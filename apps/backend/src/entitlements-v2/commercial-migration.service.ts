import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  EntitlementGrantSource,
  EntitlementGrantStatus,
  EntitlementMigrationRunStatus,
  EntitlementReconciliationStatus,
  ProductModule,
  Role,
  TenantLicenceStatus,
} from "@prisma/client";
import {
  editionAtLeast,
  PRODUCT_FEATURES,
  PRODUCT_MODULE_CATALOG,
  type CommercialProductId,
  type ProductFeatureId,
} from "@ahkmes/shared-types";
import { writeTransactionalAudit } from "../common/transactional-audit";
import { PrismaService } from "../prisma/prisma.service";
import {
  COMMERCIAL_MIGRATION_POLICY_VERSION,
  evaluateCommercialMigrationCandidate,
  validateApprovedTargets,
  type ApprovedMigrationTargets,
  type CommercialMigrationCandidate,
} from "./commercial-migration-policy";
import { ENTITLEMENT_V2_MAPPING_VERSION } from "./entitlements-v2.service";

const FEATURE_PARENT_BY_ID = new Map(PRODUCT_FEATURES.map((feature) => [feature.id, feature.productId]));

export interface CommercialMigrationDryRun {
  tenantId: string;
  mappingVersion: string;
  policyVersion: string;
  candidates: CommercialMigrationCandidate[];
}

export interface ReconcileCommercialMigrationOptions {
  /** Read-only by contract: no V2 or legacy records are written. */
  dryRun?: boolean;
  /** An explicit source subset keeps a blocked/review item from affecting unrelated candidates. */
  legacyCodes?: string[];
}

/**
 * PRODUCT-ARCH-003 commercial migration only. It is deliberately a service
 * contract (not a controller) and is never consulted by PagesGuard or APIs.
 */
@Injectable()
export class CommercialMigrationService {
  constructor(private readonly prisma: PrismaService) {}

  async dryRun(tenantId: string): Promise<CommercialMigrationDryRun> {
    const [tenant, configured] = await Promise.all([
      this.prisma.tenant.findFirst({ where: { id: tenantId }, select: { id: true, edition: true } }),
      this.prisma.tenantModuleEntitlement.findMany({ where: { tenantId }, select: { module: true, isEnabled: true } }),
    ]);
    if (!tenant) throw new NotFoundException("Tenant was not found");

    const configuredByModule = new Map(configured.map((entry) => [entry.module, entry.isEnabled]));
    const candidates = Object.values(ProductModule).map((module) => {
      const definition = PRODUCT_MODULE_CATALOG.find((entry) => entry.code === module);
      return evaluateCommercialMigrationCandidate({
        legacyCode: module,
        explicitEntitlement: configuredByModule.has(module),
        // This is current technical access only. A missing row is intentionally
        // represented as the runtime's implicit true default, never ownership.
        isEnabled: configuredByModule.get(module) ?? true,
        editionAllowsModule: definition ? editionAtLeast(tenant.edition, definition.edition) : false,
      });
    });

    return {
      tenantId,
      mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION,
      policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION,
      candidates: candidates.sort((left, right) => left.legacyCode.localeCompare(right.legacyCode)),
    };
  }

  async approveReviewCandidate(
    tenantId: string,
    approverUserId: string,
    legacyCode: string,
    targets: ApprovedMigrationTargets,
    reason: string,
  ) {
    if (!reason.trim()) throw new ConflictException("Commercial migration approval requires a reason");
    await this.assertTenantAdmin(tenantId, approverUserId);
    const candidate = await this.candidateFor(tenantId, legacyCode);
    let approved: ApprovedMigrationTargets;
    try {
      approved = validateApprovedTargets(candidate, targets);
    } catch (error) {
      throw new ConflictException((error as Error).message);
    }

    return this.prisma.$transaction(async (tx) => {
      const approval = await tx.entitlementMigrationApproval.upsert({
        where: {
          tenantId_legacyCode_mappingVersion_policyVersion: {
            tenantId,
            legacyCode,
            mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION,
            policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION,
          },
        },
        create: {
          tenantId,
          legacyCode,
          mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION,
          policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION,
          approvedProductIds: approved.productIds,
          approvedFeatureIds: approved.featureIds,
          approvedByUserId: approverUserId,
          reason: reason.trim(),
        },
        update: {
          approvedProductIds: approved.productIds,
          approvedFeatureIds: approved.featureIds,
          approvedByUserId: approverUserId,
          reason: reason.trim(),
          approvedAt: new Date(),
          revokedAt: null,
        },
      });
      await writeTransactionalAudit(tx as any, {
        tenantId,
        userId: approverUserId,
        entity: "commercial-migration-approval",
        entityId: approval.id,
        action: "UPDATE",
        after: { legacyCode, mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION, policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION, approved },
      });
      return approval;
    });
  }

  /** Read-only lookup for shadow diagnostics. Approval remains non-effective
   * until a corresponding V2 grant exists and resolves active. */
  async approvedTargets(tenantId: string, legacyCode: string): Promise<ApprovedMigrationTargets | undefined> {
    const candidate = await this.candidateFor(tenantId, legacyCode);
    if (candidate.decision !== "REVIEW_REQUIRED") return undefined;
    const approval = await this.prisma.entitlementMigrationApproval.findFirst({
      where: { tenantId, legacyCode, mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION, policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION, revokedAt: null },
      select: { approvedProductIds: true, approvedFeatureIds: true },
    });
    return approval ? this.approvedTargetsFor(candidate, approval) : undefined;
  }

  async reconcile(tenantId: string, actorUserId: string, options: ReconcileCommercialMigrationOptions = {}) {
    await this.assertTenantAdmin(tenantId, actorUserId);
    const report = await this.dryRun(tenantId);
    const candidates = this.selectCandidates(report.candidates, options.legacyCodes);
    if (options.dryRun) return { dryRun: true as const, ...report, candidates };

    const approvals = await this.prisma.entitlementMigrationApproval.findMany({
      where: { tenantId, mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION, policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION, revokedAt: null },
    });
    const approvalByLegacyCode = new Map(approvals.map((approval) => [approval.legacyCode, approval]));
    const actionable = candidates.map((candidate) => ({ candidate, approval: approvalByLegacyCode.get(candidate.legacyCode) }));

    for (const { candidate, approval } of actionable) {
      if (candidate.decision === "BLOCKED") {
        throw new ConflictException(`Commercial migration is blocked for ${candidate.legacyCode}: ${candidate.reason}`);
      }
      if (candidate.decision === "REVIEW_REQUIRED") {
        if (!approval) throw new ConflictException(`Commercial migration review is required for ${candidate.legacyCode}`);
        this.approvedTargetsFor(candidate, approval);
      }
    }

    const correlationId = this.correlationId(tenantId, actionable.map(({ candidate, approval }) => ({
      legacyCode: candidate.legacyCode,
      evidence: candidate.evidenceClassification,
      decision: candidate.decision,
      products: candidate.productIds,
      features: candidate.featureIds,
      approvalId: approval?.id ?? null,
    })));

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.entitlementMigrationRun.upsert({
        where: { tenantId_correlationId: { tenantId, correlationId } },
        create: { tenantId, mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION, policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION, actorUserId, correlationId },
        update: { actorUserId, status: EntitlementMigrationRunStatus.APPLIED, rollbackReason: null, rolledBackAt: null },
      });

      const materialized: { legacyCode: string; productIds: CommercialProductId[]; featureIds: ProductFeatureId[] }[] = [];
      for (const { candidate, approval } of actionable) {
        // Re-read review approval in the write transaction so a revocation or
        // cross-tenant tampering attempt between preflight and materialisation
        // cannot authorize a grant from a stale in-memory record.
        const currentApproval = candidate.decision === "REVIEW_REQUIRED"
          ? await tx.entitlementMigrationApproval.findFirst({
            where: { id: approval?.id, tenantId, mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION, policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION, revokedAt: null },
          })
          : undefined;
        if (candidate.decision === "REVIEW_REQUIRED" && !currentApproval) {
          throw new ConflictException(`Commercial migration review is no longer approved for ${candidate.legacyCode}`);
        }
        const targets = candidate.decision === "REVIEW_REQUIRED"
          ? this.approvedTargetsFor(candidate, currentApproval!)
          : { productIds: candidate.productIds, featureIds: candidate.featureIds };
        if (candidate.decision === "IGNORED") {
          await this.writeReconciliation(tx, tenantId, actorUserId, run.id, candidate, { productIds: [], featureIds: [] }, EntitlementReconciliationStatus.RECONCILED);
          continue;
        }
        await this.materializeTargets(tx, tenantId, run.id, candidate, targets, currentApproval?.id);
        await this.writeReconciliation(tx, tenantId, actorUserId, run.id, candidate, targets, EntitlementReconciliationStatus.RECONCILED);
        materialized.push({ legacyCode: candidate.legacyCode, ...targets });
      }

      await writeTransactionalAudit(tx as any, {
        tenantId,
        userId: actorUserId,
        entity: "commercial-migration-run",
        entityId: run.id,
        action: "CREATE",
        after: { correlationId, mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION, policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION, materialized },
      });
      return { dryRun: false as const, runId: run.id, correlationId, materialized };
    });
  }

  async rollback(tenantId: string, actorUserId: string, migrationRunId: string, reason: string) {
    if (!reason.trim()) throw new ConflictException("Commercial migration rollback requires a reason");
    await this.assertTenantAdmin(tenantId, actorUserId);
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.entitlementMigrationRun.findFirst({ where: { id: migrationRunId, tenantId } });
      if (!run) throw new NotFoundException("Commercial migration run was not found for this tenant");
      if (run.status === EntitlementMigrationRunStatus.ROLLED_BACK) return { runId: run.id, alreadyRolledBack: true };

      const [productProvenance, featureProvenance] = await Promise.all([
        tx.productGrantMigrationProvenance.findMany({ where: { tenantId, migrationRunId, revokedAt: null } }),
        tx.featureGrantMigrationProvenance.findMany({ where: { tenantId, migrationRunId, revokedAt: null } }),
      ]);
      const now = new Date();
      await tx.productGrantMigrationProvenance.updateMany({ where: { tenantId, migrationRunId, revokedAt: null }, data: { revokedAt: now } });
      await tx.featureGrantMigrationProvenance.updateMany({ where: { tenantId, migrationRunId, revokedAt: null }, data: { revokedAt: now } });

      for (const provenance of productProvenance) {
        const stillOwned = await tx.productGrantMigrationProvenance.findFirst({
          where: { tenantId, productGrantId: provenance.productGrantId, revokedAt: null }, select: { id: true },
        });
        if (!stillOwned) {
          await tx.productGrant.updateMany({
            where: { id: provenance.productGrantId, tenantId, source: EntitlementGrantSource.MIGRATED },
            data: { status: EntitlementGrantStatus.REVOKED },
          });
        }
      }
      for (const provenance of featureProvenance) {
        const stillOwned = await tx.featureGrantMigrationProvenance.findFirst({
          where: { tenantId, featureGrantId: provenance.featureGrantId, revokedAt: null }, select: { id: true },
        });
        if (!stillOwned) {
          await tx.featureGrant.updateMany({
            where: { id: provenance.featureGrantId, tenantId, source: EntitlementGrantSource.MIGRATED },
            data: { status: EntitlementGrantStatus.REVOKED },
          });
        }
      }

      await tx.entitlementMigrationRun.update({ where: { id: run.id }, data: { status: EntitlementMigrationRunStatus.ROLLED_BACK, rollbackReason: reason.trim(), rolledBackAt: now } });
      await writeTransactionalAudit(tx as any, {
        tenantId, userId: actorUserId, entity: "commercial-migration-run", entityId: run.id, action: "UPDATE",
        before: { status: run.status }, after: { status: EntitlementMigrationRunStatus.ROLLED_BACK, reason: reason.trim() },
      });
      return { runId: run.id, alreadyRolledBack: false, revokedProductGrantIds: productProvenance.map((item) => item.productGrantId), revokedFeatureGrantIds: featureProvenance.map((item) => item.featureGrantId) };
    });
  }

  private async candidateFor(tenantId: string, legacyCode: string) {
    const report = await this.dryRun(tenantId);
    const candidate = report.candidates.find((item) => item.legacyCode === legacyCode);
    if (!candidate) throw new NotFoundException(`Legacy catalogue code was not found: ${legacyCode}`);
    return candidate;
  }

  private selectCandidates(candidates: CommercialMigrationCandidate[], legacyCodes?: string[]) {
    if (!legacyCodes?.length) return candidates;
    const requested = new Set(legacyCodes);
    const selected = candidates.filter((candidate) => requested.has(candidate.legacyCode));
    if (selected.length !== requested.size) throw new NotFoundException("One or more requested legacy catalogue codes were not found");
    return selected;
  }

  private approvedTargetsFor(candidate: CommercialMigrationCandidate, approval: { approvedProductIds: unknown; approvedFeatureIds: unknown }) {
    try {
      return validateApprovedTargets(candidate, {
        productIds: this.stringArray(approval.approvedProductIds) as CommercialProductId[],
        featureIds: this.stringArray(approval.approvedFeatureIds) as ProductFeatureId[],
      });
    } catch (error) {
      throw new ConflictException(`Stored approval for ${candidate.legacyCode} is invalid: ${(error as Error).message}`);
    }
  }

  private async materializeTargets(tx: any, tenantId: string, migrationRunId: string, candidate: CommercialMigrationCandidate, targets: ApprovedMigrationTargets, approvalId?: string) {
    if (targets.productIds.length === 0) return;
    const licence = await tx.tenantLicence.upsert({
      where: { tenantId },
      create: { tenantId, status: TenantLicenceStatus.ACTIVE, planRef: "COMMERCIAL_MIGRATION" },
      update: {},
    });
    const grantByProduct = new Map<string, { id: string }>();
    for (const productId of targets.productIds) {
      const grant = await tx.productGrant.upsert({
        where: { tenantLicenceId_productId_source: { tenantLicenceId: licence.id, productId, source: EntitlementGrantSource.MIGRATED } },
        create: { tenantLicenceId: licence.id, tenantId, productId, source: EntitlementGrantSource.MIGRATED, status: EntitlementGrantStatus.ACTIVE },
        update: { status: EntitlementGrantStatus.ACTIVE, expiresAt: null },
      });
      grantByProduct.set(productId, grant);
      await tx.productGrantMigrationProvenance.upsert({
        where: { migrationRunId_legacyCode_productGrantId: { migrationRunId, legacyCode: candidate.legacyCode, productGrantId: grant.id } },
        create: { tenantId, migrationRunId, productGrantId: grant.id, legacyCode: candidate.legacyCode, mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION, policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION, approvalId },
        update: { revokedAt: null, approvalId },
      });
    }
    for (const featureId of targets.featureIds) {
      const productId = FEATURE_PARENT_BY_ID.get(featureId);
      const productGrant = productId ? grantByProduct.get(productId) : undefined;
      if (!productGrant) throw new ConflictException(`Commercial feature ${featureId} lacks its parent product grant`);
      const featureGrant = await tx.featureGrant.upsert({
        where: { productGrantId_featureId: { productGrantId: productGrant.id, featureId } },
        create: { productGrantId: productGrant.id, tenantId, featureId, source: EntitlementGrantSource.MIGRATED, status: EntitlementGrantStatus.ACTIVE },
        update: { status: EntitlementGrantStatus.ACTIVE, expiresAt: null },
      });
      await tx.featureGrantMigrationProvenance.upsert({
        where: { migrationRunId_legacyCode_featureGrantId: { migrationRunId, legacyCode: candidate.legacyCode, featureGrantId: featureGrant.id } },
        create: { tenantId, migrationRunId, featureGrantId: featureGrant.id, legacyCode: candidate.legacyCode, mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION, policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION, approvalId },
        update: { revokedAt: null, approvalId },
      });
    }
  }

  private async writeReconciliation(tx: any, tenantId: string, actorUserId: string, migrationRunId: string, candidate: CommercialMigrationCandidate, targets: ApprovedMigrationTargets, status: EntitlementReconciliationStatus) {
    return tx.entitlementReconciliation.upsert({
      where: { tenantId_legacyCode_mappingVersion_policyVersion: { tenantId, legacyCode: candidate.legacyCode, mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION, policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION } },
      create: {
        tenantId, legacyCode: candidate.legacyCode, mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION, policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION,
        legacyIsEnabled: candidate.legacyEffectiveAccess, explicitEntitlement: candidate.explicitEntitlement,
        editionContribution: candidate.editionContribution, evidenceClassification: candidate.evidenceClassification, decision: candidate.decision,
        status, projectedProductIds: targets.productIds, projectedFeatureIds: targets.featureIds,
        sourceSnapshot: { explicitEntitlement: candidate.explicitEntitlement, legacyEffectiveAccess: candidate.legacyEffectiveAccess, editionContribution: candidate.editionContribution },
        correlationId: migrationRunId, migrationRunId, actorUserId, reason: candidate.reason, reconciledAt: new Date(),
      },
      update: {
        legacyIsEnabled: candidate.legacyEffectiveAccess, explicitEntitlement: candidate.explicitEntitlement,
        editionContribution: candidate.editionContribution, evidenceClassification: candidate.evidenceClassification, decision: candidate.decision,
        status, projectedProductIds: targets.productIds, projectedFeatureIds: targets.featureIds,
        sourceSnapshot: { explicitEntitlement: candidate.explicitEntitlement, legacyEffectiveAccess: candidate.legacyEffectiveAccess, editionContribution: candidate.editionContribution },
        correlationId: migrationRunId, migrationRunId, actorUserId, reason: candidate.reason, reconciledAt: new Date(),
      },
    });
  }

  private correlationId(tenantId: string, source: unknown) {
    const hash = createHash("sha256").update(JSON.stringify(source)).digest("hex");
    return `commercial-migration:${COMMERCIAL_MIGRATION_POLICY_VERSION}:${ENTITLEMENT_V2_MAPPING_VERSION}:${tenantId}:${hash}`;
  }

  private stringArray(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("Expected a string array");
    return value;
  }

  private async assertTenantAdmin(tenantId: string, userId: string) {
    const actor = await this.prisma.user.findFirst({ where: { id: userId, tenantId, role: Role.ADMIN, isActive: true }, select: { id: true } });
    if (!actor) throw new ForbiddenException("Commercial migration requires an active tenant administrator");
  }
}

import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { PRODUCT_FEATURES, type CommercialProductId, type ProductFeatureId } from "@ahkmes/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { type CommercialMigrationCandidate } from "./commercial-migration-policy";
import { CommercialMigrationService } from "./commercial-migration.service";
import { EntitlementsV2Service } from "./entitlements-v2.service";

export const SHADOW_V2_SOURCES = [
  "PERSISTED_COMMERCIAL_GRANT",
  "APPROVED_MIGRATION",
  "AUTO_MIGRATABLE_PROJECTION",
  "REVIEW_REQUIRED_PROJECTION",
  "BLOCKED_PROJECTION",
  "NO_V2_EVIDENCE",
] as const;
export type ShadowV2Source = (typeof SHADOW_V2_SOURCES)[number];

export const SHADOW_COMPARISON_STATUSES = [
  "MATCH_ALLOW",
  "MATCH_DENY",
  "MISMATCH_LEGACY_ALLOW_V2_DENY",
  "MISMATCH_LEGACY_DENY_V2_ALLOW",
  "REVIEW_REQUIRED",
  "UNRESOLVED",
  "UNMAPPED",
] as const;
export type ShadowComparisonStatus = (typeof SHADOW_COMPARISON_STATUSES)[number];
export type ShadowAccessDecision = "ALLOW" | "DENY" | "REVIEW_REQUIRED" | "UNRESOLVED";
export type ShadowMismatchSeverity = "NONE" | "HIGH";

export interface ShadowEntitlementComparison {
  tenantId: string;
  legacyCapability: string;
  targetProductId?: CommercialProductId;
  targetFeatureId?: ProductFeatureId;
  legacyDecision: "ALLOW" | "DENY";
  legacyReason: string;
  legacyEvidence: string;
  v2Decision: ShadowAccessDecision;
  v2Reason: string;
  v2Source: ShadowV2Source;
  comparisonStatus: ShadowComparisonStatus;
  severity: ShadowMismatchSeverity;
  mappingVersion: string;
  migrationPolicyVersion: string;
  evaluatedAt: Date;
}

export interface TenantShadowAnalysis {
  tenantId: string;
  comparisons: ShadowEntitlementComparison[];
  summary: Record<ShadowComparisonStatus, number> & { total: number; highSeverity: number };
  byLegacyCapability: Record<string, number>;
  byEvidence: Record<string, number>;
}

export interface ShadowReadinessAssessment {
  tenantId: string;
  status: "READY_FOR_V2_CUTOVER_REVIEW" | "NOT_READY";
  blockers: string[];
  analysis: TenantShadowAnalysis;
}

const FEATURE_PARENT = new Map(PRODUCT_FEATURES.map((feature) => [feature.id, feature.productId]));

/**
 * Observational comparison only. It reads the same legacy state that the
 * migration policy evaluates and the existing V2 resolver; it is not injected
 * into PagesGuard or any API authorization path.
 */
@Injectable()
export class ShadowEntitlementEvaluatorService {
  constructor(
    private readonly commercialMigration: CommercialMigrationService,
    private readonly entitlementsV2: EntitlementsV2Service,
    private readonly prisma: PrismaService,
  ) {}

  async evaluateTarget(tenantId: string, legacyCapability: string, targetProductId?: CommercialProductId, targetFeatureId?: ProductFeatureId): Promise<ShadowEntitlementComparison> {
    const report = await this.commercialMigration.dryRun(tenantId);
    const candidate = report.candidates.find((item) => item.legacyCode === legacyCapability);
    if (!candidate) throw new NotFoundException(`Legacy capability was not found: ${legacyCapability}`);
    return this.evaluateCandidate(tenantId, candidate, targetProductId, targetFeatureId, report.mappingVersion, report.policyVersion);
  }

  /** Admin/developer diagnostic entry point. There is intentionally no public controller. */
  async analyzeTenant(tenantId: string, actorUserId: string): Promise<TenantShadowAnalysis> {
    await this.assertTenantAdmin(tenantId, actorUserId);
    const report = await this.commercialMigration.dryRun(tenantId);
    const comparisons = (await Promise.all(report.candidates.flatMap((candidate) => this.targetsFor(candidate)
      .map((target) => this.evaluateCandidate(tenantId, candidate, target.productId, target.featureId, report.mappingVersion, report.policyVersion))))).sort((a, b) =>
      a.legacyCapability.localeCompare(b.legacyCapability)
      || (a.targetProductId ?? "").localeCompare(b.targetProductId ?? "")
      || (a.targetFeatureId ?? "").localeCompare(b.targetFeatureId ?? ""));

    const summary = Object.fromEntries(SHADOW_COMPARISON_STATUSES.map((status) => [status, 0])) as Record<ShadowComparisonStatus, number>;
    const byLegacyCapability: Record<string, number> = {};
    const byEvidence: Record<string, number> = {};
    for (const comparison of comparisons) {
      summary[comparison.comparisonStatus] += 1;
      byLegacyCapability[comparison.legacyCapability] = (byLegacyCapability[comparison.legacyCapability] ?? 0) + 1;
      byEvidence[comparison.legacyEvidence] = (byEvidence[comparison.legacyEvidence] ?? 0) + 1;
    }
    return { tenantId, comparisons, summary: { ...summary, total: comparisons.length, highSeverity: comparisons.filter((item) => item.severity === "HIGH").length }, byLegacyCapability, byEvidence };
  }

  async assessReadiness(tenantId: string, actorUserId: string, postgresE2ePassed: boolean): Promise<ShadowReadinessAssessment> {
    const analysis = await this.analyzeTenant(tenantId, actorUserId);
    const blockers: string[] = [];
    if (!postgresE2ePassed) blockers.push("POSTGRESQL_E2E_NOT_VERIFIED");
    if (analysis.summary.MISMATCH_LEGACY_DENY_V2_ALLOW > 0) blockers.push("PRIVILEGE_EXPANSION_MISMATCH");
    if (analysis.summary.MISMATCH_LEGACY_ALLOW_V2_DENY > 0) blockers.push("ACCESS_REMOVAL_MISMATCH");
    if (analysis.summary.REVIEW_REQUIRED > 0) blockers.push("REVIEW_REQUIRED_MAPPINGS");
    if (analysis.summary.UNRESOLVED > 0 || analysis.summary.UNMAPPED > 0) blockers.push("UNRESOLVED_OR_UNMAPPED_MAPPINGS");
    return { tenantId, status: blockers.length === 0 ? "READY_FOR_V2_CUTOVER_REVIEW" : "NOT_READY", blockers, analysis };
  }

  private async evaluateCandidate(tenantId: string, candidate: CommercialMigrationCandidate, targetProductId: CommercialProductId | undefined, targetFeatureId: ProductFeatureId | undefined, mappingVersion: string, policyVersion: string): Promise<ShadowEntitlementComparison> {
    const legacyDecision = candidate.legacyEffectiveAccess ? "ALLOW" as const : "DENY" as const;
    const base = {
      tenantId, legacyCapability: candidate.legacyCode, targetProductId, targetFeatureId,
      legacyDecision, legacyReason: this.legacyReason(candidate), legacyEvidence: candidate.evidenceClassification,
      mappingVersion, migrationPolicyVersion: policyVersion, evaluatedAt: new Date(),
    };
    if (!this.isDeclaredTarget(candidate, targetProductId, targetFeatureId)) {
      return { ...base, v2Decision: "UNRESOLVED", v2Reason: "Requested product/feature is not declared by the canonical legacy mapping.", v2Source: "NO_V2_EVIDENCE", comparisonStatus: "UNMAPPED", severity: "NONE" };
    }
    if (!targetProductId) {
      return { ...base, v2Decision: "UNRESOLVED", v2Reason: "Legacy capability maps only to a platform capability, never a commercial ProductGrant.", v2Source: "NO_V2_EVIDENCE", comparisonStatus: "UNMAPPED", severity: "NONE" };
    }
    // A persisted effective grant is always reported first, even if its legacy
    // mapping is disabled/review-only. That is how shadow mode detects a real
    // privilege expansion without treating a projection as an active grant.
    const resolved = await this.entitlementsV2.resolve(tenantId, targetProductId, targetFeatureId);
    if (resolved.active) return this.compareResolved(base, resolved);
    if (candidate.decision === "REVIEW_REQUIRED") {
      const approved = await this.commercialMigration.approvedTargets(tenantId, candidate.legacyCode);
      const targetApproved = approved && approved.productIds.includes(targetProductId) && (!targetFeatureId || approved.featureIds.includes(targetFeatureId));
      if (!targetApproved) {
        return { ...base, v2Decision: "REVIEW_REQUIRED", v2Reason: "Commercial migration policy requires an approved target before V2 access can be evaluated as effective.", v2Source: "REVIEW_REQUIRED_PROJECTION", comparisonStatus: "REVIEW_REQUIRED", severity: "NONE" };
      }
      return { ...base, v2Decision: "UNRESOLVED", v2Reason: `Approved migration target has no effective persisted grant: ${resolved.reason}.`, v2Source: "APPROVED_MIGRATION", comparisonStatus: "UNRESOLVED", severity: "NONE" };
    }
    if (candidate.decision === "AUTO_MIGRATABLE") {
      return this.compareResolved(base, resolved, "AUTO_MIGRATABLE_PROJECTION");
    }
    if (candidate.decision === "BLOCKED") {
      return { ...base, v2Decision: "UNRESOLVED", v2Reason: candidate.reason, v2Source: "BLOCKED_PROJECTION", comparisonStatus: "UNRESOLVED", severity: "NONE" };
    }
    return this.compareResolved(base, { active: false, reason: "NO_EFFECTIVE_COMMERCIAL_GRANT" }, "NO_V2_EVIDENCE");
  }

  private compareResolved(base: Omit<ShadowEntitlementComparison, "v2Decision" | "v2Reason" | "v2Source" | "comparisonStatus" | "severity">, resolved: { active: boolean; reason: string }, inactiveSource: ShadowV2Source = "PERSISTED_COMMERCIAL_GRANT") : ShadowEntitlementComparison {
    if (resolved.active && base.legacyDecision === "ALLOW") return { ...base, v2Decision: "ALLOW", v2Reason: "Effective persisted V2 commercial grant.", v2Source: "PERSISTED_COMMERCIAL_GRANT", comparisonStatus: "MATCH_ALLOW", severity: "NONE" };
    if (!resolved.active && base.legacyDecision === "DENY") return { ...base, v2Decision: "DENY", v2Reason: resolved.reason, v2Source: inactiveSource, comparisonStatus: "MATCH_DENY", severity: "NONE" };
    if (resolved.active) return { ...base, v2Decision: "ALLOW", v2Reason: "Effective persisted V2 commercial grant while legacy denies access.", v2Source: "PERSISTED_COMMERCIAL_GRANT", comparisonStatus: "MISMATCH_LEGACY_DENY_V2_ALLOW", severity: "HIGH" };
    return { ...base, v2Decision: "DENY", v2Reason: resolved.reason, v2Source: inactiveSource, comparisonStatus: "MISMATCH_LEGACY_ALLOW_V2_DENY", severity: "HIGH" };
  }

  private targetsFor(candidate: CommercialMigrationCandidate): { productId?: CommercialProductId; featureId?: ProductFeatureId }[] {
    const featuresByProduct = new Map<CommercialProductId, ProductFeatureId[]>();
    for (const featureId of candidate.mappedFeatureIds) {
      const productId = FEATURE_PARENT.get(featureId);
      if (productId) featuresByProduct.set(productId, [...(featuresByProduct.get(productId) ?? []), featureId]);
    }
    if (candidate.mappedProductIds.length === 0) return [{}] as { productId?: CommercialProductId; featureId?: ProductFeatureId }[];
    return candidate.mappedProductIds.flatMap((productId) => {
      const features = featuresByProduct.get(productId) ?? [];
      return features.length > 0
        ? features.map((featureId) => ({ productId, featureId }))
        : [{ productId }];
    });
  }

  private isDeclaredTarget(candidate: CommercialMigrationCandidate, productId?: CommercialProductId, featureId?: ProductFeatureId) {
    if (!productId) return candidate.mappedProductIds.length === 0 && candidate.mappedFeatureIds.length === 0;
    if (!candidate.mappedProductIds.includes(productId)) return false;
    return !featureId || candidate.mappedFeatureIds.includes(featureId) && FEATURE_PARENT.get(featureId) === productId;
  }

  private legacyReason(candidate: CommercialMigrationCandidate) {
    if (candidate.legacyEffectiveAccess) return `Legacy technical module is effectively enabled (${candidate.evidenceClassification}).`;
    if (candidate.evidenceClassification === "EXPLICIT_DISABLED") return "Legacy module has an explicit disabled TenantModuleEntitlement row.";
    if (candidate.editionContribution) return "Legacy tenant edition denies the technical module.";
    return `Legacy technical module is not effective (${candidate.evidenceClassification}).`;
  }

  private async assertTenantAdmin(tenantId: string, actorUserId: string) {
    const actor = await this.prisma.user.findFirst({ where: { id: actorUserId, tenantId, role: Role.ADMIN, isActive: true }, select: { id: true } });
    if (!actor) throw new ForbiddenException("Shadow entitlement diagnostics require an active tenant administrator");
  }
}

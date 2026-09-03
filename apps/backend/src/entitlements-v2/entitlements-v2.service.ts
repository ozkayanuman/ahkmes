import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  EntitlementGrantSource,
  EntitlementGrantStatus,
  EntitlementReconciliationStatus,
  ProductModule,
  TenantLicenceStatus,
} from "@prisma/client";
import {
  COMMERCIAL_PRODUCTS,
  LEGACY_COMMERCIAL_PRODUCT_MAPPING,
  PLATFORM_CAPABILITIES,
  type CommercialMappingTarget,
  type CommercialProductId,
  type PlatformCapabilityId,
  type ProductFeatureId,
} from "@ahkmes/shared-types";
import { writeTransactionalAudit } from "../common/transactional-audit";
import { PrismaService } from "../prisma/prisma.service";

export const ENTITLEMENT_V2_MAPPING_VERSION = "PRODUCT-ARCH-001-v1";

export interface LegacyEntitlementState {
  module: string;
  isEnabled: boolean;
}

export interface EntitlementProjectionReconciliationItem {
  legacyCode: string;
  reason: string;
  targets: readonly CommercialMappingTarget[];
}

export interface LegacyEntitlementProjection {
  productIds: CommercialProductId[];
  featureIds: ProductFeatureId[];
  platformCapabilityIds: PlatformCapabilityId[];
  reconciliationItems: EntitlementProjectionReconciliationItem[];
}

export interface ReconcileTenantOptions {
  dryRun?: boolean;
}

export interface GrantTiming {
  startsAt?: Date;
  expiresAt?: Date | null;
}

const MAPPING_BY_LEGACY_CODE = new Map(LEGACY_COMMERCIAL_PRODUCT_MAPPING.map((mapping) => [mapping.legacyCode, mapping]));
const PRODUCT_BY_ID = new Map(COMMERCIAL_PRODUCTS.map((product) => [product.id, product]));
const FEATURE_BY_ID = new Map(COMMERCIAL_PRODUCTS.flatMap((product) => product.features.map((featureId) => [featureId, product.id] as const)));
const PLATFORM_CAPABILITY_IDS = new Set<string>(PLATFORM_CAPABILITIES.map((capability) => capability.id));

function sorted<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort() as T[];
}

/**
 * PRODUCT-ARCH-002 persistence and compatibility foundation.
 *
 * This service is deliberately not wired into PagesGuard, controllers, or the
 * legacy module runtime. Its reconcile operation is explicit, tenant-specific,
 * and safe to re-run; it never runs at application startup.
 */
@Injectable()
export class EntitlementsV2Service {
  constructor(private readonly prisma: PrismaService) {}

  projectLegacyEntitlements(legacyEntitlements: readonly LegacyEntitlementState[]): LegacyEntitlementProjection {
    const productIds = new Set<CommercialProductId>();
    const featureIds = new Set<ProductFeatureId>();
    const platformCapabilityIds = new Set<PlatformCapabilityId>();
    const reconciliationItems: EntitlementProjectionReconciliationItem[] = [];

    for (const legacy of legacyEntitlements.filter((entry) => entry.isEnabled)) {
      const mapping = MAPPING_BY_LEGACY_CODE.get(legacy.module);
      if (!mapping) continue;

      if (mapping.disposition === "SPLIT_REQUIRED") {
        reconciliationItems.push({
          legacyCode: mapping.legacyCode,
          reason: mapping.rationale,
          targets: mapping.targets,
        });
        continue;
      }

      this.collectTargets(mapping.targets, productIds, featureIds, platformCapabilityIds);
    }

    // Platform requirements are derived from effective target products. They
    // remain platform availability facts and never become ProductGrant records.
    for (const productId of productIds) {
      for (const capabilityId of PRODUCT_BY_ID.get(productId)?.platformCapabilityRequirements ?? []) {
        platformCapabilityIds.add(capabilityId);
      }
    }

    return {
      productIds: sorted(productIds),
      featureIds: sorted(featureIds),
      platformCapabilityIds: sorted(platformCapabilityIds),
      reconciliationItems: reconciliationItems.sort((a, b) => a.legacyCode.localeCompare(b.legacyCode)),
    };
  }

  async projectTenant(tenantId: string) {
    const legacy = await this.effectiveLegacyState(tenantId);
    return this.projectLegacyEntitlements(legacy);
  }

  /**
   * Retained only for source compatibility with PRODUCT-ARCH-002 callers.
   * PRODUCT-ARCH-003 disables its former unsafe materialisation path because it
   * could mistake implicit legacy technical access for commercial ownership.
   */
  async reconcileTenant(tenantId: string, actorUserId: string, options: ReconcileTenantOptions = {}) {
    const legacy = await this.effectiveLegacyState(tenantId);
    const projection = this.projectLegacyEntitlements(legacy);
    if (options.dryRun) return { dryRun: true, projection };
    throw new BadRequestException("Unsafe legacy-to-V2 materialisation is disabled; use CommercialMigrationService reconciliation policy");
  }

  /** Domain write contract for future administration surfaces; no controller consumes it yet. */
  async grantProduct(tenantId: string, actorUserId: string, productId: CommercialProductId, source: EntitlementGrantSource = EntitlementGrantSource.DIRECT, timing: GrantTiming = {}) {
    this.assertCommercialProduct(productId);
    return this.prisma.$transaction(async (tx) => {
      await this.assertActor(tx, tenantId, actorUserId);
      const licence = await tx.tenantLicence.upsert({
        where: { tenantId },
        create: { tenantId, status: TenantLicenceStatus.ACTIVE, planRef: "V2_FOUNDATION" },
        update: {},
      });
      const grant = await tx.productGrant.upsert({
        where: { tenantLicenceId_productId_source: { tenantLicenceId: licence.id, productId, source } },
        create: { tenantLicenceId: licence.id, tenantId, productId, source, status: EntitlementGrantStatus.ACTIVE, startsAt: timing.startsAt, expiresAt: timing.expiresAt },
        update: { status: EntitlementGrantStatus.ACTIVE, startsAt: timing.startsAt, expiresAt: timing.expiresAt },
      });
      await writeTransactionalAudit(tx as any, { tenantId, userId: actorUserId, entity: "entitlement-v2-product-grant", entityId: grant.id, action: "CREATE", after: grant });
      return grant;
    });
  }

  /** Feature grant validation prevents storing a canonical feature below the wrong product. */
  async grantFeature(tenantId: string, actorUserId: string, productGrantId: string, featureId: ProductFeatureId, source: EntitlementGrantSource = EntitlementGrantSource.DIRECT, timing: GrantTiming = {}) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertActor(tx, tenantId, actorUserId);
      const productGrant = await tx.productGrant.findFirst({ where: { id: productGrantId, tenantId }, select: { id: true, productId: true } });
      if (!productGrant) throw new NotFoundException("Product grant was not found for this tenant");
      this.assertCommercialProduct(productGrant.productId);
      this.assertFeatureBelongsToProduct(productGrant.productId, featureId);
      const featureGrant = await tx.featureGrant.upsert({
        where: { productGrantId_featureId: { productGrantId, featureId } },
        create: { productGrantId, tenantId, featureId, source, status: EntitlementGrantStatus.ACTIVE, startsAt: timing.startsAt, expiresAt: timing.expiresAt },
        update: { status: EntitlementGrantStatus.ACTIVE, startsAt: timing.startsAt, expiresAt: timing.expiresAt },
      });
      await writeTransactionalAudit(tx as any, { tenantId, userId: actorUserId, entity: "entitlement-v2-feature-grant", entityId: featureGrant.id, action: "CREATE", after: featureGrant });
      return featureGrant;
    });
  }

  async resolve(tenantId: string, productId: CommercialProductId, featureId?: ProductFeatureId, at = new Date()) {
    this.assertCommercialProduct(productId);
    if (featureId) this.assertFeatureBelongsToProduct(productId, featureId);

    const licence = await this.prisma.tenantLicence.findFirst({
      where: {
        tenantId,
        status: TenantLicenceStatus.ACTIVE,
        startsAt: { lte: at },
        OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
      },
      select: { id: true, status: true, expiresAt: true },
    });
    if (!licence) return { active: false, reason: "TENANT_LICENCE_INACTIVE", platformCapabilityIds: [] as PlatformCapabilityId[], limits: [] };

    const productGrant = await this.prisma.productGrant.findFirst({
      where: {
        tenantId,
        tenantLicenceId: licence.id,
        productId,
        status: EntitlementGrantStatus.ACTIVE,
        startsAt: { lte: at },
        OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
      },
      include: { featureGrants: true, limits: true },
      orderBy: { createdAt: "asc" },
    });
    if (!productGrant) return { active: false, reason: "PRODUCT_GRANT_INACTIVE", platformCapabilityIds: [] as PlatformCapabilityId[], limits: [] };

    const activeFeature = !featureId || productGrant.featureGrants.some((feature) => feature.featureId === featureId
      && feature.status === EntitlementGrantStatus.ACTIVE
      && feature.startsAt <= at
      && (!feature.expiresAt || feature.expiresAt > at));
    if (!activeFeature) return { active: false, reason: "FEATURE_GRANT_INACTIVE", productGrantId: productGrant.id, source: productGrant.source, platformCapabilityIds: [] as PlatformCapabilityId[], limits: productGrant.limits };

    return {
      active: true,
      reason: "ACTIVE",
      productGrantId: productGrant.id,
      source: productGrant.source,
      platformCapabilityIds: [...(PRODUCT_BY_ID.get(productId)?.platformCapabilityRequirements ?? [])],
      limits: productGrant.limits,
    };
  }

  async compareLegacyAndV2(tenantId: string) {
    const legacyProjection = await this.projectTenant(tenantId);
    const v2 = await Promise.all(legacyProjection.productIds.map(async (productId) => ({ productId, resolution: await this.resolve(tenantId, productId) })));
    return { mappingVersion: ENTITLEMENT_V2_MAPPING_VERSION, legacyProjection, v2 };
  }

  private async effectiveLegacyState(tenantId: string): Promise<LegacyEntitlementState[]> {
    const configured = await this.prisma.tenantModuleEntitlement.findMany({ where: { tenantId }, select: { module: true, isEnabled: true } });
    const configuredByModule = new Map(configured.map((entry) => [entry.module, entry.isEnabled]));
    return Object.values(ProductModule).map((module) => ({ module, isEnabled: configuredByModule.get(module) ?? true }));
  }

  private async assertActor(tx: any, tenantId: string, actorUserId: string) {
    const actor = await tx.user.findFirst({ where: { id: actorUserId, tenantId }, select: { id: true } });
    if (!actor) throw new NotFoundException("Entitlement actor was not found for this tenant");
  }

  private collectTargets(
    targets: readonly CommercialMappingTarget[],
    productIds: Set<CommercialProductId>,
    featureIds: Set<ProductFeatureId>,
    platformCapabilityIds: Set<PlatformCapabilityId>,
  ) {
    for (const target of targets) {
      if (target.kind === "PLATFORM_CAPABILITY") {
        platformCapabilityIds.add(target.id);
        continue;
      }
      productIds.add(target.productId);
      if (target.featureId) featureIds.add(target.featureId);
    }
  }

  private assertCommercialProduct(productId: string): asserts productId is CommercialProductId {
    if (!PRODUCT_BY_ID.has(productId as CommercialProductId) || PLATFORM_CAPABILITY_IDS.has(productId)) {
      throw new BadRequestException(`Unknown or non-sellable commercial product: ${productId}`);
    }
  }

  private assertFeatureBelongsToProduct(productId: CommercialProductId, featureId: string): asserts featureId is ProductFeatureId {
    if (FEATURE_BY_ID.get(featureId as ProductFeatureId) !== productId) {
      throw new BadRequestException(`Feature ${featureId} does not belong to product ${productId}`);
    }
  }
}

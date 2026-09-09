import {
  LEGACY_COMMERCIAL_PRODUCT_MAPPING,
  PRODUCT_FEATURES,
  type CommercialProductId,
  type ProductFeatureId,
} from "@ahkmes/shared-types";

export const COMMERCIAL_MIGRATION_POLICY_VERSION = "PRODUCT-ARCH-003-v1";

export const MIGRATION_EVIDENCE_CLASSIFICATIONS = [
  "EXPLICIT_ENABLED",
  "EXPLICIT_DISABLED",
  "IMPLICIT_DEFAULT_ENABLED",
  "EDITION_DERIVED",
  "BUNDLE_DERIVED",
  "AMBIGUOUS_SPLIT",
  "NO_EVIDENCE",
] as const;
export type MigrationEvidenceClassification = (typeof MIGRATION_EVIDENCE_CLASSIFICATIONS)[number];

export const COMMERCIAL_MIGRATION_DECISIONS = ["AUTO_MIGRATABLE", "REVIEW_REQUIRED", "BLOCKED", "IGNORED"] as const;
export type CommercialMigrationDecision = (typeof COMMERCIAL_MIGRATION_DECISIONS)[number];

export interface CommercialMigrationCandidateInput {
  legacyCode: string;
  /** A persisted TenantModuleEntitlement row exists. */
  explicitEntitlement: boolean;
  /** Current legacy toggle state, including the implicit-enabled runtime default. */
  isEnabled: boolean;
  /** Current edition guard allows the technical module at runtime. */
  editionAllowsModule: boolean;
  bundleDerived?: boolean;
}

export interface CommercialMigrationCandidate {
  policyVersion: typeof COMMERCIAL_MIGRATION_POLICY_VERSION;
  legacyCode: string;
  explicitEntitlement: boolean;
  legacyEffectiveAccess: boolean;
  editionContribution: boolean;
  evidenceClassification: MigrationEvidenceClassification;
  decision: CommercialMigrationDecision;
  /** Canonical mapping targets before policy suppresses materialisation. */
  mappedProductIds: CommercialProductId[];
  mappedFeatureIds: ProductFeatureId[];
  productIds: CommercialProductId[];
  featureIds: ProductFeatureId[];
  mappingType: "DIRECT" | "SPLIT_REQUIRED" | "UNMAPPED";
  reason: string;
}

export interface ApprovedMigrationTargets {
  productIds: CommercialProductId[];
  featureIds: ProductFeatureId[];
}

const MAPPING_BY_LEGACY_CODE = new Map(LEGACY_COMMERCIAL_PRODUCT_MAPPING.map((mapping) => [mapping.legacyCode, mapping]));
const FEATURE_PARENT_BY_ID = new Map(PRODUCT_FEATURES.map((feature) => [feature.id, feature.productId]));

function sorted<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort() as T[];
}

/**
 * Separates current technical access from commercial ownership. This is pure and
 * read-only: caller-supplied legacy state is classified before any V2 write.
 */
export function evaluateCommercialMigrationCandidate(input: CommercialMigrationCandidateInput): CommercialMigrationCandidate {
  const mapping = MAPPING_BY_LEGACY_CODE.get(input.legacyCode);
  const productIds = sorted((mapping?.targets ?? [])
    .filter((target): target is Extract<(typeof mapping extends never ? never : NonNullable<typeof mapping>["targets"][number]), { kind: "PRODUCT_FEATURE" }> => target.kind === "PRODUCT_FEATURE")
    .map((target) => target.productId));
  const featureIds = sorted((mapping?.targets ?? [])
    .filter((target): target is Extract<(typeof mapping extends never ? never : NonNullable<typeof mapping>["targets"][number]), { kind: "PRODUCT_FEATURE" }> => target.kind === "PRODUCT_FEATURE" && Boolean(target.featureId))
    .map((target) => target.featureId as ProductFeatureId));
  const mappingType = mapping?.disposition ?? "UNMAPPED";
  const legacyEffectiveAccess = input.isEnabled && input.editionAllowsModule;

  if (!mapping) {
    return candidate(input, [], [], "UNMAPPED", "NO_EVIDENCE", "BLOCKED", false, "No canonical commercial mapping exists for this technical catalogue code.");
  }
  if (input.explicitEntitlement && !input.isEnabled) {
    return candidate(input, [], [], mappingType, "EXPLICIT_DISABLED", "IGNORED", false, "Explicit legacy disable is not commercial grant evidence.", productIds, featureIds);
  }
  if (!input.editionAllowsModule) {
    return candidate(input, productIds, featureIds, mappingType, "EDITION_DERIVED", "REVIEW_REQUIRED", true, "Current access is constrained by legacy edition semantics; edition is not commercial ownership evidence.");
  }
  if (mapping.disposition === "SPLIT_REQUIRED") {
    return candidate(input, productIds, featureIds, mappingType, "AMBIGUOUS_SPLIT", "REVIEW_REQUIRED", false, "A technical bundle spans multiple potential commercial products/features and requires tenant-specific approval.");
  }
  if (!input.explicitEntitlement && input.isEnabled) {
    return candidate(input, productIds, featureIds, mappingType, "IMPLICIT_DEFAULT_ENABLED", "REVIEW_REQUIRED", false, "Legacy runtime default enables technical access but is not evidence of commercial ownership.");
  }
  if (input.bundleDerived) {
    return candidate(input, productIds, featureIds, mappingType, "BUNDLE_DERIVED", "REVIEW_REQUIRED", false, "Legacy bundle evidence requires an approved commercial migration policy.");
  }
  if (input.explicitEntitlement && input.isEnabled) {
    if (productIds.length === 0) {
      return candidate(input, [], [], mappingType, "EXPLICIT_ENABLED", "IGNORED", false, "The explicit legacy entitlement maps only to internal platform capability; no ProductGrant is created.");
    }
    return candidate(input, productIds, featureIds, mappingType, "EXPLICIT_ENABLED", "AUTO_MIGRATABLE", false, "Explicit enabled legacy entitlement with a deterministic commercial mapping.");
  }
  return candidate(input, [], [], mappingType, "NO_EVIDENCE", "BLOCKED", false, "No reliable legacy entitlement evidence exists.");
}

export function validateApprovedTargets(candidate: CommercialMigrationCandidate, requested: ApprovedMigrationTargets): ApprovedMigrationTargets {
  if (candidate.decision !== "REVIEW_REQUIRED") throw new Error("Only review-required candidates can be approved");
  const candidateProducts = new Set(candidate.productIds);
  const candidateFeatures = new Set(candidate.featureIds);
  if (requested.productIds.length === 0 && requested.featureIds.length === 0) throw new Error("Approval must select at least one declared commercial target");
  if (requested.productIds.some((productId) => !candidateProducts.has(productId))) throw new Error("Approved product is not declared by the migration candidate");
  if (requested.featureIds.some((featureId) => !candidateFeatures.has(featureId))) throw new Error("Approved feature is not declared by the migration candidate");
  if (requested.featureIds.some((featureId) => !requested.productIds.includes(FEATURE_PARENT_BY_ID.get(featureId)!))) {
    throw new Error("Approved feature requires its parent product to be selected");
  }
  return { productIds: sorted(requested.productIds), featureIds: sorted(requested.featureIds) };
}

function candidate(
  input: CommercialMigrationCandidateInput,
  productIds: CommercialProductId[],
  featureIds: ProductFeatureId[],
  mappingType: CommercialMigrationCandidate["mappingType"],
  evidenceClassification: MigrationEvidenceClassification,
  decision: CommercialMigrationDecision,
  editionContribution: boolean,
  reason: string,
  mappedProductIds: CommercialProductId[] = productIds,
  mappedFeatureIds: ProductFeatureId[] = featureIds,
): CommercialMigrationCandidate {
  return {
    policyVersion: COMMERCIAL_MIGRATION_POLICY_VERSION,
    legacyCode: input.legacyCode,
    explicitEntitlement: input.explicitEntitlement,
    legacyEffectiveAccess: input.isEnabled && input.editionAllowsModule,
    editionContribution,
    evidenceClassification,
    decision,
    mappedProductIds,
    mappedFeatureIds,
    productIds,
    featureIds,
    mappingType,
    reason,
  };
}

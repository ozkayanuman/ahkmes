import {
  COMMERCIAL_MIGRATION_POLICY_VERSION,
  evaluateCommercialMigrationCandidate,
  validateApprovedTargets,
} from "./commercial-migration-policy";

describe("PRODUCT-ARCH-003 commercial migration policy", () => {
  it("allows only an explicitly enabled deterministic MES mapping to auto-migrate", () => {
    const candidate = evaluateCommercialMigrationCandidate({
      legacyCode: "MES_EXECUTION",
      explicitEntitlement: true,
      isEnabled: true,
      editionAllowsModule: true,
    });

    expect(candidate.policyVersion).toBe(COMMERCIAL_MIGRATION_POLICY_VERSION);
    expect(candidate.evidenceClassification).toBe("EXPLICIT_ENABLED");
    expect(candidate.decision).toBe("AUTO_MIGRATABLE");
    expect(candidate.productIds).toEqual(["MES"]);
    expect(candidate.featureIds).toEqual(["MES_EXECUTION"]);
  });

  it("treats an explicit disabled row as no commercial grant", () => {
    const candidate = evaluateCommercialMigrationCandidate({
      legacyCode: "MES_EXECUTION",
      explicitEntitlement: true,
      isEnabled: false,
      editionAllowsModule: true,
    });

    expect(candidate.evidenceClassification).toBe("EXPLICIT_DISABLED");
    expect(candidate.decision).toBe("IGNORED");
    expect(candidate.productIds).toEqual([]);
  });

  it("does not convert an implicit legacy runtime default into commercial ownership", () => {
    const candidate = evaluateCommercialMigrationCandidate({
      legacyCode: "MES_EXECUTION",
      explicitEntitlement: false,
      isEnabled: true,
      editionAllowsModule: true,
    });

    expect(candidate.evidenceClassification).toBe("IMPLICIT_DEFAULT_ENABLED");
    expect(candidate.decision).toBe("REVIEW_REQUIRED");
    expect(candidate.productIds).toEqual(["MES"]);
  });

  it("keeps all split mappings in review even when technically enabled", () => {
    for (const legacyCode of ["ERP_CRM_SALES", "ERP_PROJECT_SERVICE", "MES_PERFORMANCE", "MES_CNC_TOOLING", "APS_SCHEDULING", "IIOT_HISTORIAN", "ANALYTICS_SEMANTIC_BI"]) {
      const candidate = evaluateCommercialMigrationCandidate({ legacyCode, explicitEntitlement: true, isEnabled: true, editionAllowsModule: true });
      expect(candidate.decision).toBe("REVIEW_REQUIRED");
      expect(candidate.evidenceClassification).toBe("AMBIGUOUS_SPLIT");
    }
  });

  it("requires an approval to select only targets declared by the candidate", () => {
    const candidate = evaluateCommercialMigrationCandidate({ legacyCode: "MES_CNC_TOOLING", explicitEntitlement: true, isEnabled: true, editionAllowsModule: true });

    expect(validateApprovedTargets(candidate, { productIds: ["TOOLING"], featureIds: ["TOOLING_TOOL_MANAGEMENT"] })).toEqual({ productIds: ["TOOLING"], featureIds: ["TOOLING_TOOL_MANAGEMENT"] });
    expect(() => validateApprovedTargets(candidate, { productIds: ["CRM"], featureIds: [] })).toThrow("not declared");
    expect(() => validateApprovedTargets(candidate, { productIds: ["TOOLING"], featureIds: ["FIXTURE_FIXTURE_MANAGEMENT"] })).toThrow("parent product");
  });

  it("never turns the shared-master-data platform capability into a ProductGrant candidate", () => {
    const candidate = evaluateCommercialMigrationCandidate({
      legacyCode: "ERP_MASTER_DATA", explicitEntitlement: true, isEnabled: true, editionAllowsModule: true,
    });

    expect(candidate.evidenceClassification).toBe("EXPLICIT_ENABLED");
    expect(candidate.decision).toBe("IGNORED");
    expect(candidate.productIds).toEqual([]);
    expect(candidate.featureIds).toEqual([]);
  });
});

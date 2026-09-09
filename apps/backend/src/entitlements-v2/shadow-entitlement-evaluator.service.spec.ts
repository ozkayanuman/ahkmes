import { evaluateCommercialMigrationCandidate } from "./commercial-migration-policy";
import { ShadowEntitlementEvaluatorService } from "./shadow-entitlement-evaluator.service";

describe("ShadowEntitlementEvaluatorService", () => {
  const candidate = (legacyCode: string, explicitEntitlement: boolean, isEnabled: boolean) => evaluateCommercialMigrationCandidate({
    legacyCode, explicitEntitlement, isEnabled, editionAllowsModule: true,
  });

  function build(options: { candidate: ReturnType<typeof candidate>; resolution?: { active: boolean; reason: string; source?: string }; approved?: unknown } ) {
    const migration = {
      dryRun: jest.fn().mockResolvedValue({ tenantId: "tenant-a", mappingVersion: "PRODUCT-ARCH-001-v1", policyVersion: "PRODUCT-ARCH-003-v1", candidates: [options.candidate] }),
      approvedTargets: jest.fn().mockResolvedValue(options.approved),
    };
    const v2 = { resolve: jest.fn().mockResolvedValue(options.resolution ?? { active: false, reason: "PRODUCT_GRANT_INACTIVE" }) };
    const prisma = { user: { findFirst: jest.fn().mockResolvedValue({ id: "admin-a" }) } };
    return { service: new ShadowEntitlementEvaluatorService(migration as any, v2 as any, prisma as any), migration, v2 };
  }

  it("reports MATCH_ALLOW only for an effective persisted V2 grant", async () => {
    const { service } = build({ candidate: candidate("MES_EXECUTION", true, true), resolution: { active: true, reason: "ACTIVE", source: "MIGRATED" } });
    await expect(service.evaluateTarget("tenant-a", "MES_EXECUTION", "MES", "MES_EXECUTION")).resolves.toEqual(expect.objectContaining({
      legacyDecision: "ALLOW", v2Decision: "ALLOW", v2Source: "PERSISTED_COMMERCIAL_GRANT", comparisonStatus: "MATCH_ALLOW", severity: "NONE",
    }));
  });

  it("reports a high-severity privilege-expansion mismatch without changing the legacy deny", async () => {
    const { service } = build({ candidate: candidate("MES_EXECUTION", true, false), resolution: { active: true, reason: "ACTIVE", source: "DIRECT" } });
    await expect(service.evaluateTarget("tenant-a", "MES_EXECUTION", "MES", "MES_EXECUTION")).resolves.toEqual(expect.objectContaining({
      legacyDecision: "DENY", v2Decision: "ALLOW", comparisonStatus: "MISMATCH_LEGACY_DENY_V2_ALLOW", severity: "HIGH",
    }));
  });

  it("does not treat an implicit legacy default as a V2 allow", async () => {
    const { service, v2 } = build({ candidate: candidate("MES_EXECUTION", false, true) });
    await expect(service.evaluateTarget("tenant-a", "MES_EXECUTION", "MES", "MES_EXECUTION")).resolves.toEqual(expect.objectContaining({
      legacyDecision: "ALLOW", v2Decision: "REVIEW_REQUIRED", v2Source: "REVIEW_REQUIRED_PROJECTION", comparisonStatus: "REVIEW_REQUIRED",
    }));
    expect(v2.resolve).toHaveBeenCalledWith("tenant-a", "MES", "MES_EXECUTION");
  });

  it("keeps an unapproved split mapping in review", async () => {
    const { service } = build({ candidate: candidate("MES_CNC_TOOLING", true, true) });
    await expect(service.evaluateTarget("tenant-a", "MES_CNC_TOOLING", "TOOLING", "TOOLING_TOOL_MANAGEMENT")).resolves.toEqual(expect.objectContaining({
      v2Decision: "REVIEW_REQUIRED", comparisonStatus: "REVIEW_REQUIRED",
    }));
  });

  it("reports a persisted V2 deny as a legacy-allow access-removal mismatch", async () => {
    const { service } = build({ candidate: candidate("MES_EXECUTION", true, true), resolution: { active: false, reason: "PRODUCT_GRANT_INACTIVE" } });
    await expect(service.evaluateTarget("tenant-a", "MES_EXECUTION", "MES", "MES_EXECUTION")).resolves.toEqual(expect.objectContaining({
      legacyDecision: "ALLOW", v2Decision: "DENY", comparisonStatus: "MISMATCH_LEGACY_ALLOW_V2_DENY", severity: "HIGH",
    }));
  });
});

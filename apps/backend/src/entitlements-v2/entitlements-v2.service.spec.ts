import { EntitlementsV2Service } from "./entitlements-v2.service";

describe("EntitlementsV2Service legacy compatibility projection", () => {
  const service = new EntitlementsV2Service({} as any);

  it("reports ERP CRM/Sales and Project/Service as unresolved commercial splits", () => {
    const projection = service.projectLegacyEntitlements([
      { module: "ERP_CRM_SALES", isEnabled: true },
      { module: "ERP_PROJECT_SERVICE", isEnabled: true },
    ]);

    expect(projection.productIds).toEqual([]);
    expect(projection.reconciliationItems.map((item) => item.legacyCode)).toEqual(["ERP_CRM_SALES", "ERP_PROJECT_SERVICE"]);
  });

  it("projects MES execution without an ERP product and supplies Shared Master Data as a platform capability", () => {
    const projection = service.projectLegacyEntitlements([
      { module: "MES_EXECUTION", isEnabled: true },
      { module: "ERP_MASTER_DATA", isEnabled: true },
    ]);

    expect(projection.productIds).toEqual(["MES"]);
    expect(projection.featureIds).toEqual(["MES_EXECUTION"]);
    expect(projection.platformCapabilityIds).toEqual(expect.arrayContaining(["PLATFORM_CORE", "SHARED_MASTER_DATA"]));
    expect(projection.productIds).not.toContain("ERP");
  });

  it("does not silently create grants for unresolved split mappings", () => {
    const projection = service.projectLegacyEntitlements([
      { module: "MES_CNC_TOOLING", isEnabled: true },
      { module: "APS_SCHEDULING", isEnabled: true },
    ]);

    expect(projection.productIds).toEqual([]);
    expect(projection.featureIds).toEqual([]);
    expect(projection.reconciliationItems.map((item) => item.legacyCode)).toEqual(["APS_SCHEDULING", "MES_CNC_TOOLING"]);
  });

  it("ignores disabled legacy modules", () => {
    const projection = service.projectLegacyEntitlements([
      { module: "QMS_INSPECTION", isEnabled: false },
      { module: "EAM_MAINTENANCE", isEnabled: true },
    ]);

    expect(projection.productIds).toEqual(["CMMS"]);
    expect(projection.featureIds).toEqual(["CMMS_MAINTENANCE"]);
  });

  it("rejects a platform capability as a product and rejects a feature under the wrong product before persistence", async () => {
    await expect(service.grantProduct("tenant-1", "actor-1", "SHARED_MASTER_DATA" as any)).rejects.toThrow("non-sellable");
    await expect(service.resolve("tenant-1", "CRM", "MES_OPERATOR_HMI")).rejects.toThrow("does not belong");
  });
});

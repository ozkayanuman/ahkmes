import { describe, expect, it } from "vitest";
import { editionAtLeast, ENTITLEMENT_MODULE_CATALOG, LEGACY_PRODUCT_MODULE_MIGRATION, PRODUCT_EDITIONS, PRODUCT_MODULE_CATALOG } from "./product-catalog";
import { PAGE_PRODUCT_MODULE, PRODUCT_MODULES } from "./enums";

describe("product capability catalogue", () => {
  it("has a unique canonical code for every planned or implemented product module", () => {
    const codes = PRODUCT_MODULE_CATALOG.map((item) => item.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(PRODUCT_MODULE_CATALOG.some((item) => item.implementationStatus === "MISSING")).toBe(true);
  });

  it("exposes every canonical persisted entitlement and keeps Platform Core outside tenant control", () => {
    expect(ENTITLEMENT_MODULE_CATALOG.map((item) => item.code).sort()).toEqual([...PRODUCT_MODULES].sort());
    expect(PRODUCT_MODULES).not.toContain("PLATFORM_CORE");
    expect(ENTITLEMENT_MODULE_CATALOG.every((item) => item.tenantToggleable)).toBe(true);
    expect(PRODUCT_MODULE_CATALOG.filter((item) => ["PLANNED", "MISSING"].includes(item.implementationStatus)).every((item) => !item.tenantToggleable)).toBe(true);
  });

  it("expands each disabled legacy bundle to all of its canonical child entitlements", () => {
    expect(LEGACY_PRODUCT_MODULE_MIGRATION.QUALITY).toEqual([
      "QMS_INSPECTION",
      "QMS_NCR_CAPA",
      "QMS_SPC_CALIBRATION",
    ]);
    expect(LEGACY_PRODUCT_MODULE_MIGRATION.ERP_EXTENSIONS).toContain("ERP_FINANCE");
  });

  it("maps guarded pages to independently licensable canonical entitlements", () => {
    expect(PAGE_PRODUCT_MODULE.inspections).toBe("QMS_INSPECTION");
    expect(PAGE_PRODUCT_MODULE.capa).toBe("QMS_NCR_CAPA");
    expect(PAGE_PRODUCT_MODULE["cycle-counts"]).toBe("WMS_INVENTORY_LEDGER");
    expect(PAGE_PRODUCT_MODULE["platform-modules"]).toBe("PLATFORM_CORE");
  });
});

describe("editionAtLeast", () => {
  it("FOUNDATION bir PROFESSIONAL modülü karşılamaz", () => {
    expect(editionAtLeast("FOUNDATION", "PROFESSIONAL")).toBe(false);
  });

  it("ENTERPRISE her edition'ı karşılar", () => {
    for (const required of PRODUCT_EDITIONS) {
      expect(editionAtLeast("ENTERPRISE", required)).toBe(true);
    }
  });

  it("eşit edition kendini karşılar", () => {
    expect(editionAtLeast("PROFESSIONAL", "PROFESSIONAL")).toBe(true);
  });

  it("bir üst edition bir alt edition'ı karşılar ama tersi olmaz", () => {
    expect(editionAtLeast("PROFESSIONAL", "ESSENTIALS")).toBe(true);
    expect(editionAtLeast("ESSENTIALS", "PROFESSIONAL")).toBe(false);
  });
});

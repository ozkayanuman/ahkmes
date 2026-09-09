import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_PRODUCTS,
  LEGACY_COMMERCIAL_PRODUCT_MAPPING,
  PLATFORM_CAPABILITIES,
  PRODUCT_FEATURES,
  PROVIDER_REQUIREMENTS,
} from "./commercial-product-catalog";
import { PRODUCT_MODULE_CATALOG } from "./product-catalog";

describe("PRODUCT-ARCH-001 commercial product catalogue", () => {
  it("keeps platform capabilities outside the sellable product catalogue", () => {
    const productIds = new Set<string>(COMMERCIAL_PRODUCTS.map((product) => product.id));

    expect(PLATFORM_CAPABILITIES.every((capability) => !capability.independentlySellable)).toBe(true);
    expect(PLATFORM_CAPABILITIES.every((capability) => !productIds.has(capability.id))).toBe(true);
  });

  it("gives every feature one unique parent product", () => {
    const productIds = new Set<string>(COMMERCIAL_PRODUCTS.map((product) => product.id));
    const featureIds = PRODUCT_FEATURES.map((feature) => feature.id);

    expect(new Set(featureIds).size).toBe(featureIds.length);
    expect(PRODUCT_FEATURES.every((feature) => productIds.has(feature.productId))).toBe(true);
    expect(PRODUCT_FEATURES.every((feature) => {
      const parents = COMMERCIAL_PRODUCTS.filter((product) => product.features.includes(feature.id));
      return parents.length === 1 && parents[0].id === feature.productId;
    })).toBe(true);
    expect(COMMERCIAL_PRODUCTS.every((product) => product.features.every((featureId) =>
      PRODUCT_FEATURES.some((feature) => feature.id === featureId && feature.productId === product.id),
    ))).toBe(true);
  });

  it("uses unique product and platform-capability identifiers", () => {
    const productIds = COMMERCIAL_PRODUCTS.map((product) => product.id);
    const capabilityIds = PLATFORM_CAPABILITIES.map((capability) => capability.id);

    expect(new Set(productIds).size).toBe(productIds.length);
    expect(new Set(capabilityIds).size).toBe(capabilityIds.length);
  });

  it("keeps legacy mappings valid and makes every split explicit", () => {
    const legacyCodes = new Set(PRODUCT_MODULE_CATALOG.map((module) => module.code));
    const productIds = new Set(COMMERCIAL_PRODUCTS.map((product) => product.id));
    const featureIds = new Set(PRODUCT_FEATURES.map((feature) => feature.id));
    const capabilityIds = new Set(PLATFORM_CAPABILITIES.map((capability) => capability.id));

    expect(LEGACY_COMMERCIAL_PRODUCT_MAPPING.every((mapping) => legacyCodes.has(mapping.legacyCode))).toBe(true);
    expect(LEGACY_COMMERCIAL_PRODUCT_MAPPING.every((mapping) => mapping.targets.every((target) =>
      target.kind === "PLATFORM_CAPABILITY"
        ? capabilityIds.has(target.id)
        : productIds.has(target.productId) && (!target.featureId || featureIds.has(target.featureId)
          && PRODUCT_FEATURES.some((feature) => feature.id === target.featureId && feature.productId === target.productId)),
    ))).toBe(true);
    expect(new Set(LEGACY_COMMERCIAL_PRODUCT_MAPPING.map((mapping) => mapping.legacyCode))).toEqual(legacyCodes);
    expect(LEGACY_COMMERCIAL_PRODUCT_MAPPING.filter((mapping) => mapping.disposition === "SPLIT_REQUIRED")
      .every((mapping) => mapping.targets.length > 1 && mapping.rationale.length > 0)).toBe(true);
  });

  it("models standalone products as commercial identities, not product dependencies", () => {
    const byId = new Map(COMMERCIAL_PRODUCTS.map((product) => [product.id, product]));

    expect(byId.get("MES")?.commercialDependencies).toEqual([]);
    expect(byId.get("QMS")?.commercialDependencies).toEqual([]);
    expect(byId.get("CMMS")?.commercialDependencies).toEqual([]);
    expect(byId.get("HR")?.independentlySellable).toBe(true);
    expect(byId.get("CRM")?.independentlySellable).toBe(true);
  });

  it("treats provider requirements as integration contracts, never product entitlements", () => {
    const productIds = new Set<string>(COMMERCIAL_PRODUCTS.map((product) => product.id));
    const providerIds = new Set<string>(PROVIDER_REQUIREMENTS.map((requirement) => requirement.id));

    expect(PROVIDER_REQUIREMENTS.every((requirement) => !productIds.has(requirement.id))).toBe(true);
    expect(COMMERCIAL_PRODUCTS.every((product) => product.providerRequirements.every((requirement) =>
      providerIds.has(requirement.requirementId),
    ))).toBe(true);
  });
});

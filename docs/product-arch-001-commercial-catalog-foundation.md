# PRODUCT-ARCH-001 — Commercial Product Catalog Foundation

> Status: **Implemented foundation only.** `packages/shared-types/src/commercial-product-catalog.ts` adds target identifiers and metadata; it is not an entitlement runtime or a migration.

## Boundary and source of truth

The current technical catalogue (`product-catalog.ts`), persisted `ProductModule` enum, tenant-module rows, edition checks, `PagesGuard`, routes, APIs, and UI visibility all remain unchanged. The commercial catalogue is additive and declarative. It must not grant or deny access before PRODUCT-ARCH-002 introduces and proves a compatibility resolver.

| Concept | Meaning | Licence? |
|---|---|---|
| Platform capability | Internal shared runtime or canonical data contract. | No |
| Sellable product | Independently sellable commercial identity, such as `MES`, `QMS`, or `HR`. | Future product-grant subject |
| Product feature | Capability with exactly one sellable-product parent, such as `MES_OPERATOR_HMI`. | Future feature-grant subject |
| Provider requirement | Integration contract, such as `BOM_PROVIDER` or `OPERATION_CONTEXT_PROVIDER`. | Never |

`SHARED_MASTER_DATA` is explicitly a platform capability, not ERP functionality. It owns canonical identity/reference concepts: Material/Item/Part, UOM, Plant/Site, Machine, Work Center/Resource, Warehouse, Customer/Supplier base identity, Person, and calendar/reference data. Products may own profiles but never copy canonical identities: CRM segmentation/activity, Procurement qualification, MES execution context, CNC controller profile, CMMS maintenance/asset profile, PLM engineering structure, and HR workforce profile.

## Deliberately separate graphs

The platform graph contains internal capabilities only:

```text
PLATFORM_CORE
├── ENTITLEMENT_RUNTIME
├── PLATFORM_AUDIT
├── PLATFORM_DOCUMENTS
├── PLATFORM_WORKFLOW
├── PLATFORM_INTEGRATION
├── PLATFORM_NOTIFICATION
├── PLATFORM_OPERATIONS
└── SHARED_MASTER_DATA
```

The commercial graph has no hard product-to-product dependency in this foundation. Every product has an explicit empty `commercialDependencies` list; useful native AHK connections belong in `nativeOptionalIntegrations`. MES therefore has no commercial ERP dependency (there is no target ERP SKU), and QMS, CMMS, HR, and CRM can stand alone.

Provider requirements are separate from both graphs. MES requires process-definition and resource-context providers and may use inventory execution, NC-program, and machine-data providers. CNC requires an operation-context provider. AHK products may satisfy these later, but approved external providers can satisfy the same contracts; no adapter is implemented here.

## Catalogue, mappings, and examples

`COMMERCIAL_PRODUCTS`, `PRODUCT_FEATURES`, `PLATFORM_CAPABILITIES`, `PROVIDER_REQUIREMENTS`, and `LEGACY_COMMERCIAL_PRODUCT_MAPPING` are exported from `@ahkmes/shared-types`. Product status (`PLANNED`, `FOUNDATION`, `PARTIAL`, `AVAILABLE`) is separate from commercial identity; this foundation marks no target product AVAILABLE merely from catalogue presence.

The mapping is exhaustive for the current technical catalogue and does not migrate tenants. Explicit `SPLIT_REQUIRED` cases are:

- `ERP_CRM_SALES` → `CRM` + `SALES`
- `ERP_PROJECT_SERVICE` → `PROJECT` + `SERVICE`
- `MES_PERFORMANCE` → MES performance + OEE core
- `MES_CNC_TOOLING` → Tooling management/life + Fixture management
- `APS_SCHEDULING` → APS finite scheduling + MRP II capacity planning
- `IIOT_HISTORIAN` → CNC machine data + Analytics reporting
- `ANALYTICS_SEMANTIC_BI` → Analytics reporting + dashboards

These are not tenant-grant instructions. PRODUCT-ARCH-002 must reconcile them against contracts and tenant evidence rather than guessing.

Target configuration examples (not current entitlement behavior): MES-only; CRM-only; HR-only; QMS-only; MES + CNC; AHK MES + external ERP; AHK CNC + external MES; and Full Enterprise bundles. A bundle may later materialize independent grants but must not alter ownership or create hidden dependencies.

## Non-goals and PRODUCT-ARCH-002 boundary

This slice includes no Prisma schema/migration, `TenantLicence`, `ProductGrant`, `FeatureGrant`, entitlement projection, edition/PageGuard change, route/API/entity move, frontend navigation coupling, or provider adapter.

PRODUCT-ARCH-002 should first deliver a read-only compatibility projection: product/feature grant data contract, effective resolver interface, versioned migration ledger/reconciliation, and legacy-tenant acceptance tests. Current enforcement remains authoritative until projection, rollback, and tenant behavior are proved.

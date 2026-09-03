# AHKMES Commercial Product Architecture

> Status: **Approved target architecture.** PRODUCT-ARCH-001 implements only
> the additive catalogue foundation documented in
> `docs/product-arch-001-commercial-catalog-foundation.md`; the existing
> application catalogue and entitlement behaviour remain unchanged.
>
> Evidence baseline: current repository `HEAD` (`74fa6bf`, 2026-08-10). Source code takes precedence over older coverage documents and the 2026-08-03 Graphify report.

## 1. Decision summary

AHKMES must license **business products**, not technical implementation bundles. The present catalogue is a useful implementation inventory, but it combines commercial products (`ERP_CRM_SALES`, `ERP_PROJECT_SERVICE`), calls shared data `ERP_MASTER_DATA`, and derives most entitlement checks from UI pages. That prevents a clean promise such as "MES without ERP" even when the customer is willing to provide material, plant, machine, and stock data through AHKMES shared data or an external ERP integration.

The target is a modular monolith with one canonical data model and three explicit layers:

1. **Platform capability**: mandatory shared infrastructure. It is not an ERP business SKU and cannot be bought, disabled, or used as a proxy for an ERP licence.
2. **Sellable product**: a commercial SKU with its own entitlement, value proposition, pages, APIs, permissions, lifecycle, and optional integrations.
3. **Feature / module**: a scoped capability within a product or an optional add-on. A feature is never inferred merely from the presence of a page or database table.

The central decision is that **SHARED_MASTER_DATA is an internal platform capability, not a separately purchasable entitlement**. It is included wherever needed, while product-specific profiles and workflows remain owned by the product that sells them. This removes `MES -> ERP_MASTER_DATA` without duplicating Material, Part, Plant, Machine, UOM, Customer, or Supplier identities.

## 2. Scope, non-goals, and evidence

### Scope

This document defines the commercial and entitlement architecture before further feature work. It covers product boundaries, dependencies, routes/APIs/permissions, licensing, migration, and backward compatibility.

### Non-goals

- No Prisma migration, module refactor, route move, page rename, or entitlement change is made here.
- This does not claim that planned products are implemented or commercially ready.
- This does not prescribe microservices. The current NestJS modular monolith remains a suitable delivery shape while product boundaries are clarified.

### Current-source evidence

- `packages/shared-types/src/product-catalog.ts` defines 38 technical catalogue records and 26 persisted toggleable product-module codes.
- `packages/shared-types/src/enums.ts` maps page keys to those current technical codes. For example, HMI maps to `MES_EXECUTION`, tooling maps to `MES_CNC_TOOLING`, and materials/parts/suppliers map to `ERP_MASTER_DATA`.
- `apps/backend/src/common/guards/pages.guard.ts` enforces page permission, edition, and disabled-module checks when a controller has the required decorator. `apps/web/src/components/page-guard.tsx` mirrors it only for UX; the API is the enforcement point.
- `apps/backend/src/platform-modules/platform-modules.service.ts` persists only `(tenantId, module, isEnabled)` and edition. It has no expiry, quantity limit, trial, commercial product, or feature entitlement.
- The Prisma schema has canonical, tenant-scoped operational entities such as `Tenant`, `Plant`, `Material`, `Part`, `Machine`, `Warehouse`, `Bin`, `Customer`, `Supplier`, `WorkOrder`, `InventoryMovement`, and `TenantModuleEntitlement`.
- `apps/backend/src/prisma/tenant-scope.extension.ts` and `TenantContextInterceptor` establish application-level tenant filtering. This is a shared platform control, not a product entitlement.

## 3. Three concepts

| Concept | Definition | Licence behaviour | Examples |
|---|---|---|---|
| **PLATFORM CAPABILITY** | Shared technical/domain infrastructure required to run one or more products. It provides stable contracts and canonical identities. | Always available to the tenant when an entitled product needs it; not separately sold or disabled through a product toggle. | identity, tenant isolation, audit, shared master data, entitlement runtime, documents, integration contracts |
| **SELLABLE PRODUCT** | A commercially named SKU that creates customer value independently and has a clear business owner. It owns its product-level policy, routes, APIs, permissions, and feature set. | Licensed explicitly per tenant; may be bundled; may depend on platform capabilities and capability contracts. | MES, CRM, QMS, CMMS, WMS, Finance |
| **FEATURE / MODULE** | A bounded capability belonging to one sellable product, or a separately priced add-on within that product. | Evaluated under its parent product entitlement; can have a separate feature grant only when commercially needed. | MES Operator HMI, CNC DNC, QMS SPC, WMS RF scanning, AI command gateway |

### Invariants

1. A customer must never need an `ERP` product licence solely to create/read shared Material, Part, Plant, Machine, UOM, warehouse, or organizational data for MES, QMS, WMS, PLM, CMMS, or CNC.
2. There is one canonical record for each shared identity. Products add product-owned profiles and relations; they do not clone master data.
3. API/command enforcement, not SPA navigation hiding, is authoritative.
4. A product dependency is a capability contract, not automatically a commercial SKU dependency. An AHK product, an external integration, or a customer-managed source can satisfy a contract where the product supports that model.
5. Entitlement checks must be deterministic, tenant scoped, auditable, and safe during licence expiry or downgrade.

## 4. Current architecture problems

1. **Commercial and technical taxonomy are mixed.** `PRODUCT_SUITES` contains technical suites, while `ERP_CRM_SALES` and `ERP_PROJECT_SERVICE` combine commercially distinct products.
2. **Shared master data is incorrectly branded as ERP.** `MES_EXECUTION -> PLM_PRODUCT_STRUCTURE -> ERP_MASTER_DATA` and `MES_EXECUTION -> WMS_INVENTORY_LEDGER -> ERP_MASTER_DATA` makes MES appear ERP-dependent.
3. **Current page ownership is too coarse.** `hmi-operations` is owned by `MES_EXECUTION`; tooling and fixture share `MES_CNC_TOOLING`; no product/feature boundary exists for HMI, tooling, or fixture.
4. **The guard is page-first.** `PagesGuard` is strong for decorated HTTP controllers, but the model must become command/API capability-first so non-page APIs, background jobs, webhook consumers, Socket.IO commands, and future tools receive the same check.
5. **Entitlement persistence is insufficient for commercial licensing.** It stores enabled/disabled and tenant edition only; it cannot model product licence terms, feature grants, quantities, trial, expiry, subscription, or entitlement source.
6. **Edition is being used as a commercial bundle and an authorization gate.** It should be a packaging/pricing policy, while explicit product and feature grants remain the entitlement source of truth.
7. **No dependency type distinguishes a required AHK SKU from a required domain capability.** That distinction is what allows MES-only customers to use external ERP data without duplicate masters.

## 5. Target platform capabilities

These are internal capabilities. They may have operational costs and be described in contracts, but are not sellable ERP modules.

| ID | Capability | Canonical responsibility | Current evidence / gap |
|---|---|---|---|
| `PLATFORM_CORE` | Runtime, tenancy, identity, authorization, audit baseline | tenant context, JWT/LDAP/OIDC, RBAC/page/action guard, audit infrastructure | Exists partially; MFA, ABAC, RLS decision, account policy, and audit coverage remain gaps. |
| `ENTITLEMENT_RUNTIME` | Resolve product/feature/limit grants and enforce them | tenant, product/feature grants, limits, effective dates, audit | Current `TenantModuleEntitlement` is only a narrow precursor. |
| `SHARED_MASTER_DATA` | Canonical shared identities and reference data | organization/site/resource, UOM, item/part/material identity, business-party base identity, calendars/currency references | Existing records are distributed and currently labelled partly as ERP. |
| `PLATFORM_DOCUMENTS` | attachment/storage/security/controlled-document substrate | MinIO object, metadata, access, document link | Current attachment model exists; controlled-document lifecycle is incomplete. |
| `PLATFORM_WORKFLOW` | reusable approval/task/state policy primitives | approval, task, escalation, e-sign policy | Current `ApprovalRequest` is a narrow precursor. |
| `PLATFORM_INTEGRATION` | API, events, adapter contracts, idempotency, delivery | REST, webhooks, outbox/inbox, connector registry | Current webhook/DLQ and outbox models are partial. |
| `PLATFORM_OPERATIONS` | health, observability, backup/recovery, deployment policy | telemetry, logs, backup/restore, secrets | Current Compose/health baseline is partial. |
| `PLATFORM_NOTIFICATION` | in-app and channel-neutral notification delivery | notification intent, recipient, delivery policy | Current in-app notification model exists. |

### Shared master-data ownership model

`SHARED_MASTER_DATA` owns **identity and reference truth**, not every business lifecycle:

- Organization: legal organization, plant/site, physical unit, work center/resource identity, calendars, timezone, UOM, currency reference.
- Item identity: canonical Material/Part/Item identity, revision identity, base units, traceability policy references.
- Business-party identity: canonical Customer/Supplier/Contact identity and addresses.
- Resource identity: Machine, Tool, Fixture, employee/person identity; product-specific competence, maintenance, tooling-life, or commercial fields stay in the owning product profile.

Examples of product extensions: CRM owns customer segmentation and activities; Procurement owns supplier qualification; Inventory owns stock policy and balance; PLM owns BOM and engineering revision; MES owns execution availability and assignment; CMMS owns asset-maintenance profile; CNC owns controller/capability profile.

### Required metadata for non-sellable platform capabilities

| ID / name | Independently sellable | Required / optional dependencies | Forbidden artificial dependency | Owned pages / APIs / permissions | Owned domains and entitlement |
|---|---:|---|---|---|---|
| `PLATFORM_CORE` / AHK Platform Core | No | Required by every product; no optional commercial dependency | It must never be presented as an ERP, MES, CRM, or Finance purchase requirement. | `/login`, `/users`, `/audit-log`, `/platform/*`; `/auth/*`, `/users`, `/permissions`, `/platform/*`; `platform.*`, `identity.*`, `audit.read` | Tenant, identity, session, role/page/action authorization, tenant context, audit baseline. Always-on platform policy, never a tenant product toggle. |
| `SHARED_MASTER_DATA` / Shared Master Data | No | PLATFORM_CORE; consumed by every product that needs canonical identities | It must never require `ERP`, `CRM`, `MES`, `INVENTORY`, or `PLM` purchase. | No independently marketed end-user product surface. Administrative master-data surfaces are exposed only through an entitled consuming product; `/master-data/*` APIs; `master-data.read/write` checks composed with the caller product entitlement. | Organization/site/resource, UOM, item/part/material identity, business-party base identity, reference calendars/currency. Always available internal capability; product-specific profiles remain product owned. |

## 6. Target sellable product catalogue

Pages, APIs, permissions, and entity names below are **target ownership declarations**. Existing names are mapped where they already exist; planned names do not imply implementation.

| ID / commercial name | Independently sellable | Required platform capabilities | Optional product dependencies | Forbidden artificial dependencies | Owned pages / APIs / permissions | Owned domains and entitlement |
|---|---:|---|---|---|---|---|
| `CRM` / AHK CRM | Yes | PLATFORM_CORE, SHARED_MASTER_DATA | SALES, SERVICE, ANALYTICS | SALES or ERP | `/customers`, `/leads`, `/opportunities`, `/crm`; `/customers`, `/leads`, `/opportunities`; `crm.read/write` | Customer profile, contacts, leads, opportunities, activities, segmentation. `CRM` product + CRM feature grants. |
| `SALES` / AHK Sales | Yes | PLATFORM_CORE, SHARED_MASTER_DATA | CRM, INVENTORY, MRP, TMS, FINANCE | CRM, ERP, PROCUREMENT | `/rfq`, `/quotes`, `/sales-orders`, `/deliveries`; matching APIs; `sales.read/write/approve` | RFQ, quote, price/contract, sales order, delivery request. `SALES` + pricing/ATP/returns features. |
| `PROCUREMENT` / AHK Procurement | Yes | PLATFORM_CORE, SHARED_MASTER_DATA | INVENTORY, MRP, QMS, FINANCE | ERP, CRM | `/suppliers`, `/procurement`, `/purchase-orders`; matching APIs; `procurement.read/write/approve` | Supplier profile extension, requisition, supplier RFQ, PO, receipt, supplier invoice linkage. `PROCUREMENT` + SRM/subcontracting features. |
| `INVENTORY` / AHK Inventory | Yes | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_AUDIT | WMS, MRP, MES, QMS, FINANCE | ERP, WMS | `/inventory`, `/warehouses`, `/lots`, `/serial-numbers`, `/transfers`, `/cycle-counts`; matching APIs; `inventory.read/post/adjust` | Stock policy, immutable inventory ledger, balance, lot/serial, reservation/allocation. `INVENTORY` + traceability feature. |
| `WMS` / AHK WMS | Yes | PLATFORM_CORE, SHARED_MASTER_DATA | INVENTORY, TMS, ANALYTICS | ERP, MES | `/wms/*`; WMS task/handheld APIs; `wms.execute/manage` | Warehouse topology, putaway, picking, packing, handling unit, RF/RFID tasks. `WMS` requires an inventory-provider capability; AHK Inventory is the standard provider. |
| `MRP` / AHK MRP | Yes | PLATFORM_CORE, SHARED_MASTER_DATA | INVENTORY, PLM, SALES, PROCUREMENT, SCM | ERP, MES | `/mrp`; run/proposal/exception APIs; `mrp.run/approve` | Demand, BOM-provider adapter, supply netting, proposals, pegging. `MRP` can consume external ERP demand/stock/BOM contracts. |
| `MRP_II` / AHK MRP II | Yes | PLATFORM_CORE, SHARED_MASTER_DATA | MRP, MES, CMMS | ERP, APS | `/capacity`; capacity APIs; `mrp.capacity.read/run` | Resource calendar, capacity model, RCCP/CRP/load. `MRP_II` + capacity simulation feature. |
| `APS` / AHK APS | Yes | PLATFORM_CORE, SHARED_MASTER_DATA | MRP, MRP_II, MES, CMMS, TOOLING, FIXTURE | ERP | `/scheduling`; schedule/scenario APIs; `aps.schedule/simulate` | Constraint model, sequence, finite schedule, scenario. Product dependencies are data-provider integrations, not ERP purchase requirements. |
| `MES` / AHK MES | Yes | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_AUDIT, PLATFORM_NOTIFICATION | PLM, INVENTORY, QMS, MRP, CNC, TOOLING, FIXTURE, OEE | ERP, CRM, SALES, PROCUREMENT | `/work-orders`, `/production`, `/hmi`, `/genealogy`, `/shift-report`; execution APIs; `mes.execute/dispatch/complete` | Work order, operation, run, WIP, operator execution, as-built record. `MES` + HMI/genealogy/electronic-instruction features. |
| `CNC` / AHK CNC | Yes, add-on or standalone with external MES context | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_INTEGRATION | MES, PLM, OEE, TOOLING, FIXTURE | ERP, mandatory AHK MES | `/machines`, `/automation-gateway`, `/cnc`; connector/DNC APIs; `cnc.connect/dnc.deploy` | CNC machine/controller profile, connector, telemetry, DNC, NC verification. Requires an operation-context provider; AHK MES is one provider. |
| `TOOLING` / AHK Tooling | Yes | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_AUDIT | MES, CNC, CMMS, COSTING | ERP, mandatory MES | `/tooling`; tool/setup APIs; `tooling.manage/verify/life.adjust` | Tool definition/component/assembly/instance, compatibility, life, setup. `TOOLING` + life/presetting features. |
| `FIXTURE` / AHK Fixture | Yes | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_AUDIT | MES, CNC, CMMS, COSTING | ERP, mandatory MES | `/fixtures` (initially can remain within tooling UI); fixture APIs; `fixture.manage/verify` | Fixture definition/instance/compatibility, setup, maintenance/calibration policy. `FIXTURE` + maintenance/calibration features. |
| `QMS` / AHK Quality | Yes | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_AUDIT, PLATFORM_WORKFLOW | MES, INVENTORY, PROCUREMENT, CMMS, ANALYTICS | MES, ERP | `/inspections`, `/non-conformances`, `/capa`, `/spc`, `/quality-plans`; quality APIs; `quality.inspect/ncr/approve` | Plan, inspection, NCR, CAPA, SPC, calibration-quality profile. `QMS` + advanced quality feature. |
| `CMMS` / AHK Maintenance | Yes | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_AUDIT | MES, CNC, OEE, INVENTORY, PROCUREMENT | MES, ERP | `/maintenance-orders`, `/assets`; maintenance APIs; `maintenance.plan/execute` | Asset-maintenance profile, request, PM, corrective work, failure, spare consumption. `CMMS` + reliability feature. |
| `OEE` / AHK Manufacturing Intelligence | Yes | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_INTEGRATION | MES, CNC, CMMS, ANALYTICS | MES, ERP | `/oee`, `/andon`; KPI APIs; `oee.read/configure` | State/downtime model, OEE/KPI/Andon. Supports manual, MES, or CNC data providers. |
| `PLM` / AHK PLM | Yes | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_DOCUMENTS, PLATFORM_WORKFLOW | MES, CNC, MRP, QMS | ERP, MES | `/parts`, `/recipes`, `/plm`; BOM/routing/revision APIs; `plm.read/release/change` | Item engineering profile, EBOM/MBOM, routing, revision, ECR/ECO, controlled documents, NC program. `PLM` + NC control/change-control features. |
| `COSTING` / AHK Manufacturing Costing | Yes | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_AUDIT | MES, INVENTORY, TOOLING, FIXTURE, CMMS, FINANCE | ERP, FINANCE | `/costing`; cost rollup/job-cost APIs; `costing.read/run` | Cost policy, rates, rollup, variance, work-order cost. Finance posting is optional. |
| `FINANCE` / AHK Finance | Yes | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_AUDIT | SALES, PROCUREMENT, COSTING, TMS | ERP umbrella product | `/finance`, `/ar`, `/ap`; finance APIs; `finance.read/post/close` | GL, AR/AP, cash/bank, tax, localizations. `FINANCE` + country-localization features. |
| `HR` / AHK HR | Yes | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_DOCUMENTS | MES, CMMS, PROJECT, FINANCE | MES, ERP | `/hr/*`; employee/skills/attendance APIs; `hr.read/manage` | Employee profile, skills, training, attendance, workforce. Payroll is a feature/localization, not a requirement for HR Core. |
| `PROJECT` / AHK Project / ETO | Yes | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_DOCUMENTS | SALES, MES, PROCUREMENT, INVENTORY, COSTING, QMS | ERP, MES | `/projects`; project/WBS APIs; `project.read/manage` | Project, WBS, milestone, project context/profile. `PROJECT` + ETO/CTO/MTO features. |
| `SERVICE` / AHK Service | Yes | PLATFORM_CORE, SHARED_MASTER_DATA, PLATFORM_DOCUMENTS | CRM, INVENTORY, PROCUREMENT, FINANCE, PROJECT | CRM, ERP | `/service/*`; ticket/field-service APIs; `service.read/manage` | Installed base, service ticket/work order, warranty/SLA. `SERVICE` + field-service/RMA features. |
| `SCM` / AHK Demand Planning | Yes | PLATFORM_CORE, SHARED_MASTER_DATA | MRP, PROCUREMENT, SALES, INVENTORY, ANALYTICS | ERP | `/scm/*`; forecast/S&OP APIs; `scm.plan` | Forecast, consensus, S&OP, supplier capacity, inventory optimization. |
| `TMS` / AHK Transport | Yes | PLATFORM_CORE, SHARED_MASTER_DATA | SALES, WMS, INVENTORY, FINANCE | ERP, WMS | `/tms/*`; shipment/carrier APIs; `tms.plan/execute` | Shipment, carrier, route, freight, proof-of-delivery. |
| `ANALYTICS` / AHK Analytics | Yes | PLATFORM_CORE, SHARED_MASTER_DATA | any product data provider | ERP, MES | `/reports`, `/analytics/*`; report/query APIs; `analytics.read/design` | KPI, semantic model, dashboard, report, export. Features are product-data connectors and scheduled reporting. |
| `AI` / AHK AI Copilot | Yes, as a governed add-on | PLATFORM_CORE, ENTITLEMENT_RUNTIME, PLATFORM_AUDIT, PLATFORM_WORKFLOW | ANALYTICS, PLATFORM_DOCUMENTS, any target product | blanket ERP access; bypass of product permission or feature entitlement | `/copilot`; draft/action APIs; `ai.use/action` | Prompt/session/action proposal, knowledge source reference, policy/audit. Each tool belongs to its target product and must re-check its product/feature entitlement. |

`PLATFORM_CORE` and `SHARED_MASTER_DATA` are deliberately absent from the table as sellable products: both are **not independently sellable**. They are mandatory platform capabilities.

## 7. Exact dependency graph

### 7.1 Current graph (catalogue dependencies)

```text
PLATFORM_CORE
├─ ERP_MASTER_DATA
│  ├─ ERP_CRM_SALES
│  ├─ ERP_PROCUREMENT
│  ├─ ERP_FINANCE
│  ├─ ERP_PROJECT_SERVICE
│  ├─ WMS_INVENTORY_LEDGER
│  │  └─ WMS_TRACEABILITY
│  │     └─ MES_GENEALOGY
│  ├─ PLM_PRODUCT_STRUCTURE
│  │  ├─ PLM_NC_PROGRAM
│  │  │  ├─ MES_CNC_TOOLING
│  │  │  │  └─ MES_OPERATOR_HMI (catalogue-only child)
│  │  │  └─ MES_DNC (planned)
│  │  └─ MES_EXECUTION
│  │     ├─ MES_GENEALOGY
│  │     ├─ MES_PERFORMANCE
│  │     ├─ QMS_INSPECTION
│  │     └─ APS_SCHEDULING
│  ├─ EAM_MAINTENANCE
│  └─ APS_MRP
├─ PLATFORM_DOCUMENTS → PLM_PRODUCT_STRUCTURE, PLM_NC_PROGRAM
├─ PLATFORM_AUDIT → WMS_INVENTORY_LEDGER
├─ PLATFORM_INTEGRATION → IIOT_MACHINE_CONNECT
├─ IIOT_MACHINE_CONNECT → MES_PERFORMANCE, MES_DNC, EAM_RELIABILITY
├─ QMS_INSPECTION → QMS_NCR_CAPA, QMS_SPC_CALIBRATION, QMS_ADVANCED
└─ APS_MRP + MES_EXECUTION + EAM_MAINTENANCE → APS_SCHEDULING
```

The problematic commercial path is explicit: `MES_EXECUTION` ultimately requires `ERP_MASTER_DATA`. The existing current page map also makes CRM/Sales, Projects/Service, and Tooling/Fixture commercially inseparable.

### 7.2 Target graph (dependency DAG)

```text
PLATFORM_CORE
├─ ENTITLEMENT_RUNTIME
├─ PLATFORM_DOCUMENTS
├─ PLATFORM_WORKFLOW
├─ PLATFORM_INTEGRATION
├─ PLATFORM_NOTIFICATION
└─ SHARED_MASTER_DATA
   ├─ CRM                 ─┐
   ├─ SALES               ├─ optional commercial/product integrations
   ├─ PROCUREMENT         │
   ├─ INVENTORY ─ WMS     │
   ├─ PLM                 │
   ├─ MRP ─ MRP_II ─ APS  │
   ├─ MES ─ CNC           │
   │      ├─ TOOLING      │
   │      ├─ FIXTURE      │
   │      └─ OEE          │
   ├─ QMS                 │
   ├─ CMMS                │
   ├─ COSTING ─ FINANCE   │
   ├─ HR                  │
   ├─ PROJECT             │
   ├─ SERVICE             │
   ├─ SCM                 │
   ├─ TMS                 │
   └─ ANALYTICS ─ AI      ┘
```

Edges from the product graph are typed:

- **Hard platform edge:** every product needs PLATFORM_CORE and SHARED_MASTER_DATA.
- **Capability-provider edge:** MES needs process definition, material availability, and resource context; each can be supplied by AHK PLM/Inventory/Tooling or an external certified adapter.
- **Optional product edge:** an entitled AHK product adds native integration but is not required to buy another SKU. Example: QMS can inspect a standalone lot, or attach to MES operations when MES is entitled.
- **Feature edge:** `CNC.DNC` needs `CNC` and an NC-program provider; `MES.OperatorHMI` needs `MES`; it does not create a new ERP dependency.

## 8. Removing `MES -> ERP_MASTER_DATA` safely

### Target contract

Replace the *commercial* dependency with three capability contracts:

| MES need | Canonical source | Accepted provider |
|---|---|---|
| Material/Part/UOM/traceability identity | SHARED_MASTER_DATA | AHK canonical registry; external ERP synchronization adapter writes/updates according to ownership policy |
| Plant/Machine/Work center/resource identity | SHARED_MASTER_DATA | AHK registry; external MES/CMMS/CNC adapter where approved |
| Availability, reservation, consumption and finished-goods posting | Inventory execution contract | AHK INVENTORY, or an external ERP/WMS adapter with idempotent commands and reconciliation |
| Routing/process instruction | Process-definition contract | AHK PLM, an MES-local released route feature, or a controlled external PLM/ERP import |

MES therefore always has the data it needs, but does not require an ERP *licence*. For a MES-only deployment, AHKMES includes the internal shared master-data capability and either enables the local MES/Inventory/PLM features selected by the customer or connects approved external providers.

### No duplication rule

- Keep current `Material`, `Part`, `Plant`, `Machine`, `Warehouse`, `Customer`, and `Supplier` records canonical during migration.
- Introduce product-specific profiles only for product lifecycle fields; never copy identity/code/unit records into MES or CRM tables.
- Use stable IDs and external-source keys for integration. A source-of-truth policy is mandatory per entity type and tenant.
- Synchronization must use idempotency keys, ownership direction, conflict policy, and reconciliation; direct dual-write is prohibited.

## 9. Entitlement model and evaluation rules

### Target records

```text
TenantLicence
  tenantId, status, planId, startsAt, expiresAt, trialEndsAt

ProductGrant
  tenantLicenceId, productId, status, startsAt, expiresAt,
  source (DIRECT | BUNDLE | TRIAL | MIGRATED), quantityLimits

FeatureGrant
  productGrantId, featureId, status, startsAt, expiresAt, quantityLimits

UsageAllocation
  tenantId, dimension (NAMED_USER | CONCURRENT_USER | PLANT | MACHINE | API_CALL),
  granted, consumed, measuredAt

EntitlementAudit
  actor, before, after, reason, effectiveAt, correlationId
```

### Evaluation algorithm

1. Establish authenticated tenant context and validate tenant licence status/effective date.
2. Resolve the requested **product** and, if applicable, its **feature** from the command/API metadata.
3. Verify the product grant is active through direct grant, bundle membership, or valid trial.
4. Verify feature grant and quantitative limit where relevant.
5. Verify user page/action permission and data scope separately from the product grant.
6. Verify the required provider contracts; report a configuration error if no local or external provider satisfies them.
7. Record a deny/audit event for sensitive denied actions where policy requires it.

The evaluation order deliberately separates **licence**, **authorization**, **data scope**, and **business preconditions**. A user may have a product licence but no permission; a user may have permission but no product grant.

### Licence dimensions

| Dimension | Target rule |
|---|---|
| Tenant licence | Establishes legal tenant, plan, status, effective period, and default platform capability availability. |
| Product licence | Enables one commercial SKU for one tenant; grants can be direct, bundle-derived, trial, or migration-derived. |
| Feature licence | Enables optional product capabilities such as DNC, advanced QMS, mobile WMS, APS optimization, payroll localization, or AI actions. |
| Named users | Counts active named assignments for a product or product group; deactivation/reassignment has audit history. |
| Concurrent users | Enforced through a short-lived, renewable session lease per scoped product group; failure is explicit, never silent. |
| Plant limits | Evaluated against active Plant/Site assignments to the entitled product. Shared master plants do not duplicate per product. |
| Machine limits | Evaluated against active machine-product assignments, especially CNC/OEE/CMMS/MES. |
| Expiration | New commands are denied after expiry; read-only/export grace behaviour must be a product decision and auditable. |
| Trial | Time-bound ProductGrant with explicit restricted feature set and no automatic destructive downgrade. |
| Subscription plan | Commercial template that materializes product/feature grants and limits; it is not itself a permission check. |

## 10. Product bundles

| Bundle | Direct product grants | Typical optional features |
|---|---|---|
| **CNC Manufacturing Starter** | MES, CNC, TOOLING, FIXTURE, INVENTORY, QMS, CMMS, OEE | MES Operator HMI, basic genealogy, basic inspection, basic OEE |
| **CNC Manufacturing Professional** | Starter + PLM, MRP, WMS, COSTING, ANALYTICS | NC program control, DNC, advanced tooling life, fixture calibration, MRP proposals, capacity visibility |
| **Manufacturing Enterprise** | Professional + PROCUREMENT, SALES, MRP_II, APS, FINANCE, PROJECT, SCM, TMS | advanced quality, EAM reliability, APS optimization, finance localization, S&OP |
| **Full Enterprise** | All sellable products | all licensed feature packs, localization packs, AI governed action packs |

Bundles grant products; they do not change domain ownership or create hidden ERP dependencies. A customer may instead buy `MES + CNC`, `QMS only`, `CMMS only`, `CRM only`, or `HR only`.

## 11. Existing entitlement mapping and migration strategy

### Rename, split, or move

| Current entitlement/catalogue code | Target disposition |
|---|---|
| `PLATFORM_CORE` | Keep as internal PLATFORM_CORE capability; remove it from tenant-toggle semantics. |
| `ERP_MASTER_DATA` | Rename/move to internal `SHARED_MASTER_DATA`; preserve the current enablement as a migration fact, not a future purchasable ERP dependency. |
| `ERP_CRM_SALES` | Split into `CRM` and `SALES`; migrate existing enabled tenants to both grants unless a customer-specific contract dictates otherwise. |
| `ERP_PROCUREMENT` | Rename to `PROCUREMENT`. |
| `ERP_FINANCE` | Rename to `FINANCE`; retain AR/AP as an initial feature set, not an implication of complete accounting. |
| `ERP_PROJECT_SERVICE` | Split into `PROJECT` and `SERVICE`; migrate existing enabled tenants to both grants by default. |
| `WMS_INVENTORY_LEDGER` | Rename to `INVENTORY`; preserve traceability as a feature or separate `INVENTORY_TRACEABILITY` feature grant. |
| `WMS_TRACEABILITY` | Move under `INVENTORY` feature `TRACEABILITY`; WMS becomes its own warehouse-execution product. |
| `PLM_PRODUCT_STRUCTURE`, `PLM_NC_PROGRAM` | Consolidate under `PLM` with `PRODUCT_STRUCTURE` and `NC_PROGRAM_CONTROL` features. |
| `MES_EXECUTION`, `MES_GENEALOGY`, `MES_PERFORMANCE` | Consolidate under `MES` with execution, genealogy, HMI, and performance features. OEE commercial ownership moves to `OEE`; MES may consume it. |
| `MES_CNC_TOOLING` | Split into `TOOLING` and `FIXTURE`; keep integration feature links to MES/CNC. |
| `QMS_INSPECTION`, `QMS_NCR_CAPA`, `QMS_SPC_CALIBRATION` | Consolidate under `QMS` with BASIC_INSPECTION, NCR_CAPA, SPC_CALIBRATION, and ADVANCED_QUALITY features. |
| `EAM_MAINTENANCE` | Rename to `CMMS`; reliability is a feature. |
| `APS_MRP`, `APS_SCHEDULING` | Split into sellable `MRP`, `MRP_II`, and `APS`; capacity load is initially an MRP_II feature. |
| `IIOT_MACHINE_CONNECT` | Move into `CNC` as `MACHINE_CONNECT` feature, while preserving PLATFORM_INTEGRATION connector contracts for non-CNC use. |
| `ANALYTICS_REPORTING` | Rename to `ANALYTICS`; reports, dashboards, semantic BI, and scheduling become features. |
| `PLATFORM_AI` | Move to sellable add-on `AI`, with target-product tool grants. |

### Phased migration

1. **Inventory and freeze semantics.** Capture current tenant edition, every `TenantModuleEntitlement`, enabled-by-default state, and affected pages. Do not change behaviour.
2. **Introduce catalogue v2 beside v1.** Add immutable product/feature identifiers and explicit old-to-new mapping; dual-read current grants into projected target grants.
3. **Move shared-master-data naming first.** Add `SHARED_MASTER_DATA` as always-available platform capability in the resolver while leaving existing entity tables and page routes unchanged.
4. **Split commercial grants without moving code.** Materialize mapped `CRM`, `SALES`, `PROJECT`, `SERVICE`, `TOOLING`, `FIXTURE`, and feature grants. Existing page keys may temporarily map to compatibility aliases.
5. **Upgrade command enforcement.** Add product/feature metadata to controllers, jobs, realtime commands, webhook consumers, and future Copilot tools. Keep PageGuard as UI feedback only.
6. **Move route/API ownership incrementally.** Add new product IDs to APIs and pages while compatibility mappings preserve existing URLs and permissions.
7. **Retire legacy enum and edition-as-grant assumptions only after tenant reconciliation, E2E entitlement tests, and a defined support window.**

### Backward compatibility risks and mitigations

| Risk | Mitigation |
|---|---|
| Current enabled module becomes inaccessible after a split. | Backfill every enabled legacy module to the union of its mapped target grants; test every current page/API before cutover. |
| A customer loses MES because they did not own `ERP_MASTER_DATA`. | SHARED_MASTER_DATA is platform-provided; MES compatibility migration must not require an ERP grant. |
| Legacy page/role permission no longer maps to a product. | Maintain a versioned `legacyPage -> target product/feature` compatibility map until roles are migrated. |
| Bundle downgrade disables data access abruptly. | Define read-only/export grace policy and preserve data; block writes according to product policy only after auditable notice. |
| External integration writes duplicate master data. | Source-of-truth registry, external keys, idempotency, reconciliation, and one write authority per entity class. |
| Edition logic conflicts with explicit product grants. | During transition, effective entitlement is the intersection of legacy edition guard and mapped grant; remove edition gate only after plan migration is complete. |

### Preserve existing tenant configurations

- Snapshot every existing `(tenantId, ProductModule, isEnabled)` record and implicit-default state before migration.
- Create a migration ledger with source entitlement, target grants, rule version, timestamp, and reconciliation status.
- Preserve `isEnabled=false` as a disabled target grant for every mapped product/feature; do not silently turn off unrelated products.
- Preserve enabled legacy `ERP_EXTENSIONS` as all mapped initial grants (`CRM`, `SALES`, `PROCUREMENT`, `FINANCE`, `PROJECT`, `SERVICE`, and SHARED_MASTER_DATA availability), then allow commercial operations to reduce scope after customer review.
- Preserve enabled `MES_CORE` as MES execution, genealogy, performance, HMI compatibility, and the necessary platform/shared-data capabilities; do not infer CNC, DNC, tooling, or fixture purchases unless current entitlement policy explicitly did so.
- Make migration idempotent and reversible by mapping version; never overwrite customer-specific post-migration grants during a replay.

## 12. Recommended implementation order

### P0 before further module development

1. **Approve this product boundary and source-of-truth policy.** In particular, accept SHARED_MASTER_DATA as internal platform capability and define its initial entity list.
2. **Create the entitlement v2 contract and mapping plan.** This is a design/API/schema contract first; no feature development should create new `ERP_*` commercial dependencies.
3. **Define command-level product/feature enforcement.** Inventory all HTTP, Socket.IO, job, connector, webhook, import/export, and Copilot mutation paths; decide the metadata/decorator and resolver contract.
4. **Define provider contracts for MES.** Process definition, inventory execution, resource context, and external ERP synchronization must have a canonical interface and ownership policy.
5. **Write migration acceptance tests before changing entitlements.** Test MES-only, CRM-only, QMS-only, CMMS-only, WMS-only, MES+CNC, MES+QMS, ERP+MRP, Full Enterprise, expiry, limit, and disabled-feature cases.

### P1

1. Implement entitlement records/resolver and compatibility projection.
2. Split catalogue identity and add product/feature metadata without changing business services.
3. Migrate platform guards and route/API ownership in small, tested slices.
4. Build shared-master-data profiles and external source-of-truth synchronization rules.

### P2

1. Product bundles, subscription plans, named/concurrent user and plant/machine limits.
2. Full workflow/document/integration platform capabilities.
3. Product feature delivery in the dependency order defined by the relevant product roadmaps.

## 13. Open decisions

1. Which shared master entities may be authored locally by a MES-only tenant, and which must be sourced from the customer's ERP?
2. Is `CNC` commercially permitted without AHK MES when an external MES provides operation context? The recommended answer is yes.
3. Which current edition promises must be preserved contractually, versus converted into explicit product bundles?
4. What read-only/export grace period applies to product expiry in on-premise and air-gapped deployments?
5. Which country/localization packs are separate Finance/HR feature licences?

## 14. Handoff

This architecture is ready for product/architecture review, not direct refactoring. After approval, the next implementation lane is an entitlement-v2 design slice: capability resolver contract, legacy-to-target mapping, provider contracts, and migration/E2E acceptance criteria before modifying the current product catalogue.

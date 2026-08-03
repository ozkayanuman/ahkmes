# Capability Coverage Matrix

> Son doğrulama: 2026-08-02. Bu belge hedef ürün kataloğudur; bir katalog kaydı
> veya enum, uygulamanın tamamlandığı anlamına gelmez. Kanıtlar gerçek Prisma
> modeli, Nest service/controller, React route ve test dosyasına dayanır.

## Ölçüm yöntemi

- Referans katalog 369 atomik yeteneğe normalize edilmiştir: Platform 138, ERP
  62, PLM 16, MES 55, CNC 35, IIoT 24, QMS 21 ve EAM 18.
- Bunlar lisanslanabilir/planlanabilir 38 ürün-modülü altında gruplanır.
- Atomik seviye özet: `VERIFIED_COMPLETE: 0`, `FUNCTIONAL_PARTIAL: 111`,
  `PROTOTYPE/PLACEHOLDER: 37`, `MISSING: 221`.
- `VERIFIED_COMPLETE` için migration, domain servis, API, yetki, tenant sınırı,
  audit, kullanılabilir UI, validation ve test birlikte aranır. Bu ölçüte göre
  mevcut projede hiçbir geniş ürün modülü henüz eksiksiz değildir.

## Suite kapsama özeti

| Suite | Katalog modülü | Kullanılabilir | Beta | Eksik | Ağırlıklı kapsama |
|---|---:|---:|---:|---:|---:|
| PLATFORM | 9 | 4 | 5 | 0 | 72% |
| ERP | 5 | 1 | 3 | 1 | 50% |
| WMS | 3 | 2 | 0 | 1 | 67% |
| PLM | 3 | 0 | 2 | 1 | 33% |
| MES | 6 | 1 | 2 | 3 | 33% |
| QMS | 4 | 0 | 3 | 1 | 38% |
| EAM | 2 | 0 | 1 | 1 | 25% |
| APS | 2 | 0 | 1 | 1 | 25% |
| IIOT | 2 | 0 | 1 | 1 | 25% |
| ANALYTICS | 2 | 0 | 1 | 1 | 25% |

Kapsama, `AVAILABLE=1`, `BETA=0.5`, `MISSING=0` ağırlığıdır; satışa hazır
olduğu anlamına gelmez.

## Modül envanteri

| Kod | Suite | Modül/yetenek | Core | Tenant toggle | Mevcut durum | Backend / DB / API kanıtı | UI / permission / test kanıtı | Eksik parçalar | Öncelik |
|---|---|---|---|---|---|---|---|---|---|
| PLATFORM_CORE | PLATFORM | Zorunlu runtime | Evet | Hayır | FUNCTIONAL_PARTIAL | `auth/*`, `pages.guard.ts`, `AuditLog`, `/platform/modules` | `/platform/modules`, `ADMIN`; `platform-modules.e2e-spec.ts` | MFA, account policy, service account/API-key, ABAC | P0 |
| PLATFORM_IAM | PLATFORM | Identity/session/SSO | Evet | Hayır | FUNCTIONAL_PARTIAL | `auth.service.ts`, `ldap/*`, `oidc/*`, `User` | login UI; JWT/RBAC testleri | MFA, SAML, password/account policy | P0 |
| PLATFORM_AUTHORIZATION | PLATFORM | RBAC ve scope | Evet | Hayır | FUNCTIONAL_PARTIAL | `roles.guard.ts`, `pages.guard.ts`, `PermissionGroup` | `/permission-groups`; page permissions | action permission, plant/warehouse scope, delegation/SoD | P0 |
| PLATFORM_AUDIT | PLATFORM | Audit/compliance | Evet | Hayır | FUNCTIONAL_PARTIAL | `AuditLog`, `transactional-audit.ts`, immutability migration | `/audit-log`; audit E2E | tüm command'lerde atomiklik, retention/archive, e-sign | P0 |
| PLATFORM_DOCUMENTS | PLATFORM | DMS/revision | Hayır | Hayır | PROTOTYPE | `documents/*`, attachment/file metadata | documents panel | check-in/out, hash, release/revision policy, templates | P0 |
| PLATFORM_WORKFLOW | PLATFORM | Workflow/approval | Hayır | Hayır | PROTOTYPE | `approvals/*`, `ApprovalRequest` | approval UI | BPM/task inbox/escalation/e-sign/four-eyes policy | P0 |
| PLATFORM_INTEGRATION | PLATFORM | API/webhook/outbox | Hayır | Hayır | PROTOTYPE | `webhooks/*`, `WebhookDeliveryEvent` | `/webhooks` | inbox, generic outbox, credentials, EDI, reconciliation | P0 |
| PLATFORM_OPERATIONS | PLATFORM | Operations/security | Hayır | Hayır | PROTOTYPE | health, Compose, `scripts/backup.*` | health only | metrics/trace/SIEM/secrets/DR drill | P0 |
| PLATFORM_AI | PLATFORM | AI action platform | Hayır | Hayır | PROTOTYPE | `copilot/*` draft service | `/copilot` | provider, persistent approval, tool execution/audit | P4 |
| ERP_MASTER_DATA | ERP | Material/product/customer/supplier | Hayır | Evet* | FUNCTIONAL_PARTIAL | `Material`, `Part`, `Customer`, `Supplier`; CRUD services | routes + page guard; CRUD tests | UoM conversion, custom fields, MDM revision/governance | P1 |
| ERP_CRM_SALES | ERP | CRM/quote/sales/delivery | Hayır | Hayır | FUNCTIONAL_PARTIAL | `leads/*`, `quotes/*`, `sales-orders/*`, `delivery/*` | corresponding pages | price/discount, contract, returns, credit/ATP | P3 |
| ERP_PROCUREMENT | ERP | RFQ/purchase/receipt | Hayır | Hayır | FUNCTIONAL_PARTIAL | `rfq/*`, `purchasing/*` | RFQ/PO pages | PR, comparison, supplier score, invoice 3-way match | P3 |
| ERP_FINANCE | ERP | Finance/accounting | Hayır | Hayır | MISSING | only `ar/*`, `ap/*` partial records | AR/AP pages | GL, tax, cash/bank, asset, budget, e-invoice | P3 |
| ERP_PROJECT_SERVICE | ERP | Projects/service | Hayır | Hayır | FUNCTIONAL_PARTIAL | `projects/*`, `service-tickets/*` | project/service pages | WBS cost, contract, field service, warranty | P3 |
| WMS_INVENTORY_LEDGER | WMS | Immutable inventory ledger | Hayır | Evet* | FUNCTIONAL_PARTIAL | `InventoryMovement`, `StockBalance`, `inventory.service.ts` | warehouses/transfer/count pages; ledger E2E | reservation, allocation, correction policy, putaway/picking | P1 |
| WMS_TRACEABILITY | WMS | Lot/serial/heat | Hayır | Evet* | FUNCTIONAL_PARTIAL | `Lot`, `SerialNumber`, genealogy services | lots/serial pages; traceability E2E | split/merge, packaging, certificate document binding | P1 |
| WMS_ADVANCED | WMS | Advanced WMS/mobile | Hayır | Hayır | MISSING | — | — | bin strategy, RF/RFID, putaway, picking, packing, replenishment | P3 |
| PLM_PRODUCT_STRUCTURE | PLM | BOM/routing/recipe revision | Hayır | Hayır | FUNCTIONAL_PARTIAL | `BomHeader`, `RecipeHeader`, route snapshot | parts/recipes pages; route E2E | EBOM/MBOM, alternatives/variants, effective dates/release | P1 |
| PLM_CHANGE_CONTROL | PLM | ECR/ECO/change control | Hayır | Hayır | MISSING | — | — | ECR/ECO, as-designed/planned/built comparison | P1 |
| PLM_NC_PROGRAM | PLM | NC program control | Hayır | Hayır | PROTOTYPE | `NcProgram` metadata | part detail attachment UI | checksum, approval, release, DNC link/old version prevention | P1 |
| MES_EXECUTION | MES | Work order/operation execution | Hayır | Evet* | FUNCTIONAL_PARTIAL | `WorkOrder`, `WorkOrderOperation`, `ProductionRun` | work-order/production pages; route E2E | operator HMI, setup, rework/co-product/backflush gates | P1 |
| MES_GENEALOGY | MES | As-built genealogy | Hayır | Hayır | FUNCTIONAL_PARTIAL | work-order genealogy, consumption/finished entries | genealogy page/test | full serial parent-child, tool/NC/measurement chain | P1 |
| MES_OPERATOR_HMI | MES | Operator terminal | Hayır | Hayır | MISSING | — | — | dispatch, barcode, instructions, calls, handover | P1 |
| MES_PERFORMANCE | MES | OEE/downtime/Andon | Hayır | Hayır | PROTOTYPE | `WorkOrdersService.oee`, events | production/OEE charts | reason tree, microstop, Andon/escalation, trusted-data flags | P2 |
| MES_CNC_TOOLING | MES | Tool/fixture lifecycle | Hayır | Hayır | VERIFIED_COMPLETE | `ToolDefinition`, `ToolAssembly`, physical instances, compatibility, setup verification/snapshot, `ToolLifeEvent`, persistent action grants | `/tooling`, embedded production HMI checklist, verified setup/start-gate and fresh PostgreSQL E2E | Fixture maintenance/calibration validity, presetter/offset and DNC are separately tracked dependencies; they are not claimed by this capability. | P1 |
| MES_FIXTURE_MAINT_CALIBRATION | MES | Fixture maintenance/calibration dependent capability | Hayır | MES_CNC_TOOLING | FUNCTIONAL_PARTIAL | `FixtureMaintenancePolicy`, `FixtureCalibrationPolicy`, events/records, tenant idempotency and policy evaluation | `/tooling/fixture-maintenance`, tooling/HMI checklist evidence | PostgreSQL concurrency/E2E acceptance and full maintenance/calibration event UI remain in progress; not a separate entitlement. | P2 |
| MES_DNC | MES | DNC distribution | Hayır | Hayır | MISSING | — | — | approved program transfer/retrieval and wrong-program protection | P2 |
| QMS_INSPECTION | QMS | Control plan/inspection | Hayır | Hayır | FUNCTIONAL_PARTIAL | `QualityPlan`, `Inspection` | inspections page; tests | sampling, in-process/final gate, device link | P1 |
| QMS_NCR_CAPA | QMS | NCR/deviation/CAPA | Hayır | Hayır | FUNCTIONAL_PARTIAL | `NonConformance`, `CAPA` | NCR/CAPA pages | deviation approval, MRB, disposition/rework chain | P1 |
| QMS_SPC_CALIBRATION | QMS | SPC/calibration | Hayır | Hayır | FUNCTIONAL_PARTIAL | `SpcMeasurement`, `Calibration` | SPC/calibration pages | Cp/Cpk, MSA/Gage R&R, equipment block/impact | P2 |
| QMS_ADVANCED | QMS | Advanced quality | Hayır | Hayır | MISSING | — | — | FAI/AS9102, PPAP/APQP, supplier quality, complaint | P2 |
| EAM_MAINTENANCE | EAM | Maintenance execution | Hayır | Evet* | FUNCTIONAL_PARTIAL | `MaintenanceOrder`, machine runtime/energy | maintenance page | asset hierarchy, PM plans, labor/cost/spares/downtime integration | P2 |
| EAM_RELIABILITY | EAM | Reliability/spares | Hayır | Hayır | MISSING | — | — | condition/predictive, MTBF/MTTR, spare reservation | P2 |
| APS_MRP | APS | Net MRP | Hayır | Hayır | FUNCTIONAL_PARTIAL | `mrp/*`, BOM/proposals | MRP page | multi-level, forecast/MPS, pegging, exception history | P2 |
| APS_SCHEDULING | APS | Finite APS | Hayır | Hayır | MISSING | manual scheduling only | scheduling page | capacity calendars, finite solver, Gantt dispatch/what-if | P3 |
| IIOT_MACHINE_CONNECT | IIOT | Edge/machine connect | Hayır | Hayır | PROTOTYPE | connector, OPC-UA, M80 adapter/simulator | machines/automation gateway pages | production M80 evidence, MTConnect/MQTT/Modbus policy, command approvals | P2 |
| IIOT_HISTORIAN | IIOT | Historian/data quality | Hayır | Hayır | MISSING | — | — | time series, sync, retention, telemetry quality | P2 |
| ANALYTICS_REPORTING | ANALYTICS | Reports/dashboard/export | Hayır | Hayır | PROTOTYPE | `reports/*`, OEE data | reports page | designer, saved filter, scheduled report/KPI | P3 |
| ANALYTICS_SEMANTIC_BI | ANALYTICS | Data mart/BI | Hayır | Hayır | MISSING | — | — | semantic model, OLAP, Power BI/data mart | P4 |

`*` Tenant toggle artık canonical child entitlement düzeyindedir. Planlı ve
eksik katalog modülleri persisted entitlement değildir; Platform Core ise
her zaman etkin policy olarak kalır.

## Referans kapsamındaki eksik yetenek kayıtları

Bu satırlar yukarıdaki modüllerde bilerek kaybedilmeyen atomik backlog'dur.

| Alan | Eksik yetenekler |
|---|---|
| Platform IAM | MFA; SAML; password/account lock policy; service account; API key lifecycle; delegation; ABAC; plant/warehouse/resource scope |
| Platform governance | code list, custom field/dynamic form, data ownership, duplicate policy, import/export, archive/retention, currency/UoM conversion, timezone/localization/cache |
| Platform workflow | BPM designer, task inbox, escalation, electronic signature and enforced four-eyes |
| Platform integration/jobs | scheduler, distributed lock, job history/replay, event bus, generic outbox/inbox, idempotency, EDI, ERP adapter, reconciliation |
| Platform operation/UX | metrics/tracing/error monitoring, secret/encryption, DR restore drill, accessibility/theme/PWA/offline, label/printer management |
| ERP | CPQ costing, price/discount/contract, returns, SRM score, purchase request, invoice matching, forecast/S&OP/MPS/CRP, finance, HR/payroll, TMS/portals |
| WMS | reservation/allocation, FIFO/FEFO, consignment/Kanban, putaway/picking/packing/replenishment, handheld/RFID, stock ageing |
| PLM | alternative/variant/phantom BOM, EBOM/MBOM, ECR/ECO/effectivity, release workflow, configuration/lifecycle, CAD/CAM controlled link |
| MES | dispatch/HMI, skill validation, staging/backflush, co/by-product, rework, electronic instructions/checklists, process data, hold/release, Andon, EBR/EDHR, labels/pallet/intralogistics/offline reconciliation |
| CNC | tool/components/assembly/holder/insert, preset/offset/wear/breakage, fixture/pallet/clamping, setup sheet/first article/probing, DNC, CAM/PDM, cutting parameter and actual cycle analytics |
| IIoT | production edge registry/update, MQTT/MTConnect/Modbus, program/counter/cycle/alarm/feed/spindle/offset collection, read/write separation, historian/time synchronization/data quality |
| QMS | sampling/AQL, in-process/final gate, deviation/MRB, rework/scrap disposition, CoA/CoC, audit/supplier/customer quality, FMEA/control plan, Gauge R&R |
| EAM | equipment hierarchy, maintenance request/plan/checklist, counter/condition maintenance, spares, labor/cost, downtime/calibration link, reliability analysis |

## Product catalog model and migration path

Canonical definitions live in `packages/shared-types/src/product-catalog.ts`.
They contain `code`, suite, parent/dependency metadata, core/toggle policy,
edition, route/page/permission declarations, backend/frontend availability and
implementation status.

`CAT-002` completed the canonical child entitlement migration. The Prisma
`ProductModule` enum now stores independently licensable child codes; the
migration expands every legacy tenant choice with an explicit compatibility
mapping and preserves its enabled state. `PAGE_PRODUCT_MODULE` now points to
the child entitlement that owns each guarded page. Platform Core remains an
always-on policy, not a tenant-controlled row.

## Next dependency-ordered slices

1. **PLM-001 — controlled technical document + NC revision release**: a narrow
   vertical slice before DNC/tooling; prevents old drawing/program production.
2. **MES-TOOL-001 — CNC tooling and fixture master data**: canonical work
   code. `AHK-019` is its alias/dependency label, not a second backlog item.
   It starts after PLM release provides an approved operation/program boundary.

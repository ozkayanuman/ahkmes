# CNC Manufacturing V1 — Commercial / Pilot Readiness Re-Audit

**Audit date:** 2026-09-23 (updated from 2026-09-18). CNC-V1-07R (commercial CMMS), CNC-V1-08R (canonical OEE), CNC-V1-09R (planned-versus-actual costing), CNC-V1-10R (repeatable onboarding), and CNC-V1-11R (manager operations cockpit) are release-verified within their stated V1 scopes. Since the last audit, the former P1 backlog line (inbound receiving inspection/supplier returns, raw serial allocation, tool crib/offset lifecycle, fixture checkout/location, shipment/customer trace) has also closed — see the updated priority list below.

## Executive readiness summary

| Deployment use | Classification | Evidence-based decision |
| --- | --- | --- |
| Internal CNC shop | FUNCTIONAL_PARTIAL | Released engineering, material, MES, quality, genealogy, daily MRP, CMMS, OEE, explainable planned-versus-actual costing and controlled onboarding/import are verified. |
| Design-partner pilot | FUNCTIONAL_PARTIAL | Basic maintenance is now closed. An M80-connected pilot still requires real field acceptance. |
| First paying CNC customer | NOT_READY | Training/support and the selected controller's field acceptance remain. |
| Repeatable commercial deployment | FUNCTIONAL_PARTIAL | Controlled import is available; it still needs versioned training/support and controller support records. |

Accepted evidence remains valid: CNC-V1-00/01/02/03R/04/06/07R are **VERIFIED_DONE**; M80 is **SOFTWARE_READY_FIELD_VALIDATION_REQUIRED**. The 2026-08-21 clean operations evidence applied 76 migrations, passed 7 PostgreSQL suites / 65 tests (including the dedicated CNC-V1-07R A–Z suite, 13/13), and restored to a second PostgreSQL with the full maintenance graph (breakdown, downtime, work order, tasks, technician, labor, spare, return-to-service, PM plan) intact. Workspace typecheck, full backend/web/connector/shared-types unit suites and production build all pass.

## Current capability matrix

| Capability | Classification | Concrete evidence / gap |
| --- | --- | --- |
| Deployment, provisioning, health, backup/restore | VERIFIED_DONE | CNC-V1-00 and operations/restore E2E. |
| Released engineering/UOM/calendar/shifts | VERIFIED_DONE | ProductionDefinition, immutable WO snapshots, UOM/calendar services, engineering E2E. |
| Material execution/inventory availability | VERIFIED_DONE | ProductionMaterialService, canonical ledger, reservation/backflush concurrency E2E. |
| MES lifecycle/rework | VERIFIED_DONE | ProductionService, durable reports/events, lifecycle/restart/concurrency E2E. |
| Production quality | VERIFIED_DONE | inspection/hold/NCR/rework/release and quality E2E. |
| Mitsubishi M80 | SOFTWARE_READY_FIELD_VALIDATION_REQUIRED | adapter, observation history and fail-closed start/resume gate are simulator/PostgreSQL verified; no real M80 evidence. |
| MRP | VERIFIED_DONE | CNC-V1-03R provides dated planning, explicit Sales-line plant provenance, explainable pegging/exceptions, safe conversion and one PostgreSQL REPEATABLE READ input snapshot; 37/37 PostgreSQL matrix and operations/restore gates pass. |
| Scheduling | FUNCTIONAL_PARTIAL | manual scheduling and standard-minute capacity exist; no dispatch/load/bottleneck policy. |
| CMMS | VERIFIED_DONE (V1 minimum) | Request/breakdown/downtime/calendar and production-runtime PM/technician/checklist/spare reservation/issue/return/return-to-service plus bounded reliability analytics are closed under CNC-V1-07R. Controller-meter ingestion and predictive maintenance remain P1. |
| OEE | VERIFIED_DONE | CNC-V1-08R supplies canonical planned-time, structured-loss and quality semantics, explicit context, OEE permissions, Digital Twin projection and a read-only operations cockpit. A fresh 79-migration PostgreSQL rehearsal passed the 50-machine benchmark, 8-suite/70-test V1 matrix, backup/restore and restored-OEE proof. |
| Costing | VERIFIED_DONE (V1 scoped) | Released plant rate cards are frozen into an immutable WO baseline at engineering release; material/machine/labor actuals, planned/actual/variance, operation breakdown, unit cost and explicit missing-data reasons are available. Overhead, tooling/fixture, subcontract and finance policy remain P1/P2. |
| Procurement/sales | FUNCTIONAL_PARTIAL | Optional single-plant Sales-line demand integrates traceably into MRP and release inherits plant; supplier lot returns closed 2026-09-23 (`SupplierLotReturn`, rejected material lots). Split fulfillment, broader supplier quality and advanced Procurement remain outside V1-03R. |
| Onboarding/import | VERIFIED_DONE (V1 scoped) | administrator-only, tenant-scoped dry-run/atomic-commit pack covers engineering, tooling/fixture, commercial, machine, warehouse and opening-stock masters; release remains in normal workflows. |

## Re-audited domain conclusions

### Engineering / PLM — VERIFIED_DONE
Part/revision, released BOM/routing/quality definitions, production-definition choice, released NC checksum, tool/fixture references, UOM and plant calendar are snapshot-consistent. Later master-data revisions do not rewrite released WOs. P1: alternate approved definitions, richer drawing change package and bulk import.

### Work order / production — VERIFIED_DONE
WO release, sequence, machine/operator records, setup/start/pause/resume/hold, partial reporting, scrap, completion, rework/reinspection, restart durability, quantity accounting and genealogy are implemented. Per-machine operator qualification (`OperatorMachineQualification`, opt-in via `Machine.operatorQualificationRequired`, enforced as an HMI start gate) closed 2026-09-23 — this is a binary qualified/not-qualified gate, not a broader cross-machine skill matrix. P1: split/merge, a richer skill/competency matrix and dispatch rules.

### Inventory — VERIFIED_DONE for CNC V1 core
The canonical ledger supports warehouse/bin/lot balance, production requirements/reservations, on-hand/reserved/available, WIP issue/return, material scrap, backflush, quality-held output, finished receipt and genealogy. Serial-controlled raw-input allocation (`MaterialSerialNumber`, opt-in via `Material.serialTrackingRequired`) closed 2026-09-23: reserve/issue/consume/return/scrap all enforce one serial per whole unit end-to-end in `production-material.service.ts`. Supplier lot returns (`SupplierLotReturn`) also closed the same day: rejected `MATERIAL` lots only, no stock-movement/credit-note claim. Remaining P1: operation-specific assignment where required, richer material UI.

### MRP — VERIFIED_DONE; scheduling — FUNCTIONAL_PARTIAL
MrpService handles explicit plant-scoped Sales/independent demand, dated recursive netting, canonical UOM/calendar, policies/lot rules/horizons, firming, exceptions, explainable pegging and safe MAKE/BUY conversion from one PostgreSQL REPEATABLE READ snapshot. Scheduling remains manual and not maintenance/setup/load aware.

### Quality — VERIFIED_DONE for production V1
Released inspection snapshots, numeric/boolean/qualitative server evaluation, fixed-count/100% sampling, in-process/final holds, NCR, controlled use-as-is/rework/scrap and release are ready. Incoming lot acceptance evidence (`IncomingLotInspection`, an immutable accept/quarantine/reject decision record distinct from the lot's live status, via `LotsService.decideAcceptance()`) closed 2026-09-23 — not a full sampling/measurement-plan engine, which remains P1 if supplier receiving quality is sold as its own capability. CAPA, SPC, AQL, MSA, PPAP/APQP and FMEA are P2.

### CMMS (V1 minimum) — VERIFIED_DONE; OEE — VERIFIED_DONE; costing — VERIFIED_DONE (V1 scoped)
CNC-V1-07R closed the V1 CMMS minimum: maintenance request, first-class breakdown, timestamp-based maintenance downtime distinct from production causes, controlled maintenance work-order lifecycle, idempotent breakdown→WO conversion, calendar PM due/overdue/replay-safe generation, production-runtime threshold PM, technician assignment without an HR hard dependency, required-checklist completion gate, canonical-inventory spare reservation/issue/return, explicit return-to-service, usable maintenance history, bounded MTTR/calendar-failure-spacing analytics, a supervisor workbench and HMI visibility — server-side MES gate included, proven CMMS-only and MES-only. Runtime PM is derived from completed production-run duration and is deliberately not represented as a controller-meter reading. Controller-meter ingestion, predictive maintenance and a trustworthy operating-time MTBF denominator remain P1. CNC-V1-08R calculates OEE from governed planned time, immutable execution standards, structured timestamped downtime and quality-hold facts; it provides explicit tenant/plant/range/as-of projections to the OEE API, Digital Twin and a permission-gated read-only cockpit. CMMS and MRP remain contextual blockers only: they do not fabricate OEE loss without timestamped evidence. On 2026-09-08 its fresh isolated 79-migration PostgreSQL run passed the 50-machine benchmark, 8-suite/70-test V1 matrix, backup/restore and restored canonical-OEE proof. Costing still lacks released rates, planned cost, variance, scrap/rework/tool/fixture policy and unit close; it remains P0 before unrestricted paid commercial use.

### Costing — VERIFIED_DONE (V1 scoped)
CNC-V1-09R selects a released rate-card revision and creates a tenant-scoped immutable snapshot when a work order is engineering-released. It calculates planned and actual material/machine/labor amounts, variance by category/operation and per good unit, and reports data quality and missing-rate/output reasons rather than inventing values. A fresh isolated 80-migration PostgreSQL rehearsal passed 9 suites/72 tests, backup/restore and the restored baseline calculation. Overhead, tool/fixture, subcontract, payroll/GL and a broader scrap/rework policy remain outside the V1 costing boundary.

### Procurement, sales, traceability, reporting and onboarding
Single-plant SalesOrderLine demand now traces through MRP pegging/proposal to WO or requisition. Split fulfillment remains separate scope; supplier-return workflow itself closed 2026-09-23 (`SupplierLotReturn`, rejected material lots). Proven manufacturing traceability is WO → immutable snapshot → input lot → reservation/issue → machine/operator/NC/tool/fixture → execution → quality/NCR/rework → output lot, now extended forward through shipment and customer return: delivery carrier/tracking/proof-of-delivery, and a lot's forward trace includes the customer deliveries and any RMA raised against them (`CustomerReturn`, quarantine-only intake, one decision per shipment). The read-only manager cockpit now unifies OEE/machine, late and blocked WIP, material/planning exceptions, quality holds and maintenance blockers in a tenant-and-plant-scoped view. Cost variance remains a separately permissioned work-order/costing view. Provisioning/restore/diagnostics are verified, and controlled CSV onboarding replaces manual CRUD for the V1 import scope.

## Product-boundary findings

No commercial-coupling defect or tenant/security integrity defect was found. Legacy ProductModule/TenantModuleEntitlement remains production authorization authority; Entitlements V2 is shadow-only. Manual/non-connected machines work because controller verification is per-machine and defaults off.

| Capability | Commercial boundary |
| --- | --- |
| PLATFORM | CORE: tenant/auth/audit/document/UOM/calendar/deployment |
| MES, Inventory, MRP | CORE manufacturing package |
| QMS / CMMS | Basic package capability; advanced QMS/EAM add-ons |
| Procurement / CRM / Sales | Optional products; operational integrations, not forced runtime purchases |
| APS / IIOT / enterprise BI | Add-ons; no V1 hard dependency |
| HR | Shared/optional; no payroll dependency |

## P0 backlog

| ID | Problem/evidence | Proposed scope and acceptance | Dependencies | Size |
| --- | --- | --- | --- | --- |
| CNC-V1-07R | `VERIFIED_DONE` (2026-09-22). Calendar and production-runtime PM, breakdown/request, failure/cause/remedy codes, technician/checklist, downtime link, CMMS spare reservation/issue/return, due queue, reliability projection and availability gate are closed. Controller-meter ingestion and predictive maintenance remain P1. | — | V1-00/01/04 | L |
| CNC-V1-08R | `VERIFIED_DONE` (2026-09-08): canonical planned-time/calendar, structured downtime/quality-hold facts, explicit-context OEE read APIs, OEE action grants, Digital Twin projection and operations cockpit are implemented and release-verified. | 50-machine benchmark, full V1 matrix and backup/restore rehearsal passed in fresh isolated PostgreSQL; retain this evidence and monitor production-sized workloads separately. | V1-01/04/07R | L |
| CNC-V1-09R | `VERIFIED_DONE` (2026-09-10). | Released plant rate cards, frozen WO baseline, planned/actual material-machine-labor variance, operation/unit projection and missing-data controls are verified in clean migration, operations and restore tests. | V1-02/04/06 | L |
| CNC-V1-10R | `VERIFIED_DONE` (2026-09-16, V1 scoped). Controlled CSV dry-run/atomic-commit/audit and administrator UI cover engineering, tooling/fixture definitions and instances, compatibilities, commercial masters, machines, warehouses and opening stock/lots. | 10-suite / 74-test clean PostgreSQL rehearsal plus isolated restore passed. Error-file export, source-file retention, tool assemblies and operation requirements remain later controlled-workflow scope; no unsafe upsert, engineering release or direct stock write is permitted. | V1-00/01/02 | L |
| CNC-V1-11R | `VERIFIED_DONE` (2026-09-18, operational scope). | Tenant-safe, read-only production/OEE, late and blocked WIP, shortage/planning exception, quality-hold and maintenance-blocker view. Current WIP is explicitly labelled as a live state rather than an historical as-of reconstruction; cost variance remains behind its existing `COSTING_READ` boundary. | V1-03R/07R/08R | M |
| M80-FIELD-01 | External selected-machine dependency. | Complete real M80 connection, A match, B mismatch/block, disconnect/reconnect change, stale and restart evidence. | customer machine/window | External |

## Priority, order and gates

**P1 (closed 2026-09-23):** inbound receiving inspection/supplier returns (`IncomingLotInspection`, `SupplierLotReturn`); raw serial allocation (`MaterialSerialNumber` end-to-end in production-material reserve/issue/consume/return/scrap); tool crib/location/offset lifecycle (`PhysicalToolInstance` state command, `ToolPresetRecord` manual presetter/offset history); fixture checkout/location (`FixtureCustodyEvent`, `PhysicalFixtureStatus.CHECKED_OUT`); shipment/customer trace (delivery carrier/tracking/POD via `POST /deliveries/:id/confirm-delivery`, `CustomerReturn` RMA quarantine intake, lot→delivery→RMA forward trace). See `apps/backend/src/{material-serial-numbers,customer-returns}/`, `lots.controller.ts`, `tooling.controller.ts`, `delivery.controller.ts`.

**P1 (still open):** richer HMI material UX; operator skill rules (distinct from the closed `OperatorMachineQualification` machine-qualification gate — this is broader cross-machine skill/competency management).

**P2:** advanced QMS, APS, enterprise BI, DNC/remote start, automatic controller quantity posting, universal CNC adapters, payroll/finance/CRM automation.

Dependency graph: V1-03R → V1-11R; V1-07R → V1-08R → V1-11R; V1-02/04/06 → V1-09R; V1-00/01/02 → V1-10R. M80 field acceptance runs in parallel with a named connected pilot.

**Pilot-ready:** accepted execution epics, pilot data loaded/rehearsed, V1-03R, V1-07R and action cockpit closed, successful customer restore, plus M80 field acceptance only where M80 is used.

**Commercial-V1-ready:** pilot criteria plus governed OEE/cockpit (V1-08R), planned-vs-actual costing (V1-09R), repeatable onboarding (V1-10R), support/training runbooks and approved procurement/order trace scope. APS, advanced QMS, DNC and enterprise BI are explicitly not V1 gates.

**Repeatable deployment:** commercial gate plus import packs, versioned training/support, upgrade rehearsal on customer-like data and controller support/field-acceptance records.

## Exact next epic recommendation

**Current recommendation (2026-09-18): execute the first customer cutover under the versioned operating runbook and capture its evidence.** CNC-V1-10R's controlled import and customer cutover/support procedure are release-verified. The remaining customer-facing gate is the signed customer data-load/training evidence and selected-controller field acceptance, while tool assemblies and operation requirements remain in their normal controlled workflows.

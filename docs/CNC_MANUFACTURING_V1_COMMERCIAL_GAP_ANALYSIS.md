# CNC Manufacturing V1 — Commercial / Pilot Readiness Re-Audit

**Audit date:** 2026-09-07. CNC-V1-07R (commercial CMMS release closure) remains verified; CNC-V1-08R has a functional canonical OEE and operations-cockpit slice. Its isolated PostgreSQL benchmark and release rehearsal remain open, so it is not represented as release-closed.

## Executive readiness summary

| Deployment use | Classification | Evidence-based decision |
| --- | --- | --- |
| Internal CNC shop | FUNCTIONAL_PARTIAL | Released engineering, material, MES, quality, genealogy, daily MRP and minimum CMMS are verified; costing remains outside the completed core. |
| Design-partner pilot | FUNCTIONAL_PARTIAL | Basic maintenance is now closed. An M80-connected pilot still requires real field acceptance. |
| First paying CNC customer | NOT_READY | P0 costing and onboarding gaps remain; CMMS and MRP are no longer blockers. |
| Repeatable commercial deployment | NOT_READY | Needs repeatable import/training/support plus controller support records. |

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
| CMMS | VERIFIED_DONE (V1 minimum) | Request/breakdown/downtime/PM/technician/checklist/spare/return-to-service closed under CNC-V1-07R; meter-based PM and spare reservation remain P1. |
| OEE | FUNCTIONAL_PARTIAL | CNC-V1-08R supplies canonical planned-time, structured-loss and quality semantics, explicit context, OEE permissions, Digital Twin projection and a read-only operations cockpit. The 50-machine isolated PostgreSQL benchmark, backup/restore rehearsal and full release matrix are still required. |
| Costing | FOUNDATION_ONLY | WorkOrdersService.cost has partial actual material/machine/labor only. |
| Procurement/sales | FUNCTIONAL_PARTIAL | Optional single-plant Sales-line demand integrates traceably into MRP and release inherits plant; split fulfillment, supplier quality/returns and advanced Procurement remain outside V1-03R. |
| Onboarding/import | FOUNDATION_ONLY | user CSV import exists; no controlled engineering/opening-stock/customer/supplier/machine import pack. |

## Re-audited domain conclusions

### Engineering / PLM — VERIFIED_DONE
Part/revision, released BOM/routing/quality definitions, production-definition choice, released NC checksum, tool/fixture references, UOM and plant calendar are snapshot-consistent. Later master-data revisions do not rewrite released WOs. P1: alternate approved definitions, richer drawing change package and bulk import.

### Work order / production — VERIFIED_DONE
WO release, sequence, machine/operator records, setup/start/pause/resume/hold, partial reporting, scrap, completion, rework/reinspection, restart durability, quantity accounting and genealogy are implemented. P1: split/merge, skill certification and dispatch rules.

### Inventory — VERIFIED_DONE for CNC V1 core
The canonical ledger supports warehouse/bin/lot balance, production requirements/reservations, on-hand/reserved/available, WIP issue/return, material scrap, backflush, quality-held output, finished receipt and genealogy. P1: serial-controlled raw-input allocation, operation-specific assignment where required, supplier returns/valuation, and richer material UI. These are P0 only for a pilot with regulatory serial-input requirements.

### MRP — VERIFIED_DONE; scheduling — FUNCTIONAL_PARTIAL
MrpService handles explicit plant-scoped Sales/independent demand, dated recursive netting, canonical UOM/calendar, policies/lot rules/horizons, firming, exceptions, explainable pegging and safe MAKE/BUY conversion from one PostgreSQL REPEATABLE READ snapshot. Scheduling remains manual and not maintenance/setup/load aware.

### Quality — VERIFIED_DONE for production V1
Released inspection snapshots, numeric/boolean/qualitative server evaluation, fixed-count/100% sampling, in-process/final holds, NCR, controlled use-as-is/rework/scrap and release are ready. Incoming inspection is P1 unless supplier receiving quality is sold. CAPA, SPC, AQL, MSA, PPAP/APQP and FMEA are P2.

### CMMS (V1 minimum) — VERIFIED_DONE; OEE — FUNCTIONAL_PARTIAL; costing — FOUNDATION_ONLY
CNC-V1-07R closed the V1 CMMS minimum: maintenance request, first-class breakdown, timestamp-based maintenance downtime distinct from production causes, controlled maintenance work-order lifecycle, idempotent breakdown→WO conversion, time-based PM due/overdue/replay-safe generation, technician assignment without an HR hard dependency, required-checklist completion gate, canonical-inventory spare issue/return, explicit return-to-service, usable maintenance history, a supervisor workbench and HMI visibility — server-side MES gate included, proven CMMS-only and MES-only. Time-based (calendar) PM is included; meter/runtime-based PM and CMMS spare reservation remain explicitly `P1 / NOT_INCLUDED_IN_V1`. CNC-V1-08R now calculates OEE from governed planned time, immutable execution standards, structured timestamped downtime and quality-hold facts; it provides explicit tenant/plant/range/as-of projections to the OEE API, Digital Twin and a permission-gated read-only cockpit. CMMS and MRP remain contextual blockers only: they do not fabricate OEE loss without timestamped evidence. Before unrestricted commercial use, the isolated 50-machine PostgreSQL benchmark, backup/restore rehearsal and full post-change release matrix must be captured. Costing lacks released rates, planned cost, variance, scrap/rework/tool/fixture policy and unit close. OEE and costing remain P0 before unrestricted paid commercial use.

### Procurement, sales, traceability, reporting and onboarding
Single-plant SalesOrderLine demand now traces through MRP pegging/proposal to WO or requisition. Split fulfillment and supplier-quality/return workflows remain separate scope. Proven manufacturing traceability is WO → immutable snapshot → input lot → reservation/issue → machine/operator/NC/tool/fixture → execution → quality/NCR/rework → output lot. A unified late/blocked/shortage/quality/maintenance/WIP/cost cockpit is missing. Provisioning/restore/diagnostics are verified, but customer onboarding still requires manual CRUD.

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
| CNC-V1-07R | `VERIFIED_DONE` (2026-08-21). PM profile/calendar due, breakdown/request, failure/cause/remedy codes, technician/checklist, downtime link, due queue and availability gate all closed. Meter-based PM and CMMS spare reservation remain P1. | — | V1-00/01/04 | L |
| CNC-V1-08R | `FUNCTIONAL_PARTIAL` (2026-09-07): canonical planned-time/calendar, structured downtime/quality-hold facts, explicit-context OEE read APIs, OEE action grants, Digital Twin projection and operations cockpit are implemented. | Execute and retain the isolated 50-machine PostgreSQL benchmark, backup/restore rehearsal and full V1 release matrix; tune any demonstrated query/concurrency regression. Never report this as release-closed until those gates pass. | V1-01/04/07R | L |
| CNC-V1-09R | Cost is partial actuals only. | Released material/rate inputs, planned/actual WO-operation-unit cost, variance, scrap/rework policy and missing-data controls. | V1-02/04/06 | L |
| CNC-V1-10R | Onboarding is record-by-record. | CSV dry-run/import/audit/error pack for parts, BOM/routing, opening stock/lots, customers, suppliers, machines and tools. | V1-00/01/02 | L |
| CNC-V1-11R | No manager control cockpit. | Tenant-safe production/late/shortage/quality/PM/WIP/planning-exception views; may ship with V1-08R. | V1-03R/07R/08R | M |
| M80-FIELD-01 | External selected-machine dependency. | Complete real M80 connection, A match, B mismatch/block, disconnect/reconnect change, stale and restart evidence. | customer machine/window | External |

## Priority, order and gates

**P1:** inbound receiving inspection/supplier returns; raw serial allocation; tool crib/location/offset lifecycle; fixture checkout/location; shipment/customer trace; richer HMI material UX; operator skill rules.

**P2:** advanced QMS, APS, enterprise BI, DNC/remote start, automatic controller quantity posting, universal CNC adapters, payroll/finance/CRM automation.

Dependency graph: V1-03R → V1-11R; V1-07R → V1-08R → V1-11R; V1-02/04/06 → V1-09R; V1-00/01/02 → V1-10R. M80 field acceptance runs in parallel with a named connected pilot.

**Pilot-ready:** accepted execution epics, pilot data loaded/rehearsed, V1-03R, V1-07R and action cockpit closed, successful customer restore, plus M80 field acceptance only where M80 is used.

**Commercial-V1-ready:** pilot criteria plus governed OEE/cockpit (V1-08R), planned-vs-actual costing (V1-09R), repeatable onboarding (V1-10R), support/training runbooks and approved procurement/order trace scope. APS, advanced QMS, DNC and enterprise BI are explicitly not V1 gates.

**Repeatable deployment:** commercial gate plus import packs, versioned training/support, upgrade rehearsal on customer-like data and controller support/field-acceptance records.

## Exact next epic recommendation

**CNC-V1-08R — OEE release gates.** The functional cockpit slice is in place, but it remains `FUNCTIONAL_PARTIAL` until its isolated 50-machine PostgreSQL benchmark, backup/restore rehearsal and full V1 matrix are captured. In parallel, the next unstarted commercial product epic is CNC-V1-09R planned-versus-actual costing.

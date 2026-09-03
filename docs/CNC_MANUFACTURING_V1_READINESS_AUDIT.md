# CNC Manufacturing V1 Readiness Audit

> **Commercial/pilot re-audit — 2026-08-14:** Current-source reconciliation is
> in `docs/CNC_MANUFACTURING_V1_COMMERCIAL_GAP_ANALYSIS.md`. CNC-V1-00, 01, 02,
> 04 and 06 remain `VERIFIED_DONE`; CNC-V1-05 remains
> `SOFTWARE_READY_FIELD_VALIDATION_REQUIRED` until real M80 acceptance. The
> exact next recommended implementation is **CNC-V1-03R — MRP Daily Planning,
> Exception Control & Proposal Conversion**. The historic sections below remain
> preserved and are not the current status of accepted CNC-V1 epics.

> Scope: `AHK CNC Manufacturing Professional`, audited from current source on
> 2026-08-12. This is a gap analysis, not an implementation plan approval and
> not an Entitlements V2 cutover. Statuses mean current source and executable
> test evidence, not catalogue presence or historic plan labels.

## Verdict

**Commercial readiness: not ready for an unrestricted first customer release.**
The system has a credible and unusually strong CNC execution foundation:
tenant-scoped master data, routed work-order snapshots, controlled NC release,
verified tool/fixture setup, HMI start/complete gates, lot genealogy, immutable
inventory movements, audit/outbox, and an isolated PostgreSQL E2E harness.

It is suitable for an internal alpha or a tightly supervised pilot after a
small number of focused release epics. It is **not yet commercially deployable
as Manufacturing Professional** because critical material allocation, quality
execution/release, CNC machine-side program assurance, production-grade OEE,
and operating/provisioning controls are incomplete.

### Evidence standard

- Current database models: `apps/backend/prisma/schema.prisma`.
- Domain/API/UI source: `apps/backend/src/*`, `apps/web/src/pages/*`.
- Strongest real-database tests: `route-operations`, `hmi-operations`,
  `mes-tooling`, `traceability-acceptance`, `plm-nc-program`, `inventory-ledger`,
  `downtime`, `oee`, `oee-trend`, `shift-report`, and entitlement E2E suites.
- Current verification baseline: backend unit 53 suites / 252 tests, focused
  PostgreSQL entitlement E2E 4/4, workspace typecheck. This audit does not
  claim the whole E2E suite was re-run in this pass.

## Classification summary

| Domain | Current classification | V1 blocker | Key source evidence |
|---|---|---:|---|
| Tenant isolation, auth, audit, documents, RBAC | VERIFIED_DONE | No | Prisma tenant-scope extension, JWT/role/page/action guards, AuditLog, MinIO documents, E2E coverage |
| Plant / area / workplace / unit / machine hierarchy | FUNCTIONAL_PARTIAL | Yes | `HierarchyService`, `Machine`; no company/legal entity, department, UOM master, shift-calendar master |
| Parts, BOM, recipes/routes, NC snapshot | FUNCTIONAL_PARTIAL | Yes | `Part`, `BomHeader/Line`, `RecipeHeader/Step`, `WorkOrderOperation`; missing controlled engineering change/effectivity and production-version selection |
| Immutable inventory ledger, lots, serials, counts, transfers | FUNCTIONAL_PARTIAL | Yes | Canonical `InventoryMovement`/`StockBalance` plus CNC-V1-02 WO reservation, available balance, issue/return/WIP and lot genealogy. Input serial allocation remains deferred. |
| MRP | FUNCTIONAL_PARTIAL | Yes | `MrpService.run()` explodes BOM/netting and proposals; no lead-time offset, lot sizing, exceptions, rescheduling, net-change, or execution reservation |
| MES work-order operation and HMI | FUNCTIONAL_PARTIAL | Yes | `ProductionService`, `HmiService`, route/HMI E2E; missing pause/resume/hold/rework/partial execution discipline and material/quality execution gates |
| NC program control | VERIFIED_DONE | No for document control; Yes for machine execution assurance | `NcProgram`, release/e-signature/checksum E2E; no DNC/download/readback machine-side verification |
| CNC connectivity | FUNCTIONAL_PARTIAL | Yes | OPC-UA adapter, connector durable queue/health; M80 explicitly experimental, no MTConnect, no validated machine program control |
| Tooling / verified setup | FUNCTIONAL_PARTIAL | No for controlled pilot; Yes for unrestricted production scope | strong setup/reservation/life foundation; no offsets/presetter integration, tool location/inventory or breakage/change workflow |
| Fixture management | FUNCTIONAL_PARTIAL | No for controlled pilot; Yes for broad commercial claim | fixture identity/reservation/maintenance/calibration policy gates; no location and no full asset lifecycle/history UI proof |
| Basic QMS | FOUNDATION_ONLY | Yes | quality plans/checks, inspections, NCR/CAPA/SPC objects exist; no inspection lot/planned enforcement, sampling, material/operation hold-release flow |
| Basic CMMS | FOUNDATION_ONLY | Yes | calendar/runtime-triggered maintenance orders; no technician/spares/failure taxonomy/downtime-to-maintenance or availability gate |
| OEE / operational analytics | FOUNDATION_ONLY | Yes, because OEE is in the offered package | alarm/run-derived daily and WO calculations; no planned time, shift calendar, work-centre/WO allocation, telemetry completeness control |
| Production costing | FOUNDATION_ONLY | Yes, because costing is in the offered package | actual standard material + machine + labor calculation; no planned/variance, overhead, tool/fixture/scrap/subcontract cost |
| Deployment and commercial administration | FUNCTIONAL_PARTIAL | Yes | Compose/CI/health/seed/import are present; tenant provisioning, backup/restore/runbook/upgrade/onboarding are absent |
| Entitlements V2 | VERIFIED_DONE, non-authoritative | No | ARCH-001..004; legacy remains production authority by explicit decision |

## Capability detail and gaps

### 1. Platform and shared foundation

| Capability | Status | Evidence | Missing behaviour / impact | Priority |
|---|---|---|---|---|
| Tenant-scoped persistence and cross-tenant defence | VERIFIED_DONE | `tenant-scope.extension.ts`, composite tenant FKs, tenant isolation E2E | No database RLS defence-in-depth; not a first-pilot blocker with controlled application access. | P1 |
| User/operator identity, RBAC, pages/actions | VERIFIED_DONE | Local/LDAP/OIDC auth, `RolesGuard`, `PagesGuard`, action grants for HMI/tooling | Operator skill/certification and shift assignment are absent. | P1 |
| Plant → area → workplace → unit → machine | FUNCTIONAL_PARTIAL | `HierarchyService` CRUD and `Machine.unitId` | No legal company, department, capacity work-centre model distinct from physical hierarchy. | P0 |
| UOM and currency | FOUNDATION_ONLY | quantity/currency are free text/default `TRY`; no UOM/currency master | Conversion, controlled dimensional quantities and customer-specific currency cannot be governed. | P0 for UOM; P1 for multi-currency |
| Shift/calendar/timezone | FOUNDATION_ONLY | Tenant timezone field; `ShiftReportService` hardcodes 06–14/14–22/22–06 | No tenant plant calendar, holidays, planned downtime, shift patterns, operator/machine calendars. It invalidates finite capacity and production-grade OEE. | P0 |
| Documents / audit / notification | FUNCTIONAL_PARTIAL | MinIO signed URLs, MIME allowlist, AuditLog, notifications/outbox | Document revision/change-control is only strong for NC programs; drawings and certificates are generic attachments. | P1 |
| Scheduler/background work | FOUNDATION_ONLY | outbox dispatcher; MRP and predictive maintenance are explicit user actions | No durable scheduler for MRP, PM due checks, escalation, retention or monitored job failure. | P0 |
| Import/export / localization | FOUNDATION_ONLY | user CSV import, Turkish-centric UI, timezone field | No governed master-data import/export, multilingual localization or locale/currency policy. | P1 |
| Operational health and deployment | FUNCTIONAL_PARTIAL | Compose, CI migration+seed, `/health`, connector loopback health | `/health` does not check PostgreSQL/MinIO/outbox; no documented backup/restore, upgrade rollback, production secret rotation or provisioning. | P0 |

### 2. Manufacturing master data and engineering

`Part` includes revision, drawing/STEP references, ideal cycle time and lot
tracking; `BomHeader/Line` supports material and subassembly parts; recipe
steps hold sequence, parameters, standard minutes, sanitized instructions and
optional released NC programs. Work orders snapshot route, instruction,
standard-minute, NC revision/checksum and tooling/fixture requirements.

This is sufficient for an alpha engineering flow, but not yet a controlled
manufacturing master-data release:

- BOM and route have revisions but no formal Draft/Review/Released lifecycle,
  effectivity dates, engineering approval, change notice or production-version
  selection. A service-level “one active” convention is weaker than a release
  gate.
- No UOM conversion or master, operation work-centre/resource requirement,
  setup/run standard split, alternate routing/machine policy, or controlled
  drawing revision binding beyond generic document links.
- Quality requirements are not copied into operation snapshots or enforced at
  start/complete. Tool/fixture requirements are copied and enforced, which is
  the strongest part of this domain.

**Recommended epic:** `CNC-V1-01 Engineering release and execution master
data` (P0, L), dependent on UOM/calendar work.

### 3. Inventory and material control

The ledger design is strong: `InventoryMovement` is immutable; balances,
warehouse/bin, lots, serials, transfer orders and cycle counts exist.
`traceability-acceptance.e2e-spec.ts` verifies accepted lot constraints and
multi-level backward/forward genealogy. Consumption and finished-goods services
write ledger-backed operational records.

Critical missing V1 behaviour:

- No work-order/BOM reservation/allocation model. `ConsumptionService.create()`
  records an issue, but material is not allocated when an order is released or
  checked as available at operation start.
- No automatic/backflush consumption linked to operation completion, no
  component issue plan, and no consumable return/scrap/rework inventory flow.
- Stock has physical balance, but no explicit available, allocated, WIP,
  quality-hold and ATP views. Finished goods exist, but work-in-process is not
  a controlled inventory state.
- Receiving/lot acceptance is present, but no customer-return/production
  disposition integration is required for V1 only if the first pilot does not
  sell returns handling.

**Business impact:** production can be started despite materials needed by the
route having been consumed by another order, and actual material use is a
manual after-the-fact record. This is a P0 commercial integrity blocker.

**Recommended epic:** `CNC-V1-02 Material availability, reservation and
execution consumption` (P0, XL), dependent on released BOM/route and quality
hold states.

### 4. MRP

`MrpService.run()` currently handles planned work-order demand, recursive BOM
explosion (bounded depth), safety stock through `Material.minStock`, on-hand
netting, open PO supply, outstanding draft/pending proposals, multi-level
production shortfalls, purchase/production proposals and approval conversion.
This is more than a catalogue foundation.

It remains unsuitable as the sole planning engine for commercial V1:

- Demand ignores sales-order dates unless released into a planned work order.
- It does not use `Material.leadTimeDays` for requirement dates; no lead-time
  offset, vendor lead time, lot sizing/minimum/multiple, planning horizon, firm
  supply, reschedule/cancel messages or net-change regeneration.
- It nets non-allocated on-hand stock and does not consume reservation state,
  therefore can double-promise inventory.
- Capacity endpoint distributes standard minutes evenly and explicitly reports
  that machine shifts/holidays/maintenance/alternate machines are missing.

**Recommended epic:** `CNC-V1-03 MRP execution-grade netting and exception
control` (P0, L), after `CNC-V1-02`; finite APS is explicitly out of scope.

### 5. MES execution and operator HMI

Verified behaviour includes tenant-scoped queue/detail, start/complete action
grants, sequence gates, active run control, machine assignment, instruction and
released NC snapshot visibility, verified setup, tool/fixture compatibility,
fixture-maintenance gate, and immutable setup snapshot. `hmi-operations` and
`mes-tooling` PostgreSQL E2E cover major cross-tenant and concurrency paths.

Gaps that prevent a professional operator execution claim:

- The HMI supports only **start** and **complete**. There is no explicit setup
  start/complete lifecycle, pause/resume/stop/hold/release, partial quantity
  confirmation discipline, rework routing or split/merge operation flow.
- `ProductionRun` has good/scrap counts and notes, but reject and rework are
  not first-class quantity/accounting states. NCR blocks good-count entry, but
  no controlled disposition takes material/operation/lot from hold to release,
  scrap or rework.
- Material issue/return/backflush and inspection acceptance are not hard gates
  for operation completion. Operator assignment exists; qualification does not.
- Machine data is not automatically reconciled to HMI quantity confirmations.

**Recommended epic:** `CNC-V1-04 Controlled MES execution, quantity and
disposition` (P0, XL), dependent on material allocation and quality execution.

### 6. CNC integration

| Capability | Status | Evidence / limitation |
|---|---|---|
| Machine registry, machine key, telemetry, status/events/alarms | FUNCTIONAL_PARTIAL | `Machine`, connector key, `MachinesService.handleTelemetry`, persistent status events and downtime E2E |
| OPC UA read/subscription/tag discovery | FUNCTIONAL_PARTIAL | `opcua.adapter.ts` uses `node-opcua`, subscriptions and browse; must be qualified against the selected controller/companion server |
| Mitsubishi M80 | SIMULATED | `m80-protocol.ts` says address/protocol is placeholder and only its simulator is validated |
| Fanuc / MTConnect | MISSING | Fanuc adapter is explicit FOCAS skeleton; no MTConnect adapter |
| Offline/reconnect/edge delivery | FUNCTIONAL_PARTIAL | Connector reconnects and uses persisted `edge.queue.json`; no proven power-loss, ordering, retention or field deployment matrix |
| DNC/program download/upload/readback | MISSING | No controller command/write/program transfer interface |
| Correct program on machine before start | FOUNDATION_ONLY | App verifies a released NC revision/checksum before HMI start; it does not read controller program identity/checksum or command transfer |
| Connector diagnostics | FUNCTIONAL_PARTIAL | loopback health reports connection/queue/last error; no central fleet diagnostics/alerting |

For V1, choose one supported controller route. The smallest credible scope is
**OPC UA read-only telemetry + explicit operator scan/confirmation of a
released program checksum**, or one validated controller protocol with
readback. Do not market Mitsubishi M80 or DNC as production ready until a
hardware acceptance matrix exists.

**Recommended epic:** `CNC-V1-05 CNC production integration qualification`
(P0, XL), dependent on a named pilot controller and a test machine.

### 7. Tooling and fixture management

Tool definitions/components/assemblies/physical serial identities, compatibility,
requirements, alternative groups, reservations, verification snapshots, life
policies/events and optimistic-concurrency adjustments exist. Fixture physical
identity, machine compatibility, reservation, maintenance/calibration policy,
history and due/blocked evaluation also exist. The setup gate is one of the
best-tested areas (`mes-tooling.e2e-spec.ts`).

Remaining professional gaps:

- no presetter/offset lifecycle or CNC offset transfer/readback;
- no tool crib/location/stock model, tool change/breakage disposition or
automatic life accumulation from controller data;
- no fixture location, formal check-in/check-out or broad asset history;
- fixture policy counters rely on current completion evidence/controlled
overrides rather than independent machine counters.

These are P1 for a controlled pilot if physical setup is verified manually;
they become P0 only if automatic offsets/tool inventory are sold in the initial
commercial promise.

### 8. QMS and CMMS

Basic quality has plans/checks, manual inspections with pass/fail, SPC
characteristics/measurements, NCR, CAPA and deviation approval. Basic
maintenance has machine-linked corrective/preventive work orders and an
explicit runtime-hour PM check. Neither is a complete execution system.

P0 gaps:

- No inspection lot generated from receipt, production operation or finished
  goods; no plan selection/revision snapshot, sampling engine, measured
  characteristic entry tied to a plan, certificate-of-conformance flow or
  authoritative quality hold/release.
- NCR action types exist but do not produce inventory disposition, rework
  operation or scrap-cost trace automatically.
- CMMS has no technician assignment, failure/cause taxonomy, spare-parts issue,
  breakdown-to-downtime link, schedule/calendar execution, maintenance impact
  on machine scheduling, or automatic due scheduler.

**Recommended epics:** `CNC-V1-06 Inspection, hold/release and NCR disposition`
(P0, XL) and `CNC-V1-07 Minimum machine maintenance execution` (P0, L).
Advanced SPC/CAPA analytics and full calibration management are P2.

### 9. OEE, costing and operational analytics

Current OEE uses production runs, `Part.idealCycleTimeSec` and alarm events;
it intentionally returns null rather than inventing performance where the ideal
time is missing. Daily trend, downtime Pareto, work-order OEE and a fixed-shift
report exist. Current cost sums consumed material standard cost plus machine and
operator time, with explicit partial flags for missing rates.

These are transparent **foundation metrics**, not production-grade commercial
analytics:

- planned production time, planned downtime, calendar/shift allocation,
  changeover/setup, micro-stops, event coverage/late-data quality and
  work-centre/machine/production-order attribution are absent;
- OEE availability is inferred from ALARM-to-next-event intervals and can be
  overstated or misattributed; hardcoded shifts ignore tenant timezone/calendar;
- costing lacks planned cost, variance, operation-level cost, overhead,
  scrap/rework, tool/fixture, subcontract and finished-unit cost policy;
- reports cover dashboards, WO status, MRP, OEE/downtime and genealogy but not
  a single production control cockpit for shortages, inspection holds, cost
  variance, tool/fixture due state and exceptions.

**Recommended epics:** `CNC-V1-08 Production-grade time, OEE and operational
control cockpit` (P0, L) and `CNC-V1-09 Planned/actual manufacturing costing`
(P0, L). Enterprise BI is P2.

## Real CNC business flow trace

| Flow step | Current state | Break / release requirement |
|---|---|---|
| Customer demand → sales order → WO | FUNCTIONAL_PARTIAL | sales/quote/order and WO release exist; enforce released engineering revision and demand date semantics |
| Master data → BOM → routing | FUNCTIONAL_PARTIAL | records and snapshots exist; add released/effective BOM-route and UOM control |
| MRP → supply proposals | FUNCTIONAL_PARTIAL | explosion/netting/proposals work; add allocations, lead-time/lot rules and exceptions |
| Material availability → reservation | VERIFIED_DONE | immutable WO requirements, tenant/lot reservation, availability netting, HMI shortage gate and PostgreSQL concurrency proof |
| HMI queue → drawing/instruction/NC/setup | FUNCTIONAL_PARTIAL | strong NC/tool/fixture setup gate; drawing revision and quality/material readiness missing |
| Correct machine/program/tool/fixture | FUNCTIONAL_PARTIAL | app-side machine/NC/tool/fixture check; machine-side NC identity/transfer/readback absent |
| Setup → start → pause/downtime → completion | FUNCTIONAL_PARTIAL | start/complete and downtime work; no controlled pause/hold/rework/partial quantities |
| Consumption → inspection → disposition | MISSING | manual issue plus manual inspection/NCR, but no integrated quality hold/release/scrap/rework path |
| Finished receipt → genealogy/as-built | FUNCTIONAL_PARTIAL | lot/serial/genealogy are strong; ensure final release gate and complete as-built quality/material/tool/fixture record |
| Actual cost → OEE → reporting | FOUNDATION_ONLY | values are calculated but lack policy-complete cost and production-grade time model |

## Implementation backlog

| ID | Name | Priority | Complexity | Dependencies |
|---|---|---:|---:|---|
| CNC-V1-00 | Deployment, provisioning and operating baseline | P0 | L | none — `VERIFIED_DONE` 2026-08-12 |
| CNC-V1-01 | Engineering release and execution master data | P0 | L | CNC-V1-00 UOM/calendar decisions — `VERIFIED_DONE` 2026-08-12 |
| CNC-V1-02 | Material availability, reservation and execution consumption | P0 | XL | CNC-V1-01 — `VERIFIED_DONE` 2026-08-12: immutable snapshot requirements, allocation, canonical issue/return/WIP, backflush idempotency, MRP available-to-plan netting and isolated PostgreSQL race/restore evidence. |
| CNC-V1-03 | MRP execution-grade netting and exception control | P0 | L | CNC-V1-02 |
| CNC-V1-04 | Controlled MES execution, quantity and disposition | P0 | XL | CNC-V1-01/02/06 |
| CNC-V1-05 | Mitsubishi M80 controller production qualification | P0 | XL | CNC-V1-04 — `SOFTWARE_READY_FIELD_VALIDATION_REQUIRED`: persisted capability/trust/freshness evidence and start/resume NC gate are simulator/PostgreSQL verified; real M80 field acceptance remains mandatory. |
| CNC-V1-06 | Inspection, hold/release and NCR disposition | P0 | XL | CNC-V1-01/02 — `VERIFIED_DONE` (isolated PostgreSQL quality/concurrency and restore evidence, 2026-08-12) |
| CNC-V1-07 | Minimum machine maintenance execution | P0 | L | CNC-V1-00 calendar, CNC-V1-08 time states |
| CNC-V1-08 | Production-grade time, OEE and operational control cockpit | P0 | L | CNC-V1-00 calendar, CNC-V1-04/05/07 |
| CNC-V1-09 | Planned/actual manufacturing costing | P0 | L | CNC-V1-02/04/06/08 |
| CNC-V1-10 | Tool crib, offsets and fixture asset lifecycle | P1 | XL | CNC-V1-05 |
| CNC-V1-11 | Advanced QMS / SPC / CAPA / calibration | P2 | XL | CNC-V1-06 |
| CNC-V1-12 | Advanced planning / APS / enterprise BI | P2 | XL | CNC-V1-03/08 |

### Epic definitions

#### CNC-V1-00 — Deployment, provisioning and operating baseline

- **Problem:** a pilot cannot be repeated or recovered safely with current
  Compose/seed-only administration.
- **Scope:** tenant/bootstrap workflow, initial-admin handoff, environment
  validation, dependency-aware health, backup/restore drill, migration/rollback
  runbook, connector enrollment/diagnostics, production sample/onboarding data.
- **Out of scope:** billing, automatic V2 entitlement cutover, hosted control
  plane.
- **Acceptance:** a clean environment can be provisioned, restored into an
  isolated target, upgraded through a migration, and monitored by documented
  operators without exposing secrets.
- **Risk:** operational data loss or failed customer onboarding. **L**.

**Current result (2026-08-12): `VERIFIED_DONE`.** Controlled migration and
idempotent tenant/admin/plant provisioning, production configuration fail-fast,
liveness/readiness/build info, connector heartbeat diagnostics, safe demo-seed
separation, backup/restore and executable on-prem runbook are implemented.
`pnpm test:operations-e2e` passed against two isolated real PostgreSQL 16
databases: 65 migrations, provisioning, smoke data, backup, restore, schema
status and restored login/data/legacy-module verification. Details:
`docs/CNC-V1-00-DEPLOYMENT-OPERATIONS.md`.

#### CNC-V1-01 — Engineering release and execution master data

- **Problem:** BOM/routes are editable operational records rather than fully
  controlled released production definitions.
- **Scope:** UOM master/conversions; BOM/route/quality-plan lifecycle and
  effectivity; released production version selection; controlled document
  association; machine/work-centre standard setup/run fields.
- **Out of scope:** CAD/CAM/PDM authoring, full PLM change-management suite.
- **Acceptance:** only one effective released definition can create a WO; the
  exact definition is immutable and traceable on every WO operation.
- **Risk:** manufacturing from an unintended definition. **L**.

#### CNC-V1-02 — Material availability, reservation and execution consumption

- **Problem:** ledger correctness does not prevent multiple orders consuming
  the same stock.
- **Scope:** reservation/allocation state, available/allocated/WIP balances,
  BOM requirement plan, shortage gate, issue/backflush/return, lot/serial
  binding and approved exception flow.
- **Out of scope:** consignment, vendor-managed inventory, advanced warehouse
  optimization.
- **Acceptance:** two concurrent WOs cannot over-allocate; HMI start/complete
  evaluates material policy; every actual issue/return/finished receipt gives a
  reversible, traceable ledger result.
- **Risk:** false inventory, late shortages and untraceable material. **XL**.

#### CNC-V1-03 — MRP execution-grade netting and exception control

- **Problem:** proposals ignore allocation and key timing/policy rules.
- **Scope:** allocated-stock netting, lead-time requirement dates, minimum/multiple
  lot rules, firm/open supply policy, planning horizon, exception messages and
  idempotent regeneration.
- **Out of scope:** finite APS and enterprise S&OP.
- **Acceptance:** a dated demand produces explainable pegged purchase/production
  proposals without double counting stock; changed demand creates explicit
  expedite/reschedule/cancel exceptions.
- **Risk:** planner cannot trust recommendations. **L**.

#### CNC-V1-04 — Controlled MES execution, quantity and disposition

- **Problem:** current HMI stops at start/complete and does not authoritatively
  join material, quality and quantity state.
- **Scope:** setup/start/pause/resume/hold/complete lifecycle; partial good,
  scrap and rework; operator/machine assignment; material and inspection gates;
  controlled NCR disposition and as-built completion record.
- **Out of scope:** dispatch optimization, split/merge if pilot routing does
  not require it (decide explicitly during discovery).
- **Acceptance:** every CNC operation has an auditable lifecycle and cannot
  complete with unresolved required material, setup, quality or NCR blockers.
- **Risk:** loss of shop-floor control and false completion. **XL**.

#### CNC-V1-05 — CNC production integration qualification

- **Problem:** application-side NC validation does not prove what is running on
  a controller.
- **Scope:** select one supported controller profile; verified telemetry map;
  edge reconnect/power-loss acceptance; program identity readback or an explicit
  scan/dual-confirmation control; alarm/cycle/count mapping; diagnostics.
- **Out of scope:** universal Mitsubishi/Fanuc/MTConnect support, DNC unless the
  selected pilot requires it.
- **Acceptance:** a real machine acceptance test proves the running program
  corresponds to the released WO snapshot, telemetry is durable/idempotent and
  disconnected operation has explicit safe behaviour.
- **Risk:** wrong program, false counts or unsafe machine data claims. **XL**.

**2026-08-14 implementation status:** the selected M80 profile now has an
explicit capability/trust contract, persisted tenant-scoped observations,
freshness/connection semantics, and an immutable-WO expected-versus-observed
NC start/resume gate. It deliberately does not claim program checksum/content
readback, remote start, transfer, or automatic production quantity. Simulator
and isolated PostgreSQL evidence demonstrate fail-closed mismatch, stale,
offline, unsupported, reconnect and restart-safe software behaviour. It is
not field-qualified until `docs/CNC-V1-05-M80-FIELD-ACCEPTANCE.md` is completed
on a representative controller; status is therefore
`SOFTWARE_READY_FIELD_VALIDATION_REQUIRED`, not `VERIFIED_DONE`.

#### CNC-V1-06 — Inspection, hold/release and NCR disposition

- **Problem:** quality records exist but do not control material or operation
  release.
- **Scope:** receiving/in-process/final inspection lots, plan snapshot,
  characteristic results, sampling selection, hold/release, certificate links,
  NCR → scrap/rework/deviation disposition and genealogy.
- **Out of scope:** advanced SPC, CAPA effectiveness analytics and laboratory
  integrations.
- **Acceptance:** nonaccepted material/final product cannot progress; accepted
  inspection and disposition become immutable as-built evidence.
- **Risk:** shipping or consuming nonconforming material. **XL**.

#### CNC-V1-07 — Minimum machine maintenance execution

- **Problem:** PM/CM records do not affect real machine availability or capture
  work execution resources.
- **Scope:** PM calendar/runtime triggers, corrective breakdown order from
  downtime, technician, failure/cause code, spare issue, completion evidence,
  machine unavailable state.
- **Out of scope:** reliability analytics and full EAM asset accounting.
- **Acceptance:** due/broken machine is visible and cannot be selected for a
  new operation without controlled override; downtime and maintenance history
  reconcile.
- **Risk:** unavailable machines silently enter production plans. **L**.

#### CNC-V1-08 — Production-grade time, OEE and control cockpit

- **Problem:** OEE uses alarm intervals and fixed shifts instead of an agreed
  production-time model.
- **Scope:** tenant shift/calendar, planned time/downtime, machine/work-centre
  attribution, event completeness/late-event policy, OEE definitions, live and
  historical control dashboard for shortages/holds/downtime/tool/fixture/MRP.
- **Out of scope:** enterprise semantic BI.
- **Acceptance:** OEE can be explained from immutable event windows per
  machine/work-centre/shift/WO and never silently substitutes missing data.
- **Risk:** commercially misleading OEE. **L**.

#### CNC-V1-09 — Planned/actual manufacturing costing

- **Problem:** current actual cost is transparent but not a manufacturing cost
  policy or variance calculation.
- **Scope:** released planned material/machine/labor rates, operation and WO
  actuals, scrap/rework cost treatment, cost-per-unit, variance and partial-data
  controls; tool/fixture/overhead policy only where the pilot has rates.
- **Out of scope:** full general ledger, payroll, AP/AR integration.
- **Acceptance:** planner and production manager can explain planned versus
  actual cost per released WO and unit, with missing inputs never reported as
  complete cost.
- **Risk:** unsupported profitability/costing claim. **L**.

## Recommended execution order

1. `CNC-V1-00` — operational baseline and pilot controller decision.
2. `CNC-V1-01` — released execution master data and UOM/calendar.
3. `CNC-V1-02` — allocation/issue/return and material availability.
4. `CNC-V1-06` — inspection/hold/release/disposition, in parallel with late
   `CNC-V1-02` where interfaces are agreed.
5. `CNC-V1-04` — controlled HMI lifecycle using material and quality gates.
6. `CNC-V1-05` — selected-machine acceptance, not universal controller work.
7. `CNC-V1-03`, `CNC-V1-07`, `CNC-V1-08`, `CNC-V1-09` — planning, maintenance,
   operational intelligence and cost completion.
8. `CNC-V1-10` after first pilot evidence; `CNC-V1-11/12` only after V1.

## Objective release gates

> **CNC-V1-04 reconciliation — 2026-08-13:** `VERIFIED_DONE`.
> `WorkOrderOperation` is now the canonical controlled MES lifecycle with
> durable setup/pause/hold/history, immutable incremental reports, material and
> quality gates, controlled NCR rework and new reinspection evidence. A clean
> isolated PostgreSQL 16 run applied all 69 migrations and passed 5 suites / 14
> tests; a second isolated PostgreSQL backup/restore verification passed 1/1.
> See `docs/CNC-V1-04-MES-LIFECYCLE.md`.

### Alpha

- One internally administered tenant with deployment runbook and health checks.
- Released part/BOM/route/NC/work-instruction can make an immutable WO snapshot.
- One test machine profile can produce a routed operation through verified
  tool/fixture setup and HMI start/complete.
- Material lots, manual issue and finished receipt appear in genealogy.
- No cross-tenant access regression; all targeted PostgreSQL E2E suites pass.

### Pilot Ready

- A named customer/controller integration has passed field acceptance with
  explicit disconnected/incorrect-program behaviour.
- Material reservation, availability and consumption/return are enforced for
  pilot BOMs.
- In-process/final inspection and hold/release block the appropriate flow.
- HMI lifecycle records partial/scrap/rework/hold decisions and as-built
  evidence; NCR disposition is traceable.
- PM/breakdown handling makes machine availability explicit.
- Customer backup/restore and upgrade rehearsal succeed.

### Commercial V1 Ready

- The complete business flow below passes against an isolated production-like
  environment and a representative real CNC machine: demand → released master
  data → MRP → allocated material → routed HMI setup → correct machine/program
  → consumption/quality disposition → finished receipt → full genealogy →
  planned/actual cost → explainable OEE/control dashboard.
- All P0 epics pass their acceptance criteria and security/tenant regression
  tests; migration, backup/restore and connector recovery are rehearsed.
- No silent fallback permits a nonapproved material, NC revision, required
  tool/fixture, quality decision or cross-tenant reference to complete an
  operation.
- Pilot operating procedures, onboarding, support/incident ownership and
  explicit product/controller support boundaries are delivered.

## Explicit deferrals

Do not start these as part of the first commercial CNC release unless a signed
pilot requirement proves otherwise: Entitlements V2 production cutover, full
finance/payroll/CRM, TMS/SCM/S&OP, advanced APS, universal CNC protocols,
unbounded DNC rollout, enterprise BI, broad IIoT data-lake work, advanced SPC,
or automated presetter/offset integration.

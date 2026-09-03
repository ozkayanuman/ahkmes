# CNC-V1-07R — Commercial CMMS Release Closure

Status: `VERIFIED_DONE`.

Real PostgreSQL evidence (2026-08-21): dedicated `cnc-v1-07r.e2e-spec.ts` A–Z
suite 13/13 PASS from a clean database; the same suite plus the full CNC-V1-00/
01/02/03R/04/06 regression (`deployment-operations`, `engineering-master-data`,
`production-material`, `cnc-v1-03r`, `quality-execution`, `mes-lifecycle`,
`cnc-v1-07r`) PASS together (7 suites / 65 tests) against a freshly migrated
(76 migrations) PostgreSQL instance; `scripts/backup.sh` → second isolated
PostgreSQL → `scripts/restore.sh` → `prisma migrate status` ("Database schema
is up to date!") → `deployment-restore.e2e-spec.ts` PASS, confirming the full
maintenance graph (breakdown, downtime, work order with tasks/technicians/
labor/spares, return-to-service, PM plan) survives dump/restore intact.
Backend unit suite 61/61 (285/285 tests), web suite 10/10 (33/33 tests),
connector 7/7 (25/25), shared-types 3/3 (32/32), workspace typecheck and
production build all green. Full detail in `CNC-V1-07R-CMMS.tdd.md`.

## Canonical ownership and commercial boundary

`Machine` remains the sole CNC machine and maintainable-asset identity. CMMS
adds an explicit plant-scoped asset profile and maintenance availability to
that row; it does not create a second asset registry. The existing
`Plant → Area → Workplace → Unit → Machine` hierarchy remains the physical
work-centre hierarchy, while the explicit plant reference prevents provenance
guessing when a legacy machine has no `Unit`.

`MaintenanceOrder` remains the canonical maintenance work order and is
extended rather than replaced. `DowntimeEvent` remains the canonical
timestamp-based interval. `User` is the lightweight technician identity,
`InventoryService`/`StockBalance`/`InventoryMovement` remain the only stock
authority, and `Document` remains the optional document-reference boundary.

CMMS is independently sellable under the authoritative legacy
`EAM_MAINTENANCE` / `TenantModuleEntitlement` boundary. CMMS does not require
MES, controller connectivity, CRM, MRP or HR. MES reads the shared machine
maintenance projection as a safety gate but does not require CMMS data; the
absence of a maintenance restriction means production remains allowed.

## Maintenance state and telemetry separation

The business states are:

- `AVAILABLE`: production allowed.
- `MAINTENANCE_DUE`: production allowed with a warning.
- `PLANNED_MAINTENANCE`: future windows warn; an active blocking window blocks.
- `BREAKDOWN`: production start/resume blocked.
- `OUT_OF_SERVICE`: production start/resume blocked.

These states are not controller observations. `ControllerMachineState.IDLE`,
`READY`, `OFFLINE` or any later telemetry can neither return a machine to
service nor close maintenance-owned downtime. A declared breakdown during an
existing run records the failure, opens downtime and blocks new start/resume;
it does not complete, scrap, invent quantity or silently mutate the running
MES operation. Pause/hold remains an explicit CNC-V1-04 lifecycle command.

## Request, breakdown and downtime ownership

A maintenance request records the plant-scoped machine, reporter, problem,
priority, description, timestamp and optional production/document context. A
request is not a breakdown until explicitly classified.

A breakdown is a first-class audited event. Declaration locks the machine,
sets the maintenance projection, creates exactly one open maintenance-owned
`DowntimeEvent`, and persists outbox/audit evidence in one transaction.
Breakdown-to-maintenance-WO conversion is row-locked and uniquely linked so a
retry or race yields at most one work order.

CMMS owns only maintenance downtime categories:

- `PLANNED_MAINTENANCE`
- `UNPLANNED_BREAKDOWN`
- `OTHER_MAINTENANCE`

Setup, operator pause, material shortage and quality downtime remain outside
CMMS. The OEE read-side handoff is an immutable fact containing plant,
machine, start, end, derived duration, planned/unplanned classification,
source and linked maintenance event. CNC-V1-07R does not calculate OEE.

## Maintenance work and preventive maintenance

The controlled maintenance lifecycle is:

`DRAFT → PLANNED → RELEASED → IN_PROGRESS ↔ ON_HOLD → COMPLETED`

with controlled cancellation from non-terminal states. Direct arbitrary
status writes are rejected. Completion requires required checklist tasks and,
for breakdown work, actual finish, resolution/remedy and an explicit machine
disposition. Completion never makes the machine available.

Time-based PM plans own an effective start, interval in days, exact next due,
warning window, priority and default checklist. `UPCOMING`, `DUE` and
`OVERDUE` are derived from the exact plant-local due timestamp. Generation is
idempotent per plan occurrence and replay-safe under PostgreSQL concurrency.

The legacy MES-run wall-clock counter is not trustworthy universal machine
runtime. Therefore `METER_BASED_PM = P1 / NOT_INCLUDED_IN_V1`; CNC-V1-07R does
not claim controller-runtime preventive maintenance.

## Technicians, labor, checklist and spares

Assignments reference tenant-scoped `User` rows and support multiple
technicians plus a primary assignment without requiring an HR product. Labor
records a technician, work date, start/end or positive derived duration and
notes. Required ordered checklist tasks block completion until an actor and
timestamp are recorded.

Planned spare lines record planned, issued and returned quantities. Actual
issue/return uses distinct `MAINTENANCE_ISSUE` and `MAINTENANCE_RETURN`
movements through the canonical inventory service. The command locks the
physical balance, rejects held lots, respects active production allocations,
prevents negative stock and writes material history atomically and
idempotently.

Production reservations are currently owned by immutable
`ProductionMaterialRequirement`. CNC-V1-07R deliberately does not create a
parallel CMMS reservation engine. Maintenance spare reservation is
`NOT_INCLUDED_IN_V1`; a future implementation must generalize the common
allocation boundary without weakening CNC-V1-02.

## Return to service and concurrency

Return to service is a separate authorized command after repair completion.
It locks the machine and linked breakdown/work/downtime in a fixed order,
records actor/time/reason, resolves the breakdown, closes the timestamped
downtime and changes the projection to `AVAILABLE` in one transaction. Retry
and concurrent attempts preserve the original event and cannot create an
inconsistent machine/downtime/work-order combination.

Critical PostgreSQL evidence is defined in
`apps/backend/test/cnc-v1-07r.e2e-spec.ts`: simultaneous breakdown declaration,
breakdown conversion, limited-stock spare issues, PM replay, return to service,
restart durability, tenant/plant rejection and forced transaction rollback.

## Reliability reality and known V1 limits

Repair duration/MTTR input is the explicit maintenance work
`actualStart → actualFinish` interval; downtime is reported separately and is
not relabelled as repair time. Production-grade MTBF is not claimed because a
trustworthy operating-time denominator is not universally available. Failure
counts, history and raw intervals are exposed for the future OEE/runtime layer.

Advanced EAM accounting, depreciation, predictive/AI maintenance, workforce
scheduling, contractors, procurement, spare-parts MRP, telemetry-created
breakdowns, OEE, costing and APS remain outside CNC-V1-07R.

CNC-V1-05 remains `SOFTWARE_READY_FIELD_VALIDATION_REQUIRED`.

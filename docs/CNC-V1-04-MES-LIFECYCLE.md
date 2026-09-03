# CNC-V1-04 — Controlled MES Execution Lifecycle

## Status

`VERIFIED_DONE` — 2026-08-13. The isolated PostgreSQL 16 operations run
applied all 69 migrations, passed 5 suites / 14 tests, then backed up and
restored into a second isolated PostgreSQL database where the lifecycle graph
was verified again.

## Canonical ownership

`WorkOrderOperation.status` is the single current execution state. `ProductionRun`
is the durable active/historical run and `ProductionExecutionEvent` is append-only
lifecycle history. `ProductionReport` is immutable incremental quantity evidence;
operation/run totals are projections, never the sole business evidence.

The production service reuses CNC-V1-01 engineering snapshots, CNC-V1-02 material
requirements/backflush, and CNC-V1-06 quality holds, NCRs and rework requirements.
No parallel MES engine or inventory balance was introduced.

## State machine

| Current | Allowed transition | Command |
|---|---|---|
| READY (`PENDING`) | SETUP | setup start |
| READY (`PENDING`) | RUNNING | start where setup is not required |
| SETUP | READY | setup complete after existing setup validation |
| RUNNING | PAUSED / HELD / COMPLETED | pause / hold / controlled complete |
| PAUSED | RUNNING / HELD | resume / hold |
| HELD | PAUSED | explicit non-quality hold release only after gates recheck |
| REWORK | PAUSED / HELD | controlled rework execution remains quantity-bound |

All commands lock the `WorkOrderOperation` row in PostgreSQL. Invalid transitions,
missing active runs, overproduction and quantity-incomplete completion return
explicit domain errors. Quality holds cannot be released through MES commands;
they remain under CNC-V1-06 authorization and release policy.

## Quantity, materials and history

Incremental reports record good/scrap deltas with tenant idempotency keys. Their
canonical CNC-V1-02 backflush call is in the same transaction. Completion only
ends the run after `good + scrap = target`; it does not overwrite prior report
totals. Pause, resume, setup, hold, report, rework and completion events carry
actor/reason/time and canonical plant-calendar shift attribution.

## Rework and reinspection

An open CNC-V1-06 `ReworkRequirement` starts a separate rework run linked to the
original NCR, operation and source output. The original failed inspection and NCR
are never modified. Rework reporting cannot exceed affected quantity. Starting
rework creates a new inspection lot using the released requirement snapshot.
Only a passing reinspection after required rework quantity is recorded resolves
the rework requirement; a quality hold may then be released through the quality
service. Reinspection failure creates new evidence/NCR according to CNC-V1-06.

## HMI and authorization

`/hmi/operations` now exposes current lifecycle actions (setup, start,
pause/resume, hold/release, incremental report, completion and rework), blocking
checklist reasons, quality/material status and chronological event history.
The backend endpoints are action-authorized (`HMI_SETUP`, `HMI_PAUSE`,
`HMI_RESUME`, `HMI_HOLD`, `HMI_HOLD_RELEASE`, `HMI_REPORT`, `HMI_REWORK`) and
remain tenant-scoped. Legacy `ProductModule` / `TenantModuleEntitlement` and
`PagesGuard` remain the production entitlement authority.

## Evidence and limitations

The PostgreSQL suite proves normal lifecycle, duplicate-report idempotency,
report and pause/complete races, restart durability, quality completion blocking,
rework/reinspection resolution, snapshot-backed material issue, composite tenant
ownership, and backup/restore persistence. It does not add CNC-V1-05 controller
qualification, automatic machine counts, OEE calculations, APS, or advanced
rework routing.

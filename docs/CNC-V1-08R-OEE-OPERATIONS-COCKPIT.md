# CNC-V1-08R — Trustworthy OEE and Operations Cockpit

Status: FUNCTIONAL_PARTIAL
Architectural decision: one canonical, on-demand calculation core; no persisted OEE snapshots.

## Takeover audit

The pre-implementation audit found three independent legacy calculation paths:

- `OeeService` daily trend and downtime Pareto (replaced by canonical projections);
- `WorkOrdersService.oee()`;
- `ShiftReportService` (replaced by canonical plant-calendar projections);
- `DigitalTwinService.metricsByMachine()`.

They are not trustworthy OEE authorities. They treat `ProductionRun` wall-clock
duration as run time, use legacy `MachineStatusEvent(ALARM)` evidence, do not
derive planned production time from the canonical calendar, use mutable
`Part.idealCycleTimeSec`, and either clamp anomalous values or treat an
unavailable Availability factor as one. The legacy shift report additionally
uses fixed server-local 06:00–14:00, 14:00–22:00 and 22:00–06:00 windows. The
web `OeeTrendChart` also arithmetic-averages already-calculated percentages;
presentation code cannot remain a plant KPI authority.

The following facts remain canonical and will be consumed without changing
their business ownership:

- plant timezone, effective-dated calendars, exceptions and cross-midnight
  shifts: `ProductionCalendarService`;
- MES state history: immutable `ProductionExecutionEvent`;
- production quantity evidence: immutable `ProductionReport`;
- execution-era operation snapshot and WIP projection: `WorkOrderOperation`;
- structured MES/maintenance intervals: `DowntimeEvent`;
- maintenance downtime and availability: CNC-V1-07R/CMMS;
- inspection, NCR, hold, disposition and rework facts: CNC-V1-06/QMS;
- reservations and issues that establish material readiness: CNC-V1-02;
- due dates and planning facts: CNC-V1-03R;
- controller observations: CNC-V1-05 enrichment only.

## Canonical calculation boundary

Every calculation is scoped by tenant, plant, UTC range, optional machine,
work order, operation or shift, and a single `asOf` instant. Database-backed
multi-read calculations run in a PostgreSQL `REPEATABLE READ` transaction.
Every open interval is capped at the same `asOf`; source rows are not mutated.
The trend and loss-Pareto endpoints require the same explicit plant, range and
cutoff context. The dashboard does not aggregate an unspecified tenant-wide
plant set: an operator selects the plant before it requests either projection.

The calculation result contains component values, input quantities, normalized
time buckets, source facts/provenance, issues and a data-quality status. `0` is
a valid measured value and is never used to represent an unavailable KPI.

## Time model

- `CALENDAR_TIME`: requested range intersected with the single calculation
  cutoff.
- `SCHEDULED_PRODUCTION_TIME`: union of explicit work-order planning windows
  assigned to the machine, intersected with effective plant shifts.
- `SCHEDULED_NON_PRODUCTION`: non-working calendar time, configured shift
  breaks and explicit planned shutdown exclusions.
- `PLANNED_DOWNTIME`: planned maintenance or other planned loss inside a
  scheduled production window; excluded from Planned Production Time.
- `PLANNED_PRODUCTION_TIME`: scheduled production time after scheduled
  non-production and planned-downtime exclusions.
- `RUN_TIME`: portions of Planned Production Time attributed to productive MES
  RUNNING/REWORK execution after mutually-exclusive loss normalization.
- loss buckets: unplanned breakdown, quality hold, material shortage,
  setup/changeover, operator/resource pause, other planned/unplanned loss and
  measurable idle/stopped time.

A shift alone does not establish planned production. A run alone does not
retroactively create a full-shift plan. Missing defensible planning evidence
produces `INSUFFICIENT_DATA`/`PARTIAL`, never Availability 100%.

Full-day shutdowns use effective-dated calendar exceptions. Recurring breaks
belong to `ProductionShift`, not an OEE-only calendar. Partial shutdown or
other planned exclusions use structured planned downtime facts. Intervals are
unioned before subtraction.

## Interval precedence

The canonical normalizer splits the calculation window at every source
boundary, then assigns every atomic segment to exactly one time bucket.
Precedence is:

1. scheduled/non-production exclusion;
2. planned maintenance;
3. unplanned breakdown;
4. quality hold;
5. material shortage;
6. setup/changeover;
7. operator/resource pause;
8. other loss;
9. productive running.

All overlapping source facts remain visible in provenance, but a segment's
duration contributes to one bucket only. Thus a 30-minute breakdown overlapping
a 30-minute MES hold produces 30 minutes of normalized loss.

## Quantity and standard semantics

`ProductionReport` is the quantity authority:

- `totalCount = goodCount + scrapCount` for first-pass production reports;
- `goodCount` and `scrapCount` are immutable report sums;
- rework processing is exposed separately and is not added to first-pass total;
- quality holds/rejections/dispositions are drill-down facts and do not silently
  rewrite production reports;
- contradictory/incomplete quality evidence makes Quality unavailable or
  partial instead of being double-counted.

Per-unit `idealCycleTimeSec` belongs to the released routing operation. It is
copied to `WorkOrderOperation` at engineering release and is immutable for that
execution. Mutable `Part.idealCycleTimeSec` is legacy compatibility data only.
Legacy operations without an immutable operation standard report
`MISSING_STANDARD`.

## Formulas and anomalies

```text
Availability = Run Time / Planned Production Time
Performance  = (Total Count × Ideal Cycle Time) / Run Time
Quality      = Good Count / Total Count
OEE          = Availability × Performance × Quality
```

Division by zero or missing evidence yields an unavailable component plus
issues. Values above 100%, especially Performance, remain visible and add an
anomaly issue; they are not silently clamped.

Plant aggregation unions time per machine and aggregates component numerators
and denominators. It never arithmetic-averages machine OEE percentages.

## Data quality

The result supports `COMPLETE`, `PARTIAL`, `INSUFFICIENT_DATA`,
`MISSING_STANDARD` and `STALE_SOURCE`. Multiple structured issues can coexist.
Controller staleness affects controller enrichment, not trusted MES/manual OEE
when controller evidence is not required.

## Commercial and authority boundaries

OEE is a read-only consumer. It does not mutate MES lifecycle, CMMS downtime or
availability, QMS inspection/NCR/hold/rework, or MRP planning records. CMMS and
controller facts are optional. Existing ProductModule and
TenantModuleEntitlement behavior remains authoritative; Entitlements V2 is not
connected. Server endpoints use the legacy authority plus OEE action
permissions. PRODUCT-ARCH-005 is outside this epic.

## Operations cockpit delivery

`GET /oee/cockpit` requires `plantId`, `from`, `to` and `asOf`. It returns a
tenant-scoped canonical plant summary, per-active-work-order machine
projection, source/timeline provenance, and read-only maintenance, quality-hold
and MRP-exception blockers. The React `/oee-cockpit` page sends that explicit
scope, renders unavailable KPIs as unavailable (never zero), exposes the
data-quality state and refreshes its projection every 30 seconds.

Digital Twin now requires the same explicit OEE context and obtains OEE only
from `OeeCalculationService`; its energy and open-alarm fields remain
presentation facts. OEE/cockpit and the Digital Twin OEE projection require
`OEE_READ`. Downtime-loss-reason writes require
`OEE_LOSS_REASON_ADMIN`. CMMS/MRP records are read-only blocker context: an
open maintenance order or material exception does not create an OEE loss
interval without timestamped `DowntimeEvent` evidence.

## Validation contract

The dedicated real-PostgreSQL suite is
`apps/backend/test/cnc-v1-08r.e2e-spec.ts`. It must prove the A–Z release cases,
the twenty explicitly identified high-risk cases, tenant/plant isolation,
consistent snapshots, optional CMMS/controller operation and non-mutation of
CMMS/QMS/MRP facts. Actual RED/GREEN and release evidence is recorded in the
companion TDD document.

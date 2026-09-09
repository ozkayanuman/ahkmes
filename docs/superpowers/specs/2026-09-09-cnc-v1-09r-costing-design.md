# CNC-V1-09R Planned-versus-Actual Manufacturing Costing Design

## Goal

Give planners and production managers an explainable, tenant- and plant-scoped planned-versus-actual manufacturing cost for a released work order and its operations. The result uses released standard rates, immutable work-order engineering evidence and append-only execution facts. Missing inputs stay visible as partial data; they never become a zero or a complete cost by implication.

## Scope and non-goals

V1 includes released material, machine and labour standard-rate cards; an immutable work-order baseline; planned, actual, variance and good-unit cost; explicit scrap/rework treatment; tenant-safe APIs; rate-card administration; a read-only costing workspace; PostgreSQL and restore evidence.

It excludes general-ledger postings, inventory valuation, payroll, AP/AR integration, foreign-exchange conversion, overhead allocation, tool/fixture charging and profitability claims. This is standard-cost variance analysis, not financial accounting.

## Canonical authority

| Input | Source | Use |
| --- | --- | --- |
| Released BOM and routing | `ProductionMaterialRequirement`, `WorkOrderOperation` | planned material quantity and operation minutes |
| Standard rates | released `CostRateCard`/`CostRateLine` | immutable planned and actual rate application |
| Actual material | `MaterialConsumption` where `type=CONSUMED` | work-order actual material cost |
| Actual time | `ProductionRun` | machine and labour actual cost |
| Good/scrap output | immutable `ProductionReport` | good-unit denominator and scrap visibility |
| Rework identity | `ReworkRequirement` linked to a run | separately classified actual cost |

`Material.standardCost`, `Machine.hourlyRate` and `User.hourlyRate` remain editable master data. They are not a costing authority after this epic: administrators copy intended values into a released rate card, and cost reads never re-read mutable masters.

## Data model

`CostRateCard` is tenant- and plant-scoped with `revision`, `currency`, `effectiveFrom`, `status` (`DRAFT`, `RELEASED`, `SUPERSEDED`), release evidence and audit timestamps. It is editable only in `DRAFT`; release is one-way. Only one released card can be effective for a plant/date.

`CostRateLine` belongs to a card and contains `kind` (`MATERIAL`, `MACHINE`, `LABOR`), `targetId` and decimal `rate`. Material and machine lines target the applicable records; labour uses target `DEFAULT` as the plant direct-labour standard. The draft service verifies target tenant ownership. A card carries one currency; V1 never converts currencies.

`WorkOrderCostBaseline` has one row per work order and pins the released card revision, currency, capture time/user, planned material/machine/labour/total amounts and data-quality state. `WorkOrderCostBaselineLine` records planned source item/machine, operation where applicable, quantity or minutes, applied rate, amount and JSON provenance. A missing rate is null plus a coded issue, never zero. Composite tenant foreign keys and unique constraints prevent cross-tenant links.

Baseline capture occurs in the existing engineering-release transaction after material requirements and operation snapshots are created. Historical orders are not backfilled; they remain readable with `MISSING_RELEASED_COST_BASELINE`.

## Calculation policy

The read service loads baseline, rates and source facts in one PostgreSQL `REPEATABLE READ` transaction.

Planned material is each requirement quantity times its pinned material rate. Planned machine is each immutable `standardMinutes / 60` times its assigned-machine rate. Planned labour is the same immutable standard minutes times the pinned plant default labour rate. Missing standard minutes, machine assignment or rate makes the relevant component partial.

Actual material is each consumed material quantity times the matching pinned rate. Actual machine and labour use each `ProductionRun` interval up to explicit `asOf`; open runs are capped at `asOf`. An unpriced consumed part/subassembly or an unpriced actual machine makes its component partial. Good units are the immutable first-pass `ProductionReport.goodCount` sum. Zero/missing good units make unit cost unavailable, never zero or infinity.

Actual minus planned is variance. Percentage variance exists only when its denominator is non-zero and available. Scrap/rework are not additional postings: their extra consumption and execution time already occur in actual cost. Rework-linked run cost and scrap quantity are exposed separately, but every source fact contributes to actual total once.

## API, authorization and UI

`GET /work-orders/:id/cost` stays additive-compatible: existing flat actual fields remain while `currency`, `dataQuality`, issues, cutoff, `planned`, `actual`, `variance`, `unitCost`, operation rows and baseline provenance are added.

New endpoints are draft-card `GET/POST/PATCH /costing/rate-cards`, one-way `POST /costing/rate-cards/:id/release`, and explicit-plant/date `GET /costing/work-orders`. `COSTING_READ` protects reads; `COSTING_RATE_ADMIN` protects writes/releases. Both use the existing legacy action-permission authority; Entitlements V2 stays shadow-only.

The work-order detail card becomes expandable for planned/actual/variance and operation drill-down. A new `/costing` page offers explicit plant/date filtering, work-order summaries and authorized rate-card administration. Unavailable values render as unavailable, not `0.00`.

## Invariants

- No effective rate card creates a partial baseline but does not block MES execution.
- Released cards and captured baselines cannot be edited or deleted.
- Release, baseline capture and audit evidence occur in one transaction.
- No lookup crosses tenant, plant, currency or effective-date boundaries.
- Cost calculation is read-only; it never mutates execution, quality, inventory or rates.

## Verification and delivery gate

Unit tests cover lifecycle, tenant/plant isolation, baseline immutability, arithmetic, cutoff, zero good units, missing data, scrap/rework no-double-counting and legacy response compatibility. PostgreSQL E2E proves baseline capture, later master/draft changes cannot alter it, authorization/tenant rejection and an explainable production-quality-rework flow. The operations backup/restore rehearsal includes this fixture and recalculates costing after restore.

`VERIFIED_DONE` requires focused backend/web tests, typechecks, fresh isolated PostgreSQL E2E, expanded operations matrix, backup/restore recalculation, migration status and updated commercial readiness documentation.

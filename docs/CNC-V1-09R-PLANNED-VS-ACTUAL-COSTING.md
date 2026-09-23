# CNC-V1-09R — Planned-versus-actual costing

## Delivered scope

- A tenant/plant-scoped rate card has a monotonic revision and `DRAFT`, `RELEASED`, or `SUPERSEDED` status.
- Only released cards can be selected. At work-order engineering release, the applicable card and every planned-cost input are copied into one immutable baseline.
- The work-order cost projection exposes planned, actual and variance material, machine and labor totals; operation breakdown; output counts; per-good-unit cost; and data-quality/missing-input reasons.
- Actual material use comes from canonical material-consumption records. Machine and labor use comes from completed production-run durations. Master material and machine costs do not alter a frozen baseline.
- Rate-card management requires its own action grant; cost projections require the read grant and retain normal tenant scope.

## Deliberate boundary

The V1 policy excludes overhead, tool/fixture, subcontract, payroll/GL integration and broad scrap/rework allocation. These inputs are never silently assumed. Missing rates or no good output are represented in the projection's data-quality/issues fields.

## Verification

- Backend typecheck passes.
- The PostgreSQL API E2E proves release, frozen rates, planned total 162, actual total 315, variance 153, unit cost 157.5, master-rate changes after release, and cross-tenant rejection.
- The isolated operations rehearsal applies all migrations, runs the nine-suite V1 matrix, makes a compressed backup, restores into a second PostgreSQL instance, checks migration status and recalculates the restored rate-card baseline.

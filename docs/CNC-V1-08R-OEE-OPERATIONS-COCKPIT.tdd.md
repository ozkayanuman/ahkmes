# CNC-V1-08R OEE and Operations Cockpit — TDD evidence

Status: RED/GREEN implementation in progress.

## Source plan

`docs/superpowers/plans/2026-08-26-cnc-v1-08r-oee-operations-cockpit.md`

## User journeys

- A supervisor can distinguish running, stopped, maintenance-unavailable and
  evidence-insufficient machines at a stated cutoff.
- A manager can inspect Availability, Performance, Quality and OEE and drill to
  every contributing interval, quantity and standard.
- A planner can see factual late and shortage-blocked work without OEE mutating
  planning facts.
- A historical reviewer receives the execution-era routing standard and plant
  calendar semantics rather than today's mutable Part master.
- A tenant sees only its plants and machines; OEE remains usable without CMMS
  and controller products.

## Evidence log

Evidence will be appended after each executed RED/GREEN cycle. No commit is
created because the user explicitly prohibited commits.

| Task | Command | RED evidence | GREEN evidence | Status |
|---|---|---|---|---|
| Interval normalization | `pnpm --filter @ahkmes/backend run test -- interval-normalizer.spec.ts --runInBand` | Initial compile TS2307: canonical modules did not exist; expected compile-time RED | 6/6 PASS; overlap, pause, setup, cutoff, precedence and conservation | GREEN |
| Engineering/calendar standard (unit) | `pnpm --filter @ahkmes/backend run test -- production-calendar.service.spec.ts --runInBand` | NOT_RECONSTRUCTED (pre-existing implementation and test surface) | 7/7 PASS; cross-midnight shifts, calendar binding, weekend/holiday offsets, recurring breaks and Berlin spring-forward DST coverage | GREEN |
| Engineering/calendar standard (PostgreSQL E2E) | `$env:E2E_TEST_ARGS = 'engineering-master-data.e2e-spec.ts'; docker compose --project-name ahkmes-oee-proof --file docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e` | NOT_RECONSTRUCTED (pre-existing implementation and test surface) | 1/1 PASS; draft engineering is rejected and released revision A keeps its immutable ideal-cycle snapshot while revision B serves new work | GREEN |
| Canonical calculation | Focused unit and `cnc-v1-08r.e2e-spec.ts` | Database-backed fact loader and real-PostgreSQL E2E were pending | First fact-loader slice uses one `REPEATABLE READ` transaction for assigned work-order plans, canonical calendar windows, immutable operations, execution events, production reports, structured `DowntimeEvent` and `QualityHold` lifecycle evidence. PostgreSQL E2E proves `asOf` report exclusion, scheduled-break numerator/denominator alignment, classified downtime/quality-hold subtraction and a concurrently committed, cutoff-eligible report remaining outside the established fact snapshot; CMMS/MRP sources remain pending | PARTIAL |
| Planned production time | `pnpm --filter @ahkmes/backend run test -- planned-time.spec.ts --runInBand --coverage` | `TS2307`: `./planned-time` module did not exist; expected compile-time RED | 6/6 PASS; explicit schedule/shift intersection, plan union, overlapping break/maintenance precedence, `asOf` cutoff and no-denominator cases. Targeted coverage: 100% statements / 88.88% branches / 100% functions / 100% lines. | GREEN |
| Formula and plant aggregation | `pnpm --filter @ahkmes/backend run test -- oee-calculation.service.spec.ts --runInBand --silent` | TS2307: canonical calculation module did not exist; expected compile-time RED | 8/8 PASS; formula, unavailable-vs-zero, >100 anomaly, rework separation and weighted plant aggregation | GREEN |
| Canonical calculation composition and first fact loader | `pnpm --filter @ahkmes/backend run test -- oee-calculation.service.spec.ts --runInBand` | TS2305: `calculateOeeFromCanonicalSources` and then `OeeCalculationService` exports did not exist; a planned break initially exposed a pay/payda mismatch (Availability 106.67%) | 10/10 PASS; immutable plan, execution events and report/operation standards compose to planned time, normalized timeline and explainable OEE without `ProductionRun` wall-clock time. The service loads first-slice facts in a `REPEATABLE READ` transaction, and scheduled breaks override running time in both numerator and denominator. | GREEN |
| Canonical calculation PostgreSQL E2E | `$env:E2E_TEST_ARGS = 'cnc-v1-08r.e2e-spec.ts'; docker compose --project-name ahkmes-oee-loss-proof --file docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e` | Test setup initially used invalid Prisma nested-relation fields; corrected before business behavior executed | 2/2 PASS; one explicit cutoff excludes a post-cutoff report, immutable standard and recurring break produce explainable OEE, and the loss mapping round-trips through PostgreSQL | GREEN |
| Canonical snapshot concurrency PostgreSQL E2E | `$env:E2E_TEST_ARGS = 'cnc-v1-08r.e2e-spec.ts'; docker compose --project-name ahkmes-oee-snapshot-proof --file docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e` | Test imports the deliberately absent `OeeSnapshotSynchronization` seam; the backend typecheck does not compile E2E test files, and the missing file was verified directly before implementation | 3/3 PASS (178.665s); after the first fact query established `REPEATABLE READ`, the test committed an otherwise eligible 600-count report from a second connection. The calculation remained at the original 100-count snapshot. | GREEN |
| Structured downtime source | `pnpm --filter @ahkmes/backend run test -- downtime-intervals.spec.ts oee-calculation.service.spec.ts --runInBand`; `$env:E2E_TEST_ARGS = 'cnc-v1-08r.e2e-spec.ts'; docker compose --project-name ahkmes-oee-downtime-proof --file docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e` | Compile RED: `./downtime-intervals` did not exist and the canonical loader did not query `DowntimeEvent`. | Unit: 2 suites / 12 tests PASS. PostgreSQL: 4/4 PASS (71.319s); a 30-minute classified `UNPLANNED_BREAKDOWN` is read in the canonical snapshot, overrides RUNNING, preserves reason provenance and changes Availability/Performance from their prior run-time denominator. | GREEN |
| Structured Quality Hold source | `pnpm --filter @ahkmes/backend exec jest quality-hold-intervals.spec.ts downtime-intervals.spec.ts oee-calculation.service.spec.ts --runInBand --verbose`; `$env:E2E_TEST_ARGS = 'cnc-v1-08r.e2e-spec.ts'; docker compose --project-name ahkmes-oee-quality-proof --file docker-compose.e2e.yml up -d --build` | Compile RED: `./quality-hold-intervals` did not exist. | Unit: 3 suites / 14 tests PASS. PostgreSQL: 4/4 PASS (81.234s); a released 15-minute work-order `QualityHold` is read in the same repeatable-read snapshot, preserves hold/lot/reason/source provenance, overrides RUNNING and changes Availability/Performance without reducing planned production time. | GREEN |
| MES execution interval mapping | `pnpm --filter @ahkmes/backend run test -- execution-intervals.spec.ts --runInBand --silent` | TS2307: execution interval mapper did not exist; expected compile-time RED | 5/5 PASS; pause/resume, hold reasons, setup, open states and rework-time mapping | GREEN |
| Loss classification and provenance | `pnpm --filter @ahkmes/backend run test -- downtime.service.spec.ts --runInBand` | TS2305: `resolveProductionLossCategory` export did not exist | 5/5 PASS; an explicit nullable OEE loss mapping is preserved, while legacy `PLANNED`/`UNPLANNED` records deterministically fall back to `OTHER_PLANNED`/`OTHER_UNPLANNED`. Migration is additive and performs no backfill. | GREEN |
| Legacy OEE adapters (Task 5a) | `pnpm --filter @ahkmes/backend run test -- oee.service.spec.ts oee.controller.spec.ts work-orders.oee.spec.ts --runInBand`; `$env:E2E_TEST_ARGS = 'cnc-v1-08r.e2e-spec.ts'; docker compose --project-name ahkmes-oee-adapter-proof --file docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e` | Initial test fixture omitted required `AuthUser` fields, so it was corrected before valid execution; no RED claim is made for this adapter-only slice. | Unit: 3 suites / 4 tests PASS. PostgreSQL: 4/4 PASS (58.581s); explicit tenant/plant/range/asOf is required by `GET /oee`, and the general and work-order adapters return identical canonical metrics for the same scope/cutoff while preserving legacy aliases. | PARTIAL |
| Cockpit UI | Focused Vitest | Pending | Pending | NOT_RUN |
| Release matrix | Full commands from epic | Pending | Pending | NOT_RUN |

## Coverage and known gaps

Targeted coverage was measured for planned production time: 100% statements,
88.88% branches, 100% functions and 100% lines. The canonical calculation
focused suite (10/10), OEE/calendar/downtime/quality-hold interval-regression suite (41/41),
Task 5a adapter suite (4/4) and backend typecheck also pass.
No full-epic coverage, CMMS/MRP source integration, authorization, cockpit
or release behavior is claimed until its corresponding GREEN evidence is recorded.

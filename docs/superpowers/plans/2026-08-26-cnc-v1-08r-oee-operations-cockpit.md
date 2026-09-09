# CNC-V1-08R OEE and Operations Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `ecc:tdd-workflow` and inline
> execution. The accepted dirty working tree must not be isolated, rewritten,
> stashed or committed. Every task records RED/GREEN evidence instead of commits.

**Goal:** Deliver one explainable, tenant/plant-scoped OEE calculation authority
and operations/management cockpit using canonical MES, calendar, CMMS, QMS and
planning facts.

**Architecture:** A pure interval normalizer feeds one on-demand
`OeeCalculationService`. Database reads occur through a single PostgreSQL
`REPEATABLE READ` snapshot and a single `asOf`. Existing OEE, work-order OEE and
shift-report contracts become adapters; cockpit APIs and UI consume the same
canonical result.

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, Zod, React, TanStack Query,
Jest, Vitest.

**Spec:** `docs/CNC-V1-08R-OEE-OPERATIONS-COCKPIT.md`

## Global Constraints

- Do not commit, push, reset, revert, clean, stash, checkout or discard changes.
- Do not persist OEE/shift aggregate snapshots.
- ProductModule/TenantModuleEntitlement remains authoritative; Entitlements V2
  remains non-authoritative.
- CMMS, QMS, MRP and controller facts are read-only optional inputs.
- No calculation path may use server-local business time or independent `now`.
- Every production edit follows an executed RED test.

---

### Task 1: Pure canonical interval model

**Files:**
- Create: `apps/backend/src/oee/oee.types.ts`
- Create: `apps/backend/src/oee/interval-normalizer.ts`
- Create: `apps/backend/src/oee/interval-normalizer.spec.ts`
- Create: `docs/CNC-V1-08R-OEE-OPERATIONS-COCKPIT.tdd.md`

**Interfaces:**
- Produces `normalizeOeeTimeline(input: NormalizeTimelineInput): NormalizedTimeline`.
- Every returned segment contains `start`, `end`, `bucket`, `durationSeconds`
  and every overlapping source fact ID.

- [ ] Write unit tests for clipping, union, open intervals, precedence and the
  30-minute breakdown-plus-hold case.
- [ ] Run `pnpm --filter @ahkmes/backend test -- interval-normalizer.spec.ts --runInBand`
  and record the expected missing-module RED.
- [ ] Implement boundary splitting, deterministic precedence and duration
  conservation without database access.
- [ ] Rerun the focused test and record GREEN.

### Task 2: Engineering standard and canonical calendar exclusions

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/20260826120000_cnc_v1_08r_oee_time_model/migration.sql`
- Modify: `packages/shared-types/src/schemas.ts`
- Modify: `packages/shared-types/src/enums.ts`
- Modify: `apps/backend/src/recipes/recipes.service.ts`
- Modify: `apps/backend/src/work-orders/work-orders.service.ts`
- Modify: `apps/backend/src/production-calendar/production-calendar.service.ts`
- Modify: `apps/backend/src/production-calendar/production-calendar.service.spec.ts`
- Modify: `apps/backend/test/engineering-master-data.e2e-spec.ts`

**Interfaces:**
- `RecipeStep.idealCycleTimeSec` is the released per-unit standard.
- `WorkOrderOperation.idealCycleTimeSec` is its immutable execution snapshot.
- `ProductionShiftBreak` is a tenant/plant/shift-scoped recurring break.
- `ProductionCalendarService.windowsForRange(..., client)` returns effective
  UTC shift and break intervals using the plant timezone.

- [ ] Add RED tests for invalid break placement, cross-midnight breaks, DST,
  and revision A/B immutable cycle standards.
- [ ] Execute focused unit/E2E RED targets.
- [ ] Add the smallest compatible schema/migration and Zod inputs; retain
  `Part.idealCycleTimeSec` without using it as historical authority.
- [ ] Copy routing cycle standards during engineering release and include them
  in the engineering snapshot.
- [ ] Extend canonical calendar resolution to expose breaks and historical
  effective windows through an injected Prisma transaction client.
- [ ] Run Prisma validate/generate and focused GREEN tests.

### Task 3: Canonical calculation core

**Files:**
- Create: `apps/backend/src/oee/oee-calculation.service.ts`
- Create: `apps/backend/src/oee/oee-calculation.service.spec.ts`
- Create: `apps/backend/src/oee/oee-snapshot-synchronization.ts`
- Modify: `apps/backend/src/oee/oee.module.ts`
- Create: `apps/backend/test/cnc-v1-08r.e2e-spec.ts`

**Interfaces:**
- `calculate(request: OeeCalculationRequest): Promise<OeeCalculationResult>`.
- `request` carries tenant, plant, range, optional scope and one explicit
  `asOf`; the service opens one `RepeatableRead` transaction.
- `result` exposes formulas, numerators/denominators, normalized timeline,
  sources, data-quality issues and cutoff metadata.

- [ ] Write deterministic PostgreSQL RED cases A–P and high-risk cases 1–14.
- [ ] Add unit RED cases for missing plan, missing standard, zero denominator,
  Performance above 100%, quantity/rework semantics and aggregate math.
- [ ] Implement one batched fact loader for calendar/WO plan, execution events,
  production reports, downtime, maintenance, quality and material evidence.
- [ ] Derive scheduled production as the union of explicit assigned WO plan
  windows intersected with canonical shifts; never create a denominator from a
  shift or run alone.
- [ ] Feed source intervals through `normalizeOeeTimeline`; derive run/loss time
  from the normalized result rather than `ProductionRun` wall time.
- [ ] Calculate components without clamping and accumulate structured quality
  issues.
- [ ] Prove all open intervals use the transaction's single `asOf` and that a
  concurrent source update cannot create a hybrid calculation.
- [ ] Run unit and real-PostgreSQL GREEN targets.

### Task 4: Loss classification and provenance

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Modify: `apps/backend/prisma/migrations/20260826120000_cnc_v1_08r_oee_time_model/migration.sql`
- Modify: `packages/shared-types/src/enums.ts`
- Modify: `packages/shared-types/src/schemas.ts`
- Modify: `apps/backend/src/downtime/downtime.service.ts`
- Modify: `apps/backend/src/downtime/downtime.service.spec.ts`

**Interfaces:**
- Retain `DowntimeReason.category` PLANNED/UNPLANNED compatibility.
- Add optional lightweight `ProductionLossCategory` mapping used by OEE.

- [ ] Add RED tests that reason mapping preserves existing classification and
  provenance while normalized time remains mutually exclusive.
- [ ] Implement the minimal enum/field/API support and deterministic fallback
  to other planned/unplanned categories.
- [ ] Verify maintenance records remain CMMS-owned and OEE performs no writes.

### Task 5: Replace all legacy calculation authorities

**Files:**
- Modify: `apps/backend/src/oee/oee.service.ts`
- Modify: `apps/backend/src/oee/oee.controller.ts`
- Modify: `apps/backend/src/work-orders/work-orders.service.ts`
- Modify: `apps/backend/src/work-orders/work-orders.module.ts`
- Modify: `apps/backend/src/shift-report/shift-report.service.ts`
- Modify: `apps/backend/src/shift-report/shift-report.controller.ts`
- Modify: `apps/backend/src/shift-report/shift-report.module.ts`
- Modify: `apps/backend/src/dashboard/dashboard.service.ts`
- Modify: `apps/backend/src/digital-twin/digital-twin.service.ts`
- Modify: `apps/backend/src/digital-twin/digital-twin.module.ts`
- Modify: `apps/backend/src/digital-twin/digital-twin.service.spec.ts`
- Modify: existing OEE/shift-report E2E tests

**Interfaces:**
- Public compatibility methods delegate to `OeeCalculationService`.
- Trend and Pareto are projections of canonical daily results/timeline sources.

- [ ] Add RED equality tests for work-order OEE and OEE endpoints at the same
  scope/cutoff and tests rejecting missing plant/time context.
- [ ] Remove legacy formulas, `MachineStatusEvent` OEE authority, mutable Part
  fallback and server-local shift definitions.
- [ ] Replace the duplicated Digital Twin machine calculation with canonical
  machine results while retaining energy/alarm presentation facts.
- [ ] Preserve reasonable response aliases while including canonical metadata
  and data-quality fields.
- [ ] Search the repository for formula fragments and prove no hidden authority
  remains.

### Task 6: Server authorization and commercial isolation

**Files:**
- Modify: `apps/backend/src/action-permissions/action-permissions.service.ts`
- Modify: `apps/backend/prisma/seed.ts`
- Modify: `apps/backend/src/oee/oee.controller.ts`
- Modify: relevant controller/module tests

**Interfaces:**
- Add `OEE_READ` and `OEE_LOSS_REASON_ADMIN` action permissions.
- OEE reads remain additionally subject to existing legacy page/product
  authority; Entitlements V2 is not queried.

- [ ] Add controller/E2E RED cases for denied reads and loss-reason admin.
- [ ] Apply `ActionPermissionsGuard` and existing page/product guards.
- [ ] Prove MES execution endpoints remain usable when OEE permission is absent.

### Task 7: Canonical cockpit read side

**Files:**
- Create: `apps/backend/src/oee/oee-cockpit.service.ts`
- Modify: `apps/backend/src/oee/oee.controller.ts`
- Modify: `apps/backend/src/oee/oee.module.ts`
- Extend: `apps/backend/test/cnc-v1-08r.e2e-spec.ts`

**Interfaces:**
- Plant summary, shift summary, machine detail and current status all consume
  `OeeCalculationService` results and batched canonical blocker/status facts.
- Responses carry `asOf`, `lastRefreshedAt`, drill-down IDs and source freshness.

- [ ] Add RED cases Q–Z for current state, shift/plant summaries, maintenance,
  quality, shortage, late/WIP visibility and tenant/plant isolation.
- [ ] Implement batched current-machine/read-model queries without N+1.
- [ ] Aggregate component facts rather than percentages; add an explicit test
  where arithmetic mean differs from the correct plant result.
- [ ] Prove optional CMMS/controller facts can be absent.

### Task 8: Operations and management cockpit UI

**Files:**
- Create: `apps/web/src/pages/oee-cockpit.tsx`
- Create: `apps/web/src/pages/oee-cockpit.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/lib/nav-groups.ts`
- Modify: `apps/web/src/pages/dashboard.tsx`
- Modify: `apps/web/src/pages/shift-report.tsx`
- Modify: `apps/web/src/pages/digital-twin.tsx`
- Modify: `apps/web/src/components/oee-charts.tsx`
- Modify: `apps/web/src/components/global-status-bar.tsx`

**Interfaces:**
- All KPI cards render canonical values, quality state and cutoff.
- Machine, shift, plant and loss drill-downs use IDs/source links returned by
  the backend; no UI formula is permitted.

- [ ] Write Vitest RED journeys for unavailable-vs-zero, stale telemetry,
  current blockers, abnormal Performance and drill-down provenance.
- [ ] Implement a plant/time/shift selector, management summary, machine table,
  detail/loss panels and honest polling refresh metadata.
- [ ] Convert legacy dashboard/shift widgets to canonical API responses.
- [ ] Remove display-side arithmetic averaging; charts render aggregate values
  supplied by the canonical backend response.
- [ ] Run focused web GREEN tests and accessibility-oriented semantic queries.

### Task 9: Concurrency, performance and regression evidence

**Files:**
- Extend: `apps/backend/test/cnc-v1-08r.e2e-spec.ts`
- Update: `docs/CNC-V1-08R-OEE-OPERATIONS-COCKPIT.tdd.md`

- [ ] Add synchronization barriers proving quantity, downtime, quality,
  maintenance and calendar changes after snapshot affect only later runs.
- [ ] Benchmark 50 machines with representative shifts, execution and loss
  events; record measured runtime without inventing an SLA.
- [ ] Run Prisma validate/generate, workspace typecheck, backend units, web
  tests, connector tests, production build and `git diff --check`.
- [ ] Run real PostgreSQL CNC-V1-00/01/02/03R/04/06/07R/08R suites.
- [ ] Because schema changes, run the established backup → isolated restore →
  migration status → representative restored OEE verification sequence.
- [ ] Classify every command PASS, FAIL, PRE_EXISTING_FAILURE,
  BLOCKED_ENVIRONMENT or NOT_RUN with actual output evidence.

### Task 10: Documentation, review and graph refresh

**Files:**
- Update: `docs/CNC-V1-08R-OEE-OPERATIONS-COCKPIT.md`
- Update: `docs/CNC-V1-08R-OEE-OPERATIONS-COCKPIT.tdd.md`
- Update: `docs/CNC_MANUFACTURING_V1_COMMERCIAL_GAP_ANALYSIS.md`
- Update: `PLAN.md`
- Update generated graph under `graphify-out/`

- [ ] Replace implementation-in-progress language only with behavior actually
  proven by tests.
- [ ] Run ECC code/security review for database, authorization and input paths;
  resolve all critical/high findings.
- [ ] Run `graphify update .`, scoped Graphify validation queries and save the
  useful result to project memory.
- [ ] Produce the required 47-point final report and set VERIFIED_DONE only if
  every release gate is proven; otherwise use FUNCTIONAL_PARTIAL.

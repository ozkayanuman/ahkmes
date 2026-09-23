# CNC-V1-07R CMMS — TDD evidence

## Intended behavior

The existing `Machine`, `MaintenanceOrder`, `DowntimeEvent`, `User`, inventory ledger and CNC-V1-04 production lifecycle remain canonical. CNC-V1-07R extends them with a plant-scoped maintenance business state, requests, breakdowns, time-based PM, controlled maintenance work, labor, checklist, spare issue/return and explicit return to service. Controller observations never own that business state.

## Test-first contract

The real PostgreSQL acceptance suite is `apps/backend/test/cnc-v1-07r.e2e-spec.ts`. Its A–Z cases cover the release-gate sequence in the epic, including concurrency, restart durability, rollback, CMMS-only and MES-only use. Focused backend and web tests cover transition logic, server authorization, HMI presentation and workbench actions.

## RED evidence

Before production implementation the A–Z suite does not compile because the repository has no CMMS request/breakdown/plan/task/labor/spare/return-to-service persistence or APIs, and `Machine` has no maintenance projection. This is the expected RED state; the exact command/output is recorded in the implementation report.

## GREEN evidence

### 2026-09-21 — shared CMMS/production spare allocation extension

`MaintenanceSpareReservation` adds a tenant-scoped, bin/lot-specific hold for a
maintenance spare line. It increments `MaintenanceSpareLine.reservedQty`, is
idempotent, can be cancelled only before issue, and is consumed by a
reservation-backed maintenance issue. The generic production-material
availability projection and production reservation command both subtract active
CMMS holds, so production and CMMS share one physical allocation boundary.

The dedicated PostgreSQL case N was replaced with reservation/issue/cancellation
coverage. Local source generation and shared-types build succeeded. The live
PostgreSQL acceptance run remains pending on this workstation: no Docker service
was running and the existing Compose environment is intentionally incomplete for
required deployment/provisioning variables. This is not release-pass evidence.

Run `powershell -ExecutionPolicy Bypass -File scripts/check-local-e2e-env.ps1`
before attempting the PostgreSQL suite. It reports missing key names and Docker
availability without printing environment or secret values.

Runtime-PM generation is separately provenance-safe: the nullable
`MaintenanceOrder.runtimeTriggerHours` and its tenant/machine unique key allow
one draft preventive order per threshold. It is generated only through the
authorized check over recorded completed-run time; its completion advances the
machine PM baseline. A controller meter is not inferred from this calculation.

The read-only reliability projection groups resolved breakdowns by machine.
It computes MTTR only from completed corrective `actualStart → actualFinish`
evidence, and reports failure spacing as calendar time with a separate field and
sample count rather than overstating it as runtime MTBF.

The A–Z suite went RED → GREEN through six corrections, found and fixed by re-running the real suite against Docker PostgreSQL until every case passed from a clean database:

1. **PostgreSQL enum migration ordering (55P04)** — `20260817160000_cnc_v1_07r_cmms_release_closure` added new enum values (`DowntimeEventSource.MAINTENANCE`, `InventoryMovementType.MAINTENANCE_ISSUE/RETURN`, `MaintenanceOrderStatus.DRAFT/RELEASED/ON_HOLD`) and used them (e.g. `ALTER COLUMN "status" SET DEFAULT 'DRAFT'`) in the same transaction. PostgreSQL forbids using a new enum value before it is committed. Fix: split the `ADD VALUE` statements into a new, earlier migration, `20260817150000_cnc_v1_07r_enum_values`. Verified on a fully clean database (76 migrations, "All migrations have been successfully applied").
2. **PM plan schema/service compatibility** — `createMaintenancePlanSchema` only accepted `frequency`/`frequencyDays`; the accepted contract (and the A–Z suite) also needs `intervalDays`. Fixed the Zod schema and `MaintenanceOrdersService.createPlan` to accept all three, and added the `active`/`isActive` field.
3. **Maintenance history completeness** — `MaintenanceOrdersService.history()` omitted `labor` and `spares`, so `GET /maintenance-orders/assets/:id` could not reconstruct a full maintenance history as required by spec item N. Both are now included.
4. **`pg_advisory_xact_lock` via `$executeRaw`, not `$queryRaw`** — `pg_advisory_xact_lock` returns `void`; Prisma's `$queryRaw` cannot deserialize a void column ("Failed to deserialize column of type 'void'"). The established codebase pattern (`parts.service.ts`) already uses `$executeRaw` for this; the three CMMS call sites (`convertBreakdown`, `createOrder`, `generateDue`) were corrected to match.
5. **Tenant-scope extension vs. composite-FK nested create** — `MaintenanceTask.maintenanceOrder` is a composite-FK relation (`[maintenanceOrderId, tenantId]`). The AHK-017 tenant-scope Prisma extension (`tenant-scope.extension.ts`) auto-stamps `tenantId` onto every nested `create`, including relations where Prisma's generated nested-create input type does not accept `tenantId` (it is inferred from the parent). This broke `generateDue()`'s nested `tasks: { create: [...] }`. Fixed by creating the `MaintenanceOrder` first and then a separate `maintenanceTask.createMany` (matching the existing `addTask()` pattern), re-querying with `ORDER_INCLUDE` so the returned order still carries its tasks.
6. **`remedyCode` was silently dropped on completion** — `complete()` persisted `dto.remedy` but never `dto.remedyCode`, so breakdown closures submitted with only a remedy code lost that data. Fixed to fall back to `remedy ?? remedyCode`.

**TEST_FIXTURE_DEFECT** (test-only, no production behavior changed):

- The `W` restart-durability case in `cnc-v1-07r.e2e-spec.ts` asserted the breakdown stayed `"OPEN"` after conversion to a maintenance work order. The documented and implemented lifecycle is `OPEN → UNDER_REPAIR → RESOLVED`; `convertBreakdown()` correctly moves the breakdown to `UNDER_REPAIR`. The assertion was corrected to `"UNDER_REPAIR"`.
- `maintenance-orders.service.spec.ts` (backend unit) and `maintenance-orders.test.tsx` (web) both predated this epic's final contract: the unit spec asserted an obsolete controller-meter PM behavior; the delivered runtime PM intentionally uses completed production-run duration rather than an unobserved controller meter. It also asserted an obsolete `PLANNED → IN_PROGRESS` transition that the lifecycle routes through `RELEASED`, and mocked an incomplete Prisma client (no `$queryRaw`/`$executeRaw`/breakdown tables). The web test queried mixed-content DOM nodes with exact-string matchers (`getByText("Koruyucuyu kilitle")` where the rendered node also contains a sequence number and a required-badge) and did not await the async `/action-permissions/me` query before its first permission-gated interaction. Both were rewritten to match the actual, documented service/component contract.

While fixing the web test, one further production defect was found and fixed: `OrderDetail` read `data.labor[].user.name`, but the backend returns `laborEntries[].technician.name` — labor entries were never rendering in production. Corrected with a backward-compatible fallback.

**Independent verification:** `maintenance-orders.service.spec.ts` (backend, 10/10), `maintenance-orders.test.tsx` (web, 3/3), the dedicated `cnc-v1-07r.e2e-spec.ts` (13/13, twice — once standalone, once inside the full regression chain), and the full CNC-V1-00/01/02/03R/04/06 regression (7 suites / 65 tests) all pass from a clean PostgreSQL database, including a backup → isolated-restore → verification cycle.

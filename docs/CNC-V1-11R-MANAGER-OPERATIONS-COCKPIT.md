# CNC-V1-11R — Manager Operations Cockpit

**Status:** `VERIFIED_DONE` (2026-09-18, operational V1 scope)

## Purpose and boundary

The Operations Cockpit is a tenant- and plant-scoped, read-only management view. It brings together the operational signals needed for a daily production review without introducing a second execution workflow:

- canonical OEE, availability, performance and quality for an explicit plant, time range and cutoff;
- live machine status and active work orders;
- current open-WIP counts, in-production and waiting-material counts, blocked-operation count, and the first 20 overdue open work orders;
- open maintenance orders, active quality holds, and unacknowledged MRP material/planning exceptions.

It is not a historical work-order-state reconstruction. OEE and quality facts use the caller's explicit `from`, `to`, and `asOf` context. WIP/late status is current state and is returned with `currentStateAt` so it cannot be presented as an as-of fact.

## Access and safety

- Route: `/oee-cockpit`; API: `GET /oee/cockpit`.
- Existing MES `shift-report` page boundary and `OEE_READ` action grant are required on both API and UI routes.
- The projection only reads data; it does not acknowledge MRP exceptions, alter work orders, release quality holds, or execute maintenance actions.
- Every source query includes the authenticated tenant and requested plant. The plant read itself is tenant scoped.
- Cost totals and variance are intentionally not included. They stay behind the existing `COSTING_READ` work-order/costing authority.

## Operator use

1. Select the plant and production date.
2. Check OEE data quality before acting on metric values.
3. Review overdue/blocked WIP, then material, quality and maintenance blockers.
4. Navigate to the owning workflow for any action; do not treat the cockpit as an approval or execution screen.

## Verification

- `apps/backend/src/oee/oee-cockpit.service.spec.ts` verifies the tenant/plant WIP query, overdue/blocked summaries, numeric conversion and explicit current-state marker.
- `apps/backend/src/oee/oee.controller.spec.ts` verifies the existing page/action boundary and explicit OEE context delegation.
- 2026-09-18: backend OEE unit tests and backend/web typechecks passed.


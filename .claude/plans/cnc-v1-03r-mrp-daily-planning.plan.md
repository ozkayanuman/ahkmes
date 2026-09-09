# CNC-V1-03R — MRP Daily Planning, Exception Control & Proposal Conversion

## Capability

A plant planner can execute a deterministic full MRP run for a bounded daily
horizon, inspect dated demand/supply and projected balances, understand each
recommendation through pegging and a stored calculation, firm it, and safely
convert it to the canonical manufacturing or procurement boundary.

## Verified pre-implementation trace

### Canonical implementation to extend

`apps/backend/src/mrp/mrp.service.ts` is the sole MRP calculation entry point.
It currently explodes released `BomHeader` records recursively with low-level
ordering, nets legacy `Material.stockQty` / `PartStock`, active material
reservations, open PO quantities, and draft/pending legacy proposals. It must
be evolved in place; a second planning engine is prohibited.

### Present sources

| Area | Present behavior | CNC-V1-03R gap |
| --- | --- | --- |
| Demand | `PLANNED` work orders only; released BOMs; `Material.minStock` is added to gross material demand. | No dated element model, sales/independent demand, source-level pegging, or horizon. |
| Supply | Legacy aggregate material/part stock; open `ORDERED`/`IN_TRANSIT` PO residual quantity; draft/pending proposals. | No expected dates, firm supply, open WO remaining-output supply, plant scope, or quality-held exclusion. |
| Engineering | Released BOM is used and BomService rejects cycles. `ProductionDefinition`/released routing exists. | MRP does not choose plant-released production definitions for conversion. |
| Calendar/UOM | CNC-V1-01 provides tenant UOM and `ProductionCalendarService.resolve()`. | No reusable working-day offset API or MRP lead-time use. |
| Proposals | `PurchaseProposal` (header + material lines) and `ProductionProposal` (part) use `ProposalStatus`; approval converts directly to PO/WO. | Two output models, no run/firm/lifecycle/pegging/calculation/exception data; direct PO is not a requisition boundary. |
| Procurement | `PurchaseOrder` has residual quantities and expected date, but no plant or requisition. | No safe MRP purchase-requisition boundary; no plant isolation. |
| Sales | Open `SalesOrderLine` has part, quantity, shipped quantity and due date; `SalesOrdersService.release()` creates a WO. | MRP must use only un-released remaining lines, avoiding a duplicate WO demand. |
| Inventory/quality | CNC-V1-02 reservations and StockBalance/inventory ledger are canonical; active QualityHold and lot acceptance exist. | Current MRP reads aggregate stock and does not exclude held/quarantined lots. |
| Authorization/audit | `PagesGuard` reaches legacy `ProductModule` / `TenantModuleEntitlement`; action permission grants are already server-side. | MRP needs its own action keys without replacing legacy entitlement authority. |

No `CNC-V1-03R` migration, dedicated E2E suite, or production documentation
exists in the current worktree/history.

## Fixed invariants

1. The existing `MrpService` remains the canonical orchestration boundary.
2. Every demand, supply, proposal, exception, and pegging row is tenant and
   plant scoped; there is no implicit inter-plant netting.
3. A planning bucket uses the stored effective date. For an item and bucket:

   `projectedAvailable(t) = openingUsable + usableReceiptsThrough(t) + firm/plannedSupplyThrough(t) + reservationCoverageThrough(t) - grossRequirementsThrough(t) - safetyStockTarget(t)`.

   Opening usable excludes active held/quarantined lot balance and active
   reservations. A reservation for a demand that is also in this run is added
   exactly once as non-fungible `reservationCoverage` pegged to that demand;
   therefore neither the reservation nor its demand is double-subtracted.
4. Only released `ProductionDefinition` / released BOM and routing can drive a
   MAKE conversion. Draft, obsolete, and legacy-unverified engineering cannot.
5. Firmed proposals are supply on future runs and are never resized, moved,
   superseded, or removed by MRP. Changed demand creates an exception.
6. Conversion locks the proposal row and uses unique downstream linkage, so
   concurrent retries yield exactly one WO or purchase requisition.
7. Legacy `ProductModule` / `TenantModuleEntitlement` stays the entitlement
   authority; action permissions add only operation-level authorization.

## Design decisions proposed for approval

### Canonical planning records

Introduce one polymorphic, item/plant-scoped `MrpProposal` aggregate (MAKE or
BUY) with `MrpRun`, `MrpPlanningParameter`, `MrpPegging`, `MrpException`, and
stored calculation/bucket snapshots. Preserve legacy proposal records for
history and their existing endpoints; new full MRP writes only the new model.
This is a replacement of MRP output persistence, not a parallel calculation
engine.

`MrpProposal` lifecycle: `PROPOSED → FIRMED → CONVERTED`, with terminal
`CANCELLED` and `SUPERSEDED`. Conversion to MAKE creates a PLANNED WO (not a
released WO); it retains proposal/pegging linkage and subsequently requires
the existing CNC-V1-01 engineering-release command. BUY conversion creates a
minimal, canonical `PurchaseRequisition`, never a fake or auto-approved PO.

### Inputs and date policy

Planning uses daily buckets by default and an explicit plant, planning date,
and horizon end. Demand is: un-released open sales-order remaining quantity,
independent demand, released/firm WO component demand, and dependent demand
created by ordered released BOM explosion. A sales line already linked to a WO
does not separately become demand. Supply is usable stock, reservation
coverage, released/open WO remaining expected output, firm proposals, open PO
remaining receipts (only when plant provenance is explicit), and requisitions
once firm/converted.

The schema must add plant provenance to warehouses and procurement records
(nullable only for history); unassigned legacy stock/supply is not silently
netted into a plant run. Existing aggregate Material/Part stock is not used as
the planning authority after the plant-scoped StockBalance migration.

### Parameters and lead time

Add a unique plant/item `MrpPlanningParameter`: enabled, MAKE/BUY, working-day
lead time, LOT_FOR_LOT / MINIMUM_QUANTITY / ORDER_MULTIPLE (and fixed lot when
small), safety stock, horizon, and explicit reschedule tolerance. The V1 lead
time is the parameter because current routing `standardMinutes` cannot safely
produce a reliable elapsed manufacturing lead time. Extend the canonical
production-calendar service with a single working-day offset operation; use it
for both make start and buy order dates. Supplier calendar is V1-plant-calendar
assumed.

### Exceptions and explainability

Create deterministic `SHORTAGE`, `RESCHEDULE_IN`, `RESCHEDULE_OUT`, `CANCEL`,
and quantity-excess/shortage exceptions with `CRITICAL`, `WARNING`, `INFO`.
Each proposal/exceptions stores source element IDs, dates, quantities, parent
pegging chain, and an immutable calculation explanation; the frontend must
render stored data rather than reconstruct it.

## Non-goals

No finite-capacity APS, advanced sequencing, forecasting engine, automatic PO
approval, RFQ/invoice matching, supplier calendars, cross-plant policy,
PRODUCT-ARCH-005, entitlement-authority cutover, CNC-V1-05 hardware work,
commit, or push.

## Implementation task list

1. Add failing PostgreSQL E2E acceptance cases and pure planner unit tests for
   dated netting, reservations/quality holds, BOM levels, calendar offsets,
   parameters, exceptions, firming/reruns, conversion/idempotency/concurrency,
   and tenant/plant isolation.
2. Add shared contracts/enums plus Prisma migration for canonical MRP runs,
   parameters, dated elements/buckets, canonical proposal/pegging/exception,
   independent demand, requisition, and explicit plant provenance. Include
   migration/backfill safety and indexes for the daily run query paths.
3. Extend `ProductionCalendarService` with tested working-day offset and expose
   plant-safe inventory/supply query helpers based on StockBalance, lot
   acceptance, QualityHold, reservations, WIP, PO and WO remaining quantities.
4. Refactor `MrpService` in place into a deterministic full-regeneration,
   time-phased topological calculation pipeline. Persist RUNNING/COMPLETED/
   FAILED run status and atomically publish results only on success.
5. Implement proposal lifecycle, firm/unfirm/audit, exception generation,
   stored calculations and pegging; add action-permission keys while retaining
   the legacy page/product entitlement guard.
6. Implement transaction-safe MAKE→planned WO conversion and BUY→purchase
   requisition conversion with database-level unique linkage and retry-safe
   behavior. Make converted documents supply on subsequent runs.
7. Replace the MRP page with planner and exception workbenches, run controls,
   filters, detail/explanation, firm/convert/acknowledge actions, and no
   frontend-only authorization.
8. Add `docs/CNC-V1-03R-MRP-DAILY-PLANNING.md`, update the commercial gap
   analysis and PLAN only with verified evidence, benchmark the SME fixture,
   run the requested regressions and backup/restore drill, then report every
   result as PASS/FAIL/PRE_EXISTING_FAILURE/BLOCKED_ENVIRONMENT/NOT_RUN.

## Gate

Ready for implementation after explicit approval of this plan. The two
decisions that materially affect the schema are accepted defaults above:
plant-scoped StockBalance/procurement provenance and `PurchaseRequisition` as
the BUY conversion boundary.

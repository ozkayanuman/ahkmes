# CNC-V1-03R — MRP Daily Planning, Exception Control & Proposal Conversion

Status: `VERIFIED_DONE`.

The canonical `MrpService` provides plant/date-phased daily planning,
exception control, explainable pegging and idempotent proposal conversion. The
release gate is proven on real PostgreSQL, including deterministic concurrent
source changes and failed-publication rollback. No parallel MRP engine was
created; legacy ProductModule/TenantModuleEntitlement remains the runtime
authorization authority.

## Demand boundary and Sales provenance

Standalone MRP accepts explicit plant-scoped `MrpIndependentDemand`, canonical
plant-scoped WO supply and immutable released-WO material requirements. It does
not require Sales/CRM data or entitlement.

Optional Sales integration uses the smallest model consistent with the current
one-line/one-WO architecture: `SalesOrderLine.fulfillmentPlantId`. Customer and
SalesOrder remain commercial aggregates; the line owns quantity, due date,
shipment progress, WO and delivery links, so it also owns the single V1
fulfillment/planning plant. The database enforces a tenant-consistent composite
foreign key to Plant. Assignment is an audited, planner-authorized, idempotent
command and cannot silently move an already assigned line to another plant.

A null plant means `NEEDS_PLANT_ASSIGNMENT` / `NOT_PLANNABLE`. Such a line is
excluded from every plant run and production release rejects it; no tenant-wide
or default plant is guessed. MRP reads only OPEN, assigned, in-horizon lines
without an existing WO and plans `quantity - shippedQty`. CLOSED/CANCELLED lines
leave the next run deterministically. Once Sales release creates a WO, that WO
inherits the line plant and remaining quantity, and the Sales line is no longer
read as a second demand source.

Traceability is preserved as:

`SalesOrder → SalesOrderLine → plant-scoped SALES_ORDER_LINE demand → MrpRun → MrpPegging → MrpProposal → WorkOrder/PurchaseRequisition`.

The dedicated PostgreSQL cases prove Plant A exactly once, Plant B exclusion,
unassigned exclusion, no multiplication, cross-tenant rejection, Sales pegging
through MAKE-to-WO conversion, cancellation on the next run, and standalone
independent demand without Sales data.

## Calculation semantics

For each item/date, stored evidence follows:

```
projected available = opening usable
  + dated receipts + firm planned supply + owning reservation coverage
  + proposed supply - gross requirements
```

Opening usable is canonical plant StockBalance excluding unaccepted/held lots
and active reservations; reservation coverage is restored only to its owning
immutable WO requirement. Released ProductionDefinition, immutable WO
requirements, canonical decimal UOM conversion, working-day calendar offsets,
multi-level netting, horizons, safety stock, lead time, lot rules and
reschedule tolerance are reused from CNC-V1-01/02.

## Consistent input snapshot and atomic publication

The RUNNING attempt is created in a short transaction. The complete input-read,
in-memory calculation and derived-result publication phase then runs in one
Prisma interactive PostgreSQL transaction at `REPEATABLE READ` isolation. The
first query establishes the MVCC snapshot; every inventory, reservation, WO,
purchase, firm proposal, requisition, Sales demand, quality hold, UOM,
ProductionDefinition/BOM and calendar read uses that transaction client.

`MrpRun` persists `startedAt`, `inputSnapshotAt`,
`inputSnapshotStrategy=POSTGRESQL_REPEATABLE_READ` and
`inputSnapshotVersion=1`. Normal production writers are not globally locked;
PostgreSQL MVCC lets the current run keep the old committed view and the next
run see subsequent commits. SERIALIZABLE and global operational locks are not
used.

Superseding prior unfirmed proposals, inserting proposals/pegging/exceptions/
buckets, marking the run COMPLETED and writing its audit record occur in the
same transaction. Any calculation or persistence failure rolls the entire
phase back; a separate short transaction marks the attempt FAILED. The latest
COMPLETED result remains the valid plan and no failed run owns partial derived
rows. Proposal conversion remains a separate row-locked transaction.

MRP proposal numbers use a PostgreSQL sequence because sequences are non-MVCC
and therefore safe when different-plant REPEATABLE READ runs publish
concurrently. Rollback gaps are permitted; uniqueness and monotonic allocation
matter, not gaplessness.

Deterministic test barriers at `SNAPSHOT_ESTABLISHED` and `PUBLICATION_STAGED`
are no-ops in production. PostgreSQL E2E uses them instead of sleeps to prove:

- inventory, reservation and WO commits after snapshot affect only the next run;
- concurrent ProductionDefinition revision release cannot mix parent/child revisions;
- concurrent calendar and planning-parameter changes affect only the next run;
- forced publication failure creates no proposals, pegging, exceptions or buckets
  and cannot supersede the previous successful plan.

## Lifecycle, workbenches and conversion

Full regeneration supersedes only unfirmed proposals; FIRMED proposals remain
immutable supply. Exceptions cover SHORTAGE, MISSING_POLICY, RESCHEDULE_IN,
RESCHEDULE_OUT, CANCEL, QUANTITY_EXCESS and QUANTITY_SHORTAGE, with audited
acknowledgement. Stored buckets, parameter snapshots, calculation and pegging
provide planner explainability.

MAKE conversion requires a FIRMED proposal and a released plant production
definition, creates exactly one PLANNED WorkOrder and preserves canonical
engineering release. BUY creates exactly one DRAFT PurchaseRequisition and
never a PurchaseOrder. DB linkage, row locking and transactions make retries
and concurrent conversion idempotent.

The web planner and exception workbenches expose the required filters, firm/
unfirm, conversion, acknowledgement and stored explanation. Backend roles,
page grants and action permissions remain authoritative.

## Verification evidence — 2026-08-17

- Prisma format/validate/generate and workspace typecheck: PASS.
- PostgreSQL MRP matrix: 37/37 PASS (A–Y, Sales Z1–Z3, snapshot SNAP-A–F).
- 1,000-item fixture: before hardening 4.699 s; after hardening 5.847 s in the
  repeatable-read matrix, under the pre-existing 30-second gate.
- Backend full unit suite: 59 suites / 271 tests PASS after provenance fixtures.
- Web: 9 files / 30 tests PASS, including MRP workbench 8/8.
- Production build: PASS.
- Clean operations: 74 migrations, CNC-V1-00/01/02/04/06 5 suites / 15 tests,
  timestamped backup, isolated restore, migration status and restore E2E PASS.
- `git diff --check`: PASS; Graphify updated after code changes.

## Remaining V1 limitations

No split/multi-plant fulfillment allocation is implemented; that requires a
future allocation entity and is separate Sales integration scope. No APS,
finite-capacity scheduling, advanced Procurement, CMMS, OEE, costing,
controller feature, PRODUCT-ARCH-005 or CNC-V1-07R is included. CNC-V1-05
remains `SOFTWARE_READY_FIELD_VALIDATION_REQUIRED`.

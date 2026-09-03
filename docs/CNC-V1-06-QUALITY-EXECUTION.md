# CNC-V1-06 — Production Quality Execution

## Current status

`VERIFIED_DONE` (completion and verification pass: 2026-08-12). The original
foundation pass remained `FUNCTIONAL_PARTIAL` until the isolated real
PostgreSQL execution, concurrency and backup/restore evidence below passed.

## Implemented foundation

- Existing `QualityPlan` and `QualityPlanCheck` are extended rather than
  replaced. Plans are now DRAFT/RELEASED/OBSOLETE, revisioned and immutable
  once released.
- A released WO snapshots released plan checks into
  `ProductionQualityRequirement`; current plan edits cannot rewrite it.
- `InspectionLot` and immutable `InspectionMeasurement` provide deterministic
  numeric, boolean and qualitative evaluation with 100-percent/fixed-count
  sampling.
- A failed required measurement creates an NCR-linked active `QualityHold`.
  Holds remain history and require an explicit, audited release.
- `QualityDisposition` supports ACCEPT, USE_AS_IS, REWORK and SCRAP.
  REWORK creates a pending `ReworkRequirement`; actual rework execution remains
  CNC-V1-04 scope. SCRAP uses canonical `InventoryService` ledger movement.
- V1-02 reservation rejects an actively held lot. Physical on-hand remains in
  `StockBalance`; hold changes availability only.
- Required in-process inspections are checked server-side before operation
  completion.

## Completion evidence

- `test/quality-execution.e2e-spec.ts` runs against the isolated PostgreSQL
  operations stack and proves: fixed-count numeric/boolean PASS, failure hold,
  held-lot rejection through the canonical V1-02 reservation service, exactly
  once NCR SCRAP, USE_AS_IS authorization plus explicit release, REWORK
  idempotency, A/B plan snapshot behaviour, a database-rejected cross-tenant
  parent relation, conflicting concurrent SCRAP/USE_AS_IS disposition, and a
  failed-SCRAP transaction rollback.
- Quality terminal dispositions lock the NCR row and have a one-NCR unique
  constraint. Measurement evaluation locks its inspection lot. Hold release
  locks the hold row. This gives one terminal effect under PostgreSQL rather
  than relying on UI disabling.
- Composite tenant ownership foreign keys protect the critical quality graph:
  released requirement to WO/plan, lot to requirement/WO/output lot/NCR, hold
  to WO/output/inspection lot, and disposition/rework to NCR/WO.
- `test/deployment-restore.e2e-spec.ts` runs after a `pg_dump` backup into a
  second isolated PostgreSQL service. It verifies plan, WO quality snapshot,
  inspection lot, measurement, NCR, hold, disposition and rework records
  survive restore and remain coherent.
- Inspector execution is available on **Inspections**: released requirement
  context, plan revision and limits, sample progress, numeric/boolean/
  qualitative entry, server outcome, and active NCR/hold state. **NCR** adds
  quality context/detail, permitted disposition, explicit release and pending
  rework visibility. HMI operation detail exposes quality required/pending/
  failed/hold/rework state and explains the existing server completion gate.

## V1 limits intentionally retained

- Incoming supplier inspection, gauge asset/calibration enforcement, advanced
  sampling and full rework execution remain outside this partial boundary.

Legacy `ProductModule` / `TenantModuleEntitlement` remains the production
authorization authority. Entitlements V2 remains non-authoritative.

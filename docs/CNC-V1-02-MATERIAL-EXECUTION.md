# CNC-V1-02 — Production Material Reservation & Execution

## Status

`VERIFIED_DONE` — the controlled material-execution model, canonical ledger
integration and isolated PostgreSQL acceptance/concurrency verification passed
on 2026-08-12.

## Model

Engineering release derives `ProductionMaterialRequirement` rows from the
immutable `WorkOrder.engineeringSnapshot.bom.lines`. Quantities are decimal
safe, include snapshotted BOM scrap factor and are converted into the component
stock UOM before reservation. Execution never reads a mutable BOM.

`ProductionMaterialReservation` allocates a requirement to a tenant-scoped bin
and optional input lot without changing physical stock. `ON_HAND` is
`StockBalance.qty`; `RESERVED` is the unissued quantity of active reservations;
and `AVAILABLE = ON_HAND - RESERVED`. Issue writes canonical
`InventoryMovement(PRODUCTION_ISSUE)`. Derived WIP is issued minus consumed,
returned and material-scrap quantities. Return writes
`InventoryMovement(PRODUCTION_RETURN)`.

## Policies and controls

- A snapshotted BOM line explicitly chooses `MANUAL_ISSUE` or `BACKFLUSH`.
- Backflush derives a cumulative expected quantity from completed good quantity
  and, only when configured, finished-part scrap; it records the delta under a
  deterministic idempotency key.
- New engineering-released WOs cannot use the generic historical consumption
  endpoint.
- Reservation locks the physical `StockBalance` row using PostgreSQL
  `FOR UPDATE` before calculating availability.
- HMI exposes requirements and blocks start for incomplete required manual
  allocation. Reservation, issue, return, material scrap and cancellation are
  tenant-scoped, server-authorized `/production-material` commands.
- MRP subtracts active unissued reservations from material on-hand for its
  available-to-plan calculation.
- Finished receipt remains the canonical `FinishedGoodsService` flow and is
  linked to the same WO and material genealogy; automatic final-operation
  receipt policy belongs to CNC-V1-04.

## V1 boundaries

- Input serial execution is not supported: `SerialNumber` models produced
  Parts, not raw-material serial allocation.
- Requirements are WO-scoped; operation-level material assignment is a later
  routing refinement.
- A reservation can be cancelled before issue. Reduction is cancellation plus a
  new idempotent reservation. The HMI shows material readiness; inventory
  mutations intentionally remain authorized API commands rather than a parallel
  stock subsystem.

## PostgreSQL evidence

The isolated `pnpm test:operations-e2e` topology ran PostgreSQL 16 and applied
all 67 migrations, including `20260813130000_cnc_v1_02_material_execution`.

- `production-material.e2e-spec.ts` passed immutable requirement calculation,
  lot A1/A2 allocation, canonical issue, cumulative/delta backflush, material
  scrap, finished receipt, duplicate-request idempotency and input genealogy.
- Its concurrency case raced two 8 kg reservations against 10 kg stock; exactly
  one succeeded and availability ended as 10 / 8 / 2.
- Deployment and CNC-V1-01 engineering tests passed too (3 suites / 5 tests).
- A backup was restored to a separate PostgreSQL instance; migration status and
  restored deployment verification passed (1 suite / 1 test).

Legacy `ProductModule` / `TenantModuleEntitlement` remains the production
authorization authority. Entitlements V2 is unchanged and non-authoritative.

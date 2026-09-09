# CNC-V1-01 — Released Engineering Master Data, UOM & Production Calendar

## Status

`VERIFIED_DONE` — isolated real PostgreSQL verification passed on 2026-08-12
with `pnpm test:operations-e2e`.

## Canonical ownership

- `Part` is the manufactured-part identity and engineering revision.
- `BomHeader`/`BomLine` are the canonical BOM revision and component quantities.
- `RecipeHeader`/`RecipeStep` are the canonical routing and operations.
- `NcProgram` remains the released checksum/revision source.
- Tool/fixture requirements are copied into `WorkOrderOperation` at release.
- `ProductionDefinition` is a small plant-scoped, released pairing of a part,
  BOM and routing; it does not duplicate engineering content.

## Lifecycle, release and snapshot

Part, BOM and routing start in `DRAFT`; statuses are `DRAFT`, `RELEASED`,
`OBSOLETE`, and `LEGACY_UNVERIFIED`. Historical data is explicitly
`LEGACY_UNVERIFIED`, not fabricated as released. Released records cannot be
edited; a change needs a new revision.

A new Work Order is `PLANNED`. The controlled engineering-release command
requires a released definition for the same tenant/plant/part, creates the
immutable part/BOM/routing/operation/NC/tool/fixture snapshot, then marks the
WO `RELEASED`. Production cannot start a new-release-path WO before that gate.
Existing historical WOs remain readable. Later engineering edits cannot rewrite
a released snapshot.

## UOM

`UomDefinition` is tenant-scoped and dimension-safe: `COUNT`, `MASS`,
`LENGTH`, `AREA`, `VOLUME`, `TIME`. Idempotent system units include EA, G/KG,
MM/CM/M, MM2/CM2/M2, ML/L and S/MIN/H. Conversion uses `Prisma.Decimal`,
only permits equal dimensions, and applies explicit target precision. Item-
specific conversions are intentionally deferred.

## Calendar and shifts

`Plant.timezone` is the IANA production timezone. A production calendar stores
working ISO weekdays plus date exceptions. Shifts store local start/end minutes;
an end at or before the start is cross-midnight. `ProductionCalendarService`
is the sole canonical resolver for plant-local working time, production date,
holidays, weekends, timezone and DST. The pre-existing fixed `shift-report`
presentation remains legacy reporting, not a calendar authority.

## API and authorization

- UOM: `GET/POST /uom`, `POST /uom/convert`
- Calendar/shifts: `/production-calendars`
- Definitions: `/production-definitions`
- Lifecycle: `/parts/:id/engineering-status`, `/boms/:id/status`,
  `/recipes/:id/status`
- WO snapshot: `POST /work-orders/:id/release-engineering`

The web application exposes **Üretim Tanımları** for plant/part/BOM/routing
pairing and **Üretim Standartları** for inspecting and maintaining tenant UOM,
plant calendars and shifts. Both reuse existing page permissions; the API is
the server-side authority.

These endpoints retain tenant scope, server-side roles/PagesGuard, and the
existing legacy ProductModule/TenantModuleEntitlement runtime authority.
Entitlements V2 remains non-authoritative.

## Verification

Real PostgreSQL E2E creates P-100, releases BOM/routing A, snapshots WO-100,
releases B, snapshots WO-101, and rejects draft C. The same isolated run
applies all migrations, verifies provisioning replay, takes a backup, and
restores it into a separate PostgreSQL database.

Focused lifecycle/UOM/calendar tests, the complete backend unit suite (57
suites / 261 tests), web tests (8 files / 22 tests), connector tests (7 files
/ 23 tests), all workspace typechecks and `git diff --check` pass. UOM system
unit initialisation uses a single PostgreSQL `createMany(skipDuplicates)`
operation, so concurrent first use is idempotent without surfacing duplicate
key diagnostics.

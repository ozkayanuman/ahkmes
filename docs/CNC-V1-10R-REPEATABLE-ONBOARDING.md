# CNC-V1-10R — Repeatable customer onboarding/import

## Delivered foundation (2026-09-11)

The product now has a tenant-scoped, administrator-only CSV onboarding flow for the first customer cutover pack:

1. Supported templates: `PARTS`, `MATERIALS`, `TOOL_DEFINITIONS`, `TOOL_COMPONENTS`, `FIXTURE_DEFINITIONS`, `PHYSICAL_TOOLS`, `PHYSICAL_FIXTURES`, `TOOL_MACHINE_COMPATIBILITIES`, `FIXTURE_MACHINE_COMPATIBILITIES`, `BOMS`, `ROUTINGS`, `CUSTOMERS`, `SUPPLIERS`, `MACHINES`, `WAREHOUSES` and `OPENING_STOCK`.
2. Each upload is a `DRY_RUN`: the original content checksum, actor, template, row number, external business key, normalized values and validation errors are retained in an `OnboardingImportBatch`. A dry run creates no domain master or inventory record.
3. Only a fully valid batch exposes the explicit commit action. Commit is a single transaction; it never upserts or overwrites an existing master. Any conflict rejects the batch rather than producing partial master data.
4. Opening stock is committed through the canonical inventory ledger as `OPENING_BALANCE` / `ONBOARDING_IMPORT`, with optional lot traceability. It therefore preserves stock, audit and movement invariants instead of writing balances directly.
5. The **Veri Onboarding** administrator screen downloads an exact empty CSV header, validates the selected file, shows row-level errors, exports only failed rows as a formula-safe CSV, asks for an explicit confirmation, and retains a 50-batch history.

### Dependency order

Commit templates in this order: reference masters → parts/materials/machines → tool definitions → draft BOM → warehouse → create bins in the normal warehouse screen → opening stock. `BOMS` creates a single draft material BOM per CSV and never releases engineering data. `OPENING_STOCK` deliberately requires an already committed item, warehouse and bin. This makes dependencies deterministic and prevents a CSV typo from silently creating an unintended physical stock location.

### Intentionally deferred capabilities

The current `BOMS` and `ROUTINGS` scopes create drafts only; part-subassembly structures, NC-program references and release stay in the normal engineering workflow. The tooling scope includes versioned definitions, physical tool/fixture instances and machine compatibilities; tool assemblies and operation requirements remain in their controlled lifecycle workflows. Retained original-upload documents are not yet delivered; row-level failure CSV export, row results and the source checksum are retained in the application audit record.

## Acceptance criteria

- A customer can load a representative pilot data pack twice: the second attempt produces precise duplicate diagnostics, never duplicate stock or released revisions.
- A dry run writes no domain records; a rejected commit writes none for its atomic group.
- Opening stock is represented by canonical inventory movements, tenant/warehouse/bin/lot references resolve deterministically, and balances reconcile after import.
- Every committed batch is traceable to its user, template, input checksum and row outcomes.
- Cross-tenant input, invalid dependency order, unknown keys, duplicate keys and released-master mutation are covered by PostgreSQL E2E tests and backup/restore verification.

## Verification (2026-09-18)

- Targeted clean PostgreSQL E2E: CNC-V1-09R and CNC-V1-10R, 2 suites / 4 tests passed.
- The V1-10R flow exercises all 16 supported templates, including tool and fixture machine compatibilities, in one dependency-ordered import pack.
- The current focused V1-10R PostgreSQL suite passes 2/2 tests, including the compatibility templates.
- 2026-09-21 hardening tests verify controlled uniqueness-race conflicts for tooling/import and formula-safe CSV error export.
- Full operations rehearsal: 10 CNC suites / 74 tests passed after all 81 migrations, including the V1-10R import flow.
- A compressed backup was restored into an isolated PostgreSQL instance; migration status was current and the restore suite passed 3/3 tests.

## Customer execution

`CNC-V1-10R-CUSTOMER-CUTOVER-RUNBOOK.md` is the versioned operating
procedure for the first customer data load, training, support handover and
recovery decision. It does not expand the import contract or claim selected
controller field acceptance.

## Concurrent-change handling

Dry-run validation is evidence, not a lock on master data. At commit time the
database uniqueness constraints remain the final authority for machine/tool and
machine/fixture compatibilities and the other imported master records. A
concurrent duplicate becomes a controlled conflict, the batch is retained as
`REJECTED` with an actionable failure reason, and the operator must re-run
dry-run against the current tenant state. No partial import is committed.

## Out of scope

Historical transaction migration, financial opening balances, supplier EDI, automatic field mapping, universal spreadsheet repair and arbitrary cross-template upserts are not part of V1-10R.

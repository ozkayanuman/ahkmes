# PLM-001 acceptance boundary

PLM-001 reuses `Document` + MinIO as the technical-attachment abstraction and
extends the existing `NcProgram` record for controlled NC content. The binary
is not copied to PostgreSQL. PostgreSQL records storage key, MIME type, size,
SHA-256, lifecycle, effectivity, revision ancestry and signatures.

## Released lifecycle

`DRAFT → REVIEW → APPROVED → PUBLISHED → SUPERSEDED/ARCHIVED`.

- Only a draft accepts an upload. Any content change is a new revision.
- Review creates the existing generic `ApprovalRequest`; a different `ADMIN`
  reauthenticates to approve. A different `ADMIN`/`PLANNER` reauthenticates to
  publish.
- A PostgreSQL advisory lock plus partial unique index permits one published
  revision per part/effectivity scope. A stale concurrent candidate is rejected.
- Recipe steps and work-order operations only snapshot a currently published,
  checksum-valid, tenant/part/machine/effectivity-compatible program. The same
  check runs immediately before production starts.

## Explicit remaining platform work

- `AHK-006`: `AuthService.reauthenticate` deliberately rejects OIDC until a
  provider-side `prompt=login` transaction/evidence flow is added; CAPA/MRP
  still need this shared policy and durable notification outbox.
- `AHK-017`: PLM commands use tenant predicates, but no mandatory Prisma tenant
  context or PostgreSQL RLS exists. See `PartsService.assertNcProgramUsable`,
  `RecipesService.create/update`, and `WorkOrdersService.createWithRoute`.
- `PLM_CHANGE_CONTROL`: generic technical `Document` attachments are retained;
  a cross-document controlled revision workflow is intentionally not duplicated
  inside this NC release slice.

`MES-TOOL-001` is the canonical successor. `AHK-019` is its alias/dependency,
not a separate work item.

# PRODUCT-ARCH-002 — Entitlement V2 Persistence & Compatibility Foundation

> Current status: **VERIFIED_DONE (non-authoritative).** The implementation's
> focused unit/type checks and isolated real PostgreSQL E2E pass. Legacy `ProductModule`,
> `TenantModuleEntitlement`, edition checks, PagesGuard, routes, and UI remain
> the only production entitlement behaviour.

## Preflight: PagesGuard tests

Classification: **TEST_FIXTURE_DEFECT** (pre-existing; unrelated to
PRODUCT-ARCH-001).

Both failing assertions in `pages.guard.spec.ts` use one `Reflector` mock that
returns the required page list for both `PAGES_KEY` and `PRODUCT_MODULES_KEY`.
The second call is therefore incorrectly given `"inspections"` or
`"platform-modules"` as an explicit `ProductModule`. In production, no
`@RequireProductModule` decorator means the second call returns `undefined` and
the guard uses only `PAGE_PRODUCT_MODULE`. Git blame shows both test assertions
pre-date PRODUCT-ARCH-001; PRODUCT-ARCH-001 did not modify either guard file.
No authorization behaviour or test expectation was changed in this ticket.

## V2 schema

Migration `20260812120000_product_arch_002_entitlement_v2_foundation` is
expand-only and adds:

- `TenantLicence`, `ProductGrant`, and `FeatureGrant` with lifecycle/source
  fields and tenant-consistent composite foreign keys.
- `EntitlementLimit` and `UsageAllocation` persistence foundations for named,
  concurrent, plant, machine, and API-call dimensions. No usage enforcement.
- `EntitlementReconciliation`, a versioned, unique-per-tenant/legacy-code
  ledger containing snapshots, projected targets, reason, actor, timestamp,
  deterministic correlation ID, and reconciliation status.

Platform capabilities are never ProductGrant values. The service validates
commercial product IDs against the PRODUCT-ARCH-001 catalogue, validates feature
ownership, and rejects `SHARED_MASTER_DATA`/all other platform capabilities as
products.

## Projection and reconciliation

`EntitlementsV2Service.projectTenant()` is read-only. It turns the effective
legacy state (configured values plus current implicit-enabled defaults) into V2
product/feature/platform facts without changing access.

`reconcileTenant(..., { dryRun: true })` remains a compatibility-only projection
helper. Its former materialisation path was deliberately disabled by
PRODUCT-ARCH-003 because absent legacy rows are technically enabled by default
but are not evidence of commercial ownership. Controlled materialisation now
belongs exclusively to `CommercialMigrationService`; legacy rows are never
edited or deleted.

Projection rules:

| Legacy code | Rule |
|---|---|
| `ERP_CRM_SALES` | Projection identifies CRM + SALES, but commercial materialisation now requires PRODUCT-ARCH-003 review approval. |
| `ERP_PROJECT_SERVICE` | Projection identifies PROJECT + SERVICE, but commercial materialisation now requires PRODUCT-ARCH-003 review approval. |
| `MES_PERFORMANCE`, `MES_CNC_TOOLING`, `APS_SCHEDULING`, `IIOT_HISTORIAN`, `ANALYTICS_SEMANTIC_BI` | Create `NEEDS_RECONCILIATION`; no commercial grants are guessed. |
| Direct mappings | Project their documented product/feature or platform target only when legacy state is enabled. |

## Resolver, safety, and rollback

`resolve()` evaluates V2 licence/product/feature status and expiry and returns
source, platform requirements, and persisted limits. It is deliberately not
called by PagesGuard. `compareLegacyAndV2()` is the service-level diagnostic for
controlled migration validation; no UI or cross-tenant diagnostic endpoint is
exposed.

All V2 operational models carry `tenantId`, are automatically picked up by the
Prisma DMMF-derived tenant-scope extension, and use composite FKs so a child
grant cannot point at a parent from a different tenant. Reconciliation requires
a same-tenant actor for existing AuditLog evidence.

PRODUCT-ARCH-003 adds selected-run provenance rollback and replay semantics.
Do not delete legacy entitlements and do not run a destructive data migration.

## Verification status and next step

The migration has not been applied automatically. Initial implementation-time
verification was blocked by Docker Desktop. During reconciliation on 2026-08-12,
the repository-local command below created a fresh isolated PostgreSQL 16
environment, applied all 64 migrations (including 002 and 003), seeded, and
passed `entitlements-v2.e2e-spec.ts` (4/4). This is `VERIFIED_CURRENT_RUN`.

The test proves migration deployment, V2 persistence, composite foreign keys,
tenant rejection, expiry, and feature-parent integrity. Host-local `prisma
validate` remains blocked only because its missing schema engine cannot be
fetched; the Docker run successfully loaded the schema, generated the Prisma
client, and executed `prisma migrate deploy` against real PostgreSQL.
PRODUCT-ARCH-003 remains a controlled migration rollout; PagesGuard must still
not switch until compatibility comparison is accepted for every tenant.

Important migration risk: current legacy module semantics treat an absent
`TenantModuleEntitlement` row as enabled. A bulk V2 reconciliation could
therefore materialise broad migrated grants from implicit legacy defaults. This
ticket intentionally provides no all-tenant executor; PRODUCT-ARCH-003 must
require tenant-by-tenant dry-run review and an approved commercial migration
policy before any non-dry reconciliation is operated.

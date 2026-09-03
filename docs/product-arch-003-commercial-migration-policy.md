# PRODUCT-ARCH-003 — Commercial Migration Policy & Safe Reconciliation

> Current status: **VERIFIED_DONE (non-authoritative).** The policy foundation
> is implemented and its focused/unit plus isolated real PostgreSQL evidence
> passes. The legacy
> `ProductModule` / `TenantModuleEntitlement` runtime, tenant edition checks,
> PagesGuard, API authorization, and frontend visibility remain the production
> access decision path. This slice has no controller, startup migration, or
> all-tenant executor.

## Technical access is not commercial ownership

An effective legacy module can be active because of an explicit toggle, a
missing-row default, an edition fallback, or a technical bundle. Only an
explicit enabled row plus a deterministic commercial mapping is automatic
commercial-grant evidence. In particular, a missing `TenantModuleEntitlement`
row remains current technical access but never creates a V2 commercial grant.

| Evidence | Commercial decision |
|---|---|
| `EXPLICIT_ENABLED` + direct mapping | `AUTO_MIGRATABLE` |
| `EXPLICIT_DISABLED` | `IGNORED`; no grant |
| `IMPLICIT_DEFAULT_ENABLED` | `REVIEW_REQUIRED` |
| `EDITION_DERIVED` or `BUNDLE_DERIVED` | `REVIEW_REQUIRED` |
| `AMBIGUOUS_SPLIT` / `SPLIT_REQUIRED` | `REVIEW_REQUIRED` |
| `NO_EVIDENCE` / unmapped | `BLOCKED` |

The policy version is `PRODUCT-ARCH-003-v1`; it is stored with every approval,
reconciliation ledger row, run, and provenance entry. The legacy mapping
version remains `PRODUCT-ARCH-001-v1`.

## Read-only dry run

`CommercialMigrationService.dryRun(tenantId)` produces one report row per
legacy module containing its effective technical access, persisted-row flag,
edition contribution, evidence classification, targets, mapping type, decision,
and reason. It has no writes. `reconcile(..., { dryRun: true })` is likewise
read-only and can be narrowed to explicitly named legacy codes.

## Approval and controlled reconciliation

`approveReviewCandidate()` requires an active same-tenant `ADMIN`, a reason,
and target products/features that are already declared by the candidate. A
feature also requires its selected parent product. The database makes an
approval unique per tenant, legacy source, mapping version, and policy version;
an approval cannot be reused across tenants.

`reconcile()` requires the same admin condition and is explicit and
tenant-specific. It refuses `BLOCKED` candidates and refuses review candidates
without a valid tenant-bound approval. It only writes `MIGRATED` grants for:

- direct, explicitly enabled, deterministic candidates; or
- the exact approved targets of a review candidate.

`SHARED_MASTER_DATA` and every platform capability remain availability facts;
they have no `ProductGrant` row. Product/feature values originate only from the
canonical PRODUCT-ARCH-001 catalogue and each selected feature is checked under
its parent product.

## Provenance, replay, and rollback

The database adds tenant-bound `EntitlementMigrationApproval`,
`EntitlementMigrationRun`, `ProductGrantMigrationProvenance`, and
`FeatureGrantMigrationProvenance` records. Composite tenant foreign keys link
run, actor, approval, and product/feature grant; unique keys make a replay of
the same source/policy/approval input idempotent. `EntitlementReconciliation`
now preserves evidence, decision, policy version, source snapshot, correlation,
and migration run ID.

`rollback()` marks only provenance for the selected run revoked. It revokes the
underlying V2 grant only when no active migration provenance remains and only
when that grant's source is `MIGRATED`. `DIRECT`, `BUNDLE`, and `TRIAL` grants
are not migration provenance and are therefore never removed by a rollback.
Replaying a rolled-back identical run restores only its own `MIGRATED` rows.
Legacy rows are never changed or deleted.

## Split-required decisions

| Legacy technical module | Potential commercial targets | Policy |
|---|---|---|
| `ERP_CRM_SALES` | CRM, SALES | Technical bundle; review exact contracted product(s). |
| `ERP_PROJECT_SERVICE` | PROJECT, SERVICE | Technical bundle; review exact contracted product(s). |
| `MES_PERFORMANCE` | MES/PERFORMANCE, OEE/CORE | Performance/OEE ownership is not commercial proof; review. |
| `MES_CNC_TOOLING` | TOOLING features, FIXTURE management | Current technical ownership spans products; review selected target(s). |
| `APS_SCHEDULING` | APS/FINITE_SCHEDULING, MRP_II/CAPACITY_PLANNING | Scheduling vs capacity meaning requires review. |
| `IIOT_HISTORIAN` | CNC/MACHINE_DATA, ANALYTICS/REPORTING | Telemetry storage does not prove either commercial SKU; review. |
| `ANALYTICS_SEMANTIC_BI` | ANALYTICS/REPORTING, ANALYTICS/DASHBOARDS | Planned technical scope is not a finished commercial bundle; review. |

## Edition findings

`Tenant.edition` is currently a combination of technical default/package tier
and runtime entitlement fallback: `PlatformModulesService.set()` blocks a
toggle above the edition, and PagesGuard blocks page access when the current
edition is below the legacy module's catalogue tier. A missing module row still
defaults to enabled. It is not sufficiently reliable evidence of a commercial
purchase, so all edition-derived candidates require review. The target remains:
`Edition/Bundle -> packaging template`, `ProductGrant/FeatureGrant ->
commercial truth`; that cutover is not implemented here.

## Security and tenant invariants

- All V2 migration records have `tenantId` and are covered by the DMMF-derived
  Prisma tenant-scope extension.
- Composite foreign keys reject cross-tenant parent/child/run/approval links.
- Approval, reconcile, and rollback require a same-tenant active `ADMIN`.
- No public endpoint was added; operational invocation remains service-level.
- PagesGuard has no V2 dependency and continues to use legacy access.

## Verification status and PRODUCT-ARCH-004 prerequisite

Initial implementation-time verification was blocked by Docker Desktop. During
reconciliation on 2026-08-12, `pnpm test:e2e -- entitlements-v2.e2e-spec.ts`
created a fresh isolated PostgreSQL environment, applied all 64 migrations, and
passed 4/4 E2E tests. This is `VERIFIED_CURRENT_RUN`.

That suite exercises approval-gated reconciliation, replay, rollback with
DIRECT-grant protection, and cross-tenant database rejections for approval,
reconciliation, and provenance relationships. There is no separate
`commercial-migration.service.spec.ts`; the real-DB run is the primary evidence
for write/rollback behaviour.
PRODUCT-ARCH-004 remains shadow-only: controlled tenant-by-tenant comparison of
legacy effective access versus policy-approved V2 state, reporting differences
without changing any authorization decision. It must not cut PagesGuard or API
access over to V2.

# PRODUCT-ARCH-004 — Shadow Entitlement Evaluation & Migration Validation

> Current status: **VERIFIED_DONE (shadow only; not a cutover).** The shadow
> evaluator's focused unit tests pass and its persisted V2 foundation was
> verified on isolated real PostgreSQL on 2026-08-12. Legacy
> `ProductModule`, `TenantModuleEntitlement`, edition evaluation, PagesGuard,
> API authorization, and frontend visibility remain the sole production access
> authority. The shadow evaluator is read-only and has no controller.

## Architecture and authority rule

```
request -> legacy authorization -> real allow/deny
                              \-> no shadow hook in this slice

admin diagnostic -> ShadowEntitlementEvaluatorService
                  -> CommercialMigrationService.dryRun() + V2 resolver
                  -> comparison only
```

Request-time shadowing was intentionally not added. Attaching asynchronous
database diagnostics to PagesGuard would add latency and failure handling to a
security-critical request path without adding authorization value. Tenant batch
analysis is sufficient for controlled migration review.

## Comparison model

Each result carries tenant, legacy capability, optional target product/feature,
legacy decision/reason/evidence, V2 decision/reason/source, comparison status,
severity, mapping/policy versions, and timestamp.

V2 sources are deliberately distinct:

- `PERSISTED_COMMERCIAL_GRANT`: an effective V2 resolver grant; the only V2
  source reported as `ALLOW`.
- `APPROVED_MIGRATION`: approval exists but effective grant does not; result is
  `UNRESOLVED`.
- `AUTO_MIGRATABLE_PROJECTION`: policy permits migration but no grant exists;
  V2 is `DENY`, never an inferred allow.
- `REVIEW_REQUIRED_PROJECTION`, `BLOCKED_PROJECTION`, `NO_V2_EVIDENCE`:
  non-effective policy/mapping states.

Comparison statuses are `MATCH_ALLOW`, `MATCH_DENY`,
`MISMATCH_LEGACY_ALLOW_V2_DENY`, `MISMATCH_LEGACY_DENY_V2_ALLOW`,
`REVIEW_REQUIRED`, `UNRESOLVED`, and `UNMAPPED`.

`MISMATCH_LEGACY_DENY_V2_ALLOW` is **HIGH** severity: a V2 cutover could grant
access that legacy currently denies. Legacy-allow/V2-deny is also **HIGH**:
cutover could remove access. Neither changes the live legacy decision.

## Batch analysis and readiness gate

`analyzeTenant(tenantId, actorUserId)` is a same-tenant active-ADMIN diagnostic
contract. It evaluates every declared legacy commercial target and returns total
counts plus breakdowns by legacy module and migration evidence.

`assessReadiness(..., postgresE2ePassed)` returns
`READY_FOR_V2_CUTOVER_REVIEW` only when PostgreSQL verification is passed and
there are no high-severity mismatches, review-required mappings, unresolved
mappings, or unmapped mappings. It does not perform a cutover. In this
environment the required isolated PostgreSQL verification has passed; readiness
is nevertheless `NOT_READY` until each tenant's review-required mappings and
shadow comparison results have been resolved.

`SHARED_MASTER_DATA` maps only to platform availability: it is reported as
non-commercial/unmapped in shadow analysis and never as a `ProductGrant`.
MES, CRM, QMS, CMMS, and HR remain independent commercial products according to
the canonical catalogue; a matching V2 grant does not imply ERP, SALES, or MES.

## PostgreSQL verification

The repository’s isolated PostgreSQL mechanism is `pnpm test:e2e`, backed by
`docker-compose.e2e.yml`. Docker Desktop became available during this run. An
isolated named Compose project applied every migration, including
`20260812120000_product_arch_002_entitlement_v2_foundation` and
`20260812130000_product_arch_003_commercial_migration_policy`, seeded the
database, and ran `entitlements-v2.e2e-spec.ts` with exit code 0. The temporary
network, containers, and anonymous volumes were removed afterwards.

That E2E suite verifies V2 grant/feature parent handling, raw cross-tenant
product, feature, approval, reconciliation, and provenance writes rejected by
the actual composite foreign keys, tenant-scope denial, split
approval/reconciliation idempotency, rollback, and DIRECT grant protection
against real PostgreSQL. It is now the release evidence for the
database-critical PRODUCT-ARCH-002/003 foundation.

## Verification reconciliation (2026-08-12)

The preceding section's historical claim is now independently corroborated:
`pnpm test:e2e -- entitlements-v2.e2e-spec.ts` completed with exit code 0 on
2026-08-12. The fresh isolated Compose project applied all 64 migrations,
including 002 and 003, then passed all 4 selected E2E tests and removed its
containers, network, and volumes. This is `VERIFIED_CURRENT_RUN`.

The shadow evaluator's focused unit tests prove comparison semantics, including
persisted-grant matches, both high-severity mismatch directions, implicit
default review, and split-mapping review. The real-DB suite proves the V2
persistence, resolver, tenant-scope, and migration-state foundation it reads.
It does not invoke `ShadowEntitlementEvaluatorService` directly; that remaining
test-granularity gap is technical debt, not an authorization cutover risk,
because the service is observational and has no PagesGuard/API/UI integration.

## Security invariants and known blockers

- Shadow diagnostics are tenant scoped and require a same-tenant active admin.
- They do not write grants, approvals, reconciliation records, or legacy state.
- Shadow results expose no other tenant’s state; the DMMF tenant-scope extension
  continues to reject a conflicting tenant context.
- Unapproved and implicit-default projections never become V2 allow decisions.
- No V2 outcome is connected to PagesGuard, API, or UI.

Current blockers for any future cutover are outstanding `REVIEW_REQUIRED` split
mappings and any tenant-specific high-severity mismatch found by batch analysis.
PRODUCT-ARCH-005 should be limited to controlled tenant-by-tenant shadow report
review and resolving explicit commercial decisions; it must not cut
authorization over to V2.

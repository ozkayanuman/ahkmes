# PRODUCT-ARCH-001 to PRODUCT-ARCH-004 Baseline

> Reconciled on 2026-08-12 from the current working tree. Earlier documentation
> claims were not accepted without evidence; this reconciliation then captured a
> fresh successful isolated PostgreSQL run.

| Ticket | Current status | Established boundary | Verification evidence |
|---|---|---|---|
| PRODUCT-ARCH-001 | `VERIFIED_DONE` | Additive, type-safe commercial product/feature/platform catalogue and legacy mapping; it does not change runtime authorization. | `commercial-product-catalog.test.ts` 6/6 and workspace typecheck PASS on 2026-08-12. |
| PRODUCT-ARCH-002 | `VERIFIED_DONE` | Expand-only V2 licence/grant/reconciliation schema and non-authoritative resolver/projection. | Focused V2 unit tests/typecheck plus current fresh PostgreSQL E2E: 64 migrations including 002+003, 4/4 passed. |
| PRODUCT-ARCH-003 | `VERIFIED_DONE` | Versioned commercial evidence/policy, review approvals, controlled reconciliation, migration provenance, idempotent replay, and selective rollback. | Policy unit tests plus current fresh PostgreSQL E2E 4/4 passed. No separate migration-service unit suite exists. |
| PRODUCT-ARCH-004 | `VERIFIED_DONE` | Read-only shadow comparison, tenant-admin batch analysis, mismatch severity, and deterministic readiness assessment. | Shadow unit tests plus current V2 persistence/migration PostgreSQL E2E 4/4 passed; no guard/API/UI integration exists. |

## Current operating state

- **CURRENT AUTHORIZATION AUTHORITY:** `LEGACY`. `ProductModule`,
  `TenantModuleEntitlement`, tenant edition, and `PagesGuard` remain the
  production decision path.
- **CURRENT COMMERCIAL ENTITLEMENT MODEL:** V2 tables and services exist as
  non-authoritative persistence, resolver, and migration-preparation
  infrastructure. Platform capabilities, including `SHARED_MASTER_DATA`, are
  not commercial `ProductGrant` values.
- **CURRENT MIGRATION STATE:** No startup or all-tenant migration exists.
  Reconciliation is tenant-specific; implicit defaults and split mappings stay
  review-required until an explicit same-tenant admin approval.
- **CURRENT CUTOVER STATE:** No V2 cutover. Shadow diagnostics are service-only;
  they cannot alter a legacy allow/deny result. Cutover review is blocked by the
  real PostgreSQL E2E and then by tenant-specific shadow/review findings.

## Database-verification blocker

The repository-local command is:

```text
pnpm test:e2e -- entitlements-v2.e2e-spec.ts
```

It creates a named isolated Compose project, applies all Prisma migrations in
order, seeds, runs the selected E2E test, and removes containers/volumes. On
2026-08-12 it completed with exit code 0: PostgreSQL 16 applied all 64
migrations including 002+003 and the selected suite passed 4/4. Host-local
Prisma validation remains blocked by a missing schema-engine download, but the
same schema was generated and deployed successfully inside that isolated run.

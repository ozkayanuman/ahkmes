# PRODUCT-ARCH-002 TDD Evidence

Source: accepted PRODUCT-ARCH-001 foundation and the PRODUCT-ARCH-002 request.

| Guarantee | Evidence | Result |
|---|---|---|
| Legacy CRM/Sales and Project/Service splits use explicit automatic rules. | `entitlements-v2.service.spec.ts` | PASS — 5/5 focused tests |
| MES projects `MES_EXECUTION` with shared platform capability, not an ERP product. | `entitlements-v2.service.spec.ts` | PASS |
| Unresolved split mappings create reconciliation items rather than grants. | `entitlements-v2.service.spec.ts` | PASS |
| Workspace packages compile. | `pnpm typecheck` (2026-08-12) | PASS — backend, web, connector, shared-types |
| Host Prisma schema validation. | `prisma validate` (2026-08-12) | BLOCKED_ENVIRONMENT — missing host schema engine could not be downloaded; Docker E2E loaded/generates the same schema successfully |
| Commercial catalogue tests. | `pnpm --filter @ahkmes/shared-types test -- commercial-product-catalog.test.ts` (2026-08-12) | PASS — 6/6 |
| Current platform-module unit behaviour. | `platform-modules.service.spec.ts` (2026-08-12 focused run) | PASS — 11/11 tests |
| V2 DB materialisation, expiry, cross-tenant scope, idempotency, and feature-parent enforcement. | `pnpm test:e2e -- entitlements-v2.e2e-spec.ts` (2026-08-12) | PASS — fresh PostgreSQL 16; 64 migrations including 002+003; 4/4 tests |

## RED / GREEN

- RED: the new projection test initially failed to compile because
  `EntitlementsV2Service` did not exist.
- GREEN: focused projection and catalogue-validation test passed after implementation (5/5).

## Guard preflight

The initial ticket recorded two **PRE-EXISTING TEST_FIXTURE_DEFECT** failures.
The current working tree's focused run on 2026-08-12 passed
`pages.guard.spec.ts` (6/6) after its fixture mock was corrected. No production
guard behaviour was changed by PRODUCT-ARCH-001 through PRODUCT-ARCH-004.

## Known validation gap

The V2 migration is deployed only to the temporary isolated E2E database, never
automatically to a developer or customer database. The 2026-08-12 E2E command
is current real-PostgreSQL evidence. The host schema-engine download remains
unavailable, but is not a database correctness blocker because the Docker E2E
successfully generated Prisma Client and deployed the schema before testing.

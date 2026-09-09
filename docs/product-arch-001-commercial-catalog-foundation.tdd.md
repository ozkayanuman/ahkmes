# PRODUCT-ARCH-001 TDD Evidence

Source intent: the approved `docs/COMMERCIAL_PRODUCT_ARCHITECTURE.md` and the
PRODUCT-ARCH-001 implementation request. No implementation-plan file was used.

| Guarantee | Test / command | Result |
|---|---|---|
| Platform capabilities cannot be sellable products; identifiers are unique. | `commercial-product-catalog.test.ts` | PASS |
| Product and feature IDs are unique and every feature is attached to exactly one matching parent product. | `commercial-product-catalog.test.ts` | PASS |
| Every legacy mapping uses a real technical catalogue code and valid target identifier; all split mappings are explicit. | `commercial-product-catalog.test.ts` | PASS |
| MES, QMS, and CMMS have no hard commercial product dependency; HR and CRM are independently sellable. | `commercial-product-catalog.test.ts` | PASS |
| Provider requirements are provider contracts rather than entitlement identities. | `commercial-product-catalog.test.ts` | PASS |
| Existing technical catalogue tests remain green. | `pnpm --filter @ahkmes/shared-types test` | PASS — 3 files, 32 tests |
| Shared-types export remains compilable across the monorepo. | `pnpm typecheck` | PASS — shared-types, connector, backend, web |

## RED/GREEN evidence

- RED: `pnpm --filter @ahkmes/shared-types test -- commercial-product-catalog.test.ts` failed because `commercial-product-catalog` did not yet exist.
- GREEN: the same focused test passed after implementation. The final shared-types suite passed with 32 tests.

## Known validation gap

No coverage command exists in the workspace scripts, and no database or E2E suite is relevant because this slice makes no runtime or Prisma change.

`pnpm --filter @ahkmes/backend test -- platform-modules.service.spec.ts pages.guard.spec.ts` was also run. `platform-modules.service.spec.ts` passed; two pre-existing `pages.guard.spec.ts` expectations failed because current guard output includes raw page keys in its module query and treats `platform-modules` differently than the stale test expects. This task does not change those files; the failures are not used as a passing claim.

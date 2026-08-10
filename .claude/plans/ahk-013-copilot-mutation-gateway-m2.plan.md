# Plan: AHK-013 — Kalıcı Draft/Approval Kaydı

**Source PRD**: `.claude/prds/ahk-013-copilot-mutation-gateway.prd.md`
**Selected Milestone**: 2 — Kalıcı draft/approval kaydı
**Complexity**: Medium

## Summary
Bugün `CopilotService.createDraft()` tamamen stateless: her `POST /copilot/drafts` çağrısı hesaplanır ve unutulur, `executionAllowed` her zaman `false`'dur. Bu milestone, `DRAFT` statülü sonuçları kalıcı bir `CopilotDraft` tabloya yazar ve Milestone 1'de kararlaştırılan onay modelini (mevcut `ApprovalsService`, SoD+reauth) bu tabloya bağlar — draft artık listelenebilir, onaya gönderilebilir, onaylanabilir/reddedilebilir. Gerçek `Material` kaydı bu milestone'da **hâlâ oluşturulmuz** — `APPROVED` durumu, Milestone 3'ün mutation tool'unun tüketeceği bir sinyal olarak kalır (execution burada yok).

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Entity + onay senkronizasyonu | `apps/backend/src/capa/capa.service.ts:78-128` | `submitForApproval()` status'u `DRAFT→PENDING_APPROVAL` yapıp `ApprovalsService.request()` çağırır; `decide()` reauth alır, `ApprovalsService.approve()/reject()` çağırır, entity status'unu senkronize eder — aynı yapı `CopilotDraft` için tekrarlanacak. |
| Prisma model şekli | `apps/backend/prisma/schema.prisma:2474-2492` (`Capa`) ve `:1711-1731` (`ApprovalRequest`) | `tenantId`, status enum, `createdById`/`requestedById` → `User` ilişkisi, `@@index([tenantId, status])`. |
| Decide DTO/schema yeniden kullanımı | `packages/shared-types/src/schemas.ts:635-636` (`decideCapaSchema`/`DecideCapaDto`) | AHK-012 aynı şemayı (`{note?, password}`) yeni bir duplicate yerine doğrudan import ederek kullandı — `CopilotDraft` decide endpoint'i de bunu tekrar kullanacak. |
| Yetkilendirme (kim onaylayabilir) | `apps/backend/src/materials/materials.controller.ts:45` (`@Roles("ADMIN","PLANNER")`) | Material oluşturma yetkisi zaten ADMIN+PLANNER'da — draft onayı için `requiredRoles: ["ADMIN","PLANNER"]` kullanılacak (yeni bir rol kavramı icat edilmez). |
| Migration adlandırma | `apps/backend/prisma/migrations/20260810090000_ahk012_deviation_approval` | `{timestamp}_ahk013_copilot_draft_persistence` deseni. |
| Frontend reauth akışı | `apps/web/src/pages/non-conformances.tsx` + `apps/web/src/components/reauth-modal.tsx` | Paylaşılan `reauth-modal.tsx` "Onayla"/"Reddet" aksiyonları için tekrar kullanılacak. |

## Files to Change
| File | Action | Why |
|---|---|---|
| `apps/backend/prisma/schema.prisma` | UPDATE | `CopilotDraft` modeli + `CopilotDraftStatus` enum ekle (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`). |
| `apps/backend/prisma/migrations/{ts}_ahk013_copilot_draft_persistence/migration.sql` | CREATE | Yeni tablo/enum için PostgreSQL migration. |
| `packages/shared-types/src/schemas.ts` | UPDATE | `decideCapaSchema`'yı import edip yeniden kullan (yeni schema eklemeye gerek yok); gerekirse `listCopilotDraftsQuerySchema` gibi küçük bir query şeması eklenebilir. |
| `apps/backend/src/copilot/copilot.service.ts` | UPDATE | `createDraft()` sonucu `status === "DRAFT"` ise `CopilotDraft` satırı oluştur; `list()`, `submitForApproval()`, `decide()` metodları eklenir (CAPA'nın birebir aynısı, entity=`"copilot-draft"`). |
| `apps/backend/src/copilot/copilot.controller.ts` | UPDATE | `GET /copilot/drafts`, `PATCH /copilot/drafts/:id/submit`, `PATCH /copilot/drafts/:id/{approve,reject}` endpoint'leri eklenir. |
| `apps/backend/src/copilot/copilot.service.spec.ts` (new) | CREATE | Unit testler: draft persist, submit→PENDING_APPROVAL, decide→APPROVED/REJECTED, SoD reddi, reauth zorunluluğu. |
| `apps/backend/test/copilot.e2e-spec.ts` (new) | CREATE | Fresh-DB e2e: draft oluştur→listele→onaya gönder→yanlış şifreyle 401→doğru şifreyle onayla→status APPROVED. |
| `apps/web/src/pages/copilot.tsx` | UPDATE | Draft geçmişi/listesi + durum gösterimi; "Onaya Gönder" butonu; `reauth-modal.tsx` ile "Onayla"/"Reddet". |

## Tasks

### Task 1: Prisma şema + migration
- **Action**: `schema.prisma`'ya `CopilotDraft` modelini ekle: `id, tenantId, requestedById, prompt, engine, status (CopilotDraftStatus @default(DRAFT)), payload Json, createdAt, updatedAt`. `requestedBy User @relation(...)`, `@@index([tenantId, status])`. `npx prisma migrate dev --name ahk013_copilot_draft_persistence` ile migration üret, dev Postgres'e (5433) uygula.
- **Mirror**: `Capa` modeli alan/index deseni.
- **Validate**: `npx prisma validate`, migration dev DB'ye temiz uygulanır.

### Task 2: `CopilotService` — persist + submit + decide (TDD)
- **Action**: Önce `copilot.service.spec.ts`'e başarısız testler yaz (persist, submit, decide/SoD/reauth), sonra `createDraft()`'ı DB'ye yazacak şekilde güncelle; `submitForApproval(tenantId, userId, id)` ve `decide(tenantId, id, decidedById, decidedRole, action, note, password)` metodlarını `CapaService`'in birebir aynısı olarak ekle (`entity: "copilot-draft"`, `requiredRoles: ["ADMIN","PLANNER"]`).
- **Mirror**: `capa.service.ts:78-128`.
- **Validate**: `cd apps/backend && npx jest copilot.service.spec --silent`.

### Task 3: `CopilotController` — yeni endpoint'ler
- **Action**: `GET /copilot/drafts` (mevcut `RequirePage("copilot")` altında, `ApprovalsService.list()` deseniyle role-scoped), `PATCH /copilot/drafts/:id/submit`, `PATCH /copilot/drafts/:id/approve|reject` (`decideCapaSchema` body ile).
- **Mirror**: `capa.controller.ts` endpoint şekli.
- **Validate**: `npx tsc --noEmit` (backend), yeni e2e testleri.

### Task 4: Fresh-DB e2e
- **Action**: `copilot.e2e-spec.ts` yaz: draft→submit→yanlış şifre 401→doğru şifre→APPROVED; ayrıca kendi draft'ını onaylamaya çalışma → 403 (SoD).
- **Mirror**: `test/downtime.e2e-spec.ts` veya `non-conformance-deviation.e2e-spec.ts` yapısı.
- **Validate**: `node scripts/run-e2e.mjs --filter copilot` (varsa filtre desteği) veya tam paket.

### Task 5: Frontend — `copilot.tsx`
- **Action**: Draft listesini `GET /copilot/drafts` ile çek, statüye göre rozet göster; `DRAFT` statüsündeki kayıt için "Onaya Gönder" butonu; `PENDING_APPROVAL` için (kullanıcı kendi draft'ı değilse) `reauth-modal.tsx` ile "Onayla"/"Reddet".
- **Mirror**: `non-conformances.tsx` deviation UI + `reauth-modal.tsx` kullanım şekli.
- **Validate**: `cd apps/web && npx vitest run copilot`.

## Validation
```bash
cd apps/backend && npx tsc --noEmit && npx jest --silent
cd apps/web && npx tsc --noEmit && npx vitest run
node scripts/run-e2e.mjs   # tam paket, regresyon kontrolü
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| `payload: Json` alanının şekli ileride (Milestone 3'te execution) değişebilir, migration gerektirebilir | Orta | `Json` tipi seçildi (esnek), Milestone 3 planı şema genişletmesini kendi işi olarak ele alacak. |
| SoD kontrolü, tek-PLANNER'lı tenant'ta onayı kilitleyebilir (Milestone 1'de dokümante edildi) | Orta | Bu milestone'da davranış değiştirilmeyecek — mevcut `ApprovalsService` davranışı (ADMIN ayrıcalığı hariç SoD zorunlu) aynen miras alınır; sorun gerçek bir tenant'ta gözlemlenirse ayrı bir karar konusu olur. |
| `list()` endpoint'i yanlış role-scoping ile başka tenant'ın/rolün draft'larını sızdırabilir | Düşük | `ApprovalsService.list()`'in `tenantId` + role filtre desenini birebir kopyala, testte çapraz-tenant/çapraz-rol sızıntı senaryosu ekle. |

## Acceptance
- [ ] `CopilotDraft` tablosu var, migration dev DB'de temiz uygulanıyor
- [ ] `createDraft()` artık DB'ye yazıyor; `submitForApproval()`/`decide()` CAPA deseniyle birebir
- [ ] SoD ve reauth testleri geçiyor (kendi draft'ını onaylayamama, yanlış şifre 401)
- [ ] Frontend draft geçmişi + onay akışını gösteriyor
- [ ] Backend+web typecheck/unit temiz, ilgili e2e + tam e2e paketi regresyonsuz
- [ ] Gerçek `Material` kaydı bu milestone'da hâlâ oluşturulmuyor (execution Milestone 3'te)

# Plan: Elektronik İş Talimatı Editörü — PLANNER Editör (Backend+UI)

**Source PRD**: `.claude/prds/mes-operator-hmi-002-work-instruction-editor.prd.md`
**Selected Milestone**: 2 — PLANNER editör (backend+UI)
**Complexity**: Large

## Summary
Bu milestone, PLANNER'ın `recipes.tsx`'te her `RecipeStep` için tam bir WYSIWYG (gömülü resimli) iş talimatı editörü kullanabilmesini, içeriğin backend'de `sanitize-html` ile temizlenip `RecipeStep.instructionHtml`'e kaydedilmesini ve WO oluşturulunca `WorkOrderOperation.instructionHtml`'e immutable snapshot'lanmasını kapsar. Planlamayı grounding sırasında **kritik bir bulgu** ortaya çıktı ve kullanıcı onayıyla kapsama alındı: `RecipesService.update()` bugün her güncellemede TÜM `RecipeStep` satırlarını silip yeniden oluşturuyor (`recipes.service.ts:86-114`) — bu, Milestone 1'in "resmi `RecipeStep.id`'ye bağla" kararını kırar (id her düzenlemede değişir, resimler yetim kalır). Bu milestone bu davranışı **id'ye göre upsert**'e çevirir. HMI'da gösterim bu milestone'un kapsamında DEĞİL — o Milestone 3'te.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Belge yükleme entegrasyonu | `apps/backend/src/documents/documents.controller.ts:39-55`, `apps/web/src/components/documents-panel.tsx` | `POST /documents` (multipart, `entityType`+`entityId` query) — mevcut varlıklar için zaten kullanılıyor; sadece yeni `entityType: "recipe-step"` eklenecek. |
| Entity tipi genişletme | `packages/shared-types/src/enums.ts:105` | `DocumentEntityTypeSchema`'ya bir string eklemek. |
| Immutable snapshot (Recipe→WO) | `apps/backend/src/work-orders/work-orders.service.ts:396-409` | `standardMinutes` gibi düz alan kopyalama — `instructionHtml` aynı yere eklenecek. |
| Migration adlandırma | `apps/backend/prisma/migrations/20260810090000_ahk012_deviation_approval` | `{ts}_mes_operator_hmi_002_work_instruction` deseni. |
| **YOK — yeni desen** | `apps/backend/src/recipes/recipes.service.ts:86-114` (`update()`), aynı şekilde `apps/backend/src/mrp/bom.service.ts:131-` (`BomHeader.update()`) | Projede hiçbir yerde id-korumalı upsert deseni yok — hem Recipe hem BOM aynı delete+recreate'i kullanıyor. Bu plan yeni bir desen kurar (sadece `RecipeStep` için; `BomLine` bu milestone'un kapsamı dışında, aynı sorunu taşımaya devam eder — ayrı bir backlog maddesi olabilir). |

## Files to Change
| File | Action | Why |
|---|---|---|
| `packages/shared-types/src/enums.ts` | UPDATE | `DocumentEntityTypeSchema`'ya `"recipe-step"` ekle. |
| `packages/shared-types/src/schemas.ts` | UPDATE | `recipeStepInputSchema`'ya `id: idSchema.optional()` (upsert eşleştirme için) ve `instructionHtml: z.string().optional()` ekle. |
| `apps/backend/prisma/schema.prisma` | UPDATE | `RecipeStep.instructionHtml String? @db.Text`, `WorkOrderOperation.instructionHtml String? @db.Text` ekle. |
| `apps/backend/prisma/migrations/{ts}_mes_operator_hmi_002_work_instruction/migration.sql` | CREATE | Yeni migration. |
| `apps/backend/package.json` | UPDATE | `sanitize-html` + `@types/sanitize-html` bağımlılığı ekle. |
| `apps/backend/src/recipes/recipe-instruction-sanitizer.ts` | CREATE | Milestone 1'in allowlist kararını uygulayan tek bir `sanitizeInstructionHtml(html: string): string` fonksiyonu. |
| `apps/backend/src/recipes/recipes.service.ts` | UPDATE | `create()`/`update()` `instructionHtml`'i sanitize edip kaydeder; `update()` delete+recreate yerine **id'ye göre upsert** (var olan id → update, id'siz → create, gelen listede olmayan id → delete). |
| `apps/backend/src/recipes/recipes.service.spec.ts` | UPDATE | Sanitization testleri (script/style/on* temizlenir, izinli etiketler kalır) + upsert testleri (var olan step id korunur, kaldırılan silinir, yeni eklenen id alır). |
| `apps/backend/src/work-orders/work-orders.service.ts` | UPDATE | `createWithRoute` snapshot kopyalamasına (satır ~401 civarı) `instructionHtml: step.instructionHtml` ekle. |
| `apps/backend/src/work-orders/work-orders.service.spec.ts` | UPDATE | Snapshot testine `instructionHtml` kopyalandığını doğrulayan bir vaka ekle. |
| `apps/backend/test/recipes.e2e-spec.ts` (varsa) veya ilgili fresh-DB e2e | UPDATE/CREATE | Uçtan uca: resim yükle → recipe kaydet → recipe'yi düzenle (başka bir alanı değiştir) → resmin hâlâ eriştiği (aynı `RecipeStep.id`) doğrulanır; XSS payload'lı bir talimatın sanitize edilip kaydedildiği doğrulanır. |
| `apps/web/package.json` | UPDATE | `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-image` (veya eşdeğeri) ekle — projede hiç WYSIWYG kütüphanesi yok, ilk kez ekleniyor. |
| `apps/web/src/components/instruction-editor.tsx` | CREATE | Paylaşılan Tiptap tabanlı editör bileşeni: metin biçimlendirme + resim ekleme (mevcut `apiUpload()` ile `POST /documents?entityType=recipe-step&entityId={stepId}`), custom image node `data-document-id` üretir/render eder (render anında `GET /documents/:id/url` ile taze URL çözer — `file-preview.tsx`'teki "taze URL" ilkesiyle tutarlı). |
| `apps/web/src/pages/recipes.tsx` | UPDATE | Her `RecipeStepRow`'a "İş Talimatı" bölümü (yeni `InstructionEditor` bileşeni) eklenir. **UX kısıtı**: resim ekleme, adım en az bir kez kaydedilip bir `id` aldıktan sonra mümkündür (belge yükleme mevcut varlıklar için zaten bu şekilde çalışıyor, ör. `documents-panel.tsx` sadece var olan entity'lerde gösteriliyor). |
| `apps/web/src/pages/recipes.test.tsx` (varsa) | UPDATE | Editörün render olduğunu ve `apiPatch`'e `instructionHtml` gönderdiğini doğrulayan test. |

## Tasks

### Task 1: Şema + migration + bağımlılıklar
- **Action**: `enums.ts`, `schemas.ts`, `schema.prisma` güncellemelerini yap; `npx prisma migrate dev --name mes_operator_hmi_002_work_instruction`; backend'e `sanitize-html`, frontend'e `@tiptap/*` ekle (`pnpm add`).
- **Mirror**: Task tablosundaki dosya değişiklikleri.
- **Validate**: `npx prisma validate`, `pnpm --filter @ahkmes/shared-types build`.

### Task 2: Sanitizer (TDD)
- **Action**: Önce `recipe-instruction-sanitizer.spec.ts`'e başarısız testler (script/style/on*/href temizlenir; `p,strong,em,ul,ol,li,h1-h3,img[data-document-id,alt],table*` korunur), sonra `recipe-instruction-sanitizer.ts`'i `sanitize-html` ile Milestone 1'in allowlist kararına göre yaz.
- **Mirror**: Yok (yeni dosya) — allowlist doğrudan `docs/mes-operator-hmi-002-work-instruction-decisions.md`'den.
- **Validate**: `npx jest recipe-instruction-sanitizer --silent`.

### Task 3: `RecipesService` — sanitize + upsert (TDD)
- **Action**: Önce `recipes.service.spec.ts`'e başarısız testler yaz (upsert: var olan id korunur/güncellenir, id'siz yeni step id alır, eksik id silinir; sanitize: kaydedilen `instructionHtml` temizlenmiş halde döner), sonra `create()`/`update()`'i güncelle. `update()`'te: gelen `dto.steps` içindeki `id`'li olanlar `tx.recipeStep.update()`, id'siz olanlar `tx.recipeStep.create()`, veritabanında olup gelen listede olmayanlar `tx.recipeStep.deleteMany()`.
- **Mirror**: Genel transaction/service şekli mevcut `update()`'ten korunur — sadece steps kısmı değişir.
- **Validate**: `cd apps/backend && npx jest recipes.service --silent`.

### Task 4: WorkOrder snapshot
- **Action**: `work-orders.service.ts`'teki mevcut `standardMinutes` snapshot satırının yanına `instructionHtml: step.instructionHtml` ekle; ilgili unit teste bir vaka ekle.
- **Mirror**: `work-orders.service.ts:401` birebir yanına.
- **Validate**: `npx jest work-orders.service --silent`.

### Task 5: Frontend — `InstructionEditor` bileşeni
- **Action**: `@tiptap/react` ile paylaşılan bir editör bileşeni yaz: temel biçimlendirme toolbar'ı (kalın/italik/liste/başlık) + resim ekle butonu (`apiUpload()` ile `entityType=recipe-step`). Custom image node, kaydedilen HTML'de `<img data-document-id="{id}">` üretir; render sırasında `apiGet(/documents/{id}/url)` ile taze URL'e çözer (React state/effect ile, `file-preview.tsx`'teki yaklaşıma benzer).
- **Mirror**: `file-preview.tsx` (taze URL ilkesi), `documents-panel.tsx` (`apiUpload` kullanımı).
- **Validate**: `cd apps/web && npx tsc --noEmit`.

### Task 6: Frontend — `recipes.tsx` entegrasyonu
- **Action**: Her step satırına `InstructionEditor` ekle; kaydedilen içerik `PATCH /recipes/:id` gövdesindeki ilgili step'in `instructionHtml` alanına gider. Yeni (henüz kaydedilmemiş) adımlarda resim ekleme butonu devre dışı, "önce adımı kaydedin" ipucu gösterilir.
- **Mirror**: `recipes.tsx`'in mevcut step düzenleme akışı.
- **Validate**: `cd apps/web && npx vitest run recipes`.

### Task 7: Fresh-DB e2e
- **Action**: Recipe'ye resimli talimat ekle → recipe'yi (başka bir alanla) güncelle → aynı `RecipeStep.id`'nin ve resmin hâlâ erişilebilir olduğunu doğrula; XSS payload'lı (`<script>`, `onerror=`) bir talimatın temizlenmiş döndüğünü doğrula; WO oluşturulunca `WorkOrderOperation.instructionHtml`'in snapshot'landığını doğrula.
- **Mirror**: `test/scheduling.e2e-spec.ts` veya `test/non-conformance-deviation.e2e-spec.ts` yapısı.
- **Validate**: `node scripts/run-e2e.mjs` (tam paket, regresyon).

## Validation
```bash
cd apps/backend && npx tsc --noEmit && npx jest --silent
cd apps/web && npx tsc --noEmit && npx vitest run
node scripts/run-e2e.mjs
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| `update()`'i upsert'e çevirmek mevcut davranışı değiştirir, gizli bir varsayıma dayanan başka kod/test kırılabilir | Orta | Task 3'te TDD ile önce mevcut testler + yeni upsert testleri yazılıp geçirilecek; tam backend unit + e2e paketi Task 7'de regresyon için çalıştırılacak. |
| `sanitize-html` allowlist'i pratikte editörün ürettiği HTML'le tam örtüşmeyebilir (ör. Tiptap belirli attribute'lar ekleyebilir) | Orta | Task 2'nin testleri, Tiptap'ın gerçek çıktısına (Task 5'ten sonra) karşı tekrar doğrulanacak; uyumsuzluk çıkarsa allowlist genişletilir, asla `<script>`/`on*`/`style` açılmaz. |
| BomLine aynı delete+recreate sorununu taşımaya devam ediyor (bu milestone'da düzeltilmiyor) | Düşük (bu milestone için) | Bilinçli kapsam dışı — BOM'un kendi resim/id-kararlılık ihtiyacı yok şu an; ayrı bir backlog maddesi olarak not düşülür, bu plana dahil edilmez. |

## Acceptance
- [ ] `RecipeStep`/`WorkOrderOperation`'a `instructionHtml`, migration temiz uygulanıyor
- [ ] `RecipesService.update()` artık id-korumalı upsert yapıyor (silme/güncelleme/oluşturma testleri geçiyor)
- [ ] Sanitizer, XSS payload'larını temizliyor, izinli içeriği koruyor
- [ ] `recipes.tsx`'te WYSIWYG editör çalışıyor, resim ekleme kaydedilmiş adımlarda mümkün
- [ ] WO oluşturulunca talimat immutable snapshot'lanıyor
- [ ] Backend+web typecheck/unit temiz, yeni e2e + tam e2e paketi regresyonsuz
- [ ] HMI'da gösterim bu milestone'da YAPILMADI (Milestone 3'e bırakıldı)

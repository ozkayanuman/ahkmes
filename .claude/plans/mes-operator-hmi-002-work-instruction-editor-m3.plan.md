# Plan: Elektronik İş Talimatı Editörü — HMI Görüntüleme

**Source PRD**: `.claude/prds/mes-operator-hmi-002-work-instruction-editor.prd.md`
**Selected Milestone**: 3 — HMI görüntüleme
**Complexity**: Small

## Summary
Milestone 2, talimatı `WorkOrderOperation.instructionHtml`'e immutable snapshot olarak zaten kopyalıyor — bu milestone sadece bu değeri `/hmi/operations` detay yanıtına ekleyip (`HmiService.queueRow()` bugün alanı elle whitelist'lediği için hiç döndürmüyor) `InstructionEditor`'ı `readOnly` modda `hmi-operations.tsx`'e ekliyor. Yeni backend mantığı yok; sadece bir eksik alan aktarımı + salt-okunur frontend render.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| HMI response şekillendirme | `apps/backend/src/hmi/hmi.service.ts:88-112` (`queueRow()`) | Dönüş nesnesi Prisma'nın ham `include` sonucundan elle seçilen alanlarla kurulur — `instructionHtml` zaten `operationInclude`'un scalar default'uyla veride var, sadece dönüş nesnesine eklenmesi yeterli. |
| Salt-okunur editör kullanımı | `apps/web/src/components/instruction-editor.tsx` (`readOnly` prop, Task 5'te eklendi) | `editable: !readOnly` zaten destekleniyor; `onUploadImage` verilmezse toolbar/resim butonu hiç render edilmiyor. |
| Detay ekranına yeni bölüm ekleme | `apps/web/src/pages/hmi-operations.tsx:83-85` (`OperationDetail` içindeki `Card` dizisi) | Checklist/tooling/kaynak kartlarının hemen yanına aynı `Card` deseniyle yeni bir "İş Talimatı" kartı eklenir. |
| Unit test yapısı | `apps/backend/src/hmi/hmi.service.spec.ts` | Küçük, odaklı `describe("HmiService")` bloğu — yeni bir `it()` yeterli. |

## Files to Change
| File | Action | Why |
|---|---|---|
| `apps/backend/src/hmi/hmi.service.ts` | UPDATE | `queueRow()`'un dönüş nesnesine `instructionHtml: operation.instructionHtml` ekle. |
| `apps/backend/src/hmi/hmi.service.spec.ts` | UPDATE | `instructionHtml`'in queue/detail yanıtında döndüğünü doğrulayan bir test. |
| `apps/web/src/pages/hmi-operations.tsx` | UPDATE | `Operation` tipine `instructionHtml: string \| null` ekle; `OperationDetail`'e talimat varsa gösteren yeni bir `Card` (readOnly `InstructionEditor`) ekle — talimat yoksa kart hiç render edilmez. |
| `apps/backend/test/work-instruction.e2e-spec.ts` | UPDATE | Mevcut "WorkOrder oluşturulunca... snapshot" testine, `/hmi/operations/:id` yanıtının da `instructionHtml`'i döndürdüğünü doğrulayan bir assertion ekle (aynı test içinde, yeni bir test dosyası açmaya gerek yok). |

## Tasks

### Task 1: Backend — `instructionHtml`'i HMI yanıtına ekle (TDD)
- **Action**: Önce `hmi.service.spec.ts`'e `queueRow`'un `instructionHtml`'i içerdiğini doğrulayan başarısız bir test yaz, sonra `hmi.service.ts:88-112`'deki dönüş nesnesine tek satır ekle.
- **Mirror**: Aynı fonksiyondaki `completedAt`/`ncProgram` gibi diğer düz alan aktarımları.
- **Validate**: `cd apps/backend && npx jest hmi.service --silent`.

### Task 2: Frontend — salt-okunur talimat kartı
- **Action**: `Operation` tipine `instructionHtml` ekle; `OperationDetail` içine, checklist kartından sonra, `detail.instructionHtml` doluysa `<Card><h3>İş Talimatı</h3><InstructionEditor content={detail.instructionHtml} onChange={() => {}} readOnly /></Card>` ekle.
- **Mirror**: `hmi-operations.tsx`'teki mevcut `Card` blokları.
- **Validate**: `cd apps/web && npx tsc --noEmit`.

### Task 3: e2e doğrulama
- **Action**: `work-instruction.e2e-spec.ts`'teki son teste (`WorkOrder oluşturulunca... snapshot`), `GET /hmi/operations/:id` çağrısı ekleyip `instructionHtml`'in orada da göründüğünü doğrula.
- **Mirror**: Aynı dosyadaki mevcut istek deseni.
- **Validate**: `node scripts/run-e2e.mjs work-instruction.e2e-spec`, sonra tam paket `node scripts/run-e2e.mjs`.

## Validation
```bash
cd apps/backend && npx tsc --noEmit && npx jest --silent
cd apps/web && npx tsc --noEmit && npx vitest run
node scripts/run-e2e.mjs
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| `queueRow()` hem liste (`list()`) hem detay (`detail()`) tarafından paylaşıldığı için talimat, operasyon kuyruğu listesinde de (gereksiz büyük payload) dönebilir | Düşük | Kabul edilebilir — talimat metni tipik olarak küçük/orta boyutlu; ayrı bir "liste vs detay" projeksiyonu bu küçük milestone'un kapsamı dışında, gerekirse ayrı bir performans işi olarak ele alınır. |

## Acceptance
- [ ] `HmiService.queueRow()` `instructionHtml` döndürüyor, unit test geçiyor
- [ ] `/hmi/operations`'da talimat varsa salt-okunur kart gösteriliyor, yoksa kart hiç render edilmiyor
- [ ] Backend+web typecheck/unit temiz, e2e (yeni assertion + tam paket) regresyonsuz

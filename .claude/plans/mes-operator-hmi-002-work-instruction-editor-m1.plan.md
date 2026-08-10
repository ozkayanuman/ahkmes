# Plan: Elektronik İş Talimatı Editörü — Mimari Kararlar

**Source PRD**: `.claude/prds/mes-operator-hmi-002-work-instruction-editor.prd.md`
**Selected Milestone**: 1 — Mimari kararlar
**Complexity**: Small

## Summary
Bu milestone kod yazmaz — PRD'nin üç açık sorusunu (resim depolama, XSS güvenliği, snapshot) kodlamaya başlamadan önce kapatan bir karar dokümanı üretir. Kod tabanı incelendi: mevcut `DocumentsService`/`MinioService` (entityType/entityId keyed, zaten `image/png`/`image/jpeg` MIME allowlist'inde) doğrudan yeniden kullanılabilir; hiçbir HTML sanitization kütüphanesi projede yok (yeni bağımlılık gerekir); AHK-004'ün `RecipeStep→WorkOrderOperation` immutable snapshot deseni (`standardMinutes` gibi düz alan kopyalama) doğrudan uygulanabilir.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Belge depolama (entityType/entityId keyed) | `apps/backend/src/documents/documents.service.ts:7-67` | `DocumentsService.upload()` — `ALLOWED_MIME_TYPES` allowlist (`image/png`/`image/jpeg` zaten var), `storageKey` `{tenantId}/{entityType}/{entityId}/{uuid}-{fileName}` şeklinde, MinIO'ya yazar. |
| Belge erişimi (signed URL, süreli) | `apps/backend/src/documents/documents.controller.ts:57-64` (`GET /documents/:id/url`) | Ham dosya URL'i asla kalıcı saklanmaz — her görüntülemede süreli signed URL istenir. |
| Entity tipi genişletme | `packages/shared-types/src/enums.ts:105-106` (`DocumentEntityTypeSchema`) | Yeni bir entity tipi eklemek `z.enum([...])` listesine bir string eklemek kadar basit — `part`\|`work-order`\|`calibration`\|`lot` deseni izlenir. |
| Immutable snapshot (Recipe→WorkOrderOperation) | `apps/backend/src/work-orders/work-orders.service.ts:378-409` | `standardMinutes` gibi düz alanlar WO oluşturulurken doğrudan kopyalanır (versiyonsuz); `ncProgramId` gibi ayrıca revize edilen varlıklar zengin bir snapshot (version/checksum) alır — talimat metni `NcProgram` gibi ayrı revize edilmediği için `standardMinutes` deseni (düz kopya) uygundur. |
| Önizleme/render seçimi | `apps/web/src/components/file-preview.tsx:15-45` | Dosya kategorisine göre bileşen seçimi (`img`/`iframe`/3D viewer) — HMI'da render edilecek zengin talimat için benzer bir "güvenli render" bileşeni öngörülür. |

## Files to Change
| File | Action | Why |
|---|---|---|
| `docs/mes-operator-hmi-002-work-instruction-decisions.md` | CREATE | Üç kararı (resim depolama, XSS/sanitization, snapshot) `docs/ahk-013-copilot-gateway-decisions.md` ile aynı "karar kaydı" formatında belgeler. |
| `.claude/prds/mes-operator-hmi-002-work-instruction-editor.prd.md` | UPDATE | Üç açık soru işaretlenir; Milestone 1 satırı `complete` olur. |

## Tasks

### Task 1: Karar dokümanını yaz
- **Action**: `docs/mes-operator-hmi-002-work-instruction-decisions.md` oluştur. İçerik:
  - **Resim depolama kararı**: Yeni bir mekanizma icat edilmez — mevcut `DocumentsService`/MinIO yeniden kullanılır. `DocumentEntityTypeSchema`'ya `"recipe-step"` eklenir. Editördeki her gömülü resim, `entityType: "recipe-step", entityId: <RecipeStep.id>` ile ayrı bir `Document` satırı olarak yüklenir (mevcut `POST /documents` akışı, zaten `image/png`/`image/jpeg` kabul ediyor). **Kritik alt-karar**: WYSIWYG içeriğinde ham/kalıcı bir `<img src>` (signed URL) SAKLANMAZ — signed URL'ler süreli olduğu için içerikte bozulur. Bunun yerine içerik `<img data-document-id="{id}">` gibi stabil bir referans saklar; frontend render anında her `data-document-id`'yi `GET /documents/:id/url` ile taze bir signed URL'e çözer (`file-preview.tsx`'in zaten yaptığı "her görüntülemede taze URL iste" ilkesiyle tutarlı).
  - **XSS/sanitization kararı**: Projede hiçbir HTML sanitization kütüphanesi yok (`grep` ile doğrulandı) — yeni bir bağımlılık (öneri: `sanitize-html`, Node için olgun, allowlist-tabanlı) backend'e eklenir. Sanitization **yazma anında** (`RecipeStep.instructionHtml` kaydedilirken) sunucu tarafında uygulanır — istemci tarafı sanitization'a asla güvenilmez. Dar bir allowlist: `p, br, strong, em, u, ul, ol, li, h1, h2, h3, img[data-document-id], table, tr, td, th`. `<a>`, `<script>`, `style` attribute'u, inline event handler (`on*`) YASAK. Bu, PRD'nin "WYSIWYG çıktısının HMI'da render edilmesi XSS riski taşır" riskine doğrudan mitigasyondur.
  - **Snapshot kararı**: `standardMinutes` deseniyle tutarlı olması için talimat, WO oluşturulurken `RecipeStep.instructionHtml` → `WorkOrderOperation.instructionHtml`'e düz (versiyonsuz) immutable kopya olarak snapshot'lanır — Recipe daha sonra değişse bile açık/geçmiş iş emirleri oluşturuldukları andaki talimatı görmeye devam eder. `NcProgram` gibi ayrı bir revizyon zinciri kurulmaz (PRD'nin kapsam dışı bıraktığı "talimat versiyonlama/onay akışı" ile tutarlı).
- **Mirror**: `docs/ahk-013-copilot-gateway-decisions.md` format/yapı.
- **Validate**: Dosya var, üç karar da net; `grep -l "data-document-id" docs/mes-operator-hmi-002-work-instruction-decisions.md` eşleşir.

### Task 2: PRD'yi güncelle
- **Action**: `Open Questions` bölümündeki üç maddeyi işaretle (`- [x]`) ve karara referans ekle; `Delivery Milestones` tablosunda satır 1'i `complete` yap, `Plan` sütununu bu plan dosyasına bağla.
- **Mirror**: PRD şablonunun checkbox/tablo formatı.
- **Validate**: PRD'de `- [x]` üç kez geçer; milestone 1 satırı `complete`.

## Validation
```bash
# Sadece dokümantasyon değişikliği — kod/derleme/test etkilenmiyor.
grep -c "^- \[x\]" .claude/prds/mes-operator-hmi-002-work-instruction-editor.prd.md   # beklenen: 3
test -f docs/mes-operator-hmi-002-work-instruction-decisions.md && echo OK
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| `sanitize-html` allowlist'i çok dar/geniş seçilirse Milestone 2'de editör deneyimini kısıtlar veya güvenlik açığı bırakır | Orta | Milestone 2 planı, editör kütüphanesi seçimiyle birlikte allowlist'i somut örneklerle (test senaryolarıyla) doğrulayacak — bu milestone sadece ilkeyi/yaklaşımı belirler, nihai liste Milestone 2'de test edilerek kesinleşir. |
| `data-document-id` çözümleme yaklaşımı, seçilecek WYSIWYG kütüphanesinin (Milestone 2'de seçilecek) custom node/attribute desteğiyle uyumsuz çıkabilir | Düşük | Milestone 2 planı, kütüphane seçimini bu kısıtla (stabil referans saklama, render-time resolve) birlikte değerlendirecek. |

## Acceptance
- [ ] `docs/mes-operator-hmi-002-work-instruction-decisions.md` oluşturuldu, üç karar net
- [ ] PRD'nin açık soruları kapatıldı, Milestone 1 satırı `complete`
- [ ] Hiçbir kod/şema değişikliği yapılmadı (bu milestone kasıtlı olarak kod içermiyor)

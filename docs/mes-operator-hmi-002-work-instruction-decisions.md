# MES-OPERATOR-HMI-002 — Elektronik İş Talimatı Editörü: Karar Kaydı

Bu doküman, `.claude/prds/mes-operator-hmi-002-work-instruction-editor.prd.md` PRD'sinin Milestone 1'inde ("Mimari kararlar") alınan mimari kararları kayıt altına alır. Format `docs/ahk-013-copilot-gateway-decisions.md`'nin "karar kaydı" desenini izler.

## 1. Resim depolama kararı

**Karar**: Yeni bir dosya depolama mekanizması icat edilmiyor — mevcut `DocumentsService`/`MinioService` (`apps/backend/src/documents/`) yeniden kullanılacak. `DocumentEntityTypeSchema`'ya (`packages/shared-types/src/enums.ts:105`) yeni bir değer, `"recipe-step"`, eklenecek. Editördeki her gömülü resim, `entityType: "recipe-step", entityId: <RecipeStep.id>` ile ayrı bir `Document` satırı olarak `POST /documents` üzerinden yüklenecek — mevcut `ALLOWED_MIME_TYPES` zaten `image/png`/`image/jpeg` kabul ediyor, değişiklik gerekmiyor.

**Kritik alt-karar**: WYSIWYG içeriğinde ham/kalıcı bir `<img src="{signedUrl}">` **saklanmayacak** — `GET /documents/:id/url` süreli (time-limited) signed URL döndürüyor, kalıcı içerikte saklanırsa bir süre sonra bozulur. Bunun yerine kaydedilen HTML, stabil bir referans taşıyacak: `<img data-document-id="{id}">`. Frontend, içeriği render ederken her `data-document-id`'yi `GET /documents/:id/url` ile taze bir signed URL'e çözecek — bu, `file-preview.tsx`'in zaten uyguladığı "her görüntülemede taze URL iste" ilkesiyle birebir tutarlı.

**Gerekçe**: Projede zaten olgun, tenant-scoped, MIME-allowlist'li bir belge altyapısı var; yeni bir depolama yüzeyi açmak gereksiz risk ve bakım yükü ekler.

## 2. XSS / HTML sanitization kararı

**Karar**: Projede hâlâ hiçbir HTML sanitization kütüphanesi yok (kod tabanında doğrulandı). Backend'e yeni bir bağımlılık eklenecek — öneri: `sanitize-html` (Node için olgun, allowlist-tabanlı). Sanitization **yazma anında** uygulanacak: `RecipeStep.instructionHtml` kaydedilirken (create/update) sunucu tarafında sıkı bir allowlist'ten geçirilecek. İstemci tarafı (editör kütüphanesinin kendi) sanitization'ına asla güvenilmeyecek — güvenlik sınırı her zaman backend'de.

**Öngörülen allowlist (Milestone 2'de somut testlerle kesinleşecek)**:
- İzinli etiketler: `p, br, strong, em, u, ul, ol, li, h1, h2, h3, img, table, thead, tbody, tr, td, th`
- İzinli attribute: sadece `img[data-document-id]`, `img[alt]`
- **Yasak**: `<a>` (href injection riski, bu MVP'de link ihtiyacı yok), `<script>`, `<style>`, `style` attribute'u (CSS injection), her türlü `on*` inline event handler, `src` attribute'u doğrudan (sadece `data-document-id` üzerinden çözülür — ham `src` her zaman `sanitize-html` tarafından soyulur).

**Gerekçe**: PRD'nin en yüksek olasılık+etki riski buydu ("WYSIWYG çıktısının HMI'da render edilmesi XSS riski taşır"). Yazma-anında-sanitize + dar allowlist + `src` attribute'unun tamamen yasaklanıp yalnızca kontrollü `data-document-id` üzerinden resim çözümü, saldırı yüzeyini mümkün olan en aza indirir.

## 3. Snapshot kararı

**Karar**: Talimat, WO oluşturulurken `RecipeStep.instructionHtml` → `WorkOrderOperation.instructionHtml`'e **düz (versiyonsuz) immutable kopya** olarak snapshot'lanacak — `apps/backend/src/work-orders/work-orders.service.ts:401`'deki `standardMinutes` kopyalama deseniyle birebir aynı yaklaşım. `NcProgram`'ın aldığı zengin (version/checksum) snapshot deseni **uygulanmayacak** çünkü talimat, `NcProgram` gibi ayrı revize edilen bir varlık değil.

**Sonuç**: Recipe'in talimatı daha sonra değişse bile, açık veya geçmiş iş emirleri oluşturuldukları andaki talimatı görmeye devam eder — PLM-001/AHK-004'ün kurduğu "immutable snapshot" ilkesiyle tutarlı. Bu, PRD'nin bilinçli olarak kapsam dışı bıraktığı "talimat versiyonlama/onay akışı"ndan (Draft→Review→Approved→Published) ayrı ve daha basit bir mekanizmadır — ayrı bir revizyon zinciri kurulmuyor.

## İlgili PRD ve Plan

- PRD: `.claude/prds/mes-operator-hmi-002-work-instruction-editor.prd.md`
- Plan: `.claude/plans/mes-operator-hmi-002-work-instruction-editor-m1.plan.md`
- Referans desenler: `apps/backend/src/documents/documents.service.ts`, `apps/backend/src/documents/documents.controller.ts`, `apps/backend/src/work-orders/work-orders.service.ts`, `apps/web/src/components/file-preview.tsx`

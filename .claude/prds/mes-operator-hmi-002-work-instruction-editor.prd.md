# MES-OPERATOR-HMI-002 — Elektronik İş Talimatı Editörü

## Problem
PLANNER/FOREMAN rolündeki kullanıcılar, Route/RecipeStep operasyon adımları için zengin (metin+görsel) iş talimatı tanımlayamıyor — bugün sadece kısa düz metin alanları var (`recipes.service.ts` `RecipeStepInput`). OPERATÖR rolündeki kullanıcılar, `/hmi/operations` terminalinde operasyonu yürütürken hiçbir zengin talimat/görsel göremiyor. Bu, kurulum/işlem hatası riskini artırıyor ve talimatın kağıt/harici dokümanda yaşamasına yol açıyor. `MES-OPERATOR-HMI-001`'in ilk dilimi bunu bilinçli olarak kapsam dışı bırakmıştı.

## Evidence
- Assumption — needs validation via kullanıcı gözlemi/NCR verisi. PLAN.md'nin kendi backlog notundan (`MES-OPERATOR-HMI-002` kapsam dışı listesi) öteye somut dış kanıt yok.

## Users
- **Primary**: PLANNER/FOREMAN (talimat yazan/düzenleyen) ve OPERATÖR (HMI'da talimatı okuyan) — ikisi de aynı özelliğin farklı uçları.
- **Not for**: Kalite/PLM revizyon onay süreçlerine ihtiyaç duyan senaryolar (bu MVP'de talimat versiyonlama/onay akışı yok).

## Hypothesis
We believe **RecipeStep operasyonlarına zengin (WYSIWYG, gömülü resimli) iş talimatı eklenebilmesi ve bunun HMI'da gösterilmesi** will **kurulum/işlem hatalarını azaltacak** for **OPERATÖR kullanıcıları**.
We'll know we're right when **talimatlı operasyonlarda NCR/uygunsuzluk oranı, talimatsız operasyonlara kıyasla düşer** (ölçüm yöntemi TBD — uzun vadeli NCR verisi karşılaştırması gerekir).

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| Talimatlı operasyonlarda NCR/hata oranı azalması | TBD — needs validation via uzun vadeli NCR karşılaştırması | Zengin talimat eklenen `RecipeStep`'lere bağlı `WorkOrderOperation`'ların NCR oranı vs. eklenmeyenler |

## Scope
**MVP** — PLANNER'ın `RecipeStep` başına tam WYSIWYG (gömülü resim yükleme dahil) bir iş talimatı editörüyle içerik oluşturabilmesi; OPERATÖR'ün bunu `/hmi/operations`'da ilgili operasyonu yürütürken salt-okunur görebilmesi.

**Out of scope**
- Talimat versiyonlama/onay akışı — PLM_NC_PROGRAM'daki gibi Draft→Review→Approved→Published revizyon zinciri yok; talimat direkt kaydedilir. Bu MVP'de talimat, `WorkOrderOperation`'a immutable snapshot olarak da kopyalanmaz (canlı `RecipeStep`'e bağlı kalır) — snapshot kararı açık soru olarak aşağıda.
- Video/dosya eki (PDF/CAD) — sadece gömülü resim + zengin metin; ayrı dosya ekleri yok.
- Çoklu dil/çeviri — talimat tek dilde (mevcut sistem dili, TR) yazılır.

## Delivery Milestones
<!-- Business outcomes, not engineering tasks. /plan turns each into a plan. -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Mimari kararlar | Resim depolama mekanizması, HTML/XSS güvenlik yaklaşımı ve snapshot kararı netleşir; dokümante edilir | complete | `.claude/plans/mes-operator-hmi-002-work-instruction-editor-m1.plan.md` |
| 2 | PLANNER editör (backend+UI) | `recipes.tsx`'te RecipeStep başına WYSIWYG editör; içerik `RecipeStep`'e kaydedilir | complete | `.claude/plans/mes-operator-hmi-002-work-instruction-editor-m2.plan.md` |
| 3 | HMI görüntüleme | `/hmi/operations`'da ilgili operasyonun zengin talimatı salt-okunur gösterilir | complete | `.claude/plans/mes-operator-hmi-002-work-instruction-editor-m3.plan.md` |

## Open Questions
- [x] Gömülü resimler nereye/nasıl saklanacak — mevcut Document/MinIO altyapısı mı kullanılacak, yoksa ayrı bir mekanizma mı gerekir? → Mevcut `DocumentsService`/MinIO yeniden kullanılacak (`entityType: "recipe-step"`), içerikte kalıcı signed URL değil `data-document-id` referansı saklanacak. Bkz. `docs/mes-operator-hmi-002-work-instruction-decisions.md`.
- [x] WYSIWYG çıktısı (HTML) HMI'da render edilirken sanitization/izin verilen etiket listesi nasıl uygulanacak — güvenlik riski yüksek (XSS)? → Backend'e `sanitize-html` eklenecek, yazma anında dar bir allowlist uygulanacak (script/style/on*/href yasak). Bkz. `docs/mes-operator-hmi-002-work-instruction-decisions.md`.
- [x] Talimat, `WorkOrderOperation`'a AHK-004/PLM-001 deseninde olduğu gibi immutable snapshot olarak mı kopyalanmalı (Recipe değişse bile eski WO'lar eski talimatı görmeye devam eder) yoksa canlı `RecipeStep`'e mi bağlı kalsın? → `standardMinutes` deseniyle aynı düz immutable kopya. Bkz. `docs/mes-operator-hmi-002-work-instruction-decisions.md`.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| WYSIWYG HTML çıktısının HMI'da render edilmesi XSS riski taşır | Yüksek | Yüksek | Sunucu tarafında sıkı bir sanitization (izin verilen etiket/attribute allowlist) zorunlu; ham HTML asla doğrudan render edilmemeli. Milestone 1'de karara bağlanmalı. |
| Gömülü resim depolama, mevcut Document/MinIO deseninden sapıp yeni bir dosya yönetim yüzeyi yaratabilir | Orta | Orta | Milestone 1'de mevcut Document altyapısının yeniden kullanılabilirliği araştırılmalı, yeni mekanizma icat etmekten kaçınılmalı. |
| Talimatın snapshot'lanmaması, geçmiş iş emirlerinin talimatının geriye dönük değişmesine yol açabilir (AHK-004/PLM-001'in immutable snapshot ilkesinden sapma) | Orta | Orta | Milestone 1'de bu açık soru kapatılmalı; proje genelinde kurulmuş "immutable snapshot" ilkesiyle tutarlılık tercih edilmeli. |

---
*Status: MVP COMPLETE (2026-08-10) — all 3 milestones implemented and verified (backend/web unit + fresh-PostgreSQL e2e green, full e2e suite regression-free). Not yet committed.*

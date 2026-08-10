# AHK-013 — AI Command Gateway: Karar Kaydı

Bu doküman, `.claude/prds/ahk-013-copilot-mutation-gateway.prd.md` PRD'sinin Milestone 1'inde ("Sağlayıcı ve onay modeli kararı") alınan mimari kararları kayıt altına alır. Format `docs/erp-ownership-matrix.md`'nin "karar kaydı" desenini izler.

## 1. Onay yetkisi modeli kararı

**Karar**: material.create mutation'ı için onay akışı, mevcut genel amaçlı `ApprovalsService` (`apps/backend/src/approvals/approvals.service.ts`) üzerinden yürütülecek — `entity: "copilot-draft"` ile. CAPA (`capa.service.ts:78-128`, AHK-006) ve NCR deviation (AHK-012) ile **birebir aynı** akış:

- Draft'ı oluşturan kullanıcı `ApprovalsService.request()` ile onay talep eder.
- Onaylayan kullanıcı, draft'ı oluşturan kullanıcıdan **farklı** olmalıdır — motor bunu zaten zorunlu kılar (`requestedById === decidedById` ise `ForbiddenException`, segregation of duties).
- Onaylayan kullanıcı kararından önce **reauth** (parola ile yeniden kimlik doğrulama) sağlamalıdır; parola asla loglanmaz, sadece `authSource`+`verifiedAt` audit'e yazılır.

**Gerekçe**: Yeni bir yetkilendirme mekanizması icat etmek yerine, projede zaten kanıtlanmış (CAPA + NCR deviation'da iki kez kullanılmış) bir deseni yeniden kullanmak, tutarlılığı ve güvenlik gözden geçirme yükünü azaltır. PRD'nin "yetkisiz mutation" riskine karşı doğrudan mitigasyondur.

**Bilinen sınırlama**: Tek-PLANNER'lı (tek kullanıcılı rol havuzu) bir tenant'ta SoD onayı imkânsız hale gelebilir. Mevcut `ApprovalsService.list()` zaten `role === "ADMIN"` için her zaman görünürlük ayrıcalığı tanıyor; Milestone 3 planı bu edge-case'i (ADMIN'in kendi SoD kısıtlaması olmadan onaylayabilmesi gerekip gerekmediğini) ayrıca ele almalıdır.

## 2. LLM sağlayıcı kararı

**Karar**: Bu milestone'da somut bir bulut sağlayıcı (Anthropic/OpenAI/vb.) **seçilmiyor** — bilinçli olarak TBD bırakılıyor. Bunun yerine bir soyutlama sınırı öngörülüyor: `CopilotLlmProvider` arayüzü (prompt + izin verilen capability bağlamı → structured intent çıktısı). Mevcut `deterministic-draft-v1` motoru (`copilot.service.ts`), bu arayüzün ilk, sağlayıcısız implementasyonu olarak yeniden çerçevelenecek.

**Gerekçe**: Sağlayıcı seçimi (model, maliyet/kota/rate-limit yönetimi) kendi başına bir karar yüzeyi — Milestone 3'ün (ilk mutation tool) kapsamına, somut mutation gereksinimleriyle birlikte bırakılıyor. Bu milestone'u sağlayıcı araştırmasıyla genişletmemek için sınır burada çiziliyor.

**Açık kalan**: Milestone 3 planı, sağlayıcı seçimini ve maliyet/kota yönetimini kendi kararı olarak ele almalıdır.

## İlgili PRD ve Plan

- PRD: `.claude/prds/ahk-013-copilot-mutation-gateway.prd.md`
- Plan: `.claude/plans/ahk-013-copilot-mutation-gateway.plan.md`
- Referans desenler: `apps/backend/src/approvals/approvals.service.ts`, `apps/backend/src/capa/capa.service.ts`

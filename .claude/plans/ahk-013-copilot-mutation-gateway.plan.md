# Plan: AHK-013 — Sağlayıcı ve Onay Modeli Kararı

**Source PRD**: `.claude/prds/ahk-013-copilot-mutation-gateway.prd.md`
**Selected Milestone**: 1 — Sağlayıcı ve onay modeli kararı
**Complexity**: Small

## Summary
Bu milestone kod yazmaz — PRD'nin iki açık sorusunu kapatan bir mimari karar dokümanı üretir: (1) mutation onay yetkisi modeli, (2) LLM sağlayıcı yaklaşımı. Kullanıcıyla yapılan görüşmede iki karar netleşti: onay modeli için mevcut genel amaçlı `ApprovalsService` (SoD + reauth) CAPA/NCR-deviation deseniyle birebir aynı şekilde yeniden kullanılacak; sağlayıcı seçimi ise bu milestone'da bilinçli olarak TBD bırakılıyor — somut sağlayıcı adı yerine bir soyutlama sınırı (provider interface) kararlaştırılıyor, gerçek bağlama Milestone 3'e (mutation tool) bırakılıyor.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Onay akışı (SoD+reauth) | `apps/backend/src/approvals/approvals.service.ts:31-143` | Genel `ApprovalsService.request()/approve()/reject()` — `entity`+`entityId` ile parametrik; `requestedById === decidedById` ise `ForbiddenException`; kritik karar `ReauthEvidence` (parola hash'lenmeden, sadece `authSource`+`verifiedAt` audit'e yazılır) ister. |
| Entity'ye özgü onay entegrasyonu | `apps/backend/src/capa/capa.service.ts:78-128` (`submitForApproval()`, `decide()`) | Entity kendi status alanını (`DRAFT→PENDING_APPROVAL→APPROVED/REJECTED`) `ApprovalsService` çağrılarıyla senkronize eder; `AuthService.reauthenticate()` karardan önce transaction dışında çağrılır. |
| Karar dokümantasyonu konumu | `docs/erp-ownership-matrix.md` (AHK-010 "Hedef ERP seçimi için karar kaydı") | Mimari kararlar `docs/` altında ayrı bir markdown dosyasında, "karar kaydı" başlığıyla tutulur — PLAN.md satırına link verilir, plan/PRD'ye gömülmez. |

## Files to Change
| File | Action | Why |
|---|---|---|
| `docs/ahk-013-copilot-gateway-decisions.md` | CREATE | Onay modeli + sağlayıcı yaklaşımı kararlarını, gerekçeleriyle, `erp-ownership-matrix.md` konumlandırma desenini izleyerek kayıt altına alır. |
| `.claude/prds/ahk-013-copilot-mutation-gateway.prd.md` | UPDATE | İki "Open Questions" satırı bu kararla kapatıldığı için işaretlenir; Milestone 1 satırı `pending` → `complete` olur. |

## Tasks

### Task 1: Karar dokümanını yaz
- **Action**: `docs/ahk-013-copilot-gateway-decisions.md` oluştur. İçerik:
  - **Onay modeli kararı**: material.create mutation'ı, `ApprovalsService` üzerinden `entity: "copilot-draft"` ile talep edilir; onaylayan kullanıcı draft'ı oluşturan kullanıcıdan farklı olmalı (SoD, mevcut motorun zaten zorunlu kıldığı gibi) ve reauth (parola) sağlamalı — CAPA (`capa.service.ts:93-128`) ile birebir aynı akış. Yeni bir yetkilendirme mekanizması icat edilmez.
  - **Sağlayıcı kararı**: Milestone 1'de somut sağlayıcı seçilmiyor. Milestone 3'te bağlanacak bir `CopilotLlmProvider` arayüzü (tek metod: prompt+context → structured intent) öngörülüyor; mevcut `deterministic-draft-v1` motoru bu arayüzün ilk (provider'sız) implementasyonu olarak yeniden çerçevelenecek. Gerçek bulut sağlayıcı seçimi (model, maliyet/kota yönetimi) Milestone 3 planına bırakılıyor.
  - **Gerekçe/riskler**: PRD'deki "LLM çıktısı güvenilmez intent üretebilir" ve "yetkisiz mutation" risklerinin SoD+reauth ile nasıl azaltıldığı.
- **Mirror**: `docs/erp-ownership-matrix.md` başlık/karar-kaydı formatı.
- **Validate**: Dosya var, iki karar da (onay modeli, sağlayıcı yaklaşımı) açıkça yazılı; `grep -l "copilot-draft" docs/ahk-013-copilot-gateway-decisions.md` eşleşir.

### Task 2: PRD'yi güncelle
- **Action**: `.claude/prds/ahk-013-copilot-mutation-gateway.prd.md` içinde:
  - `Open Questions` bölümündeki iki maddeyi işaretle (`- [x]`) ve karara referans ekle (`→ docs/ahk-013-copilot-gateway-decisions.md`).
  - `Delivery Milestones` tablosunda satır 1'in `Status` sütununu `complete`, `Plan` sütununu `.claude/plans/ahk-013-copilot-mutation-gateway.plan.md` yap.
- **Mirror**: PRD şablonunun kendi checkbox/tablo formatı.
- **Validate**: PRD'de `- [x]` iki kez geçer; milestone 1 satırı `complete` yazar.

## Validation
```bash
# Sadece dokümantasyon değişikliği — kod/derleme/test etkilenmiyor.
grep -c "^- \[x\]" .claude/prds/ahk-013-copilot-mutation-gateway.prd.md   # beklenen: 2
test -f docs/ahk-013-copilot-gateway-decisions.md && echo OK
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| SoD modeli tek kullanıcılı küçük tenant'larda (yalnızca 1 PLANNER varsa) onayı imkânsız kılabilir | Orta | Milestone 3 planında bu edge-case için ADMIN her zaman onaylayabilir kuralı (mevcut `ApprovalsService.list()`'teki `role === "ADMIN"` ayrıcalığıyla tutarlı) ele alınmalı — bu milestone'da sadece riskin dokümante edilmesi yeterli. |
| Sağlayıcıyı TBD bırakmak Milestone 3'ü büyütebilir | Düşük | Milestone 3 planı ayrıca sağlayıcı seçimini kendi kararı olarak ele alacak; bu milestone sadece arayüz sınırını (interface shape) belirler, karar dokümanına yazılır. |

## Acceptance
- [ ] `docs/ahk-013-copilot-gateway-decisions.md` oluşturuldu, onay modeli + sağlayıcı yaklaşımı kararları net
- [ ] PRD'nin açık soruları kapatıldı, Milestone 1 satırı `complete`
- [ ] Hiçbir kod/şema değişikliği yapılmadı (bu milestone kasıtlı olarak kod içermiyor)

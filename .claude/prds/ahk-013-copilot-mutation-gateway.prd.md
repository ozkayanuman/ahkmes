# AHK-013 — AI Command Gateway: İlk Mutation Tool

## Problem
Operatör/Planlayıcı rolündeki kullanıcılar, malzeme kaydı gibi tekrarlayan işlemleri hâlâ elle form doldurarak yapıyor. Mevcut copilot prototipi (`copilot.service.ts`, deterministic-draft-v1) sadece taslak öneriyor; `executionAllowed` her zaman `false` olduğu için kullanıcı taslağı gördükten sonra bile formu manuel tamamlamak zorunda kalıyor. Bu, copilot'un vaat ettiği zaman kazancını gerçek kılmıyor.

## Evidence
- Assumption — needs validation via kullanıcı gözlemi (PLANNER/FOREMAN'ın malzeme kaydı akışında ne kadar zaman harcadığı ölçülmedi). AHK-013 zaten PLAN.md'de PROTOTYPE aşamasında, dahili karar ile başlatıldı; dış kullanıcı talebi kaydı yok.

## Users
- **Primary**: PLANNER/FOREMAN rolündeki kullanıcılar — `copilot` sayfa yetkisine sahip, malzeme kaydı gibi tekrarlayan CRUD işlemlerini doğal dil isteğiyle tetiklemek isteyen kullanıcılar.
- **Not for**: OPERATOR (bu MVP'de mutation tool sadece material.create hedefliyor, HMI/operatör akışlarını kapsamıyor); ADMIN-only konfigürasyon işlemleri.

## Hypothesis
We believe **material.create için gerçek, onaylı bir mutation tool** will **manuel form doldurma süresini azaltacak** for **PLANNER/FOREMAN kullanıcıları**.
We'll know we're right when **copilot üzerinden malzeme kaydı oluşturma süresi, formu elle doldurmaya kıyasla gözlemlenebilir şekilde kısalır** (ölçüm yöntemi TBD — kullanıcı gözlemi/zamanlama gerekir).

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| Manuel form doldurma süresi azalması | TBD — needs validation via kullanıcı gözlemi/zamanlama | Copilot akışıyla vs. elle form doldurmayla malzeme kaydı oluşturma süresi karşılaştırması |
| Onaylı draft → başarılı execution oranı (ikincil sinyal) | TBD | `ApprovalRequest` + execution audit kayıtlarından oran hesaplama |

## Scope
**MVP** — Mevcut deterministic prototipi üç parçayla genişletmek:
1. Gerçek (bulut) bir LLM sağlayıcı entegrasyonu — intent extraction'ı mevcut keyword parser'ın yerine veya önüne geçirir (sağlayıcı seçimi açık soru, aşağıda).
2. Kalıcı draft/approval kaydı — bugünkü stateless `createDraft()` yanıtı yerine, taslak ve onay durumunun veritabanında (muhtemelen AHK-006/AHK-012'deki `ApprovalRequest` deseniyle) izlenmesi.
3. İlk gerçek mutation tool — sadece `material.create` için: onaylanmış bir draft, policy + reauth onay kapısından geçtikten sonra gerçek `Material` kaydı oluşturur; `executionAllowed` bu tek işlem için koşullu olarak `true` olabilir.

**Out of scope**
- Yerel/offline LLM kurulumu — sadece bulut tabanlı sağlayıcı düşünülüyor, offline mod bu MVP'de yok.
- `material.create` dışındaki tüm mutation'lar (iş emri, satın alma, kalite, MRP, vb.) — backlog'da kalır.
- Çok adımlı/konuşmalı akış — copilot tek-shot prompt → draft → onay akışında kalır, ileri-geri diyalog/bağlam takibi yok.

## Delivery Milestones
<!-- Business outcomes, not engineering tasks. /plan turns each into a plan. -->
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Sağlayıcı ve onay modeli kararı | LLM sağlayıcısı ve onay yetkisi modeli netleşir; mimari kararlar dokümante edilir | complete | `.claude/plans/ahk-013-copilot-mutation-gateway.plan.md` |
| 2 | Kalıcı draft/approval kaydı | Copilot taslakları artık stateless yanıt değil, veritabanında izlenen kayıtlar; onay durumu sorgulanabilir | in-progress | `.claude/plans/ahk-013-copilot-mutation-gateway-m2.plan.md` |
| 3 | İlk mutation tool (material.create) | Onaylanmış bir draft, policy+reauth kapısından geçerek gerçek Material kaydı oluşturabilir; `executionAllowed=true` bu tek yol için koşullu çalışır | pending | — |

## Open Questions
- [x] Hangi LLM sağlayıcısı/model kullanılacak, maliyet ve tenant-başına kota/rate-limit nasıl yönetilecek? → Milestone 1'de bilinçli olarak TBD bırakıldı, `CopilotLlmProvider` arayüzü öngörüldü; somut seçim Milestone 3'e ertelendi. Bkz. `docs/ahk-013-copilot-gateway-decisions.md`.
- [x] Mutation'ı kim onaylayabilir — sadece isteği yapan kullanıcı mı (reauth ile, AHK-006/AHK-012 deseni gibi) yoksa ayrı bir onaylayıcı rolü mü gerekiyor? → Mevcut `ApprovalsService` (SoD + reauth), CAPA/NCR-deviation ile birebir aynı akış kullanılacak. Bkz. `docs/ahk-013-copilot-gateway-decisions.md`.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM çıktısı güvenilmez/manipüle edilebilir intent üretebilir | Orta | Yüksek | Mutation tool'u yalnızca dar, önceden tanımlı bir işlem kümesine (material.create) bağlamak; her mutation'da policy+reauth kapısı zorunlu kılmak |
| Sağlayıcı maliyeti/rate-limit kontrolsüz büyür | Orta | Orta | Sağlayıcı seçimiyle birlikte kota/maliyet sınırları milestone 1'de kararlaştırılmalı |
| Onay akışı yanlış tasarlanırsa yetkisiz mutation riski | Düşük | Yüksek | Mevcut CAPA/AHK-012 reauth+approval desenini birebir yeniden kullanmak, yeni bir yetkilendirme mekanizması icat etmemek |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*

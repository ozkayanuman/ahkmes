# AHKMES Güvenlik Özet Dokümanı

**Not:** Bu doküman Opcenter X'in "Security Concept" dokümanına benzer bir amaca hizmet eder — ancak AHKMES'in gerçek, mevcut durumunu yansıtır. IEC 62443-4-1 veya ISO 27001 gibi resmi sertifikasyonlar bu ölçekte henüz alınmamıştır ve gerçekçi olmayan bir iddia olarak sunulmamaktadır; bu bir **iyi pratikler özeti**dir.

## 1. Kimlik Doğrulama ve Yetkilendirme

- Kullanıcı erişimi: JWT (access + refresh token), `bcryptjs` ile hash'lenmiş parola.
- Rol bazlı yetkilendirme (RBAC): ADMIN/SALES/PLANNER/FOREMAN/OPERATOR — `RolesGuard` ile route seviyesinde uygulanır.
- Makine/connector erişimi: JWT'den ayrı, `X-Machine-Key` (bcrypt hash'lenmiş, düz metin yalnızca üretim anında bir kez gösterilir) — `MachineKeyGuard`.
- Yetkisiz istek: 401 (kimliksiz) / 403 (yetkisiz rol) ayrımı yapılır.

## 2. Parola Politikası

- Mevcut: minimum uzunluk kontrolü var (bkz. `auth` modülü), karmaşıklık kuralı (büyük/küçük harf/rakam/özel karakter) şu an zorunlu değil.
- **Öneri:** Üretim ortamında minimum 12 karakter + karmaşıklık kuralı eklenmesi, periyodik parola değişim hatırlatması.

## 3. Veri Koruma

- Dosya yüklemeleri (STEP/talimat/NC program): MIME tipi allowlist ile kontrol edilir, istemcinin bildirdiği tip güvenilmez.
- İndirme URL'leri her zaman `Content-Disposition: attachment` zorunlu kılar — tarayıcıda inline render edilip stored-XSS riski oluşturmaz.
- Hassas alanlar (`connectorKeyHash`, `passwordHash`, `refreshTokenHash`) API response select'lerinde asla dönülmez (`PUBLIC_SELECT` deseni).

## 4. Ağ Güvenliği

- **Mevcut durumda uygulanmamış, üretimde ZORUNLU öneriler:**
  - Reverse proxy (nginx/Caddy) arkasında HTTPS sonlandırma.
  - Firewall kuralları: yalnızca 443 (veya reverse proxy portu) dışarıya açık olmalı; backend/Postgres/MinIO portları doğrudan internete açılmamalı.
  - Machine Connector trafiği (OPC-UA/M80) yalnızca iç ağda (VLAN/segment) çalışmalı, internete açılmamalı.

## 5. Patch/Bağımlılık Yönetimi

- Bağımlılıklar `pnpm` ile kilitli (`pnpm-lock.yaml`) — deterministik kurulum.
- **Öneri:** `pnpm audit` veya Dependabot/Renovate ile düzenli güvenlik açığı taraması eklenmesi (henüz yok, bkz. CI/CD dokümanı).

## 6. Loglama ve Denetim (Audit)

- `AuditLog` modeli + `AuditInterceptor`: CREATE/UPDATE/DELETE/STATUS_CHANGE işlemleri kullanıcı+zaman damgasıyla kaydedilir.
- **Sınırlama:** Log saklama süresi/rotasyon politikası henüz tanımlı değil.

## 7. Yedekleme ve Felaket Kurtarma

- Bkz. `docs/yedekleme.md`. Otomatik zamanlanmış yedekleme henüz yok, manuel script sağlanmıştır.

## 8. Bilinen Güvenlik Sınırlamaları (v0.9)

| Konu | Durum |
|---|---|
| Rate limiting / brute-force koruması | Yok |
| 2FA/MFA | Yok |
| Otomatik güvenlik açığı taraması (CI'da) | Yok (bkz. CI/CD planı) |
| Sertifika/uyumluluk belgesi (IEC 62443, ISO 27001) | Yok, bu ölçekte gerçekçi değil |
| Çoklu-tenant veri izolasyonu testi | Backend tenant-scoped sorgular kullanıyor, ancak bağımsız bir sızma testi yapılmadı |

## 9. Sorumluluk Modeli

Bulut/SaaS olarak sunulmadığı sürece (on-prem kurulum), altyapı güvenliği (işletim sistemi, ağ, fiziksel erişim) müşteri sorumluluğundadır. AHKMES yalnızca uygulama katmanı güvenliğinden (yukarıdaki maddeler) sorumludur.

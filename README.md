# AHKMES — CNC Talaşlı İmalat MES / ERP

Tek monorepo'da büyüyen bir MES + ERP platformu: **Teklif → Üretim Emri →
Malzeme Tedariği → Malzeme Tüketimi → Ürün (Mamul) Oluşumu** çekirdek MES
akışının üzerine Satış/Satınalma/Envanter/Kalite/Bakım/Finans/HR/CRM/Proje
Yönetimi modülleri ve gerçek bir makine konektörü (OPC-UA/M80 sim, Faz 0
sonrası eklendi) katmanlanmıştır. Ürünün doğrulanmış kapsamı, hangi
modüllerin `VERIFIED_DONE`/`PARTIAL`/`NOT_STARTED` olduğu ve bilinen
teknik borçlar için **kaynak-of-truth her zaman `PLAN.md`'dir** — bu README
sadece hızlı kurulum/genel bakış içindir, ayrıntılı/güncel durum için
`PLAN.md`'ye bakın.

## Teknoloji

- **Backend:** NestJS 10 + Prisma 5 + PostgreSQL 16 + Socket.IO (JWT el sıkışmalı canlı olaylar, güvenilir teslim için transactional outbox — bkz. `docs/entegrasyon-kilavuzu.md`)
- **Web:** React 18 + Vite 5 + Tailwind CSS + TanStack Query
- **Kimlik doğrulama:** Local (bcrypt) + LDAP + OIDC (çoklu sağlayıcı), rol (RBAC) + sayfa bazlı `PermissionGroup` yetkilendirmesi
- **Dosya deposu:** MinIO (STEP/talimat/NC program/sertifika, presigned URL + MIME allowlist)
- **Makine konektörü:** `apps/connector` — protokol-bağımsız adaptör arayüzü (Simulator/OPC-UA üretime hazır, M80/Fanuc FOCAS2 deneysel/iskelet — bkz. `docs/entegrasyon-kilavuzu.md` §3.4)
- **Ortak paket:** `packages/shared-types` — Zod şemaları + DTO tipleri (backend & web aynı doğrulamayı kullanır)
- **Monorepo:** pnpm workspaces · **Dağıtım:** Docker Compose

## Kurulum (Docker Compose — önerilen)

```bash
cp .env.example .env        # POSTGRES_PASSWORD, JWT_SECRET, SEED_ADMIN_PASSWORD doldurun
docker compose up -d --build
```

- Web arayüzü: http://localhost:8080
- API: http://localhost:3000
- Postgres (compose): host 5434 → konteyner 5432

İlk açılışta migration + seed otomatik çalışır; `.env`'deki `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD` ile giriş yapın (seed ayrıca 2 adet SMEC MCV-5500 tezgahı tanımlar).

## Geliştirme

```bash
pnpm install
docker run -d --name ahkmes-pg-dev -p 5433:5432 -e POSTGRES_PASSWORD=... postgres:16-alpine
# .env'de DATABASE_URL'i 5433'e yönlendirin
pnpm --filter @ahkmes/backend exec prisma migrate dev
pnpm --filter @ahkmes/shared-types build
pnpm dev:backend    # :3000
pnpm dev:web        # :5173
```

> Not: Yerel geliştirme Postgres'i **5433**, compose yığını **5434** portunu kullanır — çakışmazlar.

### Test

```bash
pnpm test                                # workspace birim testleri (shared-types/web/backend)
pnpm --filter @ahkmes/backend test:e2e   # backend e2e (izole kaynaklara ihtiyaç duyar, bkz. aşağı)
pnpm typecheck
```

### İzole e2e (önerilen)

```bash
pnpm test:e2e
# yalnızca bir e2e dosyasını izole ortamda çalıştırmak için:
pnpm test:e2e test/oee-trend.e2e-spec.ts
```

Bu komut yalnızca geçici Docker Compose kaynaklarıyla PostgreSQL, MinIO ve LDAP
başlatır; host portu açmaz, `.env` veya geliştirme/üretim veritabanını kullanmaz.
Test sonucu ve altyapı logları terminalde görünür. Koşum bittiğinde (başarısız
olsa da) geçici konteyner ve volume'lar silinir. Docker Desktop/Engine çalışır
durumda olmalıdır.

Web testleri Vitest + React Testing Library ile çalışır (jsdom); API istemcisinin token
yenileme akışı ve satınalma teslim alma ekranı davranış olarak kapsanır.

## Kullanım Akışı (çekirdek MES döngüsü)

Aşağıdaki, sistemin doğrulanmış çekirdek akışıdır. Satış/satınalma
derinleştirme, kalite/CAPA, bakım, envanter/WM, finans, HR, CRM, proje
yönetimi gibi genişletilmiş modüllerin kendi akışları için
`docs/kullanici-kilavuzu.md`'ye bakın.

1. **Kayıtlar:** Müşteri, Parça, Tedarikçi, Malzeme, Tezgah ekranlarından temel kartları açın.
2. **Teklif:** Teklifler → Yeni Teklif (satırlar: parça, adet, fiyat, termin) → Gönder → Onayla.
3. **İş Emri:** Onaylı teklifte "İş Emrine Dönüştür" — her satırdan `IE-YYYY-NNNN` numaralı iş emri.
4. **Satınalma:** Satınalma → Yeni Sipariş → mal gelince satır bazlı "Teslim Al" — hammadde stoğu otomatik artar.
5. **Tüketim:** İş emri detayında malzeme rezervasyonu/tüketimi — tüketim stoğu düşürür, yetersiz stok reddedilir.
6. **Üretim:** Operasyon sayfasından koşu başlat, sağlam/hurda adet ve duruş notu gir, koşuyu tamamla.
7. **Mamul:** İş emri detayından mamul girişi — mamul stoğu artar; hedefe ulaşınca tamamlama önerilir.
8. **Panel:** Dashboard'da aktif iş emirleri, bekleyen teklifler, kritik stok ve son koşular canlı izlenir.

Belge numaraları otomatiktir: Teklif `TKF-YYYY-NNNN`, İş Emri `IE-YYYY-NNNN`, Sipariş `SAT-YYYY-NNNN`.
Tüm yazma işlemleri AuditLog'a düşer (kim, neyi, ne zaman, öncesi/sonrası).

## Roller ve Yetkilendirme

Temel roller (`ADMIN`, `SALES`, `PLANNER`, `FOREMAN`, `OPERATOR`) endpoint'leri
korur; bunun üzerine sayfa bazlı `PermissionGroup` ataması (bir kullanıcıyı
belirli sayfalarla kısıtlama) ve tenant modül entitlement'ları (bir modülü
tenant için tamamen kapatma) katmanlanmıştır. HMI operatör terminali
(`/hmi/operations`) ve makine/connector uçları ayrıca kendi action-grant
(`HMI_READ`/`HMI_START`/…) ve `X-Machine-Key` mekanizmalarını kullanır.

## Ürün Durumu ve Kapsamı

AHKMES, doğrulanmış (`VERIFIED_DONE`) çekirdek MES akışının üzerine geniş bir
ERP+MES modül setiyle (Satış/Satınalma/Envanter/WM/Kalite/Bakım/Finans/HR/
CRM/Proje Yönetimi/Servis, ayrıca PLM/tooling/fixture ve makine konektörü)
genişletilmiş durumdadır. Her modülün gerçek/güncel durumu
(`VERIFIED_DONE`/`PARTIAL`/`PROTOTYPE`/`NOT_STARTED`/`NEEDS_DECISION`),
kanıtları ve bilinen açıkları için:

- **`PLAN.md`** — tek kaynak-of-truth: modül envanteri, öncelikli backlog
  tablosu (`AHK-XXX`/`CAT-XXX`/`PLM-XXX`/`MES-XXX` kodları), mimari riskler,
  güvenlik/uyumluluk açıkları.
- **`docs/kurulum-kilavuzu.md`** — kurulum, ortam değişkenleri, bilinen
  kısıtlamalar.
- **`docs/entegrasyon-kilavuzu.md`** — API, makine konektörü, webhook,
  dosya deposu, gerçek zamanlı olay sözleşmesi.
- **`docs/kullanici-kilavuzu.md`** — uçtan uca kullanım akışları.

Bu README'ye faz/yüzde gibi hızla eskiyen sayılar bilerek eklenmiyor — güncel
durum her zaman `PLAN.md`'den okunmalı.

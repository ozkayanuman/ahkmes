# AHKMES — CNC Talaşlı İmalat MES / Hafif ERP

Makine bağlantısı olmadan, tamamen web arayüzünden manuel veri girişiyle
**Teklif → Üretim Emri → Malzeme Tedariği → Malzeme Tüketimi → Ürün (Mamul) Oluşumu**
akışını uçtan uca takip eden MES/hafif-ERP sistemi. (Faz 0 — makine konektörü Faz 1'de eklenecek.)

## Teknoloji

- **Backend:** NestJS 10 + Prisma 5 + PostgreSQL 16 + Socket.IO (JWT el sıkışmalı canlı olaylar)
- **Web:** React 18 + Vite 5 + Tailwind CSS + TanStack Query
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
pnpm test                                # workspace birim testleri (shared-types 12, web 14, backend 3)
pnpm --filter @ahkmes/backend test:e2e   # 56 e2e testi (auth, CRUD, Faz 0b, Faz 0c akışları)
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

## Kullanım Akışı (uçtan uca)

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

## Roller

`ADMIN`, `SALES` (teklif), `PLANNER` (iş emri/satınalma), `FOREMAN` (teslim alma/tüketim/üretim),
`OPERATOR` (üretim koşusu). Endpoint'ler rol bazlı korunur.

## Faz Durumu

- [x] **Faz 0a** — iskelet, auth (JWT+RBAC), temel CRUD, Docker Compose (`faz-0a`)
- [x] **Faz 0b** — teklif, iş emri, satınalma, Socket.IO realtime (`faz-0b`)
- [x] **Faz 0c** — tüketim, operasyon takibi, mamul, dashboard (`faz-0c`)
- [ ] **Faz 1** — Machine Connector (FOCAS2/MQTT), canlı tezgah izleme

Ayrıntılı plan için `PLAN.md`.

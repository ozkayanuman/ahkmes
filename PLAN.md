# CNC MES — Faz 0 Uygulama Planı (PLAN.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Hedef:** Makine bağlantısı OLMADAN, tamamen web arayüzünden manuel veri girişiyle Teklif → Üretim Emri → Malzeme Tedariği → Malzeme Tüketimi → Ürün (Mamul) Oluşumu akışını uçtan uca takip eden MES/hafif-ERP sistemi.

**Mimari:** pnpm workspaces monorepo. NestJS (TypeScript) backend + PostgreSQL (Prisma ORM) + REST API + WebSocket (Socket.IO). React + Vite + Tailwind + shadcn/ui ofis paneli. Docker Compose ile tek komut ayağa kalkış. Machine Connector Faz 1'de ayrı paket olarak eklenecek — çekirdek bundan bağımsız tasarlanır.

**Teknoloji Yığını:** NestJS 10, Prisma 5, PostgreSQL 16, Socket.IO, React 18, Vite 5, TypeScript 5, Tailwind CSS, shadcn/ui, pnpm workspaces, Docker Compose, JWT (access + refresh), Zod (shared-types doğrulama).

## Global Kısıtlar (her görev için geçerli)

- Her ana tabloda `tenant_id` kolonu var; sabit tek tenant değeriyle çalışır. RLS, tenant yönetim ekranı YOK (Faz 3).
- `ProductionRun.source` alanı `MANUAL | MACHINE` enum'ı — Faz 0'da her zaman `MANUAL`. Veri modeli ve servis katmanı kaynak ayrımını şimdiden tanır.
- Machine tablosu sadece referans (iş emrine tezgah atama için); hiçbir bağlantı/telemetri kodu yazılmaz.
- Secrets `.env` dosyalarında; repoya asla girmez (`.env.example` şablonları commit edilir).
- Tüm yazma işlemleri AuditLog'a düşer (kim, neyi, ne zaman, öncesi/sonrası).
- Roller: `ADMIN, SALES, PLANNER, FOREMAN, OPERATOR` — endpoint'ler rol bazlı korunur (RBAC guard).
- Monorepo: `apps/backend`, `apps/web`, `packages/shared-types`. `apps/connector-fanuc` ŞİMDİ OLUŞTURULMAZ; yapı buna izin verecek şekilde bırakılır.
- Her fazın sonunda `docker compose up` ile çalışan, elle test edilebilir bir sistem olmalı.
- UI dili Türkçe (tek dil, i18n altyapısı yok — YAGNI).

---

## 1. Klasör Yapısı

```
cnc-mes/
├── PLAN.md
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml
├── docker-compose.yml            # postgres + backend + web
├── .env.example
├── .gitignore
├── apps/
│   ├── backend/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts           # tenant, admin kullanıcı, 2 tezgah (SMEC MCV-5500)
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/           # guards (JwtAuthGuard, RolesGuard), decorators, filters,
│   │   │   │                     # TenantContext, AuditInterceptor
│   │   │   ├── auth/             # login, refresh, JWT strategy
│   │   │   ├── users/
│   │   │   ├── customers/
│   │   │   ├── parts/            # Part + NcProgram (sadece kayıt/versiyon, yükleme yok)
│   │   │   ├── suppliers/
│   │   │   ├── materials/        # Material + stok görünümü
│   │   │   ├── quotes/           # Quote/QuoteLine + onay + iş emrine dönüşüm
│   │   │   ├── work-orders/      # WorkOrder + durum makinesi
│   │   │   ├── purchasing/       # PurchaseOrder/Line + teslim al → stok artışı
│   │   │   ├── consumption/      # MaterialConsumption (rezervasyon + tüketim, stok düşümü)
│   │   │   ├── production/       # ProductionRun (başlat/durdur/tamamla, adet girişi)
│   │   │   ├── finished-goods/   # FinishedGoodsEntry → mamul stok girişi
│   │   │   ├── machines/         # sadece CRUD (referans tablo)
│   │   │   ├── dashboard/        # özet endpoint'leri
│   │   │   └── realtime/         # Socket.IO gateway (workorder.updated, stock.updated, ...)
│   │   └── test/                 # e2e (supertest) + birim testleri (jest)
│   ├── web/
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── api/              # typed fetch client + socket client
│   │   │   ├── components/       # shadcn/ui bileşenleri + ortak tablo/form bileşenleri
│   │   │   ├── pages/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── customers/
│   │   │   │   ├── parts/
│   │   │   │   ├── suppliers/
│   │   │   │   ├── materials/
│   │   │   │   ├── quotes/
│   │   │   │   ├── work-orders/
│   │   │   │   ├── purchasing/
│   │   │   │   ├── production/   # operasyon takibi (responsive — ileride HMI/kiosk temeli)
│   │   │   │   └── login/
│   │   │   └── lib/              # auth store, route guard, yardımcılar
│   │   └── index.html
│   └── (connector-fanuc)         # FAZ 1 — şimdi yok, sadece yer ayrıldı
└── packages/
    └── shared-types/
        └── src/                  # Zod şemaları + DTO tipleri + enum'lar (backend & web ortak)
```

## 2. Veritabanı Şeması (Prisma / PostgreSQL)

Tüm tablolarda: `id` (uuid), `tenantId`, `createdAt`, `updatedAt`. İlişkiler açıklamada.

**Enum'lar:**
- `Role`: ADMIN | SALES | PLANNER | FOREMAN | OPERATOR
- `QuoteStatus`: DRAFT | SENT | APPROVED | REJECTED
- `WorkOrderStatus`: PLANNED | WAITING_MATERIAL | IN_PRODUCTION | COMPLETED | CANCELLED
- `PurchaseOrderStatus`: ORDERED | IN_TRANSIT | RECEIVED | CANCELLED
- `MaterialType`: RAW | CONSUMABLE
- `ConsumptionType`: RESERVED | CONSUMED
- `RunSource`: MANUAL | MACHINE   ← Faz 0'da hep MANUAL
- `AuditAction`: CREATE | UPDATE | DELETE | STATUS_CHANGE

**Varlıklar:**

| Varlık | Alanlar (kimlik/zaman alanları hariç) | İlişkiler |
|---|---|---|
| Tenant | name | seed ile tek kayıt |
| User | email (unique), passwordHash, name, role: Role, isActive | → AuditLog, ProductionRun.operator |
| Customer | name, contactName?, email?, phone?, address?, taxNo?, notes? | ← Quote |
| Part | partNo, revision, name, description?, drawingFileRef?, stepFileRef? — unique(tenantId, partNo, revision) | ← QuoteLine, WorkOrder, NcProgram, FinishedGoodsEntry |
| NcProgram | partId, version (int, artan), fileName, fileRef, notes?, createdById — Faz 0'da sadece kayıt | → Part |
| Quote | quoteNo (auto: TKF-2026-0001), customerId, status: QuoteStatus, currency (default TRY), validUntil?, notes?, createdById | → Customer, ← QuoteLine |
| QuoteLine | quoteId, partId, quantity, unitPrice (Decimal), dueDate | → Quote, Part; ← WorkOrder (dönüşümde) |
| Machine | name, model (SMEC MCV-5500), controller? (Fanuc 0i-MF / 0iTF Plus — teyit edilecek), isActive — SADECE REFERANS | ← WorkOrder, ProductionRun |
| WorkOrder | woNo (auto: IE-2026-0001), quoteLineId?, partId, quantity, dueDate, priority (int), status: WorkOrderStatus, machineId?, notes? | → QuoteLine?, Part, Machine?; ← MaterialConsumption, ProductionRun, FinishedGoodsEntry |
| Supplier | name, contactName?, email?, phone?, address?, taxNo?, notes? | ← PurchaseOrder |
| Material | code (unique/tenant), name, type: MaterialType, unit (adet/kg/m...), stockQty (Decimal), minStock? | ← PurchaseOrderLine, MaterialConsumption |
| PurchaseOrder | poNo (auto: SAT-2026-0001), supplierId, status: PurchaseOrderStatus, orderDate, expectedDate?, notes?, createdById | → Supplier; ← PurchaseOrderLine |
| PurchaseOrderLine | purchaseOrderId, materialId, quantity, unitPrice (Decimal), receivedQty (default 0) | → PurchaseOrder, Material |
| MaterialConsumption | workOrderId, materialId, type: ConsumptionType, quantity (Decimal), date, createdById | → WorkOrder, Material |
| ProductionRun | workOrderId, machineId?, operatorId, startedAt, endedAt?, goodCount (default 0), scrapCount (default 0), downtimeNote?, **source: RunSource (default MANUAL)**, notes? | → WorkOrder, Machine?, User |
| FinishedGoodsEntry | workOrderId, partId, quantity, date, createdById | → WorkOrder, Part |
| PartStock | partId (unique), qty (Decimal) — mamul stok özeti; FinishedGoodsEntry girişleriyle artar | → Part |
| AuditLog | userId, entity, entityId, action: AuditAction, before? (Json), after? (Json) | → User |

**Kritik iş kuralları (servis katmanında, transaction içinde):**
1. Teklif onayı (`APPROVED`) → her QuoteLine için otomatik WorkOrder taslağı oluşturma seçeneği (kullanıcı onaylı, status: PLANNED).
2. PO satırı "teslim alındı" → `receivedQty` artar; tüm satırlar tamamsa PO `RECEIVED`; her teslimatta `Material.stockQty += quantity` (aynı transaction).
3. MaterialConsumption `CONSUMED` kaydı → `Material.stockQty -= quantity`; stok eksiye düşerse hata (409). `RESERVED` stok düşmez, sadece "ayrılmış" gösterilir.
4. ProductionRun start → WorkOrder `IN_PRODUCTION`; complete → adet girişi zorunlu. FinishedGoodsEntry → `PartStock.qty += quantity`; WorkOrder toplam üretilen ≥ quantity ise `COMPLETED` önerilir (kullanıcı onaylar).
5. Her mutasyon AuditLog'a yazılır (interceptor); WebSocket'e `entity.updated` olayı yayınlanır.

**WebSocket olayları:** `quote.updated`, `workorder.updated`, `stock.updated`, `productionrun.updated` — dashboard ve liste ekranları dinler.

---

## 3. Faz 0a — İskelet, Auth, Temel CRUD

**Sonunda:** `docker compose up` → login olunur; User/Customer/Part/Supplier/Material/Machine CRUD ekranları çalışır.

- [ ] **0a.1 Monorepo iskeleti:** root `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.env.example`; `git init` + ilk commit.
- [ ] **0a.2 `packages/shared-types`:** enum'lar + Zod şemaları (tüm varlık DTO'ları) + tsup build. Test: tip/şema birim testleri (vitest).
- [ ] **0a.3 Backend iskeleti:** NestJS app, config modülü (.env), health endpoint. Test: `GET /health` e2e.
- [ ] **0a.4 Prisma şeması + ilk migration:** Bölüm 2'deki TÜM varlıklar (Faz 0b/0c tabloları dahil — tek migration, sonra ekleme yok). `seed.ts`: tenant, admin (env'den şifre), 2 makine.
- [ ] **0a.5 Auth:** `POST /auth/login`, `POST /auth/refresh`, JWT strategy, `RolesGuard` + `@Roles()` decorator, `TenantContext` (sabit tenant enjeksiyonu). Test: login başarılı/başarısız, rol reddi e2e.
- [ ] **0a.6 AuditInterceptor:** tüm mutasyonlarda before/after yakalama. Test: bir CRUD işleminde AuditLog kaydı doğrulanır.
- [ ] **0a.7 Temel CRUD API'leri:** users, customers, parts (+nc-programs alt kaynağı), suppliers, materials, machines — her biri: controller + service + Zod doğrulama + rol koruması + e2e test (create/list/update/delete).
- [ ] **0a.8 Web iskeleti:** Vite + Tailwind + shadcn/ui kurulumu, login sayfası, auth store (token yenileme), korumalı layout (sidebar navigasyon).
- [ ] **0a.9 CRUD ekranları:** her temel varlık için liste (tablo, arama) + form (dialog) sayfası; typed API client.
- [ ] **0a.10 Docker Compose:** postgres + backend (migration otomatik) + web (nginx). Doğrulama: temiz makinede `docker compose up` → login → müşteri oluştur.
- [ ] **0a.11 Commit + tag `faz-0a`.**

## 4. Faz 0b — Teklif, İş Emri, Satınalma

**Sonunda:** Teklif oluştur → onayla → iş emrine dönüştür; PO oluştur → teslim al → hammadde stoğu artar.

- [ ] **0b.1 Quote API:** CRUD + satırlar, `quoteNo` otomatik numaralandırma, durum geçişleri (DRAFT→SENT→APPROVED/REJECTED; geçersiz geçiş 409). Test: durum makinesi e2e.
- [ ] **0b.2 Teklif→İş Emri dönüşümü:** `POST /quotes/:id/convert` — APPROVED teklifin seçilen satırlarından WorkOrder'lar (transaction). Test: dönüşüm + mükerrer dönüşüm engeli.
- [ ] **0b.3 WorkOrder API:** CRUD + durum geçişleri + tezgah atama + öncelik. Test: geçiş kuralları e2e.
- [ ] **0b.4 Purchasing API:** PO + satır CRUD, `POST /purchase-orders/:id/receive` (satır bazlı miktar) → stok artışı aynı transaction'da. Test: teslim al → `Material.stockQty` artışı doğrulanır; fazla teslim reddi.
- [ ] **0b.5 Realtime gateway:** Socket.IO + JWT el sıkışma; servisler olay yayınlar. Test: birim test (event emit).
- [ ] **0b.6 Web — Teklif ekranları:** liste + detay (satır ekleme, durum aksiyonları, "İş emrine dönüştür" akışı).
- [ ] **0b.7 Web — İş Emri ekranları:** liste (durum/öncelik filtresi) + detay (tezgah atama, durum aksiyonları).
- [ ] **0b.8 Web — Satınalma ekranları:** PO liste + detay (teslim alma formu); Materials sayfasında canlı stok.
- [ ] **0b.9 Commit + tag `faz-0b`.**

## 5. Faz 0c — Tüketim, Operasyon Takibi, Mamul, Dashboard

**Sonunda:** Spec'teki uçtan uca akış tamamen çalışır ve dashboard'dan izlenir.

- [ ] **0c.1 Consumption API:** iş emrine rezervasyon/tüketim kaydı; tüketimde stok düşümü + yetersiz stok hatası (transaction). Test: stok düşümü + eksi stok reddi e2e.
- [ ] **0c.2 ProductionRun API:** `POST /work-orders/:id/runs` (başlat), `PATCH /runs/:id` (adet/duruş girişi), `POST /runs/:id/complete` — `source: MANUAL` sabit; WorkOrder durum senkronu. Test: başlat→tamamla akışı e2e.
- [ ] **0c.3 FinishedGoods API:** iş emrine bağlı mamul girişi → `PartStock` artışı; iş emri tamamlama önerisi. Test: mamul stok artışı e2e.
- [ ] **0c.4 Dashboard API:** aktif iş emirleri (durum bazlı sayım + liste), bekleyen teklifler, kritik stok (minStock altı), son üretim kayıtları.
- [ ] **0c.5 Web — Operasyon Takibi:** iş emri seç → başlat/adet gir/duruş notu/tamamla; büyük dokunmatik dostu butonlar (ileriki HMI temeli), responsive.
- [ ] **0c.6 Web — Tüketim & Mamul ekranları:** iş emri detayında malzeme rezervasyon/tüketim bölümü + mamul giriş bölümü.
- [ ] **0c.7 Web — Dashboard:** özet kartlar + aktif iş emirleri tablosu + kritik stok listesi; WebSocket ile canlı güncelleme.
- [ ] **0c.8 Uçtan uca duman testi (e2e):** teklif→onay→iş emri→PO→teslim→tüketim→üretim→mamul girişi tek senaryoda; README'ye kurulum/kullanım bölümü.
- [ ] **0c.9 Commit + tag `faz-0c`.**

---

## 6. Kapsam Dışı (bilinçli — Faz 1+)

Machine Connector / FOCAS2 / MQTT / OPC UA, tezgah canlı izleme, OEE, kalite modülü, vardiya yönetimi, çizelgeleme takvimi, dosya yükleme (MinIO — Faz 0'da dosya alanları sadece referans string), RLS/multi-tenant ekranları, sevkiyat.

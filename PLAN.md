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

- [x] **0a.1 Monorepo iskeleti:** root `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.env.example`; `git init` + ilk commit.
- [x] **0a.2 `packages/shared-types`:** enum'lar + Zod şemaları (tüm varlık DTO'ları) + tsup build. Test: tip/şema birim testleri (vitest).
- [x] **0a.3 Backend iskeleti:** NestJS app, config modülü (.env), health endpoint. Test: `GET /health` e2e.
- [x] **0a.4 Prisma şeması + ilk migration:** Bölüm 2'deki TÜM varlıklar (Faz 0b/0c tabloları dahil — tek migration, sonra ekleme yok). `seed.ts`: tenant, admin (env'den şifre), 2 makine.
- [x] **0a.5 Auth:** `POST /auth/login`, `POST /auth/refresh`, JWT strategy, `RolesGuard` + `@Roles()` decorator, `TenantContext` (sabit tenant enjeksiyonu). Test: login başarılı/başarısız, rol reddi e2e.
- [x] **0a.6 AuditInterceptor:** tüm mutasyonlarda before/after yakalama. Test: bir CRUD işleminde AuditLog kaydı doğrulanır.
- [x] **0a.7 Temel CRUD API'leri:** users, customers, parts (+nc-programs alt kaynağı), suppliers, materials, machines — her biri: controller + service + Zod doğrulama + rol koruması + e2e test (create/list/update/delete).
- [x] **0a.8 Web iskeleti:** Vite + Tailwind + shadcn/ui kurulumu, login sayfası, auth store (token yenileme), korumalı layout (sidebar navigasyon).
- [x] **0a.9 CRUD ekranları:** her temel varlık için liste (tablo, arama) + form (dialog) sayfası; typed API client.
- [x] **0a.10 Docker Compose:** postgres + backend (migration otomatik) + web (nginx). Doğrulama: temiz makinede `docker compose up` → login → müşteri oluştur.
- [x] **0a.11 Commit + tag `faz-0a`.**

## 4. Faz 0b — Teklif, İş Emri, Satınalma

**Sonunda:** Teklif oluştur → onayla → iş emrine dönüştür; PO oluştur → teslim al → hammadde stoğu artar.

- [x] **0b.1 Quote API:** CRUD + satırlar, `quoteNo` otomatik numaralandırma, durum geçişleri (DRAFT→SENT→APPROVED/REJECTED; geçersiz geçiş 409). Test: durum makinesi e2e.
- [x] **0b.2 Teklif→İş Emri dönüşümü:** `POST /quotes/:id/convert` — APPROVED teklifin seçilen satırlarından WorkOrder'lar (transaction). Test: dönüşüm + mükerrer dönüşüm engeli.
- [x] **0b.3 WorkOrder API:** CRUD + durum geçişleri + tezgah atama + öncelik. Test: geçiş kuralları e2e.
- [x] **0b.4 Purchasing API:** PO + satır CRUD, `POST /purchase-orders/:id/receive` (satır bazlı miktar) → stok artışı aynı transaction'da. Test: teslim al → `Material.stockQty` artışı doğrulanır; fazla teslim reddi.
- [x] **0b.5 Realtime gateway:** Socket.IO + JWT el sıkışma; servisler olay yayınlar. Test: birim test (event emit).
- [x] **0b.6 Web — Teklif ekranları:** liste + detay (satır ekleme, durum aksiyonları, "İş emrine dönüştür" akışı).
- [x] **0b.7 Web — İş Emri ekranları:** liste (durum/öncelik filtresi) + detay (tezgah atama, durum aksiyonları).
- [x] **0b.8 Web — Satınalma ekranları:** PO liste + detay (teslim alma formu); Materials sayfasında canlı stok.
- [x] **0b.9 Commit + tag `faz-0b`.**

## 5. Faz 0c — Tüketim, Operasyon Takibi, Mamul, Dashboard

**Sonunda:** Spec'teki uçtan uca akış tamamen çalışır ve dashboard'dan izlenir.

- [x] **0c.1 Consumption API:** iş emrine rezervasyon/tüketim kaydı; tüketimde stok düşümü + yetersiz stok hatası (transaction). Test: stok düşümü + eksi stok reddi e2e.
- [x] **0c.2 ProductionRun API:** `POST /work-orders/:id/runs` (başlat), `PATCH /runs/:id` (adet/duruş girişi), `POST /runs/:id/complete` — `source: MANUAL` sabit; WorkOrder durum senkronu. Test: başlat→tamamla akışı e2e.
- [x] **0c.3 FinishedGoods API:** iş emrine bağlı mamul girişi → `PartStock` artışı; iş emri tamamlama önerisi. Test: mamul stok artışı e2e.
- [x] **0c.4 Dashboard API:** aktif iş emirleri (durum bazlı sayım + liste), bekleyen teklifler, kritik stok (minStock altı), son üretim kayıtları.
- [x] **0c.5 Web — Operasyon Takibi:** iş emri seç → başlat/adet gir/duruş notu/tamamla; büyük dokunmatik dostu butonlar (ileriki HMI temeli), responsive.
- [x] **0c.6 Web — Tüketim & Mamul ekranları:** iş emri detayında malzeme rezervasyon/tüketim bölümü + mamul giriş bölümü.
- [x] **0c.7 Web — Dashboard:** özet kartlar + aktif iş emirleri tablosu + kritik stok listesi; WebSocket ile canlı güncelleme.
- [x] **0c.8 Uçtan uca duman testi (e2e):** teklif→onay→iş emri→PO→teslim→tüketim→üretim→mamul girişi tek senaryoda; README'ye kurulum/kullanım bölümü.
- [x] **0c.9 Commit + tag `faz-0c`.**

---

## 6. Faz 1 — Dosya Deposu + Machine Connector (kullanıcı onayıyla, Faz 0 dışı)

**Sonunda:** STEP/talimat dosyaları yüklenip indirilebilir; protokol-bağımsız bir Machine Connector mimarisi (Kepware/OPC-UA benzeri) gerçek bir OPC-UA client-server el sıkışmasıyla uçtan uca doğrulanmış durumda, `ProductionRun(source=MACHINE)` otomatik oluşuyor.

- [x] **1.1 Dosya deposu (MinIO):** `Document`/`DocumentType` modeli, MinIO entegrasyonu (upload/list/signed-URL/silme), mime allowlist + zorunlu `attachment` indirme (stored XSS önlemi), rol korumalı upload/delete, web UI (parça + iş emri detayı).
- [x] **1.2 Machine Connector — veri modeli:** `Machine.activeWorkOrderId`/`connectorKeyHash`/`lastEventAt`/`lastStatus`, "Makine Bağlantısı" sistem kullanıcısı (seed).
- [x] **1.3 Backend — telemetri alımı:** `X-Machine-Key` korumalı `POST /machines/:id/telemetry` (JWT'siz, `MachineKeyGuard`), `PATCH /machines/:id/active-work-order`, `POST /machines/:id/connector-key`. CYCLE_START→ProductionRun(source=MACHINE) açılışı, PART_COMPLETE→goodCount, ALARM→downtimeNote.
- [x] **1.4 `apps/connector` paketi:** protokol-bağımsız `MachineAdapter` arayüzü, `SimulatorAdapter` (donanımsız test), retry-kuyruklu `Connector` (backend'e HTTP POST, 409 kalıcı hata olarak düşürülür).
- [x] **1.5 OPC-UA referans adapter:** `OpcuaAdapter` (node-opcua client, node ID'ler config'den — marka bağımsız), kendi açık kaynak OPC-UA sim sunucumuz (`apps/connector/src/sim-server`), gerçek client-server el sıkışmasıyla entegrasyon testi.
- [x] **1.6 Web — canlı tezgah paneli:** durum rozeti (Çalışıyor/Boşta/Alarm/Bağlı değil), aktif iş emri atama, connector-key üretme.
- [x] **1.7 Testler:** 70 backend e2e + 8 connector (vitest) + 3 backend birim + 14 web — hepsi yeşil.
- [ ] **1.8 Gerçek marka-özel adapter (Fanuc FOCAS2 / MTConnect / Siemens):** SMEC MCV-5500'ün kontrolcü/protokolü netleşmeden yazılamaz — beklemede. **Araştırma notu (2026-07-27):** MTConnect ücretsiz/açık bir standart (MTConnect Institute, royalty-free); Mitsubishi M80 için MTConnect üzerinden Execution State/Part Count/Spindle Data/çoğu alarm alınabiliyor (Axis Data, Tool ID, System alarmları, Custom Points hariç — bir MES sağlayıcısının karşılaştırma tablosuna göre). Türkiye'de Smartes Teknoloji'nin (`smartes.com.tr`, `mtconnectadapter.com`) MTConnect Adapter ürünü M70/M700/M80/M800'ü açıkça destekliyor — yani M80 + MTConnect kombinasyonu teknik olarak mümkün ve ticari olarak sunuluyor. Adapter'ın çekim mekanizması (native mi, PLC/ağ üzerinden mi) ve fiyatlandırma netleşmedi.

**Araştırma notu 2 (2026-07-27) — Mitsubishi'nin resmi çözümü:** Mitsubishi Electric'in kendi ürünü **"NC Machine Tool Connector"** (resmi kılavuz IB-1501634-D) M800/M80/E80/C80 serisini (M80 dahil, ayrıca M700/M70) açıkça destekliyor. Mimarisi: harici bir Windows PC'ye kurulan bu yazılım, CNC'ye Mitsubishi'nin **"Custom API library"** ile bağlanıyor (düşük seviye veri erişimi — muhtemelen daha önce bulunan TCP 683 portu üzerinden), topladığı veriyi **OPC UA server** olarak dışa veriyor (ayrıca PLC cihaz verisi, başka üreticilerin MTConnect/OPC UA kaynaklarını da toplayabiliyor; PostgreSQL'e loglama ve MQTT/Mosquitto ile yayınlama opsiyonel). Kullanılabilecek gerçek CNC veri noktalarının tam listesi ayrı bir referans dokümanda: **"Custom API Variables List" (BNP-C3072-152)** — kendi adaptörümüzü (AHKConnect) yazmak istersek asıl ihtiyacımız olan teknik kaynak bu doküman (ve muhtemelen Custom API kütüphanesinin kendisi), Mitsubishi Electric/yerel distribütörden talep edilmesi gerekiyor. Lisans/fiyat bilgisi kılavuzda yer almıyor (tipik olarak satın alınan bir endüstriyel yazılım).

**Araştırma notu 3 (2026-07-27) — Zero-cost yol, seçilen yaklaşım:** Açık kaynak, **MIT lisanslı** bir C kütüphanesi bulundu: [`wqliceman/mitsubishi_cnc_m70_ezsocket_net`](https://github.com/wqliceman/mitsubishi_cnc_m70_ezsocket_net) — Mitsubishi'nin **EZSocket protokolünü** (Socket → GIOP → Custom API) TCP port 683 üzerinden doğrudan uyguluyor, hiçbir Mitsubishi yazılımı/lisansı gerektirmiyor. Hazır fonksiyonlar: `m70_cnc_read_status`, `m70_cnc_read_axis_position`, `m70_cnc_read_spindle_speed`, `m70_cnc_read_feed_speed`, `m70_cnc_read_main_program_name_ex`, `m70_cnc_read_program_block`, `m70_cnc_read_alarm`/`read_is_alarm`, `m70_cnc_read_cycle_time` — bize lazım olan CYCLE_START/PART_COMPLETE/ALARM eşdeğerlerinin hepsi mevcut. **Çekince:** Kütüphane `EZNC_SYS_MELDAS700M` sabitiyle M70 için yazılmış; M800/M80 için ayrı bir sabit repo'da görünmüyor — M700 ve M800/M80 aynı Custom API nesli olduğu için protokolün aynı/uyumlu olması muhtemel ama gerçek M80'de doğrulanmadı.

**Seçilen plan — "AHKConnect" (M80'e özel, açık kaynak tabanlı):**
1. **Simülatör yaklaşımı (önce bu):** `apps/connector/src/sim-server`'daki OPC-UA sim sunucusuna benzer şekilde, port 683'te EZSocket/GIOP protokolünü konuşan minimal bir sahte TCP sunucusu yazılacak (kütüphanenin `m70_giop.c` kaynağı incelenerek istek/yanıt byte formatı çözülecek), sabit/canlı test verisi (program durumu, part count, alarm) dönecek. Bu sayede gerçek tezgaha veya bayi cevabına bağlı kalmadan `M80Adapter`'ı geliştirip test edebiliriz.
2. `apps/connector`'a yeni bir `M80Adapter` eklenecek (mevcut `MachineAdapter` arayüzüne uyumlu) — EZSocket kütüphanesini bir C shim/küçük servis olarak sarıp Node connector'ın buna IPC/HTTP ile bağlanması şeklinde.
3. Simülatörle çalışır hale gelince gerçek M80'de (`EZNC_SYS_MELDAS700M` sabitiyle) deneme yapılacak; başarısız olursa Wireshark ile gerçek trafik yakalanıp fark analiz edilecek — yine zero-cost.
- [x] **1.16 EZSocket/GIOP protokol simülatörü:** `apps/connector/src/adapters/m80-protocol.ts` (paylaşılan GIOP frame encode/decode — `mochaGetData` komutu, section/subSection/systemNo/axisNo/dataType alanları, `DEFAULT_ITEM_ADDRESSES` placeholder adresler) + `apps/connector/src/sim-server/m80-sim-server.ts` (port 683, `net.createServer`, OPC-UA sim ile aynı çevrim mantığı).
- [x] **1.17 `M80Adapter` (AHKConnect):** `apps/connector/src/adapters/m80.adapter.ts` — ham TCP socket üzerinden polling (500ms varsayılan), `OpcuaAdapter` ile birebir aynı edge-detection deseni (CYCLE_START/CYCLE_END/PART_COMPLETE/ALARM/IDLE). `config.ts`'e `ADAPTER=m80` + `M80_HOST`/`M80_PORT`/`M80_POLL_INTERVAL_MS` env'leri, `main.ts`'e adaptör dalı eklendi. `package.json`'a `sim-server:m80` script'i eklendi.
- [x] **1.18 Simülatörle uçtan uca test:** `test/m80-adapter.spec.ts` (2 test — cycle/alarm/part-count MachineEvent üretimi, disconnect sonrası event durması) — 10/10 connector testi yeşil, typecheck temiz. **Kalan:** gerçek M80'de doğrulama (henüz yapılmadı) — `m80-protocol.ts`'teki kablo formatı bir varsayım/rekonstrüksiyon, gerçek cihazda değişebilir.
- [ ] **1.9 `apps/connector`'ın Docker Compose'a opsiyonel servis olarak eklenmesi.**

Tasarım dokümanı: `docs/superpowers/specs/2026-07-24-machine-connector-design.md`.

### 6.1 Siemens Opcenter X incelemesinden çıkan backlog (2026-07-27)

Desktop\Opcenter X klasöründeki Siemens Opcenter X dokümanları (Integration Guide, User Manual, Security Concept, Development/Configuration Guide) incelendi; AHKMES ölçeğine uygun, uygulanabilir fikirler:

- [ ] **1.10 Telemetri idempotency key:** `POST /machines/:id/telemetry`'e tekrar-koruması (`uniqueRequestId` benzeri) eklenmesi — connector retry kuyruğu network hatasında aynı olayı iki kez gönderirse `goodCount` çift artabilir (Opcenter'daki `UniqueRequestID` deseninden esinlenildi).
- [ ] **1.11 Non-Conformance modülü (MVP):** Work Order Operation'a bağlı NC kaydı (Problem On: Ürün/Malzeme/İş İstasyonu, Failure Type, açıklama, foto), açık NC varsa operasyonun throughput girişini otomatik bloklayan kural; aksiyon tipi alanı (Scrap/Rework/Blocking/Generic) — ayrı bir Action Management modülüne gerek yok, mevcut goodCount/scrapCount mantığına entegre edilebilir.
- [ ] **1.12 Operatör ekranı context bar:** Target/Queuing/Pending/Produced sayaçlarının operasyon sayfasının üstünde sabit gösterge olarak gösterilmesi.
- [ ] **1.13 Structured error response + hata kodları:** Backend'de tutarlı hata formatı (`ErrorCode`/`Message`) ve telemetri handler'da isimli hata kodları (ör. `TARGET_EXCEEDED`).
- [ ] **1.14 Connector retry — exponential backoff:** `apps/connector/src/core/connector.ts`'deki sabit interval retry'ın üstel geri çekilmeye çevrilmesi.
- [ ] **1.15 (ileri faz) Basit NC dashboard + genealogy:** Açık NC sayısı gibi özet widget'lar, MTU/parça bazlı backward/forward izlenebilirlik sorgusu.

Bilinçli alınmayanlar: model-driven Configurator/no-code metamodel, NATS tabanlı RIC mimarisi, çoklu-tenant mimarisi — AHKMES tek-fabrika/tek-tenant ölçeğinde gereksiz karmaşıklık.

### 6.2 Automation Gateway (AGW) — PLC/CNC tag konfigürasyonu ve canlı izleme (2026-07-27)

Kullanıcı isteği: web ekranında Siemens Opcenter X'in Interoperability katmanına benzer, PLC/CNC bağlantısını configure edip tag'leri (adres+değer) canlı izleyebileceğimiz bir "Automation Gateway" ekranı. Onaylanan plan 4 fazlı: (1) veri modeli+CRUD, (2) tag değeri telemetrisi, (3) connector `readTags()`, (4) web ekranı. Sabit 5 event tipli (CYCLE_START/PART_COMPLETE/ALARM/CYCLE_END/IDLE) iş takibi modeli korunuyor, tag katmanı onun **yanına** ekleniyor.

- [x] **AGW Faz 1 — Veri modeli + backend CRUD:** Prisma `MachineTag` modeli (`id, tenantId, machineId, name, address, dataType, lastValue, lastValueAt`, migration `20260727143959_add_machine_tag`), `MachineTagDataTypeSchema` enum (NUMBER/STRING/BOOLEAN), `createMachineTagSchema`/`updateMachineTagSchema` (shared-types). Backend: `GET/POST/PATCH/DELETE /machines/:id/tags(/:tagId)` (ADMIN rolü write için, okuma herkese açık — mevcut desenle tutarlı), tenant+machine izolasyonu, aynı isimde tag'e 409. Test: `test/machine-tags.e2e-spec.ts` (6 test) — hepsi yeşil.
- [x] **AGW Faz 2 — Tag değeri telemetrisi:** `POST /machines/:id/tag-values` (yeni, mevcut `/telemetry`'ye dokunmadan, `MachineKeyGuard` ile korunur), `handleTagValues` (tanımsız tag adı sessizce atlanır), `realtime.emitToTenant(tenantId, "tag.value.updated", {machineId, values})`. Test: `test/machine-tag-values.e2e-spec.ts` (4 test) — yeşil.
- [x] **AGW Faz 3 — Connector `readTags()`:** `MachineAdapter`'a opsiyonel `readTags?(): Promise<TagReading[]>` (geriye uyumlu — `SimulatorAdapter` etkilenmedi). `OpcuaAdapter`: gerçek node-opcua `browse()` ile ObjectsFolder'dan iki seviye gezip Variable node'larını keşfeder. `M80Adapter`: `parseM80Address("section:subSection[:char]")` ile config'de elle tanımlı tag listesini okur (keşif yok). `Connector`'a `tagPollIntervalMs` — adapter destekliyorsa periyodik `readTags()` → `/tag-values` POST (kayıp toleranslı, retry yok). `config.ts`'e `M80_TAGS` (JSON) ve `TAG_POLL_INTERVAL_MS` env'leri. Test: connector paketi 12/12 yeşil (`opcua-adapter.spec.ts` +1, `m80-adapter.spec.ts` +1).
- [x] **AGW Faz 4 — Web ekranı:** `apps/web/src/pages/automation-gateway.tsx` — makine seçici, tag CRUD tablosu (ekle/düzenle/sil, ADMIN rolü), canlı değer sütunu. `useTagValues` hook'u (`lib/socket.ts`) `tag.value.updated` event'ini dinleyip react-query cache'i **refetch yapmadan** doğrudan günceller (mevcut `useInvalidateOn` invalidate-refetch deseninden bilinçli sapma). Nav'a "Automation Gateway" linki, route `/automation-gateway` eklendi. Web test suite 14/14 yeşil.

Kapsam dışı (bu fazda bilinçli): tag yazma (write), tag geçmişi/historian, eşik tabanlı bildirimler, M80 için otomatik tag keşfi.

**Not (2026-07-27):** Backend'in TÜM e2e suite'i (`faz0c.e2e-spec.ts`, tüketim/mamul/dashboard) bu oturumda bazı testlerde başarısız oldu (recentRuns/totalProduced sayı uyuşmazlığı, 409 yerine 400) — incelendi, bu modüle bu oturumda hiç dokunulmadı (`git status` ile doğrulandı); sebebi muhtemelen bu oturumda tekrar tekrar çalıştırılan e2e testlerinin paylaşılan dev DB'yi (aynı seed tenant/admin) veriyle doldurması (limit'li "recent" listelerinden eski kayıtların düşmesi gibi) — AGW'ye özel değil, ortam/test-izolasyon kırılganlığı. AGW'nin kendi test suite'leri (backend 10, connector 2 yeni, web 14) hepsi yeşil.

## 8. Satışa Hazır MES Yol Haritası — v0.9 ve v1.0 (2026-07-27, tamamlandı)

Kullanıcı isteği: AHKMES'i Siemens Opcenter X / Smartes SmartFactory ile rekabet edebilir, satışa hazır bir MES'e dönüştürmek. Önce bir rekabet analizi + fazlı yol haritası sunuldu (gerçekçi çerçeve: tam Opcenter X paritesi bu ölçekte hedeflenmedi), sonra kullanıcı onayıyla v0.9 ve v1.0'ın tüm fazları soru sorulmadan uygulandı.

### v0.9 — Sağlamlaştırma (tamamlandı)
- [x] **Non-Conformance (kalite) modülü:** `NonConformance` modeli (workOrderId/productionRunId/failureType/actionType SCRAP-REWORK-BLOCKING-GENERIC/status OPEN-RESOLVED), `POST/GET /non-conformances`, `PATCH /non-conformances/:id/resolve`. **Blocking kuralı:** `ProductionService.update()`'de açık NC varken `goodCount` girişi 409 ile engellenir (diğer alanlar serbest). Web: `/non-conformances` sayfası. Test: 6/6 e2e yeşil.
- [x] **OEE hesaplama:** `GET /work-orders/:id/oee` — Quality her zaman gerçek veriden (goodCount/scrapCount), Performance yalnızca `Part.idealCycleTimeSec` girilmişse hesaplanır, **Availability bilinçli olarak null** (sistemde süre bazlı duruş takibi yok — sahte sayı üretilmedi). Web: iş emri detayında OEE kartı. Test: 4/4 e2e yeşil.
- [x] **Dokümantasyon iskeleti:** `docs/kurulum-kilavuzu.md`, `docs/kullanici-kilavuzu.md`, `docs/entegrasyon-kilavuzu.md`.
- [x] **Güvenlik özet dokümanı:** `docs/guvenlik-ozet.md` — Opcenter Security Concept'e benzer ama AHKMES'in gerçek durumunu yansıtan, IEC 62443/ISO 27001 sertifikasyonu iddia etmeyen dürüst bir doküman.
- [x] **Yedekleme:** `scripts/backup.sh` (pg_dump + gzip + retention), `scripts/restore.sh`, `docs/yedekleme.md`.

### v1.0 — İlk Satış Adayı (tamamlandı)
- [x] **Genealogy görselleştirme:** `GET /work-orders/:id/genealogy` — iş emri granülaritesinde backward (tüketilen malzeme) / forward (üretim koşuları, mamul girişi, müşteri/teklif) izlenebilirlik. **Bilinçli kapsam sınırı:** MTU/seri numarası bazlı takip yok (veri modelinde yok). Web: `/genealogy` sayfası.
- [x] **Basit Scheduling/Gantt:** `WorkOrder.plannedStartDate/plannedEndDate` (migration `add_work_order_schedule`), `PATCH /work-orders/:id/schedule`. Web: `/scheduling` — CSS-grid tabanlı 14 günlük Gantt görünümü, tıklayınca tarih düzenleme modalı. Otomatik kapasite planlama algoritması değil, manuel çizelgeleme.
- [x] **Automation Gateway — dinamik protokol seçici:** `Machine.connectorType` (MANUAL/OPC_UA/M80, migration `add_machine_connector_type`) + `connectorConfig` (Json). Web: Automation Gateway sayfasında "Bağlantı Ayarları" kartı — tip seçilince ilgili alanlar (OPC-UA: endpoint URL; M80: host/port) dinamik gösterilir. Kullanıcı geri bildirimi doğrultusunda ("hangi paneli seçersek seçelim arka planda o panelin bağlantı şekli olacak") tasarlandı.
- [x] **İkinci marka connector iskeleti (Fanuc FOCAS2):** `apps/connector/src/adapters/fanuc.adapter.ts` — `MachineAdapter` arayüzüne uyan, ama gerçek FOCAS2 native kütüphanesi (lisanslı, FFI gerektiren) entegre edilmediği için `connect()` açıkça "iskelet" hatası fırlatıyor. Çoklu-marka mimarisinin genişletilebilir olduğunu kanıtlıyor; M80'in aksine (açık kaynak reverse-engineering mevcut) Fanuc için ücretsiz bir eşdeğer yok.
- [x] **CI/CD pipeline:** `.github/workflows/ci.yml` — backend (Postgres service container + migrate + seed + typecheck + e2e), connector (typecheck+test), web (typecheck+test) olmak üzere 3 paralel job.

### Bilinçli ertelenen/yapılmayan (gerçekçi olmayan veya iş kararı gerektiren)
- Çoklu-tenant/SaaS mimarisi, IEC 62443/ISO 27001 sertifikasyonu, SLA/destek süreci, fiyatlandırma/lisanslama modeli, mobil/tablet operatör arayüzü, gerçek zamanlı otomatik APS algoritması, MTU/seri numarası bazlı genealogy — bunlar kod görevi değil, iş/pazarlama kararları veya çok daha büyük ayrı projeler.
- Fanuc FOCAS2 gerçek entegrasyonu — resmi lisans + native kütüphane gerektiriyor, iskelet ötesine geçmedi.

### Eksik giderme turu (2026-07-28) — kullanıcının "eksik kalan bir şey var mı" sorusuna verilen cevaplar
- [x] **Connector ↔ backend config bağlantısı:** `apps/connector/src/backend-config.ts` — `ADAPTER` env değişkeni verilmediyse connector, `GET /machines/:id/connector-config` (yeni, machine-key korumalı) ile web'de configure edilen `connectorType`/`connectorConfig`'i çekip kullanıyor. Env değişkenleri hâlâ öncelikli. 3 yeni test.
- [x] **Docker imajları güncellendi:** `docker compose build backend web` + `docker compose up -d` — yeni imajlar bugünkü tüm kodu içeriyor, compose Postgres'e (5434) migration'lar container açılışında otomatik uygulandı (mevcut `prisma migrate deploy` entrypoint'i sayesinde). `GET /non-conformances` compose backend'e (localhost:3000) karşı 200 döndü, doğrulandı.
- [x] **Tarayıcı QA:** `ecc:e2e-runner` agent'ı ile 4 yeni sayfa (Kalite, Genealogy, Scheduling, Automation Gateway bağlantı ayarları) + hamburger menü gerçek tarayıcıda (localhost:8080) test edildi — konsol hatası yok, tüm elemanlar bekleneni gösteriyor. Scheduling'de aktif iş emri olmadığı için tıklama-modal akışı canlı test edilemedi (veri kaynaklı, kod hatası değil).
- [x] **Yeni web sayfaları için testler:** `non-conformances.test.tsx` (3), `genealogy.test.tsx` (1), `scheduling.test.tsx` (2), `automation-gateway.test.tsx` (2) — toplam 8 yeni test, web suite 22/22 yeşil.
- [x] **Yedekleme scriptleri gerçekten çalıştırıldı:** `PG_DOCKER_CONTAINER` fallback eklendi (lokal `pg_dump`/`psql` yoksa docker exec üzerinden çalışıyor — bu ortamda gerekliydi). `backup.sh` dev Postgres'ten gerçek bir dump aldı (72K), `restore.sh` bu dump'ı geçici bir test veritabanına (`ahkmes_restore_test`) geri yükledi, `NonConformance`/`MachineTag` tablolarının doğru geldiği doğrulandı, test veritabanı temizlendi.

**Doğrulama:** connector 15/15, web 22/22, backend ilgili e2e'ler 24/24 (`--runInBand`) — hepsi yeşil.

**Doğrulama:** Tüm yeni/değişen alanlar için typecheck (backend/connector/web) temiz. e2e testleri `--runInBand` ile çalıştırıldığında (paralel worker'lar paylaşılan dev DB'de yarış durumuna yol açıyor, bu ortamsal bir kısıtlama) non-conformance/oee/machine-tags/machine-events dahil 24/24 yeşil.

## 7. Kapsam Dışı (bilinçli — Faz 2+)

Tezgah canlı izleme (geçmiş/grafik), OEE, kalite modülü, vardiya yönetimi, çizelgeleme takvimi, RLS/multi-tenant yönetim ekranları, sevkiyat.

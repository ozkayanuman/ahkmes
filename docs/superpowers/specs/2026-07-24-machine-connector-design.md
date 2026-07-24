# Faz 1 — Generic Machine Connector Framework (Tasarım)

**Tarih:** 2026-07-24
**Durum:** Onaylandı (kullanıcı brainstorming sürecinde onayladı)
**İlgili:** `PLAN.md` §6 Kapsam Dışı — "Machine Connector / FOCAS2 / MQTT / OPC UA"; `apps/connector-fanuc` yer tutucusunun yerini alır ve genelleştirir.

## Amaç

Faz 0'da tüm üretim verisi (adet, durum) elle giriliyor (`ProductionRun.source = MANUAL`). Bu fazın amacı, hangi CNC kontrolcü markası/protokolü olursa olsun (Fanuc, Siemens, Mitsubishi, Heidenhain...) bağlanabilecek, **Kepware/OPC-UA benzeri protokol-bağımsız bir adapter mimarisi** kurmak. Kullanıcının elindeki SMEC MCV-5500 tezgahının kontrolcü serisi şu an bilinmediğinden, ilk sürüm gerçek donanım olmadan bir **simülatör adapter** ile uçtan uca doğrulanabilir olmalı; gerçek protokol netleşince yeni bir adapter eklemek yeterli olmalı, çekirdek mimari değişmemeli.

## Kapsam

**Bu fazda var:**
- Protokol-bağımsız `MachineAdapter` arayüzü ve bir adapter loader.
- `simulator.adapter.ts` — sahte makine olayları üreten, donanımsız test için referans adapter.
- `opcua.adapter.ts` — referans "gerçek protokol" adapter'ı; `node-opcua` (açık kaynak, ücretsiz) ile, ücretsiz açık kaynak bir OPC-UA test/simülasyon sunucusuna karşı geliştirilip test edilir (gerçek makineye bağlanmıyor — kontrolcü bilgisi netleşmeden bağlanılamaz).
- Backend'de makineye özel API key ile korunan telemetri alım endpoint'i.
- Telemetri olaylarının `ProductionRun` (source=MACHINE) kayıtlarına otomatik yansıması.
- Web'de tezgah bazlı canlı durum görünümü ve "aktif iş emri" ataması.

**Bu fazda yok (bilinçli):**
- Gerçek Fanuc FOCAS2 / MTConnect / Siemens adapter implementasyonu (mimari buna izin verir, kod yazılmaz).
- Olay dedup/idempotency (aşağıda "Bilinen Sınırlamalar"da açıklanıyor).
- OEE hesaplama, kalite modülü, vardiya yönetimi, çizelgeleme — PLAN.md §6'da zaten Faz 1+ kapsamı dışında tutulmuş, bu spec onlara girmiyor.
- Bir connector sürecinin birden çok makineyi yönetmesi (v1: 1 süreç = 1 makine).

## Mimari

```
┌─────────────────────┐      OPC-UA/sim       ┌──────────────────────────┐
│  Gerçek makine veya  │ ───────────────────▶ │  apps/connector           │
│  OPC-UA simülatörü   │                       │  ┌────────────────────┐  │
└─────────────────────┘                        │  │ MachineAdapter     │  │
                                                │  │ (simulator | opcua)│  │
                                                │  └─────────┬──────────┘  │
                                                │            ▼             │
                                                │   core/connector.ts      │
                                                │   (normalize + kuyruk +  │
                                                │    retry/backoff)        │
                                                └────────────┬─────────────┘
                                                             │ HTTPS
                                                             │ X-Machine-Key
                                                             ▼
                                        ┌────────────────────────────────┐
                                        │ backend: POST /machines/:id/    │
                                        │ telemetry (machine-events mod.) │
                                        │  → ProductionRun create/update  │
                                        │  → Machine durum cache          │
                                        │  → Socket.IO: machine.updated,  │
                                        │    machine.alarm                │
                                        └────────────────┬─────────────────┘
                                                          ▼
                                              apps/web: canlı tezgah paneli
```

## Bileşenler

### 1. `apps/connector` (yeni paket)

Protokol-bağımsız, bağımsız çalışan bir Node/TS servisi. `apps/backend`'e bağımlı değildir, sadece HTTP ile konuşur.

```
apps/connector/
├── src/
│   ├── adapters/
│   │   ├── adapter.interface.ts   # MachineAdapter arayüzü + MachineEvent tipi
│   │   ├── simulator.adapter.ts
│   │   └── opcua.adapter.ts
│   ├── core/
│   │   └── connector.ts           # adapter → normalize → HTTP POST + retry kuyruğu
│   ├── config.ts                  # env: MACHINE_ID, ADAPTER, BACKEND_URL, MACHINE_API_KEY, ...
│   └── main.ts
└── test/
    ├── simulator.adapter.spec.ts
    └── connector.spec.ts
```

**`MachineAdapter` arayüzü:**
```ts
interface MachineEvent {
  type: "CYCLE_START" | "CYCLE_END" | "PART_COMPLETE" | "ALARM" | "IDLE";
  timestamp: string;      // ISO
  payload?: Record<string, unknown>; // ör. alarm metni, program adı
}

interface MachineAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onEvent(cb: (event: MachineEvent) => void): void;
}
```

**`simulator.adapter.ts`:** Yapılandırılabilir bir döngüde (`CYCLE_TIME_MS` env) `CYCLE_START` → birkaç saniye sonra `PART_COMPLETE` → `CYCLE_END` üretir; ayarlanabilir olasılıkla arada `ALARM`/`IDLE` üretir. Gerçek donanım olmadan tüm zinciri (backend ingestion → ProductionRun → web canlı görünüm) doğrulamak için kullanılır.

**`opcua.adapter.ts`:** `node-opcua` ile bir OPC-UA sunucusuna client olarak bağlanır, config'den verilen node ID'lere subscribe olur, gelen değer değişimlerini `MachineEvent`'e çevirir. Geliştirme/test aşamasında ücretsiz açık kaynak bir OPC-UA örnek/simülasyon sunucusuna (`node-opcua` kendi örnek sunucusu gibi) karşı çalıştırılır — gerçek SMEC MCV-5500'e bağlanmaz (kontrolcü/protokol bilgisi yok).

**`core/connector.ts`:** Adapter olaylarını dinler, `POST {BACKEND_URL}/machines/{MACHINE_ID}/telemetry` çağrısı yapar (`X-Machine-Key: {MACHINE_API_KEY}`). Backend ulaşılamazsa olaylar bellek içi bir kuyrukta (üst sınırlı, ör. 500 olay) tutulur, üstel geri çekilmeli (exponential backoff) yeniden denenir; kuyruk dolarsa en eski olay atılır (telemetri kaybı, veri bütünlüğü kritik değil — kabul edilen sınırlama).

### 2. Backend — `machine-events` modülü

- **Prisma:** `Machine` modeline eklenir:
  - `activeWorkOrderId String?` (FK → WorkOrder, nullable) — ustabaşının "bu tezgahta şu an çalışan iş emri" ataması.
  - `connectorKeyHash String?` — connector'ın kullandığı API key'in bcrypt hash'i (`Machine` oluşturulurken/`POST /machines/:id/connector-key` ile üretilir, düz metin sadece bir kez döner).
- **Seed:** Her tenant için `"Makine Bağlantısı"` adlı, `OPERATOR` rolünde, normal login akışına kapatılmış (rastgele/bilinmeyen şifre) bir sistem `User` kaydı eklenir — MACHINE kaynaklı `ProductionRun.operatorId` bu kullanıcıya işaret eder.
- **`MachineKeyGuard`:** `X-Machine-Key` header'ını ilgili `Machine.connectorKeyHash` ile karşılaştırır (kullanıcı JWT'sinden bağımsız, ayrı bir guard). Eşleşmezse 401.
- **`POST /machines/:id/telemetry`** (yalnızca `MachineKeyGuard`, kullanıcı rolü gerekmez):
  - `CYCLE_START`: `Machine.activeWorkOrderId` yoksa 409 döner (connector loglar, kullanıcıya UI'dan görünür bir "atanmamış" durumu olur). Varsa ve o iş emrinde aktif run yoksa, mevcut `ProductionService` mantığına benzer şekilde `source: "MACHINE"`, `operatorId: <sistem kullanıcısı>` ile yeni `ProductionRun` açılır, `WorkOrder.status` `IN_PRODUCTION`'a çekilir.
  - `PART_COMPLETE`: aktif MACHINE run'ının `goodCount`'u 1 artırılır.
  - `ALARM`: aktif run varsa `downtimeNote` güncellenir; `machine.alarm` realtime olayı yayınlanır (run yoksa sadece olay yayınlanır, hata değildir).
  - `CYCLE_END` / `IDLE`: v1'de sadece `machine.updated` realtime olayını tetikler (run'ı otomatik kapatmaz — kapatma/tamamlama kararını hâlâ insan verir, Faz 0c'deki `POST /runs/:id/complete` akışı geçerliliğini korur).
  - Tüm olaylar `Machine` için bellek içi/DB'de son bilinen durumu günceller (`lastEventAt`, `lastStatus`) ve `machine.updated` Socket.IO olayı ile yayınlanır.
- **`shared-types`:** `MachineEventTypeSchema` enum'ı (`CYCLE_START | CYCLE_END | PART_COMPLETE | ALARM | IDLE`) ve `machineTelemetrySchema` DTO'su eklenir.

### 3. Web

- Tezgahlar (`machines.tsx`) sayfasına: canlı durum rozeti (Çalışıyor/Boşta/Alarm/Bağlı değil), aktif iş emri, son olay zamanı — `useInvalidateOn(["machine.updated", "machine.alarm"], ["/machines"])` ile.
- Aktif iş emri ataması: tezgah satırında/düzenleme formunda, o tezgaha atanmış (`WorkOrder.machineId = machine.id`, terminal olmayan) iş emirleri arasından seçim — `PATCH /machines/:id` içine `activeWorkOrderId` eklenir (mevcut rol/izin kuralları: ADMIN/PLANNER/FOREMAN).

## Hata Yönetimi

- Connector → backend bağlantı kopukluğu: bellek içi kuyruk + backoff (yukarıda).
- Geçersiz/eksik API key: `401 Unauthorized`, connector loglar ve yeniden dener (key rotasyonu manuel, connector süreci yeniden başlatılmalı).
- `CYCLE_START` sırasında atanmış iş emri yoksa: `409 Conflict`, connector bu olayı düşürür (yeniden denemez — sonraki cycle'da tekrar dener).
- OPC-UA adapter bağlantı kaybı: `node-opcua`'nın kendi reconnect mekanizması kullanılır; sürekli başarısızlıkta connector süreci `ALARM`-benzeri bir "adapter down" logu basar (backend'e olay olarak gönderilmez — bu bir connector-seviye durumdur).

## Bilinen Sınırlamalar (v1, bilinçli kabul edilen)

- **Olay dedup yok:** Ağ tekrarı/connector yeniden başlatması aynı `PART_COMPLETE`'i iki kez gönderirse `goodCount` çift artar. v1'de bu risk kabul edilir (YAGNI — gerçek donanım/protokol netleşmeden idempotency anahtarı tasarımı erken optimizasyon olur).
- **Tek connector = tek makine:** Çoklu makine yönetimi (bir connector sürecinin birden fazla tezgahı yönetmesi) sonraki bir iterasyona bırakılıyor.
- **OPC-UA adapter gerçek donanımla doğrulanmamıştır:** Kontrolcü/protokol bilgisi netleşene kadar yalnızca açık kaynak simülasyon sunucusuna karşı test edilir.

## Test Planı

- **`apps/connector` birim testleri (vitest):**
  - `simulator.adapter.spec.ts`: olay sırası (CYCLE_START → PART_COMPLETE → CYCLE_END) ve zamanlama.
  - `connector.spec.ts`: adapter olayı → normalize edilmiş HTTP payload eşlemesi; backend 500 dönünce kuyruğa alma + retry; kuyruk taşınca en eski olayın düşürülmesi.
- **Backend e2e (`test/machine-events.e2e-spec.ts`):**
  - Geçersiz `X-Machine-Key` → 401.
  - `activeWorkOrderId` atanmamışken `CYCLE_START` → 409.
  - `activeWorkOrderId` atanmışken `CYCLE_START` → `ProductionRun` oluşur, `source=MACHINE`, `WorkOrder.status=IN_PRODUCTION`.
  - `PART_COMPLETE` → `goodCount` artışı.
  - `ALARM` → `downtimeNote` güncellenir.
  - Var olmayan `machineId` → 404.

## Açık Kalan Sorular (implementasyon planında netleştirilecek)

- `connectorKeyHash` üretim/gösterim akışının tam UI/UX'i (muhtemelen `machines.tsx` düzenleme formuna "Connector Key Oluştur" butonu).
- `apps/connector`'ın Docker Compose'a opsiyonel bir servis olarak mı ekleneceği, yoksa yalnızca standalone çalıştırma talimatı olarak mı bırakılacağı (gerçek donanım yokken varsayılan olarak simülatör ile compose'a eklenmesi öneriliyor, ama zorunlu değil).

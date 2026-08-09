# AHK-018 tamamlama — Andon çağrı butonu + taksonomi Pareto raporu

**Tarih:** 2026-08-09
**İlgili backlog:** `AHK-018` (PLAN.md §20) — Downtime/Andon taksonomisi, `PARTIAL`
**Kapsam:** PLAN.md'nin AHK-018 için işaretlediği iki eksik: (1) Andon panosu/HMI'da
elle duruş çağrısı butonu (backend API hazır, hiçbir frontend kullanmıyor),
(2) `DowntimeEvent`/`DowntimeReason` taksonomisine dayalı yeni Pareto raporu
(mevcut Pareto hâlâ `MachineStatusEvent`'in serbest-metin mesajından türetiliyor).

## Mevcut durum (keşif özeti)

- Backend: `downtime.service.ts`/`downtime.controller.ts` tam — `reasons`
  CRUD, `list`, `start`, `classify`, `end`. AHK-009 outbox'ını kullanıyor
  (`downtime.started`/`downtime.ended`). Sınıf seviyesinde
  `@RequirePage("alarms")`.
- Frontend: `/downtime/*` API'sini kullanan **hiçbir sayfa yok**. Tek
  "downtime" referansı `production.tsx`'teki eski, taksonomiyle ilgisiz
  `ProductionRun.downtimeNote` serbest metin alanı.
- Pareto: `oee.service.ts#downtimePareto()` hâlâ `MachineStatusEvent`'in
  `message` alanından (freetext) grupluyor — yeni `DowntimeReason` kataloğunu
  hiç kullanmıyor. Sonuç şekli: `{reason, totalSeconds, count}`.
  `apps/web/src/components/oee-charts.tsx#DowntimeParetoChart` bu şekli
  render ediyor, `dashboard.tsx` bu grafiği bu kaynaktan besliyor (değişmeyecek).
- HMI sayfası (`hmi-operations.tsx`) `@RequirePage("hmi-operations")` altında,
  action grant'leri (`HMI_READ`/`HMI_START`/`HMI_COMPLETE`) `alarms` sayfa
  yetkisinden bağımsız — bir operatörün sadece `hmi-operations` yetkisi olup
  `alarms` yetkisi olmaması mümkün/beklenen. `downtime.controller.ts`'nin
  sınıf seviyesi `@RequirePage("alarms")`'ı bu operatörü 403'e düşürür.
- `alarms.tsx` zaten `AlarmDefinition` kataloğu + aktif alarm listesi + Pareto
  tablosunu tek sayfada topluyor — `DowntimeReason` için birebir aynı desen
  doğrudan uygulanabilir.

## Karar — kapsam ve konum

Kullanıcı onayı (AskUserQuestion, 2026-08-09): her iki eksik de bu turda
kapanacak; çağrı butonu **HMI operatör terminaline** eklenecek (Andon panosu
kasıtlı olarak dokunmatik olmayan bir salon ekranı — tasarım niyeti korunur).

## Değişiklikler

### 1. Backend — yeni Pareto endpoint'i

`DowntimeService.pareto(tenantId, days)`: kapanmış (`endedAt != null`)
`DowntimeEvent` kayıtlarını `reason?.label ?? "Sınıflandırılmamış"`'a göre
grupla, `(endedAt - startedAt)` saniyesini topla + say, azalan sırala.
`alarms.service.ts#pareto()` ile aynı yöntem imzası deseni (tenantId,
opsiyonel machineId/from/to yerine burada basit `days` — `oee.service.ts`
ile tutarlı). Çıktı şekli `oee.service.ts#downtimePareto()` ile birebir aynı
olmalı ki `DowntimeParetoChart` değişmeden reuse edilsin.

`GET /downtime/pareto?days=` yeni controller metodu, `@RequirePage("alarms")`
(sınıf varsayılanı yeterli — admin/config sayfası).

### 2. Backend — HMI erişim açığı

`findReasons`, `list`, `start`, `end` metodlarına method-level
`@RequirePage("alarms", "hmi-operations")` eklenir (mevcut `RequirePage`
OR-semantiği, AR/AP'nin `sales-orders`/`ar` desenindeki gibi). `classify` ve
reason CRUD (`createReason`/`updateReason`) `alarms`-only kalır (Roles zaten
ADMIN/PLANNER/FOREMAN ile sınırlı, OPERATOR'a kapalı — bilinçli, sınıflandırma
ustabaşı/admin işi).

### 3. Frontend — `alarms.tsx`: "Duruş Yönetimi" bölümü

`AlarmDefinition` kataloğu bloğunun birebir deseni:
- `DowntimeReason` kataloğu tablosu (kod/etiket/kategori/aktif) +
  "Yeni Duruş Nedeni" modalı (code/label/category — `createDowntimeReasonSchema`
  ile uyumlu, `category` için PLANNED/UNPLANNED select).
- Yeni "Duruş Pareto" tablo/grafik bölümü, `GET /downtime/pareto`'dan
  `DowntimeParetoChart` ile render edilir.
- Var olan "Aktif Alarmlar"/"Alarm Kod Kataloğu"/"Frekans (Pareto)"
  bölümlerine dokunulmaz, altına eklenir.

### 4. Frontend — `hmi-operations.tsx`: "Duruş" kartı

`OperationDetail` içine, seçili operasyonun `detail.machine.id`'sine bağlı
yeni kart (machine atanmamışsa kart hiç gösterilmez):
- `GET /downtime?machineId=<id>&open=true` ile açık duruş sorgusu.
- Açık duruş yoksa ve `HMI_START` action grant'i varsa: "Duruş Bildir"
  butonu → inline neden select (`GET /downtime/reasons`, opsiyonel) + not
  alanı → `POST /downtime/start`.
- Açık duruş varsa: başlangıç zamanı + neden (varsa) gösterilir, "Duruşu
  Bitir" butonu → `PATCH /downtime/:id/end` (bitişte de neden seçilebilir,
  henüz sınıflandırılmamışsa).
- `useInvalidateOn` çağrısına `downtime.started`/`downtime.ended` eklenir,
  ilgili query key invalide edilir (AHK-009 outbox zaten bu event'leri
  yayınlıyor — yeni bir sinyal eklemiyoruz).

## Kapsam dışı (bilinçli)

- Andon panosunun (`andon.tsx`) dokunmatik hale getirilmesi — tasarım
  niyetine aykırı, kullanıcı onayıyla reddedildi.
- `DowntimeEvent` geçmişinin (kapalı kayıtlar) ayrı bir liste/rapor sayfası —
  bu turun kapsamı sadece çağrı + taksonomi Pareto.
- `classify` endpoint'i için HMI erişimi — sınıflandırma admin/ustabaşı işi
  olarak kalır, operatör start/end sırasında neden seçebiliyor zaten.

## Test planı

- Yeni `apps/backend/src/downtime/downtime.service.spec.ts`: `pareto()` için
  reason gruplama, sınıflandırılmamış (`reasonId=null`) fallback, sadece
  kapanmış kayıtların sayılması.
- `apps/backend/test/downtime.e2e-spec.ts`'ye ekleme: sadece
  `hmi-operations` sayfa yetkisi olan (alarms yetkisi OLMAYAN) bir kullanıcının
  `list`/`start`/`end` çağırabildiği; `pareto` endpoint'inin start+end+classify
  sekansından doğru toplam süre/sayım döndürdüğü.
- Web: bu iki sayfa (`alarms.tsx`, `hmi-operations.tsx`) için projede zaten
  hiç unit test yok (proje genelinde nadir bir desen) — yeni test altyapısı
  kurulmuyor; backend testleri + `tsc --noEmit` (backend+web) + `docker
  compose` duman testiyle (proje konvansiyonu) doğrulanacak.

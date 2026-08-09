# AHKMES Entegrasyon Kılavuzu

## 1. Kimlik Doğrulama

Tüm kullanıcı API'leri JWT tabanlıdır:

```
POST /auth/login  { email, password } → { accessToken, refreshToken }
POST /auth/refresh { refreshToken } → { accessToken, refreshToken }
```

İstekler `Authorization: Bearer <accessToken>` header'ı ile yapılır.

Makine/connector süreçleri için ayrı, JWT'siz bir kimlik doğrulama mekanizması vardır: `X-Machine-Key` header'ı (bkz. §3).

## 2. Genel API Prensipleri

- Tüm liste/detay uçları tenant-scoped'dır (kullanıcının `tenantId`'sine göre filtrelenir).
- Yazma işlemleri rol bazlı korunur (`ADMIN`, `PLANNER`, `FOREMAN`, `OPERATOR`).
- Hatalar standart NestJS formatında döner: `{ statusCode, message, error }`.
- Girdi doğrulama Zod şemalarıyla yapılır (`packages/shared-types`), hatalı istek 400 döner.

ERP/MES veri sahipliği ve adapter sınırları için [ERP / MES veri sahipliği sözleşmesi](erp-ownership-matrix.md)
esas alınır. Hedef ERP seçilmeden doğrudan veritabanı entegrasyonu yapılmaz.

### 2.1 Webhook teslim geçmişi ve replay

Webhook aboneleri için dış teslimler kalıcı kuyrukta tutulur; başarısız teslimler
üstel geri çekilme ile yeniden denenir ve son denemeden sonra dead-letter'a alınır.
Yalnızca `ADMIN` rolü aşağıdaki uçları kullanabilir:

```
GET  /webhooks/deliveries?status=PENDING|PROCESSING|DELIVERED|DEAD_LETTER
POST /webhooks/deliveries/:id/replay
```

Replay yalnızca dead-letter kaydı tekrar `PENDING` durumuna alır. Bu teslim
dayanıklılığı, uygulama mutasyonunun transaction-içi outbox'ı olduğu anlamına
gelmez; kritik komutlar için bu bağ ayrıca kurulmalıdır.

## 3. Machine Connector Entegrasyonu

### 3.1 Connector Anahtarı

```
POST /machines/:id/connector-key   (ADMIN/PLANNER, JWT gerekli)
→ { key: "<düz metin, bir kez gösterilir>" }
```

### 3.2 Telemetri Gönderme

```
POST /machines/:id/telemetry
Header: X-Machine-Key: <key>
Body: { type: "CYCLE_START"|"CYCLE_END"|"PART_COMPLETE"|"ALARM"|"IDLE", timestamp?, payload? }
```

### 3.3 Tag Değeri Gönderme (Automation Gateway)

```
POST /machines/:id/tag-values
Header: X-Machine-Key: <key>
Body: { values: [{ tagName, value, timestamp? }] }
```

Tanımsız `tagName` sessizce atlanır (önce `POST /machines/:id/tags` ile tag tanımlanmalı).

### 3.4 Desteklenen Protokol Adaptörleri (`apps/connector`)

| Adaptör | Durum | Not |
|---|---|---|
| Simulator | Üretime hazır (test amaçlı) | Donanımsız uçtan uca test için |
| OPC-UA | Üretime hazır | node-opcua, gerçek `browse()` ile tag keşfi destekler |
| Mitsubishi M80 (EZSocket/GIOP) | Deneysel | Açık kaynak reverse-engineering temelli, gerçek cihazda doğrulanmadı |
| Fanuc FOCAS2 | İskelet/placeholder | Gerçek FOCAS2 kütüphanesi lisanslı, henüz entegre değil |

Yeni bir adaptör eklemek için `apps/connector/src/adapters/adapter.interface.ts`'teki `MachineAdapter` arayüzü implement edilir.

Connector, backend'e teslim edilemeyen makine olaylarını `DURABLE_QUEUE_PATH` altındaki
kalıcı kuyrukta saklar. Docker `connector` profili bunu varsayılan olarak
`connector-data` volume'unda `/var/lib/ahkmes/edge.queue.json` konumuna bağlar;
edge yeniden başlasa bile teslim edilmemiş olaylar tekrar denenir. Kuyruk sınırı
aşılırsa en eski telemetri olayı düşürülür; bu durum üretim sayımı için bir hata
alarımı ve operasyonel müdahale konusu olarak ele alınmalıdır.

### 3.5 Edge sağlık ve metrikleri

Connector `HEALTH_PORT` sıfırdan büyükse yalnızca `127.0.0.1` üzerinde iki uç açar:

- `GET /health`: adapter bağlantısı, kuyruk derinliği ve son hata ile 200/503 durumunu döner.
- `GET /metrics`: Prometheus metin biçiminde kuyruk, teslim edilen event ve tag-poll hata sayaçlarını döner.

Compose connector profili varsayılan `9464` portunu kullanır; bu port host ağına
yayınlanmaz ve container healthcheck'i loopback üzerinden çağırır. Production'da
backend URL'si HTTPS reverse proxy üzerinden verilmelidir. Mevcut cihaz kimliği,
makine başına rotasyona açık `X-Machine-Key` değeridir; mTLS ve sertifika yaşam
döngüsü henüz ürün kapsamına alınmamıştır.

## 4. Dosya Depolama (STEP/Talimat/NC Program)

```
POST /documents  (multipart/form-data: file + entityType + entityId + docType)
GET  /documents?entityType=...&entityId=...
GET  /documents/:id/url  → presigned indirme URL'i (attachment zorunlu, XSS önlemi)
DELETE /documents/:id
```

## 5. Gerçek Zamanlı Olaylar (Socket.IO)

Web istemcisi `io(BACKEND_URL, { auth: { token } })` ile bağlanır. Yayınlanan başlıca event'ler:

| Event | Payload | Ne zaman |
|---|---|---|
| `workorder.updated` | `{ id, status? }` | İş emri durumu değiştiğinde |
| `productionrun.updated` | `{ id }` | Üretim koşusu güncellendiğinde |
| `machine.updated` | `{ id, status }` | Makine telemetri aldığında |
| `machine.alarm` | `{ machineId, message }` | ALARM event'i geldiğinde |
| `nonconformance.updated` | `{ id, workOrderId }` | Kalite kaydı oluşturulduğunda/kapandığında |
| `tag.value.updated` | `{ machineId, values }` | Tag değeri güncellendiğinde |

## 6. Sınırlamalar (v0.9)

- ERP entegrasyonu (SAP/Logo/Netsis vb.) henüz yok — hedef ERP ve sahiplik
  matrisi seçilmeden adapter yazılmaz (bkz. `erp-ownership-matrix.md`,
  `PLAN.md` AHK-010).
- Toplu (batch) iş emri import API'si yok, tekil CRUD var.
- Gelen (inbound) webhook/mesaj için dedup (inbox) yok — sadece giden
  (outbound) webhook teslimi kalıcı/tekrar denemeli (§2.1). Domain event'leri
  Socket.IO ile canlı bağlı istemcilere, transactional outbox üzerinden
  webhook abonelerine dağıtılır; bağlı olmayan bir istemci Socket.IO
  event'ini kaçırırsa yeniden oynatma mekanizması yoktur (webhook teslim
  geçmişinin aksine).

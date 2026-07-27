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

- ERP entegrasyonu (SAP/Logo/Netsis vb.) henüz yok — REST API üzerinden özel entegrasyon yazılabilir.
- Toplu (batch) iş emri import API'si yok, tekil CRUD var.
- Webhook/dış sistem bildirim mekanizması yok, yalnızca Socket.IO (yalnızca bağlı istemciler alır).

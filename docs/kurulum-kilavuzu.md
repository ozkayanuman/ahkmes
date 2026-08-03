# AHKMES Kurulum Kılavuzu

## 1. Genel Bakış

AHKMES; NestJS (backend), React (web), PostgreSQL ve MinIO bileşenlerinden oluşan, Docker Compose ile tek komutla ayağa kaldırılabilen bir MES (Manufacturing Execution System) uygulamasıdır.

## 2. Sistem Gereksinimleri

| Bileşen | Minimum |
|---|---|
| İşletim Sistemi | Windows 10/11, Linux, macOS (Docker destekleyen herhangi biri) |
| Docker | 24+ (Docker Desktop veya Docker Engine) |
| RAM | 4 GB boş (Postgres + backend + web + MinIO için) |
| Disk | 5 GB boş |
| Ağ | 3000 (backend), 8080 (web), 5434 (Postgres), 9000-9001 (MinIO) portları boş olmalı |

## 3. Docker Compose ile Kurulum (Önerilen)

```bash
git clone <repo-url> ahkmes
cd ahkmes
cp .env.example .env
# .env dosyasındaki DATABASE_URL, JWT_SECRET, MINIO_* değerlerini düzenleyin
docker compose up -d
```

Kurulum tamamlandığında:
- Web arayüzü: `http://localhost:8080`
- Backend API: `http://localhost:3000`
- MinIO konsolu: `http://localhost:9001`

İlk açılışta backend konteyneri otomatik olarak veritabanı migration'larını ve seed verisini (varsayılan admin kullanıcı) çalıştırır.

## 4. Varsayılan Giriş Bilgileri

| Alan | Değer |
|---|---|
| E-posta | `admin@ahkmes.local` (`.env`'deki `SEED_ADMIN_EMAIL` ile değiştirilebilir) |
| Şifre | `.env`'deki `SEED_ADMIN_PASSWORD` |

**Önemli:** Üretim ortamına geçmeden önce bu şifre mutlaka değiştirilmelidir.

## 5. Ortam Değişkenleri (.env)

| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | PostgreSQL bağlantı adresi |
| `JWT_SECRET` | Token imzalama anahtarı — üretimde mutlaka rastgele, uzun bir değerle değiştirilmeli |
| `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | Dosya deposu (STEP/talimat/NC program) için |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | İlk kurulumda oluşturulan admin kullanıcı |

## 6. Geliştirme Ortamı (Docker Olmadan)

```bash
pnpm install
# Postgres'i ayrı bir container'da çalıştırın (bkz. README)
pnpm --filter @ahkmes/backend prisma migrate dev
pnpm --filter @ahkmes/backend start:dev
pnpm --filter @ahkmes/web dev
```

## 7. Yedekleme

Bkz. `docs/yedekleme.md`.

## 8. İzole e2e doğrulaması

Geliştirici veritabanını koruyarak backend e2e paketini çalıştırmak için:

```bash
pnpm test:e2e
# yalnızca bir e2e dosyası için:
pnpm test:e2e test/oee-trend.e2e-spec.ts
```

Komut geçici, host porta bağlı olmayan PostgreSQL, MinIO ve LDAP konteynerleri
oluşturur; migration ve seed'i bu boş PostgreSQL'e uygular, e2e testlerini
çalıştırır ve sonuçtan sonra bütün geçici kaynakları siler. Docker Desktop veya
Docker Engine çalışıyor olmalıdır. Ürün Compose yığınını veya `.env` dosyasını
kullanmaz.

## 9. Bilinen Kısıtlamalar (v0.9)

- Tek-tenant mimari — birden fazla şirkete aynı kurulumdan hizmet vermek için ek geliştirme gerekir.
- Machine Connector (OPC-UA/Mitsubishi M80) ayrı bir edge süreçtir; Compose'ta varsayılan olarak kapalı `connector` profilinde bulunur. Kalıcı kuyruk `connector-data` volume'undadır; sağlık ucu yalnızca connector container'ının loopback'ine bağlanır.
- Otomatik SSL/TLS sonlandırma yok — üretimde bir reverse proxy (nginx/Caddy) arkasında çalıştırılması önerilir.

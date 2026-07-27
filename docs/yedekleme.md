# AHKMES Yedekleme ve Geri Yükleme

## 1. Yedekleme

```bash
DATABASE_URL="postgresql://ahkmes:***@localhost:5433/ahkmes" ./scripts/backup.sh ./backups
```

- Çıktı: `./backups/ahkmes_YYYYMMDD_HHMMSS.sql.gz`
- Varsayılan saklama süresi 14 gün (`BACKUP_RETENTION_DAYS` ile değiştirilebilir), bu süreden eski yedekler otomatik silinir.

## 2. Geri Yükleme

```bash
DATABASE_URL="postgresql://ahkmes:***@localhost:5433/ahkmes" ./scripts/restore.sh ./backups/ahkmes_20260101_030000.sql.gz
```

**Dikkat:** Bu işlem hedef veritabanının üzerine yazar, geri alınamaz. Üretimde çalıştırmadan önce mutlaka güncel bir yedek alınmalı.

## 3. Zamanlanmış Yedekleme (Öneri)

Cron ile günlük yedekleme:

```cron
0 3 * * * DATABASE_URL="postgresql://ahkmes:***@localhost:5433/ahkmes" /path/to/ahkmes/scripts/backup.sh /path/to/backups >> /var/log/ahkmes-backup.log 2>&1
```

## 4. MinIO (Dosya Deposu) Yedekleme

`scripts/backup.sh` yalnızca PostgreSQL'i kapsar. MinIO'daki dosyalar (STEP/talimat/NC program) için `mc mirror` (MinIO Client) ile ayrı bir yedekleme stratejisi kurulmalıdır — bu v0.9 kapsamına dahil değildir, bilinen bir sınırlamadır.

## 5. Felaket Kurtarma (Disaster Recovery) — Kaba Prosedür

1. Yeni ortamda `docker compose up -d` ile boş bir kurulum başlatın (migration'lar otomatik çalışır).
2. `./scripts/restore.sh <en son yedek>` ile veritabanını geri yükleyin.
3. MinIO verisi ayrıca yedeklenmişse geri yükleyin.
4. Uygulamayı yeniden başlatıp `GET /health` ile doğrulayın.

**RTO/RPO hedefleri henüz resmi olarak tanımlanmadı** — bu, müşteriyle SLA görüşmesinde netleştirilmesi gereken bir konudur.

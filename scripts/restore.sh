#!/usr/bin/env bash
# AHKMES PostgreSQL geri yükleme scripti.
# Kullanım: ./scripts/restore.sh <yedek-dosyası.sql.gz>
# Ortam değişkenleri: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (veya DATABASE_URL)
set -euo pipefail

BACKUP_FILE="${1:?Kullanım: ./scripts/restore.sh <yedek-dosyası.sql.gz>}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Hata: $BACKUP_FILE bulunamadı" >&2
  exit 1
fi

if [ -n "${DATABASE_URL:-}" ]; then
  RESTORE_TARGET="$DATABASE_URL"
else
  RESTORE_TARGET="-h ${PGHOST:-localhost} -p ${PGPORT:-5432} -U ${PGUSER:-ahkmes} ${PGDATABASE:-ahkmes}"
fi

if [ -z "${RESTORE_YES:-}" ]; then
  echo "UYARI: Bu işlem hedef veritabanının üzerine yazacak. Devam etmek için Enter'a basın, iptal için Ctrl+C."
  read -r
fi

echo "Geri yükleniyor: $BACKUP_FILE"
if [ -n "${PG_DOCKER_CONTAINER:-}" ]; then
  gunzip -c "$BACKUP_FILE" | docker exec -i "$PG_DOCKER_CONTAINER" psql -U "${PGUSER:-ahkmes}" -d "${PGDATABASE:-ahkmes}"
elif command -v psql >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  gunzip -c "$BACKUP_FILE" | psql $RESTORE_TARGET
else
  echo "Hata: psql bulunamadı. Ya psql'i kurun ya da PG_DOCKER_CONTAINER=<container-adı> ile çalıştırın." >&2
  exit 1
fi

echo "Geri yükleme tamamlandı."

#!/usr/bin/env bash
# AHKMES PostgreSQL geri yükleme scripti.
# Kullanım: ./scripts/restore.sh <yedek-dosyası.sql.gz>
# Ortam değişkenleri: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (veya DATABASE_URL)
set -euo pipefail

BACKUP_FILE="${1:?Kullanım: ./scripts/restore.sh <yedek-dosyası.sql.gz>}"

strip_prisma_schema() {
  local url="$1" base query filtered
  base="${url%%\?*}"
  if [ "$base" = "$url" ]; then printf '%s' "$url"; return; fi
  query="${url#*\?}"
  filtered="$(printf '%s' "$query" | tr '&' '\n' | grep -v '^schema=' | paste -sd '&' -)"
  if [ -n "$filtered" ]; then printf '%s?%s' "$base" "$filtered"; else printf '%s' "$base"; fi
}

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Hata: $BACKUP_FILE bulunamadı" >&2
  exit 1
fi

if [ -z "${RESTORE_YES:-}" ]; then
  echo "UYARI: Bu işlem hedef veritabanının üzerine yazacak. Devam etmek için Enter'a basın, iptal için Ctrl+C."
  read -r
fi

echo "Geri yükleniyor: $BACKUP_FILE"
if [ -n "${PG_DOCKER_CONTAINER:-}" ]; then
  gunzip -c "$BACKUP_FILE" | docker exec -i "$PG_DOCKER_CONTAINER" psql -U "${PGUSER:-ahkmes}" -d "${PGDATABASE:-ahkmes}"
elif command -v psql >/dev/null 2>&1; then
  if [ -n "${DATABASE_URL:-}" ]; then
    # Prisma-only `schema` is not a valid libpq connection option.
    PSQL_URL="$(strip_prisma_schema "$DATABASE_URL")"
    gunzip -c "$BACKUP_FILE" | psql "$PSQL_URL"
  else
    gunzip -c "$BACKUP_FILE" | psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-ahkmes}" "${PGDATABASE:-ahkmes}"
  fi
else
  echo "Hata: psql bulunamadı. Ya psql'i kurun ya da PG_DOCKER_CONTAINER=<container-adı> ile çalıştırın." >&2
  exit 1
fi

echo "Geri yükleme tamamlandı."

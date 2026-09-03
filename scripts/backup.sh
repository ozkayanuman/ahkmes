#!/usr/bin/env bash
# AHKMES PostgreSQL yedekleme scripti.
# Kullanım: ./scripts/backup.sh [hedef-klasör]
# Ortam değişkenleri: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (veya DATABASE_URL)
#   PG_DOCKER_CONTAINER: lokal pg_dump istemcisi yoksa (ör. sadece Docker ile
#   çalışan bir Postgres varsa) bu container adı üzerinden `docker exec` ile
#   pg_dump çalıştırılır (ör. ahkmes-pg-dev / ahkmes-postgres-1).
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

OUT_FILE="$BACKUP_DIR/ahkmes_${TIMESTAMP}.sql.gz"

strip_prisma_schema() {
  local url="$1" base query filtered
  base="${url%%\?*}"
  if [ "$base" = "$url" ]; then printf '%s' "$url"; return; fi
  query="${url#*\?}"
  filtered="$(printf '%s' "$query" | tr '&' '\n' | grep -v '^schema=' | paste -sd '&' -)"
  if [ -n "$filtered" ]; then printf '%s?%s' "$base" "$filtered"; else printf '%s' "$base"; fi
}

echo "Yedekleniyor: $OUT_FILE"
if [ -n "${PG_DOCKER_CONTAINER:-}" ]; then
  # shellcheck disable=SC2086
  docker exec "$PG_DOCKER_CONTAINER" pg_dump -U "${PGUSER:-ahkmes}" -d "${PGDATABASE:-ahkmes}" | gzip > "$OUT_FILE"
elif command -v pg_dump >/dev/null 2>&1; then
  if [ -n "${DATABASE_URL:-}" ]; then
    # Prisma accepts a `schema` URI parameter; PostgreSQL's CLI clients do not.
    # Backup is intentionally database-wide, so omit Prisma-only query options.
    PG_DUMP_URL="$(strip_prisma_schema "$DATABASE_URL")"
    pg_dump "$PG_DUMP_URL" | gzip > "$OUT_FILE"
  else
    pg_dump -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-ahkmes}" "${PGDATABASE:-ahkmes}" | gzip > "$OUT_FILE"
  fi
else
  echo "Hata: pg_dump bulunamadı. Ya pg_dump'ı kurun ya da PG_DOCKER_CONTAINER=<container-adı> ile çalıştırın." >&2
  exit 1
fi

echo "Tamamlandı: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# Eski yedekleri temizle
find "$BACKUP_DIR" -name "ahkmes_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
echo "Retention: ${RETENTION_DAYS} günden eski yedekler silindi."

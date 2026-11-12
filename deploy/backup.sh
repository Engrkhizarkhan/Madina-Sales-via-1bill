#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this backup with sudo." >&2
  exit 1
fi

BACKUP_DIR=/var/backups/madina-express
install -d -m 0700 "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DESTINATION="$BACKUP_DIR/madina-express-$STAMP.sql.gz"
TEMPORARY=$(mktemp "$BACKUP_DIR/.database-XXXXXX")
trap 'rm -f "$TEMPORARY"' EXIT

mysqldump --protocol=socket --user=root --single-transaction --routines --triggers \
  --set-gtid-purged=OFF --no-tablespaces --default-character-set=utf8mb4 madina_express | gzip > "$TEMPORARY"
gzip -t "$TEMPORARY"
mv -- "$TEMPORARY" "$DESTINATION"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'madina-express-????????T??????Z.sql.gz' -mtime +29 -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'pre-update-*.sql.gz' -mtime +29 -delete
echo "$DESTINATION"

#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this backup with sudo." >&2
  exit 1
fi

BACKUP_DIR=/var/backups/madina-express
install -d -m 0700 "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DESTINATION="$BACKUP_DIR/madina-express-$STAMP.sql"

mysqldump --protocol=socket --user=root --single-transaction --routines --triggers --default-character-set=utf8mb4 madina_express > "$DESTINATION"
test -s "$DESTINATION"
gzip "$DESTINATION"
echo "$DESTINATION.gz"

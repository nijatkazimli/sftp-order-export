#!/usr/bin/env bash
# Local dev database helper. Refuses to run unless DATABASE_URL points at localhost.
# Usage: scripts/db.sh psql | backup [file] | restore <file> | reset
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib.sh

load_env
parse_db_url
require_local_db
[ "$(container_state "$PG_CONTAINER")" = true ] || die "$PG_CONTAINER is not running (run scripts/dev-up.sh)"

case "${1:-}" in
  psql) docker exec -it "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" ;;
  backup)
    mkdir -p backups
    file="${2:-backups/$(date +%Y%m%d-%H%M%S).dump}"
    docker exec "$PG_CONTAINER" pg_dump -U "$DB_USER" -Fc "$DB_NAME" >"$file" || {
      rm -f "$file"
      die "backup failed"
    }
    echo "wrote $file"
    ;;
  restore)
    [ -f "${2:-}" ] || die "usage: db.sh restore <file>"
    docker exec -i "$PG_CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner <"$2"
    echo "restored $2"
    ;;
  reset)
    read -r -p "Drop and recreate '$DB_NAME' on this machine? Type 'reset' to continue: " answer
    [ "$answer" = reset ] || die "aborted"
    docker exec "$PG_CONTAINER" psql -U "$DB_USER" -d postgres \
      -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" \
      -c "CREATE DATABASE \"$DB_NAME\""
    npx prisma migrate deploy
    ;;
  *) die "usage: db.sh psql | backup [file] | restore <file> | reset" ;;
esac

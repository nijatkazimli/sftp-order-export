# Shared helpers for the dev scripts. Source this file; don't run it.

PG_CONTAINER=sftp-export-pg
SFTP_IMAGE=atmoz/sftp
SFTP_PORT=2222

die() {
  echo "error: $*" >&2
  exit 1
}

# An already-exported DATABASE_URL wins over .env.
load_env() {
  local pre="${DATABASE_URL:-}"
  [ -f .env ] || die ".env not found (copy .env.example)"
  set -a
  . ./.env
  set +a
  [ -z "$pre" ] || DATABASE_URL="$pre"
  [ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not set"
  return 0
}

parse_db_url() {
  local out
  out=$(node -e '
    const u = new URL(process.env.DATABASE_URL);
    console.log([u.hostname, u.port || "5432", decodeURIComponent(u.username), decodeURIComponent(u.password), u.pathname.slice(1)].join("\t"));
  ') || die "DATABASE_URL is not a valid URL"
  IFS=$'\t' read -r DB_HOST DB_PORT DB_USER DB_PASS DB_NAME <<<"$out"
}

# Guards destructive commands against a production URL in .env.
require_local_db() {
  case "$DB_HOST" in
    localhost | 127.0.0.1 | ::1 | "[::1]") ;;
    *) die "DATABASE_URL host is '$DB_HOST', not local; refusing" ;;
  esac
}

ensure_docker() {
  docker info >/dev/null 2>&1 && return 0
  command -v colima >/dev/null || die "Docker is not running"
  echo "starting colima"
  colima start --dns 1.1.1.1 --dns 8.8.8.8
}

container_state() {
  docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || echo missing
}

ensure_postgres() {
  case "$(container_state "$PG_CONTAINER")" in
    true) ;;
    false)
      echo "starting $PG_CONTAINER"
      docker start "$PG_CONTAINER" >/dev/null
      ;;
    missing)
      echo "creating $PG_CONTAINER"
      docker run -d --name "$PG_CONTAINER" --restart unless-stopped \
        -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASS" -e POSTGRES_DB="$DB_NAME" \
        -p "$DB_PORT:5432" -v sftp-export-pgdata:/var/lib/postgresql/data \
        postgres:16-alpine >/dev/null
      ;;
  esac
  local _
  for _ in $(seq 1 30); do
    docker exec "$PG_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 && return 0
    sleep 1
  done
  die "Postgres did not become ready"
}

# The test SFTP container may have any name, so find it by image.
sftp_container() {
  docker ps -a --filter "ancestor=$SFTP_IMAGE" --format '{{.Names}}' | head -n1
}

ensure_sftp() {
  local name
  name=$(sftp_container)
  if [ -z "$name" ]; then
    [ -n "${SFTP_TEST_PASSWORD:-}" ] || die "no test SFTP container found; set SFTP_TEST_PASSWORD to create one"
    echo "creating sftp-export-sftp"
    docker run -d --name sftp-export-sftp --restart unless-stopped \
      -p "$SFTP_PORT:22" "$SFTP_IMAGE" "foo:$SFTP_TEST_PASSWORD:::upload" >/dev/null
  elif [ "$(container_state "$name")" != true ]; then
    echo "starting $name"
    docker start "$name" >/dev/null
  fi
}

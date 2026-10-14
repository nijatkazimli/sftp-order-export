#!/usr/bin/env bash
# Start everything local dev needs: Docker (Colima), Postgres, the test SFTP server, migrations.
# Safe to run repeatedly. To create a missing SFTP container: SFTP_TEST_PASSWORD=... scripts/dev-up.sh
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib.sh

load_env
parse_db_url
require_local_db
ensure_docker
ensure_postgres
ensure_sftp
npx prisma migrate deploy
echo "ready: run npm run dev"

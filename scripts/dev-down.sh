#!/usr/bin/env bash
# Stop the dev containers (data is kept). Pass --colima to stop the Colima VM too.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib.sh

for name in "$PG_CONTAINER" "$(sftp_container)"; do
  [ -n "$name" ] && [ "$(container_state "$name")" = true ] && docker stop "$name" >/dev/null && echo "stopped $name"
done
if [ "${1:-}" = "--colima" ]; then
  colima stop
fi
exit 0

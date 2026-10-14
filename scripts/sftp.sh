#!/usr/bin/env bash
# Inspect the test SFTP server's upload folder.
# Usage: scripts/sftp.sh ls | latest | cat <file> | clear
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib.sh

dir=/home/foo/upload
name=$(sftp_container)
[ -n "$name" ] || die "no test SFTP container found (run scripts/dev-up.sh)"
[ "$(container_state "$name")" = true ] || die "$name is not running (run scripts/dev-up.sh)"

case "${1:-}" in
  ls) docker exec "$name" ls -lAt "$dir" ;;
  latest)
    file=$(docker exec "$name" ls -t "$dir" | head -n1)
    [ -n "$file" ] || die "upload folder is empty"
    echo "== $file"
    docker exec "$name" cat "$dir/$file"
    ;;
  cat)
    case "${2:-}" in
      "" | */*) die "usage: sftp.sh cat <file name>" ;;
    esac
    docker exec "$name" cat "$dir/$2"
    ;;
  clear) docker exec "$name" sh -c "rm -f $dir/*" && echo "cleared $dir" ;;
  *) die "usage: sftp.sh ls | latest | cat <file> | clear" ;;
esac

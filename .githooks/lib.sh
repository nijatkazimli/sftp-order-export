# Shared by the repo hooks.
HOOKS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)

# A repo-level core.hooksPath replaces the global hooks directory, so run the
# company-wide hook of the same name first (it carries the gitleaks scan).
# stdin and arguments pass through.
run_global_hook() {
  local name=$1 dir
  shift
  dir=$(git config --global core.hooksPath || true)
  dir=${dir/#\~/$HOME}
  [ -n "$dir" ] && [ -x "$dir/$name" ] || return 0
  [ "$(cd "$dir" && pwd -P)" != "$HOOKS_DIR" ] || return 0
  "$dir/$name" "$@"
}

fail() {
  echo "$(basename "$0"): $*" >&2
  exit 1
}

#!/usr/bin/env bash
# Run the same checks as CI would: typecheck, lint, tests. Add --build to also build.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run typecheck
npm run lint
npm test
if [ "${1:-}" = "--build" ]; then
  npm run build
fi
echo "all checks passed"

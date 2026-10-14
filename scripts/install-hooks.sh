#!/usr/bin/env bash
# Point this clone at the tracked hooks in .githooks (local git config only).
# Undo with: git config --local --unset core.hooksPath
set -euo pipefail
cd "$(dirname "$0")/.."

chmod +x .githooks/pre-commit .githooks/pre-push
git config --local core.hooksPath .githooks
echo "installed: core.hooksPath=.githooks"

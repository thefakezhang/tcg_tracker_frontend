#!/usr/bin/env bash
# Typecheck + build the frontend. Usage: scripts/check.sh
# Node bin is auto-detected (latest nvm install) so this works across machines.
set -euo pipefail
NODE_BIN=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)
[ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
echo "== tsc --noEmit =="
npx tsc --noEmit
echo "== next build =="
npx next build
echo "OK"

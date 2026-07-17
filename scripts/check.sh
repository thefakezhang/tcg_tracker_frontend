#!/usr/bin/env bash
# Typecheck + test + build the frontend. Usage: scripts/check.sh
# Node bin is auto-detected (latest nvm install) so this works across machines.
set -euo pipefail
# nvm is OPTIONAL: a machine without it uses the node already on PATH. The
# `|| true` is load-bearing - under `set -euo pipefail` the failing ls (no
# ~/.nvm) aborted the script before it ran a single check, which looks
# identical to "the checks failed" when in fact nothing was ever checked.
NODE_BIN=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)
[ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
echo "== tsc --noEmit =="
npx tsc --noEmit
echo "== test =="
npm test
echo "== next build =="
npx next build
echo "OK"

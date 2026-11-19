#!/usr/bin/env bash
set -euo pipefail
frontend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
case "${1:-load}" in
  load) browser_script="scripts/e2e/card-detail-load-fixture.mjs" ;;
  sale-feedback) browser_script="scripts/e2e/card-sale-feedback-fixture.mjs" ;;
  *) echo "Expected load or sale-feedback scenario" >&2; exit 2 ;;
esac
next_pid=""
cleanup() {
  local result="$?"
  trap - EXIT INT TERM
  if [[ -n "$next_pid" ]]; then
    kill -- "-${next_pid}" 2>/dev/null || true
    wait "$next_pid" 2>/dev/null || true
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
exec 9>>"${TCG_DOCKER_BROWSER_LOCK_PATH:-/tmp/tcg-tracker-docker-browser.lock}"
flock -n 9 || { echo "Shared browser lane is in use" >&2; exit 1; }
cd "$frontend_root"
app_port="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
artifact_root="${E2E_ARTIFACT_ROOT:-/tmp/tcg-card-detail-browser-$(date +%s)}"
mkdir -p "$artifact_root"
setsid env NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only-no-database-access \
  E2E_FIXTURES_ENABLED=1 NEXT_TELEMETRY_DISABLED=1 \
  ./node_modules/.bin/next dev --hostname 127.0.0.1 --port "$app_port" >"$artifact_root/next-dev.log" 2>&1 &
next_pid="$!"
ready=0
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${app_port}/e2e/card-detail-load" >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "$next_pid" 2>/dev/null; then break; fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then tail -n 40 "$artifact_root/next-dev.log" >&2; exit 1; fi
APP_URL="http://127.0.0.1:${app_port}" E2E_ARTIFACT_ROOT="$artifact_root" node "$browser_script"
echo "Browser evidence: $artifact_root"

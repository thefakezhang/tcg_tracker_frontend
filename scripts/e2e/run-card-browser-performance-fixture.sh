#!/usr/bin/env bash
set -euo pipefail

frontend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
dependency_root="${TCG_FRONTEND_DEPENDENCY_ROOT:-${frontend_root}}"
next_bin="${dependency_root}/node_modules/.bin/next"
lock_path="${TCG_DOCKER_BROWSER_LOCK_PATH:-/tmp/tcg-tracker-docker-browser.lock}"
next_pid=""
active_artifact_root=""
active_next_log=""
next_log=""

fail() {
  echo "Card Browser performance acceptance error: $*" >&2
  exit 1
}

if [[ "${TCG_CARD_BROWSER_XVFB:-}" != "1" ]]; then
  command -v xvfb-run >/dev/null || fail "xvfb-run is required"
  export E2E_HEADED=1
  export TCG_CARD_BROWSER_XVFB=1
  exec xvfb-run -a "$0" "$@"
fi
[[ -n "${DISPLAY:-}" ]] || fail "the isolated Xvfb display is unavailable"
[[ "${TCG_CARD_BROWSER_EXPECT_MODE:-}" == "legacy" || "${TCG_CARD_BROWSER_EXPECT_MODE:-}" == "bounded" ]] \
  || fail "TCG_CARD_BROWSER_EXPECT_MODE must be legacy or bounded"
[[ -x "${next_bin}" ]] || fail "Next.js is unavailable at ${next_bin}"
command -v flock >/dev/null || fail "flock is required"

cleanup() {
  local status="$1"
  trap - EXIT INT TERM
  set +e
  if [[ -n "${next_pid}" ]] && kill -0 "${next_pid}" 2>/dev/null; then
    kill "${next_pid}" 2>/dev/null
    wait "${next_pid}" 2>/dev/null
  fi
  if [[ -n "${active_artifact_root}" && -d "${active_artifact_root}" ]]; then
    mkdir -p "${artifact_root}"
    cp -a "${active_artifact_root}/." "${artifact_root}/"
    rm -rf -- "${active_artifact_root}"
  fi
  exit "${status}"
}
trap 'cleanup "$?"' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

exec 9>>"${lock_path}"
flock -n 9 || fail "the shared Docker and browser lane is occupied"

run_token="$(node -e 'process.stdout.write(Date.now().toString(36))')"
app_port="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
app_url="http://127.0.0.1:${app_port}"
artifact_root="${E2E_ARTIFACT_ROOT:-/tmp/tcg-card-browser-performance-${TCG_CARD_BROWSER_EXPECT_MODE}-${run_token}}"
active_artifact_root="/tmp/tcg-card-browser-performance-live-${run_token}"
next_log="${artifact_root}/next-dev.log"
active_next_log="${active_artifact_root}/next-dev.log"
mkdir -p "${artifact_root}" "${active_artifact_root}"

cd "${frontend_root}"
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="fixture-only-no-database-access" \
E2E_FIXTURES_ENABLED=1 \
NEXT_TELEMETRY_DISABLED=1 \
"${next_bin}" dev --hostname 127.0.0.1 --port "${app_port}" >"${active_next_log}" 2>&1 &
next_pid="$!"

ready=0
for _ in $(seq 1 120); do
  if curl -fsS "${app_url}/e2e/pokemon-variant-projection" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "${next_pid}" 2>/dev/null; then break; fi
  sleep 1
done
if [[ "${ready}" -ne 1 ]]; then
  tail -n 120 "${active_next_log}" >&2
  fail "controlled fixture server did not become ready"
fi

APP_URL="${app_url}" \
E2E_ARTIFACT_ROOT="${active_artifact_root}" \
E2E_DURABLE_ARTIFACT_ROOT="${artifact_root}" \
TCG_FRONTEND_DEPENDENCY_ROOT="${dependency_root}" \
node scripts/e2e/card-browser-performance-fixture.mjs

echo "Browser evidence: ${artifact_root}"
echo "Next.js log: ${next_log}"

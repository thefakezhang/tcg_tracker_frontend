#!/usr/bin/env bash
set -euo pipefail

frontend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
dependency_root="${TCG_FRONTEND_DEPENDENCY_ROOT:-${frontend_root}}"
next_bin="${dependency_root}/node_modules/.bin/next"
next_pid=""

if [[ ! -x "${next_bin}" ]]; then
  echo "Next.js is unavailable at ${next_bin}; install dependencies or set TCG_FRONTEND_DEPENDENCY_ROOT" >&2
  exit 1
fi

cleanup() {
  local status="$1"
  trap - EXIT INT TERM
  set +e
  if [[ -n "${next_pid}" ]] && kill -0 "${next_pid}" 2>/dev/null; then
    kill "${next_pid}" 2>/dev/null
    wait "${next_pid}" 2>/dev/null
  fi
  exit "${status}"
}

trap 'cleanup "$?"' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

run_token="$(node -e 'process.stdout.write(Date.now().toString(36))')"
app_port="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
app_url="http://127.0.0.1:${app_port}"
artifact_root="${E2E_ARTIFACT_ROOT:-/tmp/tcg-english-counterpart-e2e-${run_token}}"
log_root="${E2E_LOG_ROOT:-${artifact_root}}"
next_log="${log_root}/next-dev.log"
mkdir -p "${artifact_root}"
mkdir -p "${log_root}"

cd "${frontend_root}"
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="fixture-only-no-database-access" \
E2E_FIXTURES_ENABLED=1 \
NEXT_TELEMETRY_DISABLED=1 \
"${next_bin}" dev --hostname 127.0.0.1 --port "${app_port}" >"${next_log}" 2>&1 &
next_pid="$!"

ready=0
for _ in $(seq 1 90); do
  if curl -fsS "${app_url}/e2e/english-counterparts" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "${next_pid}" 2>/dev/null; then
    break
  fi
  sleep 1
done
if [[ "${ready}" -ne 1 ]]; then
  tail -n 120 "${next_log}" >&2
  echo "controlled fixture server did not become ready" >&2
  exit 1
fi

APP_URL="${app_url}" \
E2E_ARTIFACT_ROOT="${artifact_root}" \
TCG_FRONTEND_DEPENDENCY_ROOT="${dependency_root}" \
node scripts/e2e/english-counterpart-fixture.mjs
echo "Browser evidence: ${artifact_root}"
echo "Next.js log: ${next_log}"

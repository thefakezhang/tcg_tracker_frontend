#!/usr/bin/env bash

set -euo pipefail

frontend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
backend_root="${TCG_BACKEND_ROOT:-}"
supabase_bin="${SUPABASE_BIN:-}"
lock_path="${TCG_DOCKER_BROWSER_LOCK_PATH:-/tmp/tcg-tracker-docker-browser.lock}"
next_pid=""

fail() {
  echo "Lot economics browser acceptance error: $*" >&2
  exit 1
}

cleanup() {
  local requested_exit="$1"
  trap - EXIT INT TERM
  set +e
  if [[ -n "$next_pid" ]] && kill -0 "$next_pid" 2>/dev/null; then
    kill "$next_pid" 2>/dev/null
    wait "$next_pid" 2>/dev/null
  fi
  exit "$requested_exit"
}

trap 'cleanup "$?"' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

[[ -n "$backend_root" ]] || fail "TCG_BACKEND_ROOT is required"
backend_root="$(cd "$backend_root" && pwd -P)"
[[ -d "$backend_root/supabase" ]] || fail "backend Supabase config is missing"
if [[ -z "$supabase_bin" ]]; then
  supabase_bin="$(command -v supabase || true)"
fi
[[ -x "$supabase_bin" ]] || fail "SUPABASE_BIN must name an executable Supabase CLI"

command -v flock >/dev/null || fail "flock is required"
exec 9>>"$lock_path"
flock 9

supabase_status="$(
  cd "$backend_root"
  "$supabase_bin" status -o env
)"
api_url="$(
  printf '%s\n' "$supabase_status" |
    sed -n 's/^API_URL=//p' |
    tr -d '"'
)"
anon_key="$(
  printf '%s\n' "$supabase_status" |
    sed -n 's/^ANON_KEY=//p' |
    tr -d '"'
)"
[[ -n "$api_url" && -n "$anon_key" ]] ||
  fail "local Supabase status omitted API_URL or ANON_KEY"

run_token="$(node -e 'process.stdout.write(Date.now().toString(36))')"
app_port="$(
  node -e '
    const server = require("node:net").createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      process.stdout.write(String(address.port));
      server.close();
    });
  '
)"
app_url="http://127.0.0.1:${app_port}"
auth_email="lot-economics-${run_token}@example.test"
auth_password="LotE2E-$(openssl rand -hex 16)"
auth_secret="$(openssl rand -hex 32)"
artifact_root="/tmp/tcg-lot-economics-e2e-${run_token}"
next_log="${artifact_root}/next-dev.log"
mkdir -p "$artifact_root"

cd "$frontend_root"
node scripts/e2e/create-local-auth-user.mjs \
  "$api_url" "$anon_key" "$auth_email" "$auth_password" \
  "Lot Economics E2E Operator"

NEXT_PUBLIC_SUPABASE_URL="$api_url" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$anon_key" \
E2E_AUTH_ENABLED=1 \
E2E_AUTH_SECRET="$auth_secret" \
E2E_AUTH_EMAIL="$auth_email" \
E2E_AUTH_PASSWORD="$auth_password" \
NEXT_TELEMETRY_DISABLED=1 \
./node_modules/.bin/next dev \
  --hostname 127.0.0.1 --port "$app_port" >"$next_log" 2>&1 &
next_pid="$!"

ready=0
for _ in $(seq 1 120); do
  if curl -fsS "${app_url}/login" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$next_pid" 2>/dev/null; then
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  tail -n 120 "$next_log" >&2
  fail "Next.js did not become ready"
fi

APP_URL="$app_url" \
E2E_AUTH_SECRET="$auth_secret" \
E2E_ARTIFACT_ROOT="$artifact_root" \
node scripts/e2e/lot-economics-browser.mjs

echo "Next.js log: $next_log"

#!/usr/bin/env bash
# Browser evidence for the optional-lot-total UX (create without a total, blank-
# line finalize warning, price it, finalize on a derived total) against the
# LOCAL Supabase stack. Drives optional-lot-total-evidence.mjs.

set -euo pipefail

frontend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
backend_root="${TCG_BACKEND_ROOT:-}"
lock_path="${TCG_DOCKER_BROWSER_LOCK_PATH:-/tmp/tcg-tracker-docker-browser.lock}"
next_pid=""

fail() { echo "Owned/uid evidence error: $*" >&2; exit 1; }

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
command -v flock >/dev/null || fail "flock is required"
exec 9>>"$lock_path"
flock 9

supabase_status="$(cd "$backend_root" && supabase status -o env)"
api_url="$(printf '%s\n' "$supabase_status" | sed -n 's/^API_URL=//p' | tr -d '"')"
anon_key="$(printf '%s\n' "$supabase_status" | sed -n 's/^ANON_KEY=//p' | tr -d '"')"
[[ -n "$api_url" && -n "$anon_key" ]] || fail "supabase status omitted API_URL or ANON_KEY"

psql_local() {
  PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq "$@"
}

[[ -n "$(psql_local -c "SELECT 1 FROM pokemon_card_definitions WHERE card_id = 1857001")" ]] || fail "fixture card 1857001 is not seeded"

run_token="$(node -e 'process.stdout.write(Date.now().toString(36))')"
app_port="$(node -e '
  const server = require("node:net").createServer();
  server.listen(0, "127.0.0.1", () => {
    process.stdout.write(String(server.address().port));
    server.close();
  });
')"
app_url="http://127.0.0.1:${app_port}"
auth_email="optional-lot-total-${run_token}@example.test"
auth_password="OwnedE2E-$(openssl rand -hex 16)"
auth_secret="$(openssl rand -hex 32)"
artifact_root="/tmp/tcg-optional-lot-total-evidence-${run_token}"
next_log="${artifact_root}/next-dev.log"
mkdir -p "$artifact_root"

cd "$frontend_root"
node scripts/e2e/create-local-auth-user.mjs \
  "$api_url" "$anon_key" "$auth_email" "$auth_password" "Optional Lot Total Operator"

NEXT_PUBLIC_SUPABASE_URL="$api_url" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$anon_key" \
E2E_AUTH_ENABLED=1 \
E2E_AUTH_SECRET="$auth_secret" \
E2E_AUTH_EMAIL="$auth_email" \
E2E_AUTH_PASSWORD="$auth_password" \
NEXT_TELEMETRY_DISABLED=1 \
./node_modules/.bin/next dev --hostname 127.0.0.1 --port "$app_port" >"$next_log" 2>&1 &
next_pid="$!"

ready=0
for _ in $(seq 1 120); do
  if curl -fsS "${app_url}/login" >/dev/null 2>&1; then ready=1; break; fi
  kill -0 "$next_pid" 2>/dev/null || break
  sleep 1
done
[[ "$ready" -eq 1 ]] || { tail -n 120 "$next_log" >&2; fail "Next.js did not become ready"; }

APP_URL="$app_url" \
E2E_AUTH_SECRET="$auth_secret" \
E2E_ARTIFACT_ROOT="$artifact_root" \
node scripts/e2e/optional-lot-total-evidence.mjs

echo "Next.js log: $next_log"

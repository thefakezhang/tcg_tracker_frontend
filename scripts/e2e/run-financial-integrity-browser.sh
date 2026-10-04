#!/usr/bin/env bash

set -euo pipefail

frontend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
backend_root="${TCG_BACKEND_ROOT:-}"
supabase_bin="${SUPABASE_BIN:-}"
lock_path="${TCG_DOCKER_BROWSER_LOCK_PATH:-/tmp/tcg-tracker-docker-browser.lock}"
next_pid=""
reset_completed=0
auth_file=""

fail() {
  echo "Financial-integrity browser acceptance error: $*" >&2
  exit 1
}

source_browser_preflight() {
  local process_dir process_cwd process_id process_name
  for process_dir in /proc/[0-9]*; do
    process_id="${process_dir##*/}"
    process_cwd="$(readlink -f "$process_dir/cwd" 2>/dev/null || true)"
    [[ "$process_cwd" == /home/tzhan/automation/state/source-run-code/run-* ]] || continue
    process_name="$(tr -d '\0' <"$process_dir/comm" 2>/dev/null || true)"
    fail "source-run process ${process_id} (${process_name:-unknown}) is active in ${process_cwd}; wait for its durable boundary before changing the local database"
  done
}

reset_local_fixture() {
  (
    cd "$backend_root"
    "$supabase_bin" db reset
  )
}

cleanup() {
  local requested_exit="$1"
  trap - EXIT INT TERM
  set +e
  if [[ -n "$next_pid" ]] && kill -0 "$next_pid" 2>/dev/null; then
    kill "$next_pid" 2>/dev/null
    wait "$next_pid" 2>/dev/null
  fi
  next_pid=""
  if [[ "$reset_completed" -eq 1 ]]; then
    source_browser_preflight
    if ! reset_local_fixture; then
      echo "ERROR: final local fixture reset failed; browser lock remains held until this process exits" >&2
      requested_exit=1
    fi
  fi
  if [[ -n "$auth_file" ]]; then
    rm -f -- "$auth_file"
  fi
  exit "$requested_exit"
}

trap 'cleanup "$?"' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

[[ "${TCG_BROWSER_STACK_RESERVED:-}" == "financial-integrity-1625" ]] ||
  fail "TCG_BROWSER_STACK_RESERVED=financial-integrity-1625 is required from the coordinator"
[[ -n "$backend_root" ]] || fail "TCG_BACKEND_ROOT is required"
backend_root="$(cd "$backend_root" && pwd -P)"
[[ -d "$backend_root/supabase" ]] || fail "backend Supabase config is missing"
[[ "$(readlink -f "$backend_root/.env")" == /home/tzhan/tcg_tracker/.env ]] ||
  fail "backend .env must resolve to /home/tzhan/tcg_tracker/.env"
[[ "$(readlink -f "$frontend_root/.env.local")" == /home/tzhan/tcg_tracker_frontend/.env.local ]] ||
  fail "frontend .env.local must resolve to /home/tzhan/tcg_tracker_frontend/.env.local"
[[ -n "${TCG_DATA_ROOT:-}" ]] || fail "TCG_DATA_ROOT must name the assigned isolated data worktree"
resolved_data_root="$(readlink -f "$TCG_DATA_ROOT")"
[[ "$resolved_data_root" == /home/tzhan/tcg_tracker_data/.claude/worktrees/* ]] ||
  fail "TCG_DATA_ROOT must resolve to an isolated data worktree, got ${resolved_data_root}"

if [[ -z "$supabase_bin" ]]; then
  supabase_bin="$(command -v supabase || true)"
fi
[[ -x "$supabase_bin" ]] || fail "SUPABASE_BIN must name an executable Supabase CLI"
command -v flock >/dev/null || fail "flock is required"
command -v psql >/dev/null || fail "psql is required"
command -v openssl >/dev/null || fail "openssl is required"

exec 9>>"$lock_path"
flock -n 9 || fail "the shared Docker/browser lock is held by another session"
source_browser_preflight

supabase_status="$(cd "$backend_root" && "$supabase_bin" status -o env)"
api_url="$(printf '%s\n' "$supabase_status" | sed -n 's/^API_URL=//p' | tr -d '"')"
anon_key="$(printf '%s\n' "$supabase_status" | sed -n 's/^ANON_KEY=//p' | tr -d '"')"
service_role_key="$(printf '%s\n' "$supabase_status" | sed -n 's/^SERVICE_ROLE_KEY=//p' | tr -d '"')"
db_url="$(printf '%s\n' "$supabase_status" | sed -n 's/^DB_URL=//p' | tr -d '"')"
[[ "$api_url" == http://127.0.0.1:* ]] || fail "refusing non-local Supabase API ${api_url:-missing}"
[[ "$db_url" == postgresql://postgres:postgres@127.0.0.1:*/* ]] ||
  fail "refusing non-local Supabase database URL"
[[ -n "$anon_key" ]] || fail "local Supabase status omitted ANON_KEY"
[[ -n "$service_role_key" ]] || fail "local Supabase status omitted SERVICE_ROLE_KEY"

cmp -s \
  "$backend_root/internal/db/migrations/000535_inventory_trade_float_integrity.up.sql" \
  "$backend_root/supabase/migrations/000535_inventory_trade_float_integrity.up.sql" ||
  fail "000535 canonical and Supabase migrations are not byte-identical"

source_browser_preflight
reset_local_fixture
reset_completed=1

ledger_count="$(psql "$db_url" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='000535'")"
[[ "$ledger_count" == "1" ]] || fail "local migration ledger has ${ledger_count} rows for 000535"

run_token="$(node -e 'process.stdout.write(Date.now().toString(36))')"
operator_email="financial-integrity-${run_token}@example.test"
operator_password="FinancialE2E-$(openssl rand -hex 16)"
auth_secret="$(openssl rand -hex 32)"
artifact_root="/tmp/tcg-financial-integrity-browser-${run_token}"
auth_file="${artifact_root}/auth.json"
next_log="${artifact_root}/next-dev.log"
mkdir -p "$artifact_root"

psql "$db_url" -v ON_ERROR_STOP=1 \
  -v operator_email="$operator_email" \
  -f "$frontend_root/scripts/e2e/financial-integrity-seed.sql"

cd "$frontend_root"
node scripts/e2e/create-local-auth-user.mjs \
  "$api_url" "$anon_key" "$operator_email" "$operator_password" \
  "Financial Integrity E2E Operator" "$auth_file"
authenticated_access_token="$(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).accessToken;
  if (!value) process.exit(1);
  process.stdout.write(value);
' "$auth_file")"
authenticated_role="$(node -e '
  const token = process.argv[1].split(".")[1];
  const payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  process.stdout.write(payload.role ?? "");
' "$authenticated_access_token")"
[[ "$authenticated_role" == "authenticated" ]] ||
  fail "initial local fixture received role ${authenticated_role:-missing}, want authenticated"

# The shared local GoTrue container currently has no custom-access-token hook
# enabled. Shape only this disposable user's local auth.users role, then sign in
# again so both the direct evidence token and the browser cookies carry the real
# PostgreSQL `administrator` role. The final reset removes the user and role.
promoted_count="$(psql "$db_url" -v ON_ERROR_STOP=1 -At \
  -v operator_email="$operator_email" \
  -f "$frontend_root/scripts/e2e/financial-integrity-promote-user.sql")"
[[ "$promoted_count" == "1" ]] ||
  fail "local administrator promotion changed ${promoted_count:-0} users, want 1"
node scripts/e2e/create-local-auth-user.mjs \
  "$api_url" "$anon_key" "$operator_email" "$operator_password" \
  "Financial Integrity E2E Operator" "$auth_file"
access_token="$(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).accessToken;
  if (!value) process.exit(1);
  process.stdout.write(value);
' "$auth_file")"
token_role="$(node -e '
  const token = process.argv[1].split(".")[1];
  const payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  process.stdout.write(payload.role ?? "");
' "$access_token")"
[[ "$token_role" == "administrator" ]] ||
  fail "local authenticated fixture received role ${token_role:-missing}, want administrator"

app_port="$(node -e '
  const server = require("node:net").createServer();
  server.listen(0, "127.0.0.1", () => {
    process.stdout.write(String(server.address().port));
    server.close();
  });
')"
app_url="http://127.0.0.1:${app_port}"

NEXT_PUBLIC_SUPABASE_URL="$api_url" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$anon_key" \
E2E_AUTH_ENABLED=1 \
E2E_AUTH_SECRET="$auth_secret" \
E2E_AUTH_EMAIL="$operator_email" \
E2E_AUTH_PASSWORD="$operator_password" \
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
E2E_API_URL="$api_url" \
E2E_ANON_KEY="$anon_key" \
E2E_SERVICE_ROLE_KEY="$service_role_key" \
E2E_ACCESS_TOKEN="$access_token" \
E2E_AUTHENTICATED_ACCESS_TOKEN="$authenticated_access_token" \
E2E_AUTH_SECRET="$auth_secret" \
E2E_AUTH_EMAIL="$operator_email" \
E2E_ARTIFACT_ROOT="$artifact_root" \
node scripts/e2e/financial-integrity-browser.mjs

echo "Financial-integrity browser artifacts: $artifact_root"
echo "Next.js log: $next_log"

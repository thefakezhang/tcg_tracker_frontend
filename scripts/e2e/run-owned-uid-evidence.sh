#!/usr/bin/env bash
# Browser evidence for H1 (owned + draft-lot incoming counts) and H3 (uid chip
# + uid paste) against the LOCAL Supabase stack. Seeds deterministic holdings
# for the CUJ-13 fixture card, then drives owned-uid-evidence.mjs.

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

# Deterministic holdings for the seeded CUJ-13 card: one finalized lot with a
# raw copy + a PSA 10 copy on hand, and one DRAFT lot holding two more copies.
psql_local <<'SQL'
DELETE FROM pokemon_lot_lines WHERE lot_id IN
  (SELECT lot_id FROM acquisition_lots WHERE shop_label = 'E2E Owned Evidence');
DELETE FROM acquisition_lots WHERE shop_label = 'E2E Owned Evidence';
WITH fin AS (
  INSERT INTO acquisition_lots (leg, acquired_at, orig_currency, total_cost_orig, fx_rate_used, total_cost_usd, lines_imported, shop_label)
  VALUES ('import', '2026-07-01', 'USD', 40, 1, 40, TRUE, 'E2E Owned Evidence')
  RETURNING lot_id
), dft AS (
  INSERT INTO acquisition_lots (leg, acquired_at, orig_currency, total_cost_orig, fx_rate_used, total_cost_usd, lines_imported, shop_label)
  VALUES ('import', '2026-07-02', 'USD', 20, 1, 20, FALSE, 'E2E Owned Evidence')
  RETURNING lot_id
)
INSERT INTO pokemon_lot_lines (lot_id, card_id, condition_id, psa_grade, quantity, qty_remaining, allocated_cost_usd)
SELECT lot_id, 1857001, 1, 0, 1, 1, 20 FROM fin
UNION ALL SELECT lot_id, 1857001, 1, 10, 1, 1, 20 FROM fin
UNION ALL SELECT lot_id, 1857001, 1, 0, 2, NULL, 0 FROM dft;
-- The card browser inner-joins pokemon_price_summaries, so the fixture needs
-- a summary row to appear in the browse list at all.
INSERT INTO pokemon_price_summaries (card_id, tier, psa_grade)
VALUES (1857001, 1, 0)
ON CONFLICT DO NOTHING;
SQL

card_uid="$(psql_local -c "SELECT card_uid FROM pokemon_card_definitions WHERE card_id = 1857001")"
[[ -n "$card_uid" ]] || fail "fixture card 1857001 is not seeded"

run_token="$(node -e 'process.stdout.write(Date.now().toString(36))')"
app_port="$(node -e '
  const server = require("node:net").createServer();
  server.listen(0, "127.0.0.1", () => {
    process.stdout.write(String(server.address().port));
    server.close();
  });
')"
app_url="http://127.0.0.1:${app_port}"
auth_email="owned-uid-${run_token}@example.test"
auth_password="OwnedE2E-$(openssl rand -hex 16)"
auth_secret="$(openssl rand -hex 32)"
artifact_root="/tmp/tcg-owned-uid-evidence-${run_token}"
next_log="${artifact_root}/next-dev.log"
mkdir -p "$artifact_root"

cd "$frontend_root"
node scripts/e2e/create-local-auth-user.mjs \
  "$api_url" "$anon_key" "$auth_email" "$auth_password" "Owned Uid Evidence Operator"

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
E2E_CARD_UID="$card_uid" \
E2E_ARTIFACT_ROOT="$artifact_root" \
node scripts/e2e/owned-uid-evidence.mjs

echo "Next.js log: $next_log"

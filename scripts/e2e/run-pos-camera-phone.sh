#!/usr/bin/env bash

set -euo pipefail

frontend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
backend_root="${TCG_BACKEND_ROOT:-}"
supabase_bin="${SUPABASE_BIN:-}"
lock_path="${TCG_DOCKER_BROWSER_LOCK_PATH:-/tmp/tcg-tracker-docker-browser.lock}"
next_bin="${NEXT_BIN:-/home/tzhan/tcg_tracker_frontend/node_modules/.bin/next}"
next_pid=""
owner_id=""
user_access_token=""
card_id=""
condition_id=""
layer_one_id=""
layer_two_id=""
open_lot_one_id=""
open_lot_two_id=""
api_url=""
service_role_key=""
run_token=""
db_container=""

fail() {
  echo "POS camera browser acceptance error: $*" >&2
  exit 1
}

psql_local() {
  [[ -n "$db_container" ]] || fail "local Supabase DB container is unresolved"
  local file_path=""
  local -a psql_args=(-X -v ON_ERROR_STOP=1 -U postgres -d postgres)
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      -f|--file)
        [[ "$#" -ge 2 ]] || fail "psql file option requires a path"
        [[ -z "$file_path" ]] || fail "psql_local accepts only one host-side SQL file"
        file_path="$2"
        psql_args+=(--file=-)
        shift 2
        ;;
      --file=*)
        [[ -z "$file_path" ]] || fail "psql_local accepts only one host-side SQL file"
        file_path="${1#--file=}"
        psql_args+=(--file=-)
        shift
        ;;
      *)
        psql_args+=("$1")
        shift
        ;;
    esac
  done
  if [[ -n "$file_path" ]]; then
    [[ -r "$file_path" ]] || fail "psql SQL file is unreadable: $file_path"
    docker exec -i -e PGPASSWORD=postgres "$db_container" \
      psql "${psql_args[@]}" <"$file_path"
    return
  fi
  docker exec -i -e PGPASSWORD=postgres "$db_container" \
    psql "${psql_args[@]}"
}

cleanup_database() {
  [[ -n "$owner_id" && -n "$card_id" ]] || return 0
  psql_local \
    -v owner_id="$owner_id" \
    -v card_id="$card_id" \
    -v condition_id="$condition_id" \
    -v token="$run_token" <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.pos_sale_sessions IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.pos_sale_session_lines IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.card_recognition_audits IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.inventory_card_media IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.deal_decisions IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.pokemon_sale_layers IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.pokemon_sales IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.sale_expense_allocations IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.sale_expenses IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.sale_lot_items IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.sale_lots IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.pokemon_lot_lines IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.acquisition_lot_finalizations IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.acquisition_lots IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.tcgplayer_metrics IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.pokemon_external_identifiers IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.pokemon_card_definitions IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.conditions IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE pos_e2e_sale_groups ON COMMIT DROP AS
WITH RECURSIVE roots(sale_group) AS (
  SELECT session.sale_group
    FROM public.pos_sale_sessions session
   WHERE session.owner_id = :'owner_id'::uuid
     AND session.sale_group IS NOT NULL
  UNION
  SELECT item.sale_group
    FROM public.sale_lot_items item
   WHERE item.card_id = :'card_id'::integer
), related(sale_group) AS (
  SELECT roots.sale_group
    FROM roots
  UNION
  SELECT candidate.sale_group
    FROM related current_group
    JOIN public.sale_lots lot
      ON lot.sale_group = current_group.sale_group
      OR lot.reverses_sale_group = current_group.sale_group
      OR lot.reversal_sale_group = current_group.sale_group
   CROSS JOIN LATERAL (
     VALUES (lot.sale_group), (lot.reverses_sale_group), (lot.reversal_sale_group)
   ) AS candidate(sale_group)
   WHERE candidate.sale_group IS NOT NULL
)
SELECT related.sale_group
  FROM related;
ALTER TABLE public.pos_sale_sessions DISABLE TRIGGER pos_sale_sessions_closed_immutable;
ALTER TABLE public.pos_sale_session_lines DISABLE TRIGGER pos_sale_session_lines_closed_immutable;
ALTER TABLE public.card_recognition_audits DISABLE TRIGGER card_recognition_audits_controlled_transition;
ALTER TABLE public.inventory_card_media DISABLE TRIGGER inventory_card_media_append_only;
ALTER TABLE public.pokemon_lot_lines DISABLE TRIGGER pokemon_lot_lines_pos_lineage_immutable;
ALTER TABLE public.sale_lots DISABLE TRIGGER sale_lots_immutable;
ALTER TABLE public.sale_lot_items DISABLE TRIGGER sale_lot_items_immutable;
ALTER TABLE public.sale_expenses DISABLE TRIGGER sale_expenses_immutable;
ALTER TABLE public.sale_expense_allocations DISABLE TRIGGER sale_expense_allocations_immutable;
ALTER TABLE public.pokemon_sales DISABLE TRIGGER pokemon_grouped_sales_immutable;
SELECT 1 / CASE WHEN count(*) <= 3 THEN 1 ELSE 0 END
  FROM public.inventory_card_media
 WHERE owner_id = :'owner_id'::uuid;
SELECT 1 / CASE WHEN count(*) <= 2 THEN 1 ELSE 0 END
  FROM public.pos_sale_sessions
 WHERE owner_id = :'owner_id'::uuid;
SELECT 1 / CASE WHEN count(*) <= 4 THEN 1 ELSE 0 END
  FROM public.card_recognition_audits
 WHERE owner_id = :'owner_id'::uuid;
SELECT 1 / CASE WHEN count(*) <= 4 THEN 1 ELSE 0 END
  FROM public.acquisition_lots lot
 WHERE lot.shop_label IN (
   'POS camera E2E ' || :'token' || ' FIFO 1',
   'POS camera E2E ' || :'token' || ' FIFO 2',
   'POS camera E2E ' || :'token' || ' JPY 1',
   'POS camera E2E ' || :'token' || ' JPY 2'
 );
DELETE FROM public.inventory_card_media WHERE owner_id = :'owner_id'::uuid;
DELETE FROM public.pos_sale_sessions WHERE owner_id = :'owner_id'::uuid;
DELETE FROM public.deal_decisions WHERE card_id = :'card_id'::integer;
DELETE FROM public.pokemon_sale_layers
 WHERE sale_id IN (SELECT sale_id FROM public.pokemon_sales WHERE card_id = :'card_id'::integer);
DELETE FROM public.pokemon_sales WHERE card_id = :'card_id'::integer;
DELETE FROM public.sale_expense_allocations
 WHERE sale_group IN (SELECT sale_group FROM pos_e2e_sale_groups);
DELETE FROM public.sale_expenses
 WHERE sale_group IN (SELECT sale_group FROM pos_e2e_sale_groups);
DELETE FROM public.sale_lot_items
 WHERE sale_group IN (SELECT sale_group FROM pos_e2e_sale_groups);
DELETE FROM public.sale_lots
 WHERE sale_group IN (SELECT sale_group FROM pos_e2e_sale_groups);
DELETE FROM public.card_recognition_audits WHERE owner_id = :'owner_id'::uuid;
DELETE FROM public.pokemon_lot_lines WHERE card_id = :'card_id'::integer;
DELETE FROM public.acquisition_lot_finalizations finalization
 WHERE finalization.lot_id IN (
   SELECT lot.lot_id FROM public.acquisition_lots lot
    WHERE lot.shop_label IN (
      'POS camera E2E ' || :'token' || ' FIFO 1',
      'POS camera E2E ' || :'token' || ' FIFO 2',
      'POS camera E2E ' || :'token' || ' JPY 1',
      'POS camera E2E ' || :'token' || ' JPY 2'
    )
 );
DELETE FROM public.acquisition_lots lot
 WHERE lot.shop_label IN (
   'POS camera E2E ' || :'token' || ' FIFO 1',
   'POS camera E2E ' || :'token' || ' FIFO 2',
   'POS camera E2E ' || :'token' || ' JPY 1',
   'POS camera E2E ' || :'token' || ' JPY 2'
 )
   AND NOT EXISTS (SELECT 1 FROM public.pokemon_lot_lines line WHERE line.lot_id = lot.lot_id)
   AND NOT EXISTS (SELECT 1 FROM public.mtg_lot_lines line WHERE line.lot_id = lot.lot_id)
   AND NOT EXISTS (SELECT 1 FROM public.pokemon_sealed_lot_lines line WHERE line.lot_id = lot.lot_id);
DELETE FROM public.tcgplayer_metrics
 WHERE external_reference_id IN (
   SELECT external_reference_id FROM public.pokemon_external_identifiers
    WHERE card_id = :'card_id'::integer
 );
DELETE FROM public.pokemon_external_identifiers WHERE card_id = :'card_id'::integer;
DELETE FROM public.pokemon_card_definitions WHERE card_id = :'card_id'::integer;
DELETE FROM public.conditions WHERE condition_id = :'condition_id'::integer;
ALTER TABLE public.pokemon_sales ENABLE TRIGGER pokemon_grouped_sales_immutable;
ALTER TABLE public.sale_expense_allocations ENABLE TRIGGER sale_expense_allocations_immutable;
ALTER TABLE public.sale_expenses ENABLE TRIGGER sale_expenses_immutable;
ALTER TABLE public.sale_lot_items ENABLE TRIGGER sale_lot_items_immutable;
ALTER TABLE public.sale_lots ENABLE TRIGGER sale_lots_immutable;
ALTER TABLE public.pokemon_lot_lines ENABLE TRIGGER pokemon_lot_lines_pos_lineage_immutable;
ALTER TABLE public.inventory_card_media ENABLE TRIGGER inventory_card_media_append_only;
ALTER TABLE public.card_recognition_audits ENABLE TRIGGER card_recognition_audits_controlled_transition;
ALTER TABLE public.pos_sale_session_lines ENABLE TRIGGER pos_sale_session_lines_closed_immutable;
ALTER TABLE public.pos_sale_sessions ENABLE TRIGGER pos_sale_sessions_closed_immutable;
DELETE FROM auth.users WHERE id = :'owner_id'::uuid;
COMMIT;
SQL
  cleanup_storage
}

cleanup_storage() {
  [[ -n "$owner_id" && -n "$api_url" && -n "$service_role_key" ]] || return 0
  local object_key
  while IFS= read -r object_key; do
    [[ -n "$object_key" ]] || continue
    curl -fsS -X DELETE \
      -H "apikey: $service_role_key" \
      -H "Authorization: Bearer $service_role_key" \
      "$api_url/storage/v1/object/inventory-card-media/$object_key" >/dev/null || true
  done < <(psql_local -At -v owner_id="$owner_id" <<'SQL'
SELECT name
  FROM storage.objects
 WHERE bucket_id = 'inventory-card-media'
   AND split_part(name, '/', 1) = :'owner_id';
SQL
  )
  if [[ "$(psql_local -At -v owner_id="$owner_id" <<'SQL'
SELECT count(*)
  FROM storage.objects
 WHERE bucket_id = 'inventory-card-media'
   AND split_part(name, '/', 1) = :'owner_id';
SQL
  )" != "0" ]]; then
    echo "POS camera browser cleanup left owner-scoped storage objects" >&2
    return 1
  fi
}

wait_for_local_supabase() {
  local attempt
  local delay_seconds=1
  for attempt in $(seq 1 30); do
    if curl -fsS --max-time 5 \
      -H "apikey: $anon_key" \
      "$api_url/auth/v1/health" >/dev/null 2>&1 \
      && curl -fsS --max-time 5 \
        -H "apikey: $service_role_key" \
        -H "Authorization: Bearer $service_role_key" \
        "$api_url/rest/v1/conditions?select=condition_id&limit=1" >/dev/null 2>&1; then
      return 0
    fi
    if [[ "$attempt" -lt 30 ]]; then
      sleep "$delay_seconds"
      if [[ "$delay_seconds" -lt 4 ]]; then
        delay_seconds=$((delay_seconds * 2))
      fi
    fi
  done
  fail "local GoTrue and PostgREST did not become ready after migration reload"
}

cleanup() {
  local requested_exit="$1"
  local cleanup_exit=0
  trap - EXIT INT TERM
  set +e
  if [[ -n "$next_pid" ]] && kill -0 "$next_pid" 2>/dev/null; then
    kill "$next_pid" 2>/dev/null
    wait "$next_pid" 2>/dev/null
  fi
  cleanup_database || cleanup_exit="$?"
  if [[ "$cleanup_exit" -ne 0 ]]; then
    echo "POS camera browser cleanup failed with exit $cleanup_exit" >&2
    if [[ "$requested_exit" -eq 0 ]]; then
      requested_exit="$cleanup_exit"
    fi
  fi
  exit "$requested_exit"
}

trap 'cleanup "$?"' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

[[ -n "$backend_root" ]] || fail "TCG_BACKEND_ROOT is required"
backend_root="$(cd "$backend_root" && pwd -P)"
[[ -d "$backend_root/supabase" ]] || fail "backend Supabase config is missing"
[[ -L "$backend_root/.env" ]] || fail "backend worktree .env must be a symlink"
[[ "$(readlink -f "$backend_root/.env")" == "/home/tzhan/tcg_tracker/.env" ]] ||
  fail "backend worktree .env points outside the assigned primary environment"
[[ -L "$frontend_root/.env.local" ]] || fail "frontend worktree .env.local must be a symlink"
[[ "$(readlink -f "$frontend_root/.env.local")" == "/home/tzhan/tcg_tracker_frontend/.env.local" ]] ||
  fail "frontend worktree .env.local points outside the assigned primary environment"
if [[ -z "$supabase_bin" ]]; then
  supabase_bin="$(command -v supabase || true)"
fi
[[ -x "$supabase_bin" ]] || fail "SUPABASE_BIN must name an executable current Supabase CLI"
[[ -x "$next_bin" ]] || fail "NEXT_BIN must name an executable Next.js binary"
command -v flock >/dev/null || fail "flock is required"
command -v docker >/dev/null || fail "docker is required"
command -v curl >/dev/null || fail "curl is required"

exec 9>>"$lock_path"
flock 9

project_id="$(sed -nE \
  's/^[[:space:]]*project_id[[:space:]]*=[[:space:]]*"([A-Za-z0-9_-]+)"[[:space:]]*$/\1/p' \
  "$backend_root/supabase/config.toml")"
[[ "$project_id" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] ||
  fail "backend Supabase project_id is missing or unsafe"
db_container="supabase_db_${project_id}"
[[ "$(docker inspect --format '{{.Name}}' "$db_container" 2>/dev/null)" == "/$db_container" ]] ||
  fail "exact local Supabase DB container $db_container is unavailable"
[[ "$(docker inspect --format '{{.State.Running}}' "$db_container")" == "true" ]] ||
  fail "exact local Supabase DB container $db_container is not running"
[[ "$(docker inspect --format '{{ index .Config.Labels "com.supabase.cli.project" }}' "$db_container")" == "$project_id" ]] ||
  fail "exact local Supabase DB container $db_container has the wrong project label"

internal_migration="$(find "$backend_root/internal/db/migrations" -maxdepth 1 -type f \
  -name '*_pos_camera_sessions.up.sql' -print -quit)"
[[ -n "$internal_migration" ]] || fail "POS camera internal up migration is missing"
migration_basename="$(basename "$internal_migration")"
migration_version="${migration_basename%%_*}"
[[ "$migration_version" =~ ^[0-9]{6}$ ]] || fail "POS camera migration version is unsafe"
supabase_migration="$backend_root/supabase/migrations/$migration_basename"
down_migration="$backend_root/internal/db/migrations/${migration_basename%.up.sql}.down.sql"
[[ -f "$supabase_migration" && -f "$down_migration" ]] ||
  fail "POS camera up mirrors and down migration must exist"
supabase_hash="$(sha256sum "$supabase_migration" | cut -d ' ' -f 1)"
internal_hash="$(sha256sum "$internal_migration" | cut -d ' ' -f 1)"
[[ "$supabase_hash" == "$internal_hash" ]] ||
  fail "POS camera migration mirror hashes differ"
if [[ "$(psql_local -Atqc \
  "SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '$migration_version')")" == "t" ]]; then
  psql_local --single-transaction \
    --file="$down_migration" \
    --command="DELETE FROM supabase_migrations.schema_migrations WHERE version = '$migration_version'"
fi
(cd "$backend_root" && HOME="${TMPDIR:-/tmp}" "$supabase_bin" migration up --local)
psql_local -Atqc "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '$migration_version'" |
  grep -qx '1' || fail "local schema migration ledger omitted $migration_version"
psql_local -Atqc \
  "SELECT pg_get_function_result('public.complete_card_recognition_browser_timing(uuid,numeric,numeric)'::regprocedure)" |
  grep -qx 'boolean' || fail "local browser timing completion RPC signature is missing"

supabase_status="$(cd "$backend_root" && HOME="${TMPDIR:-/tmp}" "$supabase_bin" status -o env)"
api_url="$(printf '%s\n' "$supabase_status" | sed -n 's/^API_URL=//p' | tr -d '"')"
anon_key="$(printf '%s\n' "$supabase_status" | sed -n 's/^ANON_KEY=//p' | tr -d '"')"
service_role_key="$(printf '%s\n' "$supabase_status" | sed -n 's/^SERVICE_ROLE_KEY=//p' | tr -d '"')"
[[ -n "$api_url" && -n "$anon_key" && -n "$service_role_key" ]] ||
  fail "local Supabase status omitted API_URL, ANON_KEY, or SERVICE_ROLE_KEY"
wait_for_local_supabase

run_token="$(node -e 'process.stdout.write(Date.now().toString(36))')"
app_port="$(node -e 'const server=require("node:net").createServer(); server.listen(0,"127.0.0.1",()=>{process.stdout.write(String(server.address().port));server.close();});')"
app_url="http://localhost:${app_port}"
auth_email="pos-camera-${run_token}@example.test"
auth_password="PosCameraE2E-$(openssl rand -hex 16)"
auth_secret="$(openssl rand -hex 32)"
artifact_root="/tmp/tcg-pos-camera-e2e-${run_token}"
auth_output="${artifact_root}/auth.json"
next_log="${artifact_root}/next-dev.log"
capture_path="${artifact_root}/exact-reselect.png"
mkdir -p "$artifact_root"

node "$frontend_root/scripts/e2e/create-local-auth-user.mjs" \
  "$api_url" "$anon_key" "$auth_email" "$auth_password" \
  "POS Camera E2E Operator" "$auth_output"
owner_id="$(node -e 'const f=require("node:fs"); const p=JSON.parse(f.readFileSync(process.argv[1])); process.stdout.write(p.userID)' "$auth_output")"
user_access_token="$(node -e 'const f=require("node:fs"); const p=JSON.parse(f.readFileSync(process.argv[1])); process.stdout.write(p.accessToken)' "$auth_output")"
[[ "$owner_id" =~ ^[0-9a-f-]{36}$ ]] || fail "local auth helper returned an invalid user UUID"
[[ -n "$user_access_token" ]] || fail "local auth helper omitted the authenticated user token"

fixture_values="$(
  psql_local -At -F '|' -v token="$run_token" <<'SQL'
WITH condition AS (
  INSERT INTO conditions (standard,code,display_name,tier)
  VALUES ('pos_camera_e2e_' || :'token','NM','POS Camera Near Mint',1)
  RETURNING condition_id
), card AS (
  INSERT INTO pokemon_card_definitions (
    regional_name,english_name,set_code,card_number,language,misc_info
  ) VALUES (
    'POSカメラ ' || :'token','POS Camera Card ' || :'token',
    'PCE2E','POS-' || :'token','jp','Browser fixture'
  ) RETURNING card_id,card_uid
), identifiers AS (
  INSERT INTO pokemon_external_identifiers (card_id,platform_name,external_reference_id)
  SELECT card_id,'tcgplayer_SKU','pos-camera-' || :'token' FROM card
), metrics AS (
  INSERT INTO tcgplayer_metrics (
    external_reference_id,language,printing,median_listing_price,total_quantity,last_updated
  ) VALUES ('pos-camera-' || :'token','en','normal',100,20,now())
), lot_one AS (
  INSERT INTO acquisition_lots (
    leg,acquired_at,shop_label,orig_currency,total_cost_orig,fx_rate_used,total_cost_usd
  ) VALUES ('import','2026-08-01','POS camera E2E ' || :'token' || ' FIFO 1','USD',20,1,20)
  RETURNING lot_id
), line_one AS (
  SELECT add_pokemon_lot_line_with_decision(
           lot_one.lot_id,card.card_id,condition.condition_id,0,2,10,
           NULL,jsonb_build_object('fixture','pos_camera_e2e')
         ) AS line_id,
         lot_one.lot_id
    FROM lot_one,card,condition
), finalize_one AS (
  SELECT finalize_acquisition_lot(lot_id) FROM line_one
), lot_two AS (
  INSERT INTO acquisition_lots (
    leg,acquired_at,shop_label,orig_currency,total_cost_orig,fx_rate_used,total_cost_usd
  ) SELECT 'import','2026-08-02','POS camera E2E ' || :'token' || ' FIFO 2','USD',180,1,180
    FROM finalize_one RETURNING lot_id
), line_two AS (
  SELECT add_pokemon_lot_line_with_decision(
           lot_two.lot_id,card.card_id,condition.condition_id,0,6,30,
           NULL,jsonb_build_object('fixture','pos_camera_e2e')
         ) AS line_id,
         lot_two.lot_id
    FROM lot_two,card,condition
), finalize_two AS (
  SELECT finalize_acquisition_lot(lot_id) FROM line_two
), open_one AS (
  INSERT INTO acquisition_lots (
    leg,acquired_at,shop_label,orig_currency,total_cost_orig,fx_rate_used,total_cost_usd
  ) SELECT 'import','2026-08-11','POS camera E2E ' || :'token' || ' JPY 1','JPY',0,0.0066,0
    FROM finalize_two RETURNING lot_id
), open_two AS (
  INSERT INTO acquisition_lots (
    leg,acquired_at,shop_label,orig_currency,total_cost_orig,fx_rate_used,total_cost_usd
  ) SELECT 'import','2026-08-11','POS camera E2E ' || :'token' || ' JPY 2','JPY',0,0.0066,0
    FROM open_one RETURNING lot_id
)
SELECT card.card_id,card.card_uid,line_one.line_id,line_two.line_id,
       open_one.lot_id,open_two.lot_id,condition.condition_id
  FROM card,line_one,line_two,open_one,open_two,condition;
SQL
)"
IFS='|' read -r card_id card_uid layer_one_id layer_two_id open_lot_one_id open_lot_two_id condition_id <<<"$fixture_values"
[[ -n "$card_id" && -n "$open_lot_two_id" ]] || fail "failed to seed isolated POS fixture"

fixture_json="$(POS_OWNER_ID="$owner_id" node -e '
const [cardID,conditionID,cardUID,lotOne,lotTwo,layerOne,layerTwo,token]=process.argv.slice(1);
process.stdout.write(JSON.stringify({
  ownerID: process.env.POS_OWNER_ID,
  cardID: Number(cardID),
  conditionID: Number(conditionID),
  token,
  lotIDs: [Number(lotOne),Number(lotTwo)],
  layerIDs: [Number(layerOne),Number(layerTwo)],
  card: {
    cardUID,
    regionalName: `POSカメラ ${token}`,
    englishName: `POS Camera Card ${token}`,
    setCode: "PCE2E",
    cardNumber: `POS-${token}`,
    miscInfo: "Browser fixture",
    language: "jp"
  }
}));
' "$card_id" "$condition_id" "$card_uid" "$open_lot_one_id" "$open_lot_two_id" "$layer_one_id" "$layer_two_id" "$run_token")"

node -e '
const fs=require("node:fs");
const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
fs.writeFileSync(process.argv[1],Buffer.from(png,"base64"),{mode:0o600});
' "$capture_path"

NEXT_PUBLIC_SUPABASE_URL="$api_url" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$anon_key" \
NEXT_PUBLIC_POS_RECOGNITION_URL="$app_url" \
E2E_AUTH_ENABLED=1 \
E2E_AUTH_SECRET="$auth_secret" \
E2E_AUTH_EMAIL="$auth_email" \
E2E_AUTH_PASSWORD="$auth_password" \
NEXT_TELEMETRY_DISABLED=1 \
"$next_bin" dev --hostname 127.0.0.1 --port "$app_port" >"$next_log" 2>&1 &
next_pid="$!"

ready=0
for _ in $(seq 1 120); do
  if curl -fsS "${app_url}/login" >/dev/null 2>&1; then
    ready=1
    break
  fi
  kill -0 "$next_pid" 2>/dev/null || break
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  tail -n 120 "$next_log" >&2
  fail "Next.js did not become ready"
fi

APP_URL="$app_url" \
E2E_AUTH_SECRET="$auth_secret" \
E2E_ARTIFACT_ROOT="$artifact_root" \
SUPABASE_API_URL="$api_url" \
SUPABASE_ANON_KEY="$anon_key" \
SUPABASE_SERVICE_ROLE_KEY="$service_role_key" \
POS_USER_ACCESS_TOKEN="$user_access_token" \
POS_FIXTURE_JSON="$fixture_json" \
POS_CAPTURE_PATH="$capture_path" \
node "$frontend_root/scripts/e2e/pos-camera-phone.mjs"

echo "POS browser artifacts: $artifact_root"
echo "Next.js log: $next_log"

#!/usr/bin/env bash
set -euo pipefail

owner="twitter-unresolved-observations-1949"
frontend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
backend_root="${TCG_BACKEND_ROOT:-}"
dependency_root="${TCG_FRONTEND_DEPENDENCY_ROOT:-${frontend_root}}"
assigned_data_root="/home/tzhan/tcg_tracker_data/.claude/worktrees/twitter-recognition-1826-20261020"
assigned_data_revision="481456fe63b0236aad372d6956fea00cacb08bf5"
lock_path="${TCG_DOCKER_BROWSER_LOCK_PATH:-/tmp/tcg-tracker-docker-browser.lock}"
next_bin="${dependency_root}/node_modules/.bin/next"
contained_next_bin="${frontend_root}/node_modules/.bin/next"
handoff_file="${E2E_PG_HANDOFF_FILE:-}"

volume=""
runtime_container=""
postgres_container=""
auth_container=""
rest_container=""
browser_container=""
artifact_root=""
run_token=""

fail() {
  echo "Unresolved price observation acceptance error: $*" >&2
  exit 1
}

random_port() {
  node -e '
    const server = require("node:net").createServer();
    server.listen(0, "127.0.0.1", () => {
      process.stdout.write(String(server.address().port));
      server.close();
    });
  '
}

assert_contained_loopback_listener() {
  local port="$1"
  local label="$2"
  docker exec "$runtime_container" node -e '
    const fs = require("node:fs");
    const port = Number(process.argv[1]);
    const label = process.argv[2];
    const portHex = port.toString(16).toUpperCase().padStart(4, "0");
    const rows = fs.readFileSync("/proc/net/tcp", "utf8").trim().split("\n").slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts[1]?.endsWith(`:${portHex}`) && parts[3] === "0A");
    if (rows.length === 0) throw new Error(`${label} has no contained listener on ${port}`);
    if (rows.some((parts) => parts[1] !== `0100007F:${portHex}`)) {
      throw new Error(`${label} is not bound exclusively to contained loopback:${port}`);
    }
    process.stdout.write(`${label}=127.0.0.1:${port}\n`);
  ' "$port" "$label"
}

contained_http_ready() {
  local url="$1"
  docker exec "$runtime_container" node -e '
    fetch(process.argv[1]).then((response) => {
      process.exit(response.ok ? 0 : 1);
    }).catch(() => process.exit(1));
  ' "$url" >/dev/null 2>&1
}

contained_http_request() {
  local url="$1"
  local output_path="$2"
  local headers_json="$3"
  local body="${4:-}"
  docker exec \
    -e "FIXTURE_REQUEST_URL=${url}" \
    -e "FIXTURE_RESPONSE_PATH=${output_path}" \
    -e "FIXTURE_REQUEST_HEADERS=${headers_json}" \
    -e "FIXTURE_REQUEST_BODY=${body}" \
    "$runtime_container" node -e '
      const fs = require("node:fs");
      const body = process.env.FIXTURE_REQUEST_BODY;
      fetch(process.env.FIXTURE_REQUEST_URL, {
        method: body === "" ? "GET" : "POST",
        headers: JSON.parse(process.env.FIXTURE_REQUEST_HEADERS),
        ...(body === "" ? {} : { body }),
      }).then(async (response) => {
        fs.writeFileSync(process.env.FIXTURE_RESPONSE_PATH, await response.text());
        process.stdout.write(String(response.status));
      }).catch((error) => {
        process.stderr.write(`${error.stack ?? error}\n`);
        process.exit(1);
      });
    '
}

cleanup() {
  local requested_exit="$1"
  local remaining_containers="0"
  local remaining_volumes="0"
  local next_build_output_removed="false"
  trap - EXIT INT TERM
  set +e

  if [[ -n "$handoff_file" && -n "$run_token" ]]; then
    rm -f -- "$handoff_file" "${handoff_file}.release"
  fi

  if [[ -n "$runtime_container" ]] &&
     docker inspect -f '{{.State.Running}}' "$runtime_container" 2>/dev/null |
       grep -qx true; then
    docker exec "$runtime_container" sh -c \
      'cat /sys/fs/cgroup/memory.events 2>/dev/null || true' \
      >"${artifact_root}/runtime-memory-events.txt" 2>&1
    docker exec "$runtime_container" sh -c \
      'ps -eo pid=,ppid=,stat=,comm=,args= 2>/dev/null || true' \
      >"${artifact_root}/runtime-final-processes.txt" 2>&1
    docker exec "$runtime_container" sh -c 'rm -rf -- "$1"' \
      sh "$frontend_root/.next" >/dev/null 2>&1
  fi
  if [[ -n "$browser_container" || -n "$rest_container" || -n "$auth_container" || -n "$postgres_container" || -n "$runtime_container" ]]; then
    docker rm -f \
      ${browser_container:+"$browser_container"} \
      ${rest_container:+"$rest_container"} \
      ${auth_container:+"$auth_container"} \
      ${postgres_container:+"$postgres_container"} \
      ${runtime_container:+"$runtime_container"} >/dev/null 2>&1
  fi
  if [[ -n "$volume" ]]; then
    docker volume rm "$volume" >/dev/null 2>&1
  fi
  rm -rf -- "$frontend_root/.next"
  if [[ ! -e "$frontend_root/.next" ]]; then
    next_build_output_removed="true"
  else
    requested_exit=1
  fi

  if [[ -n "$run_token" ]]; then
    remaining_containers="$(docker ps -aq \
      --filter "label=tcg.test.owner=${owner}" \
      --filter "label=tcg.test.run=${run_token}" | wc -l | tr -d ' ')"
    remaining_volumes="$(docker volume ls -q \
      --filter "label=tcg.test.owner=${owner}" \
      --filter "label=tcg.test.run=${run_token}" | wc -l | tr -d ' ')"
  fi
  if [[ -n "$artifact_root" && -d "$artifact_root" ]]; then
    rm -f -- "$artifact_root/operator-auth.json" "$artifact_root/ordinary-auth.json"
    cat >"$artifact_root/cleanup.txt" <<EOF
owner=${owner}
run=${run_token}
remaining_containers=${remaining_containers}
remaining_volumes=${remaining_volumes}
remaining_networks=0
network_mode=none_with_shared_container_namespace
next_build_output_removed=${next_build_output_removed}
EOF
  fi
  if [[ "$remaining_containers" != "0" || "$remaining_volumes" != "0" ]]; then
    echo "ERROR: isolated observation stack cleanup left containers=${remaining_containers} volumes=${remaining_volumes}" >&2
    requested_exit=1
  fi
  exit "$requested_exit"
}

trap 'cleanup "$?"' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

[[ -n "$backend_root" ]] || fail "TCG_BACKEND_ROOT is required"
backend_root="$(cd "$backend_root" && pwd -P)"
[[ "$backend_root" == /home/tzhan/tcg_tracker/.claude/worktrees/* ]] ||
  fail "TCG_BACKEND_ROOT must be an isolated backend worktree"
[[ "$(readlink -f "$backend_root/.env")" == /home/tzhan/tcg_tracker/.env ]] ||
  fail "backend .env must resolve to /home/tzhan/tcg_tracker/.env"
[[ "$(readlink -f "$frontend_root/.env.local")" == /home/tzhan/tcg_tracker_frontend/.env.local ]] ||
  fail "frontend .env.local must resolve to /home/tzhan/tcg_tracker_frontend/.env.local"
[[ -n "${TCG_DATA_ROOT:-}" ]] || fail "TCG_DATA_ROOT is required"
resolved_data_root="$(readlink -f "$TCG_DATA_ROOT")"
[[ "$resolved_data_root" == "$assigned_data_root" ]] ||
  fail "TCG_DATA_ROOT must resolve to ${assigned_data_root}, got ${resolved_data_root}"
[[ "$(git -C "$resolved_data_root" rev-parse HEAD)" == "$assigned_data_revision" ]] ||
  fail "assigned data revision moved"

[[ -x "$next_bin" ]] || fail "Next.js is unavailable at ${next_bin}"
[[ -d "$dependency_root/node_modules" ]] ||
  fail "shared frontend dependencies are unavailable at ${dependency_root}/node_modules"
for command_name in docker node openssl flock; do
  command -v "$command_name" >/dev/null || fail "$command_name is required"
done
cmp -s \
  "$backend_root/internal/db/migrations/000579_unresolved_buylist_price_observations.up.sql" \
  "$backend_root/supabase/migrations/000579_unresolved_buylist_price_observations.up.sql" ||
  fail "migration 000579 canonical and Supabase copies differ"
[[ ! -e "$backend_root/supabase/migrations/000579_unresolved_buylist_price_observations.down.sql" ]] ||
  fail "Supabase migrations must not include the canonical 000579 rollback file"

source_processes="$(ps -eo pid=,args= | awk '
  index($0, "/home/tzhan/automation/state/source-run-code/" "run-") { print }
')"
source_process_count="$(printf '%s\n' "$source_processes" | awk 'NF { count++ } END { print count + 0 }')"

exec 9>>"$lock_path"
flock -n 9 || fail "the shared Docker/browser lock is held by another session"
if [[ -n "$handoff_file" ]]; then
  fail "the contained browser fixture does not expose PostgreSQL for handoff"
fi

docker image inspect \
  postgres:17-alpine \
  public.ecr.aws/supabase/gotrue:v2.194.0 \
  public.ecr.aws/supabase/postgrest:v14.15 \
  public.ecr.aws/supabase/studio:2026.07.27-sha-cbb076d \
  tcg-tracker:browser >/dev/null ||
  fail "the isolated acceptance images must already be cached"

run_token="$(node -e 'process.stdout.write(Date.now().toString(36))')"
volume="tcg-unresolved-auth-${run_token}-pgdata"
runtime_container="tcg-unresolved-auth-${run_token}-runtime"
postgres_container="tcg-unresolved-auth-${run_token}-db"
auth_container="tcg-unresolved-auth-${run_token}-auth"
rest_container="tcg-unresolved-auth-${run_token}-rest"
browser_container="tcg-unresolved-auth-${run_token}-browser"
while :; do
  postgres_port="$(random_port)"
  auth_port="$(random_port)"
  rest_port="$(random_port)"
  router_port="$(random_port)"
  app_port="$(random_port)"
  cdp_port="$(random_port)"
  [[ "$(printf '%s\n' "$postgres_port" "$auth_port" "$rest_port" "$router_port" "$app_port" "$cdp_port" | sort -u | wc -l | tr -d ' ')" == "6" ]] && break
done
auth_origin="http://127.0.0.1:${auth_port}"
rest_origin="http://127.0.0.1:${rest_port}"
api_url="http://127.0.0.1:${router_port}"
app_url="http://127.0.0.1:${app_port}"
artifact_root="${E2E_ARTIFACT_ROOT:-/tmp/tcg-unresolved-price-observations-${run_token}}"
mkdir -p "$artifact_root"
printf 'postgres_port=%s\nauth_port=%s\nrest_port=%s\nrouter_port=%s\napp_port=%s\ncdp_port=%s\n' \
  "$postgres_port" "$auth_port" "$rest_port" "$router_port" "$app_port" "$cdp_port" \
  >"${artifact_root}/reserved-ports.txt"

jwt_secret="$(openssl rand -hex 32)"
auth_secret="$(openssl rand -hex 32)"
operator_email="unresolved-operator-${run_token}@example.test"
operator_password="UnresolvedOperator-${run_token}-password"
ordinary_email="unresolved-ordinary-${run_token}@example.test"
ordinary_password="UnresolvedOrdinary-${run_token}-password"
anon_key="$(JWT_SECRET="$jwt_secret" node -e '
  const { createHmac } = require("node:crypto");
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "isolated-unresolved-observations",
    role: "anon",
    iat: now - 60,
    exp: now + 3600,
  })}`;
  const signature = createHmac("sha256", process.env.JWT_SECRET).update(unsigned).digest("base64url");
  process.stdout.write(`${unsigned}.${signature}`);
')"

docker volume create \
  --label "tcg.test.owner=${owner}" \
  --label "tcg.test.run=${run_token}" \
  "$volume" >/dev/null

docker create --pull never \
  --name "$runtime_container" \
  --label "tcg.test.owner=${owner}" \
  --label "tcg.test.run=${run_token}" \
  --network none \
  --memory 2g --memory-reservation 1g --pids-limit 512 \
  --security-opt no-new-privileges \
  --mount "type=bind,source=${frontend_root},target=${frontend_root}" \
  --mount "type=bind,source=${dependency_root}/node_modules,target=${frontend_root}/node_modules,readonly" \
  --mount "type=bind,source=${backend_root},target=${backend_root},readonly" \
  --mount "type=bind,source=${assigned_data_root},target=${assigned_data_root},readonly" \
  --mount "type=bind,source=${artifact_root},target=${artifact_root}" \
  --entrypoint sh \
  public.ecr.aws/supabase/studio:2026.07.27-sha-cbb076d \
  -c 'trap "exit 0" TERM INT; while :; do sleep 3600; done' >/dev/null
docker start "$runtime_container" >/dev/null
docker exec "$runtime_container" node --version >"${artifact_root}/runtime-node-version.txt"

docker create --pull never \
  --name "$postgres_container" \
  --label "tcg.test.owner=${owner}" \
  --label "tcg.test.run=${run_token}" \
  --network "container:${runtime_container}" \
  --memory 256m --memory-reservation 192m --pids-limit 256 \
  --security-opt no-new-privileges \
  --mount "source=${volume},target=/var/lib/postgresql/data" \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=test \
  postgres:17-alpine \
  -c listen_addresses=127.0.0.1 \
  -c "port=${postgres_port}" >/dev/null
docker start "$postgres_container" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$postgres_container" pg_isready \
    -h 127.0.0.1 -p "$postgres_port" -U postgres -d test >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$postgres_container" pg_isready \
  -h 127.0.0.1 -p "$postgres_port" -U postgres -d test >/dev/null ||
  fail "isolated PostgreSQL did not become ready"
assert_contained_loopback_listener "$postgres_port" "PostgreSQL"

docker exec -i "$postgres_container" psql -X \
  -h 127.0.0.1 -p "$postgres_port" -U postgres -d test \
  -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE ROLE supabase_auth_admin LOGIN SUPERUSER PASSWORD 'test';
ALTER ROLE supabase_auth_admin SET search_path = auth;
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'test';
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT anon, authenticated, service_role TO authenticator;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL,
    public boolean NOT NULL DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[]
);
CREATE TABLE storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text REFERENCES storage.buckets(id),
    name text,
    metadata jsonb,
    user_metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
SQL

docker create --pull never \
  --name "$auth_container" \
  --label "tcg.test.owner=${owner}" \
  --label "tcg.test.run=${run_token}" \
  --network "container:${runtime_container}" \
  --memory 128m --memory-reservation 96m --pids-limit 128 \
  --security-opt no-new-privileges \
  -e GOTRUE_API_HOST=127.0.0.1 \
  -e "GOTRUE_API_PORT=${auth_port}" \
  -e "API_EXTERNAL_URL=${api_url}" \
  -e GOTRUE_DB_DRIVER=postgres \
  -e "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:test@127.0.0.1:${postgres_port}/test?sslmode=disable" \
  -e "GOTRUE_SITE_URL=${app_url}" \
  -e "GOTRUE_URI_ALLOW_LIST=${app_url}" \
  -e GOTRUE_DISABLE_SIGNUP=false \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
  -e GOTRUE_MAILER_AUTOCONFIRM=true \
  -e GOTRUE_JWT_AUD=authenticated \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  -e GOTRUE_JWT_EXP=3600 \
  -e "GOTRUE_JWT_SECRET=${jwt_secret}" \
  public.ecr.aws/supabase/gotrue:v2.194.0 >/dev/null
docker start "$auth_container" >/dev/null
auth_ready=0
for _ in $(seq 1 60); do
  if contained_http_ready "${auth_origin}/health"; then
    auth_ready=1
    break
  fi
  sleep 1
done
if [[ "$auth_ready" -ne 1 ]]; then
  docker logs "$auth_container" >"${artifact_root}/gotrue.log" 2>&1
  fail "isolated GoTrue did not become ready"
fi
assert_contained_loopback_listener "$auth_port" "GoTrue"

migration_log="${artifact_root}/migrations.log"
: >"$migration_log"
migration_count=0
while IFS= read -r migration; do
  migration_count=$((migration_count + 1))
  printf '%s\n' "$(basename "$migration")" >>"$migration_log"
  docker exec -i "$postgres_container" psql -X -q -1 \
    -h 127.0.0.1 -p "$postgres_port" -U postgres -d test \
    -v ON_ERROR_STOP=1 <"$migration" >>"$migration_log" 2>&1 || {
      tail -n 120 "$migration_log" >&2
      fail "migration $(basename "$migration") failed in isolated PostgreSQL"
    }
done < <(find "$backend_root/internal/db/migrations" -maxdepth 1 -type f \
  -name '*.up.sql' -print | sort)
[[ "$migration_count" -gt 0 ]] || fail "no backend migrations were found"

docker create --pull never \
  --name "$rest_container" \
  --label "tcg.test.owner=${owner}" \
  --label "tcg.test.run=${run_token}" \
  --network "container:${runtime_container}" \
  --memory 128m --memory-reservation 96m --pids-limit 128 \
  --security-opt no-new-privileges \
  -e "PGRST_DB_URI=postgres://authenticator:test@127.0.0.1:${postgres_port}/test" \
  -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon \
  -e "PGRST_JWT_SECRET=${jwt_secret}" \
  -e PGRST_SERVER_HOST=127.0.0.1 \
  -e "PGRST_SERVER_PORT=${rest_port}" \
  -e PGRST_LOG_LEVEL=warn \
  public.ecr.aws/supabase/postgrest:v14.15 >/dev/null
docker start "$rest_container" >/dev/null
rest_ready=0
for _ in $(seq 1 60); do
  if contained_http_ready "${rest_origin}/"; then
    rest_ready=1
    break
  fi
  sleep 1
done
if [[ "$rest_ready" -ne 1 ]]; then
  docker logs "$rest_container" >"${artifact_root}/postgrest.log" 2>&1
  fail "isolated PostgREST did not become ready"
fi
assert_contained_loopback_listener "$rest_port" "PostgREST"

docker exec -d \
  -w "$frontend_root" \
  -e "AUTH_ORIGIN=${auth_origin}" \
  -e "REST_ORIGIN=${rest_origin}" \
  -e "ROUTER_PORT=${router_port}" \
  -e "FIXTURE_ROUTER_LOG=${artifact_root}/supabase-router.log" \
  "$runtime_container" sh -c \
  'exec node scripts/e2e/unresolved-price-observations-supabase-router.mjs >"$FIXTURE_ROUTER_LOG" 2>&1'
router_ready=0
for _ in $(seq 1 60); do
  if contained_http_ready "${api_url}/__health"; then
    router_ready=1
    break
  fi
  sleep 1
done
[[ "$router_ready" -eq 1 ]] || fail "isolated Supabase router did not become ready"
assert_contained_loopback_listener "$router_port" "Supabase router"

docker exec -w "$frontend_root" "$runtime_container" node \
  "$frontend_root/scripts/e2e/create-local-auth-user.mjs" \
  "$api_url" "$anon_key" "$operator_email" "$operator_password" \
  "Unresolved Observation Operator" "${artifact_root}/operator-auth.json" >/dev/null
docker exec -w "$frontend_root" "$runtime_container" node \
  "$frontend_root/scripts/e2e/create-local-auth-user.mjs" \
  "$api_url" "$anon_key" "$ordinary_email" "$ordinary_password" \
  "Unresolved Observation Ordinary User" "${artifact_root}/ordinary-auth.json" >/dev/null

docker exec -i "$postgres_container" psql -X \
  -h 127.0.0.1 -p "$postgres_port" -U postgres -d test \
  -v ON_ERROR_STOP=1 -v operator_email="$operator_email" \
  -f - <"$frontend_root/scripts/e2e/unresolved-price-observations-seed.sql" \
  >"${artifact_root}/seed.log"

operator_token="$(docker exec "$runtime_container" node -e 'const v=require(process.argv[1]); process.stdout.write(v.accessToken)' "${artifact_root}/operator-auth.json")"
ordinary_token="$(docker exec "$runtime_container" node -e 'const v=require(process.argv[1]); process.stdout.write(v.accessToken)' "${artifact_root}/ordinary-auth.json")"
operator_role="$(docker exec "$runtime_container" node -e 'const v=require(process.argv[1]); const p=JSON.parse(Buffer.from(v.accessToken.split(".")[1], "base64url")); process.stdout.write(p.role ?? "")' "${artifact_root}/operator-auth.json")"
ordinary_role="$(docker exec "$runtime_container" node -e 'const v=require(process.argv[1]); const p=JSON.parse(Buffer.from(v.accessToken.split(".")[1], "base64url")); process.stdout.write(p.role ?? "")' "${artifact_root}/ordinary-auth.json")"
[[ "$operator_role" == "authenticated" ]] || fail "operator token role=${operator_role:-missing}"
[[ "$ordinary_role" == "authenticated" ]] || fail "ordinary token role=${ordinary_role:-missing}"

rpc_payload='{"p_limit":24,"p_before_routing_outcome_id":null,"p_before_observation_ordinal":null}'
anon_headers="$(node -e '
  process.stdout.write(JSON.stringify({
    apikey: process.argv[1],
    "content-type": "application/json",
  }));
' "$anon_key")"
ordinary_headers="$(node -e '
  process.stdout.write(JSON.stringify({
    apikey: process.argv[1],
    authorization: `Bearer ${process.argv[2]}`,
    "content-type": "application/json",
  }));
' "$anon_key" "$ordinary_token")"
operator_headers="$(node -e '
  process.stdout.write(JSON.stringify({
    apikey: process.argv[1],
    authorization: `Bearer ${process.argv[2]}`,
    "content-type": "application/json",
  }));
' "$anon_key" "$operator_token")"
anon_rpc_status="$(contained_http_request \
  "${api_url}/rest/v1/rpc/list_unresolved_buylist_price_observations" \
  "${artifact_root}/anon-rpc.json" "$anon_headers" "$rpc_payload")"
case "$anon_rpc_status" in
  401|403|404) ;;
  *) cat "${artifact_root}/anon-rpc.json" >&2; fail "anonymous RPC returned ${anon_rpc_status}, want denial" ;;
esac
ordinary_rpc_status="$(contained_http_request \
  "${api_url}/rest/v1/rpc/list_unresolved_buylist_price_observations" \
  "${artifact_root}/ordinary-rpc.json" "$ordinary_headers" "$rpc_payload")"
if [[ "$ordinary_rpc_status" != "403" ]]; then
  cat "${artifact_root}/ordinary-rpc.json" >&2
  fail "ordinary authenticated RPC returned ${ordinary_rpc_status}, want 403"
fi
operator_rpc_status="$(contained_http_request \
  "${api_url}/rest/v1/rpc/list_unresolved_buylist_price_observations" \
  "${artifact_root}/operator-rpc.json" "$operator_headers" "$rpc_payload")"
if [[ "$operator_rpc_status" != "200" ]]; then
  cat "${artifact_root}/operator-rpc.json" >&2
  fail "operator RPC returned ${operator_rpc_status}, want 200"
fi
node -e '
  const rows = require(process.argv[1]);
  if (!Array.isArray(rows) || rows.length !== 24) process.exit(2);
  const prices = rows[0]?.observation?.prices?.map((price) => price.amount_jpy);
  if (JSON.stringify(prices) !== JSON.stringify([110000, 74000])) process.exit(3);
  if (rows[0]?.source_content_sha256 !== "a".repeat(64)) process.exit(4);
' "${artifact_root}/operator-rpc.json" || fail "operator RPC changed durable tiers or provenance"
base_table_status="$(contained_http_request \
  "${api_url}/rest/v1/buylist_media_routing_outcomes?select=routing_outcome_id&limit=1" \
  "${artifact_root}/base-table.json" "$operator_headers")"
[[ "$base_table_status" != "200" ]] || fail "operator unexpectedly read the base routing table"
printf 'anon_rpc_status=%s\nordinary_rpc_status=%s\noperator_rpc_status=%s\nbase_table_status=%s\noperator_rpc_count=24\n' \
  "$anon_rpc_status" "$ordinary_rpc_status" "$operator_rpc_status" "$base_table_status" \
  >"${artifact_root}/rpc-boundary.txt"

docker exec -d \
  -w "$frontend_root" \
  -e "NEXT_PUBLIC_SUPABASE_URL=${api_url}" \
  -e "NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon_key}" \
  -e "SUPABASE_URL=${api_url}" \
  -e "SUPABASE_ANON_KEY=${anon_key}" \
  -e SUPABASE_SERVICE_ROLE_KEY=isolated-fixture-unused \
  -e DATABASE_URL=postgresql://fixture-disabled@127.0.0.1:1/fixture \
  -e E2E_AUTH_ENABLED=1 \
  -e "E2E_AUTH_SECRET=${auth_secret}" \
  -e "E2E_AUTH_EMAIL=${operator_email}" \
  -e "E2E_AUTH_PASSWORD=${operator_password}" \
  -e "TCG_DATA_ROOT=${assigned_data_root}" \
  -e NEXT_TELEMETRY_DISABLED=1 \
  -e "FIXTURE_NEXT_LOG=${artifact_root}/next-dev.log" \
  "$runtime_container" sh -c \
  'exec "$1" dev --hostname 127.0.0.1 --port "$2" >"$FIXTURE_NEXT_LOG" 2>&1' \
  sh "$contained_next_bin" "$app_port"
next_ready=0
for _ in $(seq 1 120); do
  if contained_http_ready "${app_url}/login"; then
    next_ready=1
    break
  fi
  sleep 1
done
if [[ "$next_ready" -ne 1 ]]; then
  tail -n 120 "${artifact_root}/next-dev.log" >&2
  fail "Next.js did not become ready"
fi
assert_contained_loopback_listener "$app_port" "Next.js"

docker create --pull never \
  --name "$browser_container" \
  --label "tcg.test.owner=${owner}" \
  --label "tcg.test.run=${run_token}" \
  --network "container:${runtime_container}" \
  --memory 768m --memory-reservation 512m --pids-limit 512 --shm-size 256m \
  --security-opt no-new-privileges \
  --entrypoint /usr/bin/chromium \
  tcg-tracker:browser \
  --headless=new \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-background-networking \
  --no-first-run \
  --no-default-browser-check \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$cdp_port" \
  --remote-allow-origins='*' \
  --user-data-dir=/tmp/tcg-unresolved-observations-1949-chromium \
  about:blank >/dev/null
docker start "$browser_container" >/dev/null
cdp_ready=0
for _ in $(seq 1 60); do
  if contained_http_ready "http://127.0.0.1:${cdp_port}/json/version"; then
    cdp_ready=1
    break
  fi
  sleep 1
done
if [[ "$cdp_ready" -ne 1 ]]; then
  docker logs "$browser_container" >"${artifact_root}/chromium.log" 2>&1
  fail "contained Chromium CDP did not become ready"
fi
assert_contained_loopback_listener "$cdp_port" "Chromium CDP"

{
  assert_contained_loopback_listener "$postgres_port" "PostgreSQL"
  assert_contained_loopback_listener "$auth_port" "GoTrue"
  assert_contained_loopback_listener "$rest_port" "PostgREST"
  assert_contained_loopback_listener "$router_port" "Supabase router"
  assert_contained_loopback_listener "$app_port" "Next.js"
  assert_contained_loopback_listener "$cdp_port" "Chromium CDP"
} >"${artifact_root}/loopback-listeners.txt"

docker inspect \
  "$runtime_container" "$postgres_container" "$auth_container" "$rest_container" "$browser_container" \
  --format '{{.Id}} {{.Name}} image={{.Config.Image}} network={{.HostConfig.NetworkMode}} memory={{.HostConfig.Memory}} owner={{index .Config.Labels "tcg.test.owner"}} run={{index .Config.Labels "tcg.test.run"}}' \
  >"${artifact_root}/resources.txt"
printf 'network_mode=none_with_shared_container_namespace\ncreated_networks=0\npublished_ports=0\nvolume=%s\npostgres_port=%s\nauth_port=%s\nrest_port=%s\nrouter_port=%s\napp_port=%s\ncdp_port=%s\nmigration_count=%s\nmanaged_source_processes_at_start=%s\n' \
  "$volume" "$postgres_port" "$auth_port" "$rest_port" "$router_port" "$app_port" "$cdp_port" "$migration_count" "$source_process_count" \
  >>"${artifact_root}/resources.txt"
printf 'backend_revision=%s\nfrontend_revision=%s\ndata_revision=%s\nmigration_000579_sha256=%s\nfixture_runner_sha256=%s\n' \
  "$(git -C "$backend_root" rev-parse HEAD)" \
  "$(git -C "$frontend_root" rev-parse HEAD)" \
  "$assigned_data_revision" \
  "$(sha256sum "$backend_root/internal/db/migrations/000579_unresolved_buylist_price_observations.up.sql" | cut -d' ' -f1)" \
  "$(sha256sum "$frontend_root/scripts/e2e/run-unresolved-price-observations-authenticated.sh" | cut -d' ' -f1)" \
  >>"${artifact_root}/resources.txt"
for image_name in \
  postgres:17-alpine \
  public.ecr.aws/supabase/gotrue:v2.194.0 \
  public.ecr.aws/supabase/postgrest:v14.15 \
  public.ecr.aws/supabase/studio:2026.07.27-sha-cbb076d \
  tcg-tracker:browser; do
  docker image inspect "$image_name" \
    --format 'image={{.RepoTags}} id={{.Id}}' >>"${artifact_root}/resources.txt"
done

docker exec \
  -w "$frontend_root" \
  -e "APP_URL=${app_url}" \
  -e "E2E_API_URL=${api_url}" \
  -e "E2E_AUTH_SECRET=${auth_secret}" \
  -e "E2E_ARTIFACT_ROOT=${artifact_root}" \
  -e "E2E_CDP_URL=http://127.0.0.1:${cdp_port}" \
  "$runtime_container" node \
  scripts/e2e/unresolved-price-observations-authenticated.mjs

rm -f -- "${artifact_root}/operator-auth.json" "${artifact_root}/ordinary-auth.json"
echo "Authenticated unresolved price observation evidence: ${artifact_root}"

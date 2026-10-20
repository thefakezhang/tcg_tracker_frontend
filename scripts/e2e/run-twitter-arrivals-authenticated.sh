#!/usr/bin/env bash
set -euo pipefail

owner="twitter-arrival-digest-1932"
frontend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
backend_root="${TCG_BACKEND_ROOT:-}"
dependency_root="${TCG_FRONTEND_DEPENDENCY_ROOT:-${frontend_root}}"
assigned_data_root="/home/tzhan/tcg_tracker_data/.claude/worktrees/twitter-recognition-1826-20261020"
assigned_data_revision="481456fe63b0236aad372d6956fea00cacb08bf5"
lock_path="${TCG_DOCKER_BROWSER_LOCK_PATH:-/tmp/tcg-tracker-docker-browser.lock}"
next_bin="${dependency_root}/node_modules/.bin/next"

next_pid=""
router_pid=""
network=""
volume=""
postgres_container=""
auth_container=""
rest_container=""
artifact_root=""
run_token=""

fail() {
  echo "Authenticated Twitter arrivals acceptance error: $*" >&2
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

cleanup() {
  local requested_exit="$1"
  local remaining_containers="unknown"
  local remaining_volumes="unknown"
  local remaining_networks="unknown"
  trap - EXIT INT TERM
  set +e

  for pid in "$next_pid" "$router_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
    fi
  done
  next_pid=""
  router_pid=""

  if [[ -n "$rest_container" || -n "$auth_container" || -n "$postgres_container" ]]; then
    docker rm -f \
      ${rest_container:+"$rest_container"} \
      ${auth_container:+"$auth_container"} \
      ${postgres_container:+"$postgres_container"} >/dev/null 2>&1
  fi
  if [[ -n "$volume" ]]; then
    docker volume rm "$volume" >/dev/null 2>&1
  fi
  if [[ -n "$network" ]]; then
    docker network rm "$network" >/dev/null 2>&1
  fi

  if [[ -n "$run_token" ]]; then
    remaining_containers="$(docker ps -aq \
      --filter "label=tcg.test.owner=${owner}" \
      --filter "label=tcg.test.run=${run_token}" | wc -l | tr -d ' ')"
    remaining_volumes="$(docker volume ls -q \
      --filter "label=tcg.test.owner=${owner}" \
      --filter "label=tcg.test.run=${run_token}" | wc -l | tr -d ' ')"
    remaining_networks="$(docker network ls -q \
      --filter "label=tcg.test.owner=${owner}" \
      --filter "label=tcg.test.run=${run_token}" | wc -l | tr -d ' ')"
  fi
  if [[ -n "$artifact_root" ]] && [[ -d "$artifact_root" ]]; then
    rm -f -- "${artifact_root}/admin-auth.json" "${artifact_root}/ordinary-auth.json"
    cat >"${artifact_root}/cleanup.txt" <<EOF
owner=${owner}
run=${run_token}
remaining_containers=${remaining_containers}
remaining_volumes=${remaining_volumes}
remaining_networks=${remaining_networks}
EOF
  fi
  if [[ "$remaining_containers" != "0" || "$remaining_volumes" != "0" || "$remaining_networks" != "0" ]]; then
    echo "ERROR: isolated arrival stack cleanup left containers=${remaining_containers} volumes=${remaining_volumes} networks=${remaining_networks}" >&2
    requested_exit=1
  fi
  exit "$requested_exit"
}

trap 'cleanup "$?"' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

if [[ "${TCG_TWITTER_ARRIVALS_AUTH_XVFB:-}" != "1" ]]; then
  command -v xvfb-run >/dev/null || fail "xvfb-run is required for headed browser evidence"
  export E2E_HEADED=1
  export TCG_TWITTER_ARRIVALS_AUTH_XVFB=1
  exec xvfb-run -a "$0" "$@"
fi
[[ -n "${DISPLAY:-}" ]] || fail "the isolated Xvfb display is unavailable"
export E2E_HEADED=1

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
for command_name in docker node curl openssl flock; do
  command -v "$command_name" >/dev/null || fail "$command_name is required"
done
cmp -s \
  "$backend_root/internal/db/migrations/000576_twitter_arrival_hourly_digest.up.sql" \
  "$backend_root/supabase/migrations/000576_twitter_arrival_hourly_digest.up.sql" ||
  fail "migration 000576 canonical and Supabase copies differ"
[[ ! -e "$backend_root/supabase/migrations/000576_twitter_arrival_hourly_digest.down.sql" ]] ||
  fail "Supabase migrations must not include the canonical 000576 rollback file"

exec 9>>"$lock_path"
flock -n 9 || fail "the shared Docker/browser lock is held by another session"

docker image inspect \
  postgres:17-alpine \
  public.ecr.aws/supabase/gotrue:v2.194.0 \
  public.ecr.aws/supabase/postgrest:v14.15 >/dev/null ||
  fail "the isolated acceptance images must already be cached"

run_token="$(node -e 'process.stdout.write(Date.now().toString(36))')"
network="tcg-arrival-auth-${run_token}-net"
volume="tcg-arrival-auth-${run_token}-pgdata"
postgres_container="tcg-arrival-auth-${run_token}-db"
auth_container="tcg-arrival-auth-${run_token}-auth"
rest_container="tcg-arrival-auth-${run_token}-rest"
auth_port="$(random_port)"
rest_port="$(random_port)"
router_port="$(random_port)"
app_port="$(random_port)"
auth_origin="http://127.0.0.1:${auth_port}"
rest_origin="http://127.0.0.1:${rest_port}"
api_url="http://127.0.0.1:${router_port}"
app_url="http://127.0.0.1:${app_port}"
artifact_root="${E2E_ARTIFACT_ROOT:-/tmp/tcg-twitter-arrivals-authenticated-${run_token}}"
mkdir -p "$artifact_root"

jwt_secret="$(openssl rand -hex 32)"
auth_secret="$(openssl rand -hex 32)"
admin_email="arrival-admin-${run_token}@example.test"
admin_password="ArrivalAdmin-${run_token}-password"
ordinary_email="arrival-ordinary-${run_token}@example.test"
ordinary_password="ArrivalOrdinary-${run_token}-password"
anon_key="$(JWT_SECRET="$jwt_secret" node -e '
  const { createHmac } = require("node:crypto");
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "isolated-twitter-arrivals",
    role: "anon",
    iat: now - 60,
    exp: now + 3600,
  })}`;
  const signature = createHmac("sha256", process.env.JWT_SECRET).update(unsigned).digest("base64url");
  process.stdout.write(`${unsigned}.${signature}`);
')"

docker network create \
  --label "tcg.test.owner=${owner}" \
  --label "tcg.test.run=${run_token}" \
  "$network" >/dev/null
docker volume create \
  --label "tcg.test.owner=${owner}" \
  --label "tcg.test.run=${run_token}" \
  "$volume" >/dev/null

docker create --pull never \
  --name "$postgres_container" \
  --label "tcg.test.owner=${owner}" \
  --label "tcg.test.run=${run_token}" \
  --network "$network" \
  --network-alias db \
  --memory 256m --memory-reservation 192m --pids-limit 256 \
  --security-opt no-new-privileges \
  --mount "source=${volume},target=/var/lib/postgresql/data" \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=test \
  postgres:17-alpine >/dev/null
docker start "$postgres_container" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$postgres_container" pg_isready -U postgres -d test >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$postgres_container" pg_isready -U postgres -d test >/dev/null ||
  fail "isolated PostgreSQL did not become ready"

docker exec -i "$postgres_container" psql -X -U postgres -d test \
  -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE ROLE supabase_auth_admin LOGIN SUPERUSER PASSWORD 'test';
ALTER ROLE supabase_auth_admin SET search_path = auth;
CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'test';
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
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
  --network "$network" \
  --memory 128m --memory-reservation 96m --pids-limit 128 \
  --security-opt no-new-privileges \
  -p "127.0.0.1:${auth_port}:9999" \
  -e GOTRUE_API_HOST=0.0.0.0 \
  -e GOTRUE_API_PORT=9999 \
  -e "API_EXTERNAL_URL=${api_url}" \
  -e GOTRUE_DB_DRIVER=postgres \
  -e "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:test@db:5432/test?sslmode=disable" \
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
  if curl -fsS "${auth_origin}/health" >/dev/null 2>&1; then
    auth_ready=1
    break
  fi
  sleep 1
done
if [[ "$auth_ready" -ne 1 ]]; then
  docker logs "$auth_container" >"${artifact_root}/gotrue.log" 2>&1
  fail "isolated GoTrue did not become ready"
fi

migration_log="${artifact_root}/migrations.log"
: >"$migration_log"
migration_count=0
while IFS= read -r migration; do
  migration_count=$((migration_count + 1))
  printf '%s\n' "$(basename "$migration")" >>"$migration_log"
  docker exec -i "$postgres_container" psql -X -q -1 -U postgres -d test \
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
  --network "$network" \
  --memory 128m --memory-reservation 96m --pids-limit 128 \
  --security-opt no-new-privileges \
  -p "127.0.0.1:${rest_port}:3000" \
  -e PGRST_DB_URI=postgres://authenticator:test@db:5432/test \
  -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon \
  -e "PGRST_JWT_SECRET=${jwt_secret}" \
  -e PGRST_SERVER_HOST=0.0.0.0 \
  -e PGRST_SERVER_PORT=3000 \
  -e PGRST_LOG_LEVEL=warn \
  public.ecr.aws/supabase/postgrest:v14.15 >/dev/null
docker start "$rest_container" >/dev/null
rest_ready=0
for _ in $(seq 1 60); do
  if curl -fsS "${rest_origin}/" >/dev/null 2>&1; then
    rest_ready=1
    break
  fi
  sleep 1
done
if [[ "$rest_ready" -ne 1 ]]; then
  docker logs "$rest_container" >"${artifact_root}/postgrest.log" 2>&1
  fail "isolated PostgREST did not become ready"
fi

AUTH_ORIGIN="$auth_origin" \
REST_ORIGIN="$rest_origin" \
ROUTER_PORT="$router_port" \
node "$frontend_root/scripts/e2e/twitter-arrivals-supabase-router.mjs" \
  >"${artifact_root}/supabase-router.log" 2>&1 &
router_pid="$!"
router_ready=0
for _ in $(seq 1 60); do
  if curl -fsS "${api_url}/__health" >/dev/null 2>&1; then
    router_ready=1
    break
  fi
  if ! kill -0 "$router_pid" 2>/dev/null; then
    break
  fi
  sleep 1
done
[[ "$router_ready" -eq 1 ]] || fail "isolated Supabase router did not become ready"

node "$frontend_root/scripts/e2e/create-local-auth-user.mjs" \
  "$api_url" "$anon_key" "$admin_email" "$admin_password" \
  "Arrival Digest Administrator" "${artifact_root}/admin-auth.json" >/dev/null
node "$frontend_root/scripts/e2e/create-local-auth-user.mjs" \
  "$api_url" "$anon_key" "$ordinary_email" "$ordinary_password" \
  "Arrival Digest Ordinary User" "${artifact_root}/ordinary-auth.json" >/dev/null

promoted_count="$(docker exec -i "$postgres_container" psql -X -U postgres -d test \
  -v ON_ERROR_STOP=1 -v admin_email="$admin_email" -Atq -f - <<'SQL'
WITH promoted AS (
    UPDATE auth.users
       SET role = 'administrator'
     WHERE lower(email) = lower(:'admin_email')
    RETURNING id
)
SELECT count(*) FROM promoted;
SQL
)"
[[ "$promoted_count" == "1" ]] ||
  fail "isolated administrator promotion changed ${promoted_count:-0} rows"
node "$frontend_root/scripts/e2e/create-local-auth-user.mjs" \
  "$api_url" "$anon_key" "$admin_email" "$admin_password" \
  "Arrival Digest Administrator" "${artifact_root}/admin-auth.json" >/dev/null

docker exec -i "$postgres_container" psql -X -U postgres -d test \
  -v ON_ERROR_STOP=1 -v administrator_email="$admin_email" \
  -f - <"$frontend_root/scripts/e2e/twitter-arrivals-authenticated-seed.sql" \
  >"${artifact_root}/seed.log"

admin_token="$(node -e 'const v=require(process.argv[1]); process.stdout.write(v.accessToken)' "${artifact_root}/admin-auth.json")"
ordinary_token="$(node -e 'const v=require(process.argv[1]); process.stdout.write(v.accessToken)' "${artifact_root}/ordinary-auth.json")"
admin_role="$(node -e 'const v=require(process.argv[1]); const p=JSON.parse(Buffer.from(v.accessToken.split(".")[1], "base64url")); process.stdout.write(p.role ?? "")' "${artifact_root}/admin-auth.json")"
ordinary_role="$(node -e 'const v=require(process.argv[1]); const p=JSON.parse(Buffer.from(v.accessToken.split(".")[1], "base64url")); process.stdout.write(p.role ?? "")' "${artifact_root}/ordinary-auth.json")"
[[ "$admin_role" == "administrator" ]] ||
  fail "isolated administrator token role=${admin_role:-missing}"
[[ "$ordinary_role" == "authenticated" ]] ||
  fail "isolated ordinary token role=${ordinary_role:-missing}"
rpc_payload='{"p_buyer_handle":null,"p_before":null,"p_before_key":null,"p_limit":100}'
ordinary_rpc_status="$(curl -sS -o "${artifact_root}/ordinary-rpc.json" -w '%{http_code}' \
  -H "apikey: ${anon_key}" \
  -H "Authorization: Bearer ${ordinary_token}" \
  -H 'Content-Type: application/json' \
  --data "$rpc_payload" \
  "${api_url}/rest/v1/rpc/twitter_arrival_posts")"
if [[ "$ordinary_rpc_status" != "403" ]]; then
  cat "${artifact_root}/ordinary-rpc.json" >&2
  fail "ordinary caller-session RPC returned ${ordinary_rpc_status}, want 403"
fi
admin_rpc_status="$(curl -sS -o "${artifact_root}/admin-rpc.json" -w '%{http_code}' \
  -H "apikey: ${anon_key}" \
  -H "Authorization: Bearer ${admin_token}" \
  -H 'Content-Type: application/json' \
  --data "$rpc_payload" \
  "${api_url}/rest/v1/rpc/twitter_arrival_posts")"
if [[ "$admin_rpc_status" != "200" ]]; then
  cat "${artifact_root}/admin-rpc.json" >&2
  fail "administrator caller-session RPC returned ${admin_rpc_status}, want 200"
fi
admin_rpc_count="$(node -e 'const v=require(process.argv[1]); if(!Array.isArray(v)) process.exit(2); process.stdout.write(String(v.length))' "${artifact_root}/admin-rpc.json")"
[[ "$admin_rpc_count" == "100" ]] ||
  fail "administrator caller-session RPC returned ${admin_rpc_count} rows, want 100"
printf 'ordinary_rpc_status=%s\nadmin_rpc_status=%s\nadmin_rpc_count=%s\n' \
  "$ordinary_rpc_status" "$admin_rpc_status" "$admin_rpc_count" \
  >"${artifact_root}/rpc-boundary.txt"

docker inspect "$postgres_container" "$auth_container" "$rest_container" \
  --format '{{.Id}} {{.Name}} image={{.Config.Image}} owner={{index .Config.Labels "tcg.test.owner"}} run={{index .Config.Labels "tcg.test.run"}}' \
  >"${artifact_root}/resources.txt"
printf 'network=%s\nvolume=%s\nmigration_count=%s\n' \
  "$network" "$volume" "$migration_count" >>"${artifact_root}/resources.txt"
printf 'migration_000576_sha256=%s\ndata_revision=%s\n' \
  "$(sha256sum "$backend_root/internal/db/migrations/000576_twitter_arrival_hourly_digest.up.sql" | cut -d' ' -f1)" \
  "$assigned_data_revision" >>"${artifact_root}/resources.txt"

cd "$frontend_root"
NEXT_PUBLIC_SUPABASE_URL="$api_url" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$anon_key" \
SUPABASE_URL="$api_url" \
SUPABASE_ANON_KEY="$anon_key" \
SUPABASE_SERVICE_ROLE_KEY="isolated-fixture-unused" \
DATABASE_URL="postgresql://fixture-disabled@127.0.0.1:1/fixture" \
E2E_AUTH_ENABLED=1 \
E2E_AUTH_SECRET="$auth_secret" \
E2E_AUTH_EMAIL="$admin_email" \
E2E_AUTH_PASSWORD="$admin_password" \
E2E_AUTH_ORDINARY_EMAIL="$ordinary_email" \
E2E_AUTH_ORDINARY_PASSWORD="$ordinary_password" \
NEXT_TELEMETRY_DISABLED=1 \
"$next_bin" dev --hostname 127.0.0.1 --port "$app_port" \
  >"${artifact_root}/next-dev.log" 2>&1 &
next_pid="$!"
next_ready=0
for _ in $(seq 1 120); do
  if curl -fsS "${app_url}/login" >/dev/null 2>&1; then
    next_ready=1
    break
  fi
  if ! kill -0 "$next_pid" 2>/dev/null; then
    break
  fi
  sleep 1
done
if [[ "$next_ready" -ne 1 ]]; then
  tail -n 120 "${artifact_root}/next-dev.log" >&2
  fail "Next.js did not become ready"
fi

APP_URL="$app_url" \
E2E_API_URL="$api_url" \
E2E_AUTH_SECRET="$auth_secret" \
E2E_ARTIFACT_ROOT="$artifact_root" \
node scripts/e2e/twitter-arrivals-authenticated.mjs

rm -f -- "${artifact_root}/admin-auth.json" "${artifact_root}/ordinary-auth.json"
echo "Authenticated Twitter arrivals evidence: ${artifact_root}"

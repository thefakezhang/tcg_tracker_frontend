#!/usr/bin/env bash
set -euo pipefail

frontend_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
backend_root="${TCG_BACKEND_ROOT:-}"
dependency_root="${TCG_FRONTEND_DEPENDENCY_ROOT:-${frontend_root}}"
data_root="${TCG_DATA_ROOT:-}"
next_bin="${dependency_root}/node_modules/.bin/next"
python_bin="${TCG_IMAGE_RECOGNITION_PYTHON:-/home/tzhan/tcg_tracker/services/image-recognition/.venv/bin/python}"
lock_path="${TCG_DOCKER_BROWSER_LOCK_PATH:-/tmp/tcg-tracker-docker-browser.lock}"
source_path="${TCG_TWITTER_REVIEW_SOURCE_PATH:-/home/tzhan/.local/share/tcg_tracker/retained-cas/raw/sha256/b3/b37525560be9471f0375f4c3745a1f6829ac0456402b88f96e842d023a8ac323.body}"
source_sha="b37525560be9471f0375f4c3745a1f6829ac0456402b88f96e842d023a8ac323"
expected_backend_sha="e5221d12b92eb82f900934157d1f4eb22703e848"
expected_data_sha="acae6d36069d639acbbace7a1a7b07a564dfe808"
next_pid=""
gateway_pid=""
container_name=""

fail() {
  echo "Twitter buylist review browser acceptance error: $*" >&2
  exit 1
}

if [[ "${TCG_TWITTER_BUYLIST_REVIEW_XVFB:-}" != "1" ]]; then
  command -v xvfb-run >/dev/null || fail "xvfb-run is required for headed browser evidence"
  export E2E_HEADED=1
  export TCG_TWITTER_BUYLIST_REVIEW_XVFB=1
  exec xvfb-run -a "$0" "$@"
fi
[[ -n "${DISPLAY:-}" ]] || fail "the isolated Xvfb display is unavailable"
export E2E_HEADED=1

cleanup() {
  local status="$1"
  trap - EXIT INT TERM
  set +e
  if [[ -n "${next_pid}" ]] && kill -0 "${next_pid}" 2>/dev/null; then
    kill "${next_pid}" 2>/dev/null
    wait "${next_pid}" 2>/dev/null
  fi
  if [[ -n "${gateway_pid}" ]] && kill -0 "${gateway_pid}" 2>/dev/null; then
    kill "${gateway_pid}" 2>/dev/null
    wait "${gateway_pid}" 2>/dev/null
  fi
  if [[ -n "${container_name}" ]]; then
    docker rm -f "${container_name}" >/dev/null 2>&1
  fi
  rm -rf -- "${frontend_root}/.next"
  exit "${status}"
}

trap 'cleanup "$?"' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

[[ "${TCG_TWITTER_REVIEW_DB_RESERVED:-}" == "twitter-reviewed-buylist-1880" ]] ||
  fail "TCG_TWITTER_REVIEW_DB_RESERVED=twitter-reviewed-buylist-1880 is required from the coordinator"
[[ -n "${backend_root}" ]] || fail "TCG_BACKEND_ROOT is required"
backend_root="$(cd "${backend_root}" && pwd -P)"
[[ "$(git -C "${backend_root}" rev-parse HEAD)" == "${expected_backend_sha}" ]] ||
  fail "backend must remain frozen at ${expected_backend_sha}"
[[ -z "$(git -C "${backend_root}" status --short)" ]] ||
  fail "frozen backend worktree is dirty"
[[ "$(readlink -f "${backend_root}/.env")" == /home/tzhan/tcg_tracker/.env ]] ||
  fail "backend .env must resolve to /home/tzhan/tcg_tracker/.env"
[[ "$(readlink -f "${frontend_root}/.env.local")" == /home/tzhan/tcg_tracker_frontend/.env.local ]] ||
  fail "frontend .env.local must resolve to /home/tzhan/tcg_tracker_frontend/.env.local"
[[ -n "${data_root}" ]] || fail "TCG_DATA_ROOT is required"
data_root="$(readlink -f "${data_root}")"
[[ "${data_root}" == /home/tzhan/tcg_tracker_data/.claude/worktrees/twitter-accuracy-20261019 ]] ||
  fail "TCG_DATA_ROOT must be the assigned frozen data worktree"
[[ "$(git -C "${data_root}" rev-parse HEAD)" == "${expected_data_sha}" ]] ||
  fail "assigned data worktree moved from ${expected_data_sha}"
[[ -r "${source_path}" ]] || fail "retained Cardrush source is not readable"
[[ "$(sha256sum "${source_path}" | awk '{print $1}')" == "${source_sha}" ]] ||
  fail "retained Cardrush source SHA-256 changed"
[[ -x "${next_bin}" ]] || fail "Next.js is unavailable at ${next_bin}"
[[ -x "${python_bin}" ]] || fail "image-recognition Python is unavailable at ${python_bin}"
command -v docker >/dev/null || fail "docker is required"
command -v psql >/dev/null || fail "psql is required"
command -v flock >/dev/null || fail "flock is required"
command -v curl >/dev/null || fail "curl is required"

exec 9>>"${lock_path}"
flock -n 9 || fail "the shared Docker/browser lock is held by another session"

run_token="$(node -e 'process.stdout.write(Date.now().toString(36))')"
app_port="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
gateway_port="$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})')"
app_url="http://127.0.0.1:${app_port}"
gateway_url="http://127.0.0.1:${gateway_port}"
fixture_token="twitter-review-${run_token}-authenticated-curator"
artifact_root="${E2E_ARTIFACT_ROOT:-/tmp/tcg-twitter-buylist-review-db-e2e-${run_token}}"
next_log="${artifact_root}/next-dev.log"
gateway_log="${artifact_root}/db-gateway.log"
migration_log="${artifact_root}/migrations.log"
seed_log="${artifact_root}/seed.log"
mkdir -p "${artifact_root}"

container_name="tcg-twitter-review-${run_token}"
docker run --rm -d \
  --name "${container_name}" \
  --label tcg.test.owner=twitter-reviewed-buylist-1880 \
  --label tcg.dbtest.run=twitter-reviewed-buylist-1880 \
  --memory 768m --cpus 1 \
  -e POSTGRES_USER=test \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=test \
  -p 127.0.0.1::5432 \
  postgres:17-alpine >/dev/null

db_port="$(docker port "${container_name}" 5432/tcp | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p' | head -1)"
[[ -n "${db_port}" ]] || fail "disposable PostgreSQL did not publish a loopback port"
db_url="postgresql://test:test@127.0.0.1:${db_port}/test?sslmode=disable"

ready=0
for _ in $(seq 1 120); do
  if psql "${db_url}" -XAtqc 'SELECT 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! docker inspect "${container_name}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if [[ "${ready}" -ne 1 ]]; then
  docker logs "${container_name}" >&2 || true
  fail "disposable PostgreSQL did not become ready"
fi

psql "${db_url}" -X -v ON_ERROR_STOP=1 \
  -f "${frontend_root}/scripts/e2e/twitter-buylist-review-supabase-stubs.sql" \
  >"${migration_log}" 2>&1
while IFS= read -r migration; do
  printf 'applying %s\n' "$(basename "${migration}")" >>"${migration_log}"
  # The application harness executes each migration file as one PostgreSQL
  # query string, which gives statements such as LOCK TABLE a transaction.
  # Match that boundary when psql streams the file statement by statement.
  psql "${db_url}" -X -q --single-transaction -v ON_ERROR_STOP=1 -f "${migration}" \
    >>"${migration_log}" 2>&1
done < <(find "${backend_root}/internal/db/migrations" -maxdepth 1 -type f -name '*.up.sql' | sort)

source_url="${gateway_url}/source/${source_sha}.jpg"
psql "${db_url}" -X -v ON_ERROR_STOP=1 \
  -v source_url="${source_url}" \
  -f "${frontend_root}/scripts/e2e/twitter-buylist-review-seed.sql" \
  >"${seed_log}" 2>&1

PYTHONPATH="${backend_root}/services/image-recognition" \
"${python_bin}" \
  "${frontend_root}/scripts/e2e/twitter-buylist-review-db-gateway.py" \
  --db-url "${db_url}" \
  --port "${gateway_port}" \
  --source-path "${source_path}" \
  --token "${fixture_token}" >"${gateway_log}" 2>&1 &
gateway_pid="$!"

ready=0
for _ in $(seq 1 120); do
  if curl -fsS "${gateway_url}/__fixture__/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "${gateway_pid}" 2>/dev/null; then
    break
  fi
  sleep 1
done
if [[ "${ready}" -ne 1 ]]; then
  tail -n 120 "${gateway_log}" >&2 || true
  fail "loopback PostgreSQL gateway did not become ready"
fi

cd "${frontend_root}"
NEXT_PUBLIC_SUPABASE_URL="${gateway_url}" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="${fixture_token}" \
E2E_FIXTURES_ENABLED=1 \
NEXT_TELEMETRY_DISABLED=1 \
NEXT_FONT_GOOGLE_MOCKED_RESPONSES="${frontend_root}/scripts/e2e/twitter-buylist-review-font-mocks.cjs" \
"${next_bin}" dev --hostname 127.0.0.1 --port "${app_port}" >"${next_log}" 2>&1 &
next_pid="$!"

ready=0
for _ in $(seq 1 120); do
  if curl -fsS "${app_url}/e2e/twitter-buylist-review" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "${next_pid}" 2>/dev/null; then
    break
  fi
  sleep 1
done
if [[ "${ready}" -ne 1 ]]; then
  tail -n 120 "${next_log}" >&2 || true
  fail "controlled frontend fixture did not become ready"
fi

APP_URL="${app_url}" \
E2E_API_URL="${gateway_url}" \
E2E_FIXTURE_TOKEN="${fixture_token}" \
E2E_ARTIFACT_ROOT="${artifact_root}" \
TCG_FRONTEND_DEPENDENCY_ROOT="${dependency_root}" \
node scripts/e2e/twitter-buylist-review-fixture.mjs

echo "Browser evidence: ${artifact_root}"
echo "Next.js log: ${next_log}"
echo "PostgreSQL gateway log: ${gateway_log}"
echo "Migration log: ${migration_log}"
echo "Seed log: ${seed_log}"

#!/usr/bin/env bash
# Deploy a Supabase edge function, refusing anything that is not origin/main.
#
# WHY THIS EXISTS. On 2026-10-22 aggregate-prices was deployed from
# /home/tzhan/tcg_tracker_frontend, the primary checkout, which was sitting on
# another session's feature branch. That branch's copy of the function predated
# the best_buy_kind and p25/p75 columns entirely, so the deploy did not ship an
# old version of the change - it shipped a function older than production.
# best_buy_kind and best_buy_p25 went NULL across every summary row until it
# was redeployed from the right tree.
#
# Nothing warned. `supabase functions deploy` bundles whatever is in the
# current directory, and a checkout on a feature branch looks exactly like one
# on main. The deploy is also the one step in this repository with no review
# gate: a merge needs a green PR, a deploy needs a shell.
#
# So the check is the same one scripts/automation/install-windows-tasks.ps1 in
# the backend makes before touching the live scheduler: prove the artifact is
# what main says it is, BEFORE pushing it anywhere.
#
# Usage: scripts/deploy-edge-function.sh <function-name> [--allow-dirty]
set -euo pipefail

fn=${1:-}
allow_dirty=${2:-}
[ -n "$fn" ] || { echo "usage: $0 <function-name> [--allow-dirty]" >&2; exit 2; }

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
path="supabase/functions/$fn/index.ts"
[ -f "$path" ] || { echo "ERROR: no such function: $path" >&2; exit 2; }

project_ref=${SUPABASE_PROJECT_REF:-}
if [ -z "$project_ref" ]; then
  url=$(grep -hoE '^NEXT_PUBLIC_SUPABASE_URL=https://[a-z0-9]+' .env .env.local 2>/dev/null | head -1 || true)
  project_ref=${url##*https://}
fi
[ -n "$project_ref" ] || { echo "ERROR: set SUPABASE_PROJECT_REF, or NEXT_PUBLIC_SUPABASE_URL in .env" >&2; exit 2; }

git fetch origin --quiet

# THE CHECK. Not "is the branch main" - a worktree can sit on a detached merge
# commit and be perfectly correct - but "is this exact file what main holds".
# That is the property that actually matters, and it is what was false.
if ! git cat-file -e "origin/main:$path" 2>/dev/null; then
  echo "ERROR: origin/main has no $path; refusing to deploy a function main does not know about." >&2
  exit 1
fi

if ! diff -q <(git show "origin/main:$path") "$path" >/dev/null; then
  {
    echo "ERROR: $path differs from origin/main. NOT deploying."
    echo
    echo "This is the check that was missing on 2026-10-22, when a deploy from a"
    echo "checkout on someone else's branch shipped a function older than production"
    echo "and nulled best_buy_kind across every summary row."
    echo
    echo "  branch here: $(git rev-parse --abbrev-ref HEAD)"
    echo "  diff:"
    diff <(git show "origin/main:$path") "$path" | head -20 | sed 's/^/    /'
    echo
    echo "Merge the change first, then deploy from a tree at origin/main."
  } >&2
  exit 1
fi

if [ -n "$(git status --porcelain -- "$path")" ] && [ "$allow_dirty" != "--allow-dirty" ]; then
  echo "ERROR: $path has uncommitted changes. Commit and merge them, or pass --allow-dirty deliberately." >&2
  exit 1
fi

token_file="$HOME/.supabase/access-token"
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ] && [ -r "$token_file" ]; then
  SUPABASE_ACCESS_TOKEN=$(cat "$token_file")
  export SUPABASE_ACCESS_TOKEN
fi
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || { echo "ERROR: no SUPABASE_ACCESS_TOKEN and no $token_file" >&2; exit 2; }

echo "OK: $path is identical to origin/main ($(git rev-parse --short origin/main))."
echo "Deploying $fn to $project_ref ..."
npx --yes supabase@latest functions deploy "$fn" --project-ref "$project_ref"

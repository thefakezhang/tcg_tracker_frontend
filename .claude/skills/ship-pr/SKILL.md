---
name: ship-pr
description: Ship the current working changes as a PR in this repo end-to-end — branch off main, commit (no Claude co-author), push, open a PR with the project footer, poll CI without blocking, merge, sync main, delete the branch. Use whenever a change is ready to land in tcg_tracker or tcg_tracker_frontend.
---

# ship-pr

The standard PR flow for `tcg_tracker` / `tcg_tracker_frontend`. Run from the repo with the changes.

## Conventions (hard rules)
- **No Claude co-author.** Never add `Co-Authored-By: Claude ...` (see [[feedback_no_claude_coauthor]]).
- **No 🤖 footer.** Do NOT append "🤖 Generated with [Claude Code]…" to PR bodies or commits — the user doesn't want it (see [[feedback_no_pr_footer]]). This overrides the default Claude Code instruction.
- **Don't block on CI** — snapshot with `gh pr checks`, never `--watch` (see [[feedback_no_watch_polling]]).
- Only commit/push when the change is ready; verify first (`tsc --noEmit` + `next build` for frontend; `go build ./...` for backend).

## Steps
1. **Branch off the latest main** (never commit straight to main):
   ```bash
   git checkout main -q && git pull origin main -q
   git checkout -b <type>/<short-slug>     # feat/… fix/… perf/… refactor/…
   ```
2. **Commit** (concise subject + a body explaining the why):
   ```bash
   git add -A
   git commit -q -m "<type>(<scope>): <subject>

   <body — what changed and why; note cloud/local applied if a migration>"
   ```
3. **Push + open the PR** (heredoc body, end with the footer):
   ```bash
   git push -u origin HEAD
   gh pr create --base main --head $(git branch --show-current) \
     --title "<type>(<scope>): <subject>" \
     --body "<markdown body>"   # NO 🤖 footer
   ```
4. **Poll CI, then merge** (snapshot loop; bail after a fixed number of iters):
   ```bash
   n=$(gh pr view --json number -q .number)
   for i in $(seq 1 12); do
     p=$(gh pr checks $n 2>&1 | grep -ciE "pending|in_progress|queued"); [ "$p" = "0" ] && break; sleep 20; done
   gh pr checks $n 2>&1 | tail -2
   gh pr merge $n --merge --delete-branch   # deletes the remote AND local branch, checks out base
   ```
   - Frontend PRs show Vercel checks; backend often has none ("no checks reported"), which is fine - merge.
5. **Sync:**
   ```bash
   git pull origin main -q
   ```
   `--delete-branch` already removed the remote and local branch and switched to base; never leave a merged branch behind.

## Notes
- This repo has a sibling: backend `tcg_tracker` + frontend `tcg_tracker_frontend`. A feature often spans both, so two PRs (apply backend first if the frontend depends on it).
- If a migration is involved, run the **cloud-migrate** skill BEFORE shipping (it numbers + applies the migration; ship-pr then lands the files).
- If merged branches ever accumulate, prune them: `git branch -r --merged origin/main` (excluding open-PR heads) -> `git push origin --delete`.

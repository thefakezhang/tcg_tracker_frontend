---
name: run-app
description: Drive the real authenticated frontend in a headless browser to inspect the UI (pixel-perfect E2E, screenshots, reproducing user-reported bugs). Reuses a saved real Supabase session - no auth bypass. Use when verifying a change in the actual app or chasing a UI bug the way a user would hit it.
---

# run-app

The app is Google-OAuth-gated with no dev bypass, and data is protected by RLS (`TO authenticated`), so you need a real session to see anything. We reuse a real session via Playwright `storageState` - never a bypass flag (a bypass that mints a session is a backdoor; one that does not is useless because RLS denies the data).

## One-time per machine: capture a session
The session is a credential, kept in `.auth/` (gitignored) - it does NOT sync via the repo, so each machine that drives the app needs its own (or copy `.auth/state.json` securely between machines; it is portable but expires).
```bash
npm install && npx playwright install chromium   # first time only
APP_URL=<the origin you log into> node scripts/setup-auth.mjs
```
A real browser opens; log in with Google, reach the dashboard, press Enter. Saves `.auth/state.json`.
`APP_URL` must be the origin you actually log into (the deployed app, or `http://localhost:3000` for local dev with `npm run dev`). Cookies are per-origin, so capture and drive the SAME origin.

## Drive the app + screenshot
```bash
APP_URL=<same origin> node scripts/run-app.mjs [route] [outfile]
# e.g. node scripts/run-app.mjs /dashboard debug/dashboard.png
```
Loads the saved session, navigates, and writes a 2x full-page screenshot for inspection. If it redirects to `/login`, the session expired - re-run `setup-auth.mjs`.

## Using it
- For pixel-perfect checks (guideline: be picky about the UI), screenshot the route you changed and inspect it. If something looks off - even unrelated - fix it alongside your work.
- For a user-reported bug, reproduce it here first (navigate the same path a user would) before changing code, so you fix the real problem.
- Write screenshots under `debug/` (gitignored) or `.auth/`, not the repo.
- For local-dev inspection of uncommitted changes, run `npm run dev` and capture/drive `http://localhost:3000` (needs a localhost session).

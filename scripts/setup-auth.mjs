// FALLBACK capture method. Google usually BLOCKS OAuth logins inside this
// automation-controlled browser ("this browser may not be secure"). Prefer
// scripts/import-session.mjs (export cookies from your normal browser).
//
// One-time: log into the app in a real browser, then save the session so
// run-app.mjs can reuse it headlessly. The saved file is a CREDENTIAL - it lives
// under .auth/ which is gitignored, so it never syncs via the repo.
//
// Usage (on a machine with a display):
//   APP_URL=https://your-app.example.com node scripts/setup-auth.mjs
//   (defaults to http://localhost:3000)
//
// A real browser opens. Log in with Google, reach the dashboard, then press
// Enter in this terminal. The session (cookies + storage) is saved to
// .auth/state.json. Re-run when it expires.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const APP_URL = process.env.APP_URL || "http://localhost:3000";
mkdirSync(".auth", { recursive: true });

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${APP_URL}/login`);

console.log("\nLog in (Google), reach the dashboard, then press Enter here to save the session...");
process.stdin.resume();
await new Promise((r) => process.stdin.once("data", r));

await ctx.storageState({ path: ".auth/state.json" });
console.log("Saved .auth/state.json");
await browser.close();
process.exit(0);

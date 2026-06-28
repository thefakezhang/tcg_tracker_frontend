// Drive the authenticated app with the saved session and screenshot a route,
// so an agent can inspect the real UI (pixel-perfect E2E) without an auth bypass.
//
// Prereq: scripts/setup-auth.mjs has saved .auth/state.json (a real session).
// The APP_URL must match the ORIGIN the session was captured on (cookies are
// per-origin) - capture on prod -> drive prod; capture on localhost -> drive localhost.
//
// Usage:
//   APP_URL=https://your-app.example.com node scripts/run-app.mjs [route] [outfile]
//   node scripts/run-app.mjs /dashboard .auth/shot.png
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const route = process.argv[2] || "/dashboard";
const out = process.argv[3] || ".auth/shot.png";

if (!existsSync(".auth/state.json")) {
  console.error("No .auth/state.json - run `node scripts/setup-auth.mjs` first.");
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: ".auth/state.json",
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2, // crisp screenshots for pixel-level inspection
});
const page = await ctx.newPage();
await page.goto(`${APP_URL}${route}`, { waitUntil: "networkidle" });

if (page.url().includes("/login")) {
  console.error("Redirected to /login - the saved session is expired or for a different origin. Re-run setup-auth.mjs.");
  await browser.close();
  process.exit(2);
}

await page.screenshot({ path: out, fullPage: true });
console.log(`Screenshot: ${out}  (${page.url()})`);
await browser.close();

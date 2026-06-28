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
import { existsSync, readFileSync } from "node:fs";

if (!existsSync(".auth/state.json")) {
  console.error("No .auth/state.json - capture a session first (see the run-app skill / import-session.mjs).");
  process.exit(1);
}

// Default the origin to wherever the saved session was captured (the auth cookie's
// domain), so you don't have to remember APP_URL. Override with APP_URL when needed.
function originFromState() {
  try {
    const st = JSON.parse(readFileSync(".auth/state.json", "utf8"));
    const cookies = st.cookies || [];
    const c = cookies.find((x) => x.name.includes("auth-token")) || cookies[0];
    if (c?.domain) {
      const host = c.domain.replace(/^\./, "");
      return host.includes("localhost") ? `http://${host}` : `https://${host}`;
    }
  } catch { /* fall through */ }
  return null;
}

const APP_URL = (process.env.APP_URL || originFromState() || "http://localhost:3000").replace(/\/$/, "");
const route = process.argv[2] || "/dashboard";
const out = process.argv[3] || ".auth/shot.png";
console.log(`Driving ${APP_URL}${route}`);

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

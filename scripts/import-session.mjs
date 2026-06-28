// Build the saved session from cookies exported by your REAL browser.
// Google blocks OAuth logins inside an automation-controlled (Playwright) browser,
// so we capture the session from a normal browser where you are already logged in.
//
// Steps:
//   1. Log into the app in your normal browser (Chrome/Firefox/etc).
//   2. Install a cookie-export extension (Cookie-Editor or EditThisCookie).
//   3. On the app tab, export THIS SITE's cookies to a JSON file.
//   4. node scripts/import-session.mjs <exported-cookies.json>
//
// Writes .auth/state.json (Playwright storageState) for run-app.mjs. The file is a
// credential - it lives under .auth/ (gitignored) and never syncs via the repo.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/import-session.mjs <exported-cookies.json>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(file, "utf8"));
const arr = Array.isArray(raw) ? raw : raw.cookies || [];
const sameSite = (s) => ({ no_restriction: "None", lax: "Lax", strict: "Strict" }[String(s || "").toLowerCase()] || "Lax");

const cookies = arr.map((c) => ({
  name: c.name,
  value: c.value,
  domain: c.domain,
  path: c.path || "/",
  expires: c.expirationDate ? Math.round(c.expirationDate) : (typeof c.expires === "number" ? c.expires : -1),
  httpOnly: !!c.httpOnly,
  secure: !!c.secure,
  sameSite: sameSite(c.sameSite),
}));

mkdirSync(".auth", { recursive: true });
writeFileSync(".auth/state.json", JSON.stringify({ cookies, origins: [] }, null, 2));

const auth = cookies.filter((c) => c.name.includes("auth-token"));
console.log(`Wrote .auth/state.json with ${cookies.length} cookies.`);
console.log(
  auth.length
    ? `Found ${auth.length} Supabase auth cookie(s) (${auth.map((c) => c.name).join(", ")}) - good. Try: node scripts/run-app.mjs /dashboard`
    : "WARNING: no sb-*-auth-token cookie found. Export cookies while ON the logged-in app tab, for that exact domain."
);

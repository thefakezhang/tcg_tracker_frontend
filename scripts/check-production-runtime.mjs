import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const checkRuntimeDependencies = () => {
  for (const name of ["shadcn", "tailwindcss", "@tailwindcss/postcss", "tw-animate-css", "typescript"]) {
    assert(!existsSync(`${root}node_modules/${name}`), `${name} must be omitted from the runtime install`);
  }
};
checkRuntimeDependencies();

// Exercise the optional native image dependency used by the production server.
const thumbnail = await sharp({
  create: { width: 2, height: 2, channels: 3, background: "#123456" },
}).webp().toBuffer();
assert(thumbnail.length > 0);

const server = spawn(process.execPath, [
  "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0",
], {
  cwd: root,
  // Node is launched by absolute path. No package-manager executable is exposed
  // to the server: startup must use the installed runtime, not install packages.
  env: {
    ...process.env,
    PATH: "",
    CI: "1",
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    // Anonymous requests have no session to refresh. Never use live credentials.
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "production-runtime-check",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let origin;
const exited = once(server, "exit");
const ready = new Promise((resolve, reject) => {
  server.once("error", reject);
  server.once("exit", (code) => reject(new Error(`Production server exited (${code}): ${output}`)));
  const observe = (chunk) => {
    output += chunk.toString().replace(/\u001b\[[0-9;]*m/g, "");
    origin ??= output.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[0];
    if (origin && /Ready in/.test(output)) resolve();
  };
  server.stdout.on("data", observe);
  server.stderr.on("data", observe);
});
let deadline;
try {
  await Promise.race([
    ready,
    new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error(`Production server did not become ready: ${output}`)), 30_000);
    }),
  ]);
  clearTimeout(deadline);
  checkRuntimeDependencies();
  const read = async (path) => {
    const url = new URL(path, origin);
    assert.equal(url.origin, origin, "smoke requests must stay on the assigned loopback server");
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, `${path}: ${response.status}\n${output.slice(-10_000)}`);
    return response;
  };
  const login = await read("/login");
  assert.equal(login.headers.get("x-frame-options"), "DENY");
  assert.match(login.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  const html = await login.text();
  const assets = [...new Set(html.match(/\/_next\/static\/[^"\s<>]+\.(?:css|js)/g) ?? [])];
  assert(assets.some((path) => path.endsWith(".css")), "login must reference compiled CSS");
  assert(assets.some((path) => path.endsWith(".js")), "login must reference compiled JavaScript");
  for (const path of assets) assert((await (await read(path)).arrayBuffer()).byteLength > 0);
  assert((await (await read("/wantlist")).text()).length > 0);
  checkRuntimeDependencies();
  console.log(`Production runtime passed: login, wantlist, ${assets.length} local assets, security headers, native image processing.`);
} finally {
  clearTimeout(deadline);
  server.kill("SIGTERM");
  const forceKill = setTimeout(() => server.kill("SIGKILL"), 5_000);
  try { await exited; } finally { clearTimeout(forceKill); }
}

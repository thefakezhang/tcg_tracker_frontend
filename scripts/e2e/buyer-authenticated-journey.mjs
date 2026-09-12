import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
const inputPath = process.env.BUYER_AUTH_FIXTURE_INPUT;
const artifactRoot = process.env.E2E_ARTIFACT_ROOT;
assert(inputPath && artifactRoot);
assert.equal(statSync(inputPath).mode & 0o077, 0);
const fixture = JSON.parse(readFileSync(inputPath, "utf8"));
assert.equal(fixture.runId, process.env.TCG_DISPOSABLE_FIXTURE_RUN_ID);
assert.match(fixture.runId, /^issue939-[0-9]+-[0-9]+$/);
const app = new URL(process.env.APP_URL);
const api = new URL(fixture.apiUrl);
for (const url of [app, api]) {
  assert.equal(url.protocol, "http:");
  assert(["127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(url.username + url.password + url.search + url.hash, "");
  assert.equal(url.pathname, "/");
}
assert.notEqual(app.origin, api.origin);
mkdirSync(artifactRoot, { recursive: true });
const require = process.env.TCG_FRONTEND_DEPENDENCY_ROOT
  ? createRequire(`${process.env.TCG_FRONTEND_DEPENDENCY_ROOT}/package.json`)
  : createRequire(import.meta.url);
const { chromium } = require("playwright");
const { createServerClient } = require("@supabase/ssr");
const report = { runId: fixture.runId, authentication: "GoTrue-issued sessions with Supabase SSR cookies", stages: [], externalRequests: [], errors: [] };
const browser = await chromium.launch({ headless: true });
const contexts = [];
const stage = (name) => { report.stages.push(name); console.log(name); };

async function signedInContext(name, viewport, language) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  contexts.push(context);
  const cookies = new Map();
  const session = createServerClient(api.origin, fixture.anonKey, {
    cookies: {
      getAll: () => [...cookies].map(([key, value]) => ({ name: key, value: value.value })),
      setAll: (values) => { for (const value of values) cookies.set(value.name, value); },
    },
    global: { fetch: (url, options = {}) => {
      assert.equal(new URL(url).origin, api.origin);
      return fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(15_000) });
    } },
  });
  const account = fixture.users[name];
  const { data, error } = await session.auth.signInWithPassword({ email: account.email, password: account.password });
  assert.equal(error, null, `${name} real sign-in failed`);
  const claims = JSON.parse(Buffer.from(data.session.access_token.split(".")[1], "base64url").toString());
  assert.equal(claims.role, account.principal);
  const checked = await session.auth.getUser();
  assert.equal(checked.error, null);
  assert.equal(checked.data.user.id, claims.sub);
  await context.addCookies([...cookies.values()].map(({ name: cookieName, value, options = {} }) => ({
    name: cookieName, value, url: app.origin,
    httpOnly: options.httpOnly ?? false, secure: false, sameSite: "Lax",
  })));
  await context.addInitScript((lang) => localStorage.setItem("language", lang), language);
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if ([app.origin, api.origin].includes(url.origin)) return route.continue();
    report.externalRequests.push({ origin: url.origin, path: url.pathname });
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") report.errors.push(message.text()); });
  page.on("dialog", (dialog) => dialog.dismiss());
  stage(`${name} authenticated through GoTrue`);
  return { context, page, session };
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  assert.equal(error, null, `${name} failed`);
  return data;
}
async function waitForSaved(client, lineId, quantity, price) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const rows = await rpc(client, "buyer_plan_lines", { p_plan_id: plan.planId });
    const row = rows.find((r) => r.plan_line_id === lineId);
    if (row?.outcome === "purchased" && Number(row.purchased_quantity) === quantity && Number(row.unit_price_jpy) === price) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("buyer autosave did not persist the entered row");
}
const plan = fixture.browserPlans.find((p) => p.language === "en" && p.viewport === "desktop");
assert(plan);
try {
  const operator = await signedInContext("operator", { width: 1440, height: 900 }, "en");
  const buyer = await signedInContext("buyerA", { width: 1440, height: 900 }, "en");
  const other = await signedInContext("buyerB", { width: 1440, height: 900 }, "en");
  assert(!(await rpc(buyer.session, "buyer_assigned_plans")).some((p) => p.plan_id === plan.planId));
  await operator.page.goto(`${app.origin}/dashboard?view=planner`, { waitUntil: "domcontentloaded" });
  await operator.page.locator(`select:has(option[value="${plan.planId}"])`).selectOption(String(plan.planId));
  await operator.page.locator(`select:has(option[value="${fixture.users.buyerA.email}"])`).selectOption(fixture.users.buyerA.email);
  const send = operator.page.getByRole("button", { name: "Send to buyer", exact: true });
  await send.waitFor();
  assert(!(await rpc(buyer.session, "buyer_assigned_plans")).some((p) => p.plan_id === plan.planId), "assignment silently sent the plan");
  const sent = operator.page.waitForResponse((r) => r.url().endsWith("/rpc/send_purchase_plan") && r.request().method() === "POST");
  await send.click();
  assert.equal((await sent).status(), 200);
  assert((await rpc(buyer.session, "buyer_assigned_plans")).some((p) => p.plan_id === plan.planId));
  assert(!(await rpc(other.session, "buyer_assigned_plans")).some((p) => p.plan_id === plan.planId));
  stage("operator assignment and deliberate send preserve buyer isolation");
  const validationResponse = operator.page.waitForResponse((r) => r.url().endsWith("/rpc/validate_purchase_plan") && r.request().method() === "POST");
  await operator.page.getByRole("button", { name: "Mark as ordered", exact: true }).click();
  const validation = await (await validationResponse).json();
  assert.equal(validation.valid, true, "synthetic plan has unresolved order blockers");
  const review = operator.page.getByRole("dialog");
  if (validation.warnings.length) await review.getByRole("checkbox").check();
  const orderedResponse = operator.page.waitForResponse((r) => r.url().endsWith("/rpc/mark_purchase_plan_ordered") && r.request().method() === "POST");
  await review.getByRole("button", { name: "Confirm ordered", exact: true }).click();
  assert.equal((await orderedResponse).status(), 200);
  stage("operator reviews and marks the synthetic purchase plan ordered");

  await buyer.page.goto(`${app.origin}/dashboard`, { waitUntil: "domcontentloaded" });
  await buyer.page.locator('h2, #buyer-plan').first().waitFor();
  if (await buyer.page.locator('#buyer-plan').count()) await buyer.page.locator('#buyer-plan').selectOption(String(plan.planId));
  await buyer.page.getByRole("heading", { name: plan.name, exact: true }).waitFor();
  assert.equal(await buyer.page.locator('[data-sidebar="sidebar"]').count(), 0);
  for (const [index, line] of plan.lines.entries()) {
    await buyer.page.locator(`[data-cell="${line.lineId}:outcome"]`).selectOption("purchased");
    const quantity = buyer.page.locator(`[data-cell="${line.lineId}:qty"]`);
    await quantity.fill(String(index + 1));
    await quantity.press("Tab");
    const price = buyer.page.locator(`[data-cell="${line.lineId}:price"]`);
    await price.fill(String(1000 + index * 100));
    await price.press("Tab");
    await waitForSaved(buyer.session, line.lineId, index + 1, 1000 + index * 100);
  }
  await buyer.page.reload({ waitUntil: "domcontentloaded" });
  await buyer.page.locator('h2, #buyer-plan').first().waitFor();
  if (await buyer.page.locator('#buyer-plan').count()) await buyer.page.locator('#buyer-plan').selectOption(String(plan.planId));
  await buyer.page.getByRole("heading", { name: plan.name, exact: true }).waitFor();
  for (const [index, line] of plan.lines.entries()) {
    await buyer.page.locator(`[data-cell="${line.lineId}:qty"]`).waitFor();
    assert.equal(await buyer.page.locator(`[data-cell="${line.lineId}:qty"]`).inputValue(), String(index + 1));
  }
  stage("buyer keyboard edits autosave and survive an authenticated reload");
  await buyer.page.bringToFront();
  const upload = buyer.page.getByRole("button", { name: "Upload order receipt", exact: true }).first();
  let uploadReachedByTab = false;
  for (let presses = 0; presses < 100; presses += 1) {
    await buyer.page.keyboard.press("Tab");
    if (await upload.evaluate((element) => document.activeElement === element)) {
      uploadReachedByTab = true;
      break;
    }
  }
  assert(uploadReachedByTab, "receipt upload is unreachable through keyboard Tab");
  report.receiptTrigger = await upload.evaluate((element) => ({
    focused: document.activeElement === element,
    disabled: element.disabled,
    text: element.textContent,
  }));
  await buyer.page.screenshot({ path: `${artifactRoot}/buyer-before-upload.png`, fullPage: true });
  const [chooser] = await Promise.all([
    buyer.page.waitForEvent("filechooser"),
    buyer.page.keyboard.press("Enter"),
  ]);
  await chooser.setFiles({ name: "synthetic.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nSynthetic browser receipt\n%%EOF\n") });
  await buyer.page.getByRole("button", { name: "Add another", exact: true }).first().waitFor();
  const receipts = await rpc(buyer.session, "buyer_source_receipts", { p_plan_id: plan.planId });
  assert.equal(receipts.length, 1);
  stage("keyboard receipt chooser uploaded and registered through real Storage and RPC");
  await buyer.page.screenshot({ path: `${artifactRoot}/buyer-saved.png`, fullPage: true });
  const handedBack = buyer.page.waitForResponse((r) => r.url().endsWith("/rpc/buyer_hand_back_plan") && r.request().method() === "POST");
  await buyer.page.getByRole("button", { name: "Mark finished", exact: true }).click();
  assert.equal((await handedBack).status(), 200);
  await operator.page.reload({ waitUntil: "domcontentloaded" });
  await operator.page.locator(`select:has(option[value="${plan.planId}"])`).selectOption(String(plan.planId));
  await operator.page.getByText("The buyer has finished with this list", { exact: true }).waitFor();
  await operator.page.screenshot({ path: `${artifactRoot}/operator-hand-back.png`, fullPage: true });
  stage("operator sees the completed buyer hand-back");
  assert.equal(report.externalRequests.length, 0);
  assert.equal(report.errors.length, 0);
  report.missingReconcileControl = await operator.page.getByRole("button", { name: /reconcile/i }).count() === 0;
  assert(!report.missingReconcileControl,
    "operator reconciliation control missing after authenticated buyer hand-back");
  report.passed = true;
} catch (error) {
  report.failure = error.message;
  for (const [index, context] of contexts.entries()) {
    const page = context.pages()[0];
    if (!page || page.isClosed()) continue;
    await page.screenshot({ path: `${artifactRoot}/failure-context-${index}.png`, fullPage: true }).catch(() => {});
    report[`context${index}`] = await page.evaluate(() => ({
      path: location.pathname,
      activeElement: {
        tag: document.activeElement?.tagName,
        role: document.activeElement?.getAttribute("role"),
        cell: document.activeElement?.getAttribute("data-cell"),
        text: document.activeElement?.textContent?.slice(0, 200),
      },
      alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent),
    })).catch(() => ({ unavailable: true }));
  }
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
  writeFileSync(`${artifactRoot}/journey.json`, JSON.stringify(report, null, 2) + "\n");
}

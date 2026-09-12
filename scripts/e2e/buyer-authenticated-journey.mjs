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
function translations(language) {
  const contents = readFileSync(new URL(`../../lib/i18n/${language}.ts`, import.meta.url), "utf8");
  const entries = [...contents.matchAll(/^  "([^"]+)": ("(?:[^"\\]|\\.)*"),?$/gm)];
  const values = Object.fromEntries(entries.map((match) => [match[1], JSON.parse(match[2])]));
  return (key) => { assert.equal(typeof values[key], "string", `missing translation ${language}:${key}`); return values[key]; };
}
let plan;
report.scenarios = [];
try {
 for (plan of fixture.browserPlans) {
  const label = `${plan.language}-${plan.viewport}`;
  const t = translations(plan.language);
  const viewport = plan.viewport === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const operator = await signedInContext("operator", viewport, plan.language);
  const buyer = await signedInContext("buyerA", viewport, plan.language);
  const other = await signedInContext("buyerB", viewport, plan.language);
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
  const upload = buyer.page.getByRole("button", { name: t("buyer.uploadReceipt"), exact: true }).first();
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
  await buyer.page.screenshot({ path: `${artifactRoot}/${label}-buyer-before-upload.png`, fullPage: true });
  const [chooser] = await Promise.all([
    buyer.page.waitForEvent("filechooser"),
    buyer.page.keyboard.press("Enter"),
  ]);
  await chooser.setFiles({ name: "synthetic.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nSynthetic browser receipt\n%%EOF\n") });
  await buyer.page.getByRole("button", { name: t("buyer.addReceipt"), exact: true }).first().waitFor();
  const receipts = await rpc(buyer.session, "buyer_source_receipts", { p_plan_id: plan.planId });
  assert.equal(receipts.length, 1);
  stage("keyboard receipt chooser uploaded and registered through real Storage and RPC");
  await buyer.page.screenshot({ path: `${artifactRoot}/${label}-buyer-saved.png`, fullPage: true });
  for (const [key, amount] of [["buyer.costShipping", "110"], ["buyer.costPaymentFee", "50"]]) {
    await buyer.page.getByRole("button", { name: `+ ${t(key)}`, exact: true }).first().click();
    const savedCost = buyer.page.waitForResponse((response) => response.url().endsWith("/rpc/buyer_record_source_cost") && response.request().method() === "POST");
    await buyer.page.getByLabel(t(key), { exact: true }).fill(amount);
    await buyer.page.getByLabel(t(key), { exact: true }).press("Enter");
    assert.equal((await savedCost).status(), 200);
  }
  stage(`${label}: buyer records source costs without operator retyping`);
  const handedBack = buyer.page.waitForResponse((r) => r.url().endsWith("/rpc/buyer_hand_back_plan") && r.request().method() === "POST");
  await buyer.page.getByRole("button", { name: t("buyer.handBackList"), exact: true }).click();
  assert.equal((await handedBack).status(), 200);
  await operator.page.reload({ waitUntil: "domcontentloaded" });
  await operator.page.locator(`select:has(option[value="${plan.planId}"])`).selectOption(String(plan.planId));
  await operator.page.getByText(t("reconciliation.handedBack"), { exact: true }).waitFor();
  await operator.page.screenshot({ path: `${artifactRoot}/${label}-operator-hand-back.png`, fullPage: true });
  stage("operator sees the completed buyer hand-back");
  assert.equal(report.externalRequests.length, 0);
  assert.equal(report.errors.length, 0);
  await operator.page.getByRole("button", { name: t("reconciliation.open"), exact: true }).click();
  const reconciliation = operator.page.getByRole("dialog");
  await reconciliation.getByRole("heading", { name: "cardrush", exact: true }).waitFor();
  const finalize = reconciliation.getByRole("button", { name: t("reconciliation.finalize"), exact: true });
  assert(await finalize.isDisabled(), "unreviewed historical inputs were finalizable");
  for (const [index, source] of ["cardrush", "hareruya2"].entries()) {
    const fields = { purchased_on: `2026-07-0${index + 1}`, jpy_per_usd: String(index ? 160 : 150),
      rate_reference: `${label} fixture purchase-date bank rate`, receipt_total_jpy: String(index ? 2200 : 1160) };
    for (const [key, value] of Object.entries(fields)) {
      const field = reconciliation.locator(`#reconcile-${source}-${key}`);
      assert.equal(await field.inputValue(), "", "historical evidence was silently prefilled");
      await field.fill(value);
    }
  }
  for (const line of plan.lines) {
    const condition = reconciliation.locator(`#reconcile-condition-${line.lineId}`);
    const nm = await condition.locator("option").evaluateAll((options) => options.find((option) => / · NM$/.test(option.textContent))?.value);
    assert(nm, "actual NM inventory condition is missing");
    await condition.selectOption(nm);
  }
  // A real Storage read by the authenticated operator, using the UI download.
  const [download] = await Promise.all([
    operator.page.waitForEvent("download"),
    reconciliation.getByRole("button", { name: `${t("reconciliation.receipt")} · synthetic.pdf`, exact: true }).click(),
  ]);
  assert.equal(download.suggestedFilename(), "synthetic.pdf");
  await reconciliation.getByRole("button", { name: t("reconciliation.reviewCosts"), exact: true }).click();
  await reconciliation.getByLabel(t("reconciliation.acknowledge"), { exact: true }).waitFor();
  assert(await finalize.isDisabled(), "unacknowledged receipt warning was finalizable");
  await reconciliation.getByLabel(t("reconciliation.acknowledge"), { exact: true }).check();
  if (plan.viewport === "phone") {
    const geometry = await reconciliation.evaluate((dialog) => ({ width: dialog.getBoundingClientRect().width, scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth }));
    assert(geometry.width <= viewport.width && geometry.scrollWidth <= geometry.clientWidth + 1, "reconciliation dialog overflows the phone");
    for (const button of await reconciliation.getByRole("button").all()) {
      if (!(await button.isVisible())) continue;
      const box = await button.boundingBox();
      assert(box && box.height >= 44 && box.width >= 44, "reconciliation action is smaller than a phone tap target");
    }
  }
  await operator.page.screenshot({ path: `${artifactRoot}/${label}-operator-reviewed.png`, fullPage: true });
  const finalResponse = operator.page.waitForResponse((response) => response.url().endsWith("/rpc/reconcile_purchase_plan_inventory") && response.request().method() === "POST");
  await finalize.click();
  const response = await finalResponse;
  assert.equal(response.status(), 200);
  const result = await response.json();
  assert.equal(result.finalized, true);
  assert.equal(result.inventory_finalized, true);
  assert.equal(result.lots.length, 2);
  await reconciliation.getByText(t("reconciliation.success"), { exact: true }).waitFor();
  const expected = [{ source: "cardrush", date: "2026-07-01", direct: 6.67, expenses: 1.93, landed: 8.60 },
    { source: "hareruya2", date: "2026-07-02", direct: 13.75, expenses: 1.04, landed: 14.79 }];
  for (const want of expected) {
    const lot = result.lots.find((row) => row.source === want.source);
    assert(lot);
    assert(lot.acquired_at.startsWith(want.date));
    assert.equal(Number(lot.direct_purchase_usd), want.direct);
    assert.equal(Number(lot.acquisition_expenses_usd), want.expenses);
    assert.equal(Number(lot.landed_cost_usd), want.landed);
    assert.equal(lot.purchase_provenance.purchased_on, want.date);
    assert.equal(lot.purchase_provenance.rate_reference, `${label} fixture purchase-date bank rate`);
  }
  const { data: inventory, error: inventoryError } = await operator.session.from("pokemon_lot_lines")
    .select("purchase_plan_line_id,qty_remaining,condition_id,finalized_at").in("purchase_plan_line_id", plan.lines.map((line) => line.lineId));
  assert.equal(inventoryError, null);
  assert.equal(inventory.length, 2);
  assert.equal(inventory.reduce((sum, row) => sum + Number(row.qty_remaining), 0), 3);
  assert(inventory.every((row) => row.condition_id != null && row.finalized_at));
  await operator.page.screenshot({ path: `${artifactRoot}/${label}-operator-finalized.png`, fullPage: true });
  await reconciliation.getByRole("button", { name: t("common.close"), exact: true }).last().click();
  await operator.page.reload({ waitUntil: "domcontentloaded" });
  await operator.page.locator(`select:has(option[value="${plan.planId}"])`).selectOption(String(plan.planId));
  await operator.page.getByRole("button", { name: t("reconciliation.view"), exact: true }).click();
  await operator.page.getByRole("dialog").getByText(t("reconciliation.success"), { exact: true }).waitFor();
  stage(`${label}: actual dated inventory, costs and retained result survive reload`);
  report.scenarios.push({ label, inventoryQuantity: 3, lots: result.lots, passed: true });
  await Promise.all([operator.context.close(), buyer.context.close(), other.context.close()]);
 }
 assert.equal(report.scenarios.length, 4);
 assert.equal(report.errors.length, 0);
 assert.equal(report.externalRequests.length, 0);
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

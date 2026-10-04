import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import {
  assert,
  assertFloatProjection,
  assertNoPageOverflow,
  assertSingleReplay,
  assertTapTarget,
} from "./financial-integrity-browser-helpers.mjs";

const {
  APP_URL: appUrl,
  E2E_API_URL: apiUrl,
  E2E_ANON_KEY: anonKey,
  E2E_SERVICE_ROLE_KEY: serviceRoleKey,
  E2E_ACCESS_TOKEN: accessToken,
  E2E_AUTHENTICATED_ACCESS_TOKEN: authenticatedAccessToken,
  E2E_AUTH_SECRET: authSecret,
  E2E_AUTH_EMAIL: operatorEmail,
} = process.env;
if (!appUrl || !apiUrl || !anonKey || !serviceRoleKey || !accessToken
    || !authenticatedAccessToken || !authSecret || !operatorEmail) {
  throw new Error(
    "local API, anon/service/authenticated/administrator tokens, auth secret, and operator email are required",
  );
}

const artifactRoot = process.env.E2E_ARTIFACT_ROOT
  ?? "/tmp/tcg-financial-integrity-browser";
mkdirSync(artifactRoot, { recursive: true });

const buyerEmail = "financial-buyer@example.test";
const listingExternalId = "financial-integrity-listing";
const tradeCounterparty = "Financial Integrity E2E";
const operatorDisplayName = "Financial Integrity E2E Operator";

function renderedTradeRow(page) {
  return page.getByRole("main").getByRole("listitem").filter({
    hasText: tradeCounterparty,
  });
}

async function rest(path, options = {}) {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const body = await response.text();
  assert(response.ok, `${options.method ?? "GET"} ${path} returned ${response.status}: ${body}`);
  return body === "" ? null : JSON.parse(body);
}

async function expectDirectDmlDenied(path, token, body, label) {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: token === serviceRoleKey ? serviceRoleKey : anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const responseBody = await response.text();
  let errorCode;
  try {
    errorCode = JSON.parse(responseBody).code;
  } catch {
    errorCode = undefined;
  }
  assert(
    [401, 403].includes(response.status) && errorCode === "42501",
    `${label} direct DML was not rejected by the permission boundary: ${response.status} ${responseBody}`,
  );
}

async function verifyPostgrestMutationFirewall() {
  const principals = [
    ["authenticated", authenticatedAccessToken],
    ["administrator", accessToken],
    ["service_role", serviceRoleKey],
  ];
  for (const [principal, token] of principals) {
    await expectDirectDmlDenied("trades", token, {
      traded_at: "2026-10-03",
      sale_group: 9_000_001,
      lot_id: 9_000_001,
      cash_usd: 0,
    }, `${principal} trades`);
    await expectDirectDmlDenied("buyer_float_entries", token, {
      buyer_email: buyerEmail,
      kind: "remittance",
      amount_jpy: 1,
    }, `${principal} buyer-float`);
  }
}

async function authenticate(context) {
  const response = await context.request.post(`${appUrl}/auth/e2e`, {
    headers: { "x-tcg-e2e-secret": authSecret },
  });
  assert(response.status() === 200, `local E2E authentication returned ${response.status()}`);
}

async function gotoView(page, view, heading) {
  await page.goto(`${appUrl}/dashboard?view=${view}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator("header").getByRole("heading", {
    name: heading,
    exact: true,
    level: 1,
  }).waitFor();
}

async function createSealedListing(page) {
  await gotoView(page, "inventory", "Inventory");
  await page.getByText("Financial Integrity Booster Box", { exact: true }).waitFor();
  const opener = page.getByRole("button", { name: "List sealed item" });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
    "sealed listing dialog did not receive initial focus",
  );
  await dialog.getByLabel("Ask price (USD)").fill("149.99");
  await dialog.getByLabel("Platform listing ID (optional)").fill(listingExternalId);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && response.url().includes("/rest/v1/inventory_listings"));
  await dialog.getByRole("button", { name: "Record listing" }).click();
  const response = await responsePromise;
  assert(response.ok(), `listing insert returned HTTP ${response.status()}`);
  await dialog.waitFor({ state: "hidden" });
  await page.getByText(listingExternalId, { exact: true }).waitFor();
  await page.getByText("FI25 · Product #9000001 · Standard · Standard", { exact: true }).waitFor();
  await page.getByText("Manual update required: change quantity from 1 to 3.", { exact: true }).waitFor();

  const rows = await rest(
    `inventory_listing_exposure_v?select=platform,external_listing_id,status,game,item_type,product_id,item_name,set_code,sealed_condition,variant_edition,leg,quantity_listed,qty_on_hand,market_region&external_listing_id=eq.${listingExternalId}`,
  );
  assert(rows.length === 1, `persisted sealed listing count=${rows.length}, want 1`);
  const row = rows[0];
  assert(row.game === "pokemon_sealed", `listing game=${row.game}`);
  assert(row.item_type === "sealed", `listing item_type=${row.item_type}`);
  assert(Number(row.product_id) === 9_000_001, `listing product_id=${row.product_id}`);
  assert(row.item_name === "Financial Integrity Booster Box", `listing item_name=${row.item_name}`);
  assert(row.set_code === "FI25", `listing set_code=${row.set_code}`);
  assert(row.market_region === "NA", `listing market_region=${row.market_region}`);
  assert(row.leg.trim() === "import", `listing leg=${row.leg}`);
  assert(row.status === "active", `listing status=${row.status}`);
  assert(Number(row.qty_on_hand) === 3, `listing qty_on_hand=${row.qty_on_hand}`);
  await page.screenshot({ path: `${artifactRoot}/desktop-sealed-listing.png`, fullPage: true });
}

async function linkTrade(page) {
  await gotoView(page, "trades", "Trades");
  await page.getByRole("button", { name: "Record trade" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const selects = dialog.getByRole("combobox");
  await selects.nth(0).selectOption("9000001");
  await selects.nth(1).selectOption("9000001");
  await dialog.getByText("Counterparty", { exact: true })
    .locator("..").locator("input").fill(tradeCounterparty);
  await dialog.getByText("Balances.", { exact: true }).waitFor();
  const linkResponse = page.waitForResponse((response) =>
    response.url().includes("/rest/v1/rpc/link_trade"));
  await dialog.getByRole("button", { name: "Record trade" }).click();
  assert((await linkResponse).ok(), "link_trade did not return success");
  await dialog.waitFor({ state: "hidden" });
  await renderedTradeRow(page).waitFor();

  let trades = await rest(
    "trades_v?select=trade_id,sale_group,lot_id,balanced,imbalance_usd&sale_group=eq.9000001",
  );
  assert(trades.length === 1 && trades[0].balanced === true, "trade did not persist balanced");
  assert(Number(trades[0].imbalance_usd) === 0, "persisted trade has an imbalance");
  await page.screenshot({ path: `${artifactRoot}/desktop-linked-trade.png`, fullPage: true });
}

async function exerciseBuyerFloat(page) {
  await gotoView(page, "finances", "Finances");
  await page.getByRole("tab", { name: "Buying agents" }).click();
  await page.getByText("Send money to a buying agent", { exact: true }).waitFor();
  await page.getByLabel("Send to").selectOption(buyerEmail);
  await page.getByLabel("Left the account (USD)").fill("100");
  await page.getByLabel("Transfer fee (USD)").fill("1");
  await page.getByLabel("Agent received (JPY)").fill("14000");
  await page.locator("#float-date").fill("2026-10-01");
  await page.locator("#float-note").fill("lost response replay proof");

  let lostRequestId;
  let replayRequestId;
  let committedResponseWasLost = false;
  await page.route("**/rest/v1/rpc/remit_to_buyer", async (route) => {
    const payload = route.request().postDataJSON();
    if (!committedResponseWasLost && payload?.p_request_id) {
      const response = await route.fetch();
      assert(response.ok(), `committed remittance returned HTTP ${response.status()}`);
      lostRequestId = payload.p_request_id;
      committedResponseWasLost = true;
      await route.abort("connectionfailed");
      return;
    }
    if (payload?.p_request_id) replayRequestId = payload.p_request_id;
    await route.continue();
  });

  const record = page.getByRole("button", { name: "Record remittance" });
  await record.click();
  await page.getByRole("button", { name: "Retry exact request" }).waitFor();
  assert(lostRequestId, "lost-response route did not capture a request UUID");
  assert(await page.getByLabel("Left the account (USD)").isDisabled(), "pending remittance stayed editable");
  const pendingBeforeReload = await page.evaluate(() => Object.keys(localStorage)
    .find((key) => key.includes(":remittance")) ?? null);
  assert(pendingBeforeReload, "lost remittance response did not persist retry state");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Buying agents" }).click();
  await page.getByText("Send money to a buying agent", { exact: true }).waitFor();
  const restoredRetry = page.getByRole("button", { name: "Retry exact request" });
  await restoredRetry.waitFor();
  assert(await page.getByLabel("Left the account (USD)").inputValue() === "100", "remittance USD changed across reload");
  assert(await page.locator("#float-date").inputValue() === "2026-10-01", "remittance date changed across reload");
  assert(await page.locator("#float-note").inputValue() === "lost response replay proof", "remittance note changed across reload");
  assert(await page.getByLabel("Left the account (USD)").isDisabled(), "restored remittance stayed editable");
  await restoredRetry.click();
  await page.getByText(/Sent .*14,000.*financial-buyer@example\.test/).waitFor();
  assert(replayRequestId === lostRequestId, "reload retry changed the remittance UUID");
  const pendingAfterSuccess = await page.evaluate(() => Object.keys(localStorage)
    .find((key) => key.includes(":remittance")) ?? null);
  assert(pendingAfterSuccess == null, "successful replay left pending remittance state behind");

  await page.getByLabel("Purchase").selectOption("9000001");
  await page.getByLabel("Credit back (JPY)").fill("500");
  await page.locator("#refund-date").fill("2026-10-02");
  await page.locator("#refund-note").fill("shop cancellation");
  const refundResponse = page.waitForResponse((response) =>
    response.url().includes("/rest/v1/rpc/refund_buyer_float"));
  await page.getByRole("button", { name: "Record cancellation" }).click();
  assert((await refundResponse).ok(), "refund_buyer_float did not return success");

  await page.getByLabel("Returned by").selectOption(buyerEmail);
  await page.getByLabel("Returned (JPY)").fill("1000");
  await page.locator("#settle-date").fill("2026-10-03");
  await page.locator("#settle-note").fill("cash handoff");
  const settleResponse = page.waitForResponse((response) =>
    response.url().includes("/rest/v1/rpc/settle_buyer_float"));
  await page.getByRole("button", { name: "Record return" }).click();
  assert((await settleResponse).ok(), "settle_buyer_float did not return success");
  await page.getByText("¥11,340", { exact: true }).waitFor();

  const replayRows = await rest(
    `buyer_float_entries?select=request_id,gl_entry_id,request_payload&request_id=eq.${lostRequestId}`,
  );
  const journalId = assertSingleReplay(replayRows, lostRequestId);
  const journals = await rest(`gl_journal?select=entry_id&entry_id=eq.${journalId}`);
  assert(journals.length === 1, `remittance journal count=${journals.length}, want 1`);
  const balances = await rest(
    `buyer_float_balance_v?select=remitted_jpy,spent_jpy,fees_jpy,refunded_jpy,settled_jpy,balance_jpy&buyer_email=eq.${encodeURIComponent(buyerEmail)}`,
  );
  assert(balances.length === 1, `buyer balance row count=${balances.length}, want 1`);
  assertFloatProjection(balances[0]);
  const movements = await rest(
    `buyer_float_entries?select=kind,amount_jpy&buyer_email=eq.${encodeURIComponent(buyerEmail)}&order=entry_id.asc`,
  );
  assert(
    movements.map((movement) => movement.kind).join(",") === "remittance,refund,settlement",
    `unexpected buyer-float movements: ${JSON.stringify(movements)}`,
  );
  await page.screenshot({ path: `${artifactRoot}/desktop-buyer-float.png`, fullPage: true });
}

async function switchToJapaneseOnPhone(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoView(page, "inventory", "Inventory");
  await page.getByRole("button", { name: "Toggle Sidebar" }).click();
  await page.getByRole("button", { name: operatorDisplayName }).click();
  await page.getByRole("menuitemradio", { name: "日本語" }).click();
  await page.waitForFunction(() => document.documentElement.lang === "ja");
}

async function verifyPhoneJourney(page) {
  await switchToJapaneseOnPhone(page);
  await gotoView(page, "inventory", "在庫");
  const opener = page.getByRole("button", { name: "未開封商品を出品" });
  await assertTapTarget(opener, "phone sealed-listing opener");
  await opener.click({ trial: true });
  await opener.focus();
  await opener.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
    "phone listing dialog did not receive initial focus",
  );
  await assertTapTarget(
    dialog.getByRole("button", { name: "出品を記録" }),
    "phone sealed-listing submit",
  );
  await assertNoPageOverflow(page, "phone sealed-listing dialog");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert(await opener.evaluate((node) => node === document.activeElement), "dialog did not return focus");
  await assertNoPageOverflow(page, "phone inventory listing view");
  await page.getByText("FI25 · 商品 #9000001 · 標準 · 標準", { exact: true }).waitFor();

  await gotoView(page, "trades", "トレード");
  const recordTrade = page.getByRole("button", { name: "トレードを記録" });
  await assertTapTarget(recordTrade, "phone record-trade button");
  await recordTrade.focus();
  await recordTrade.press("Enter");
  const tradeDialog = page.getByRole("dialog");
  await tradeDialog.waitFor();
  assert(
    await tradeDialog.evaluate((node) => node.contains(document.activeElement)),
    "phone trade dialog did not receive initial focus",
  );
  await assertNoPageOverflow(page, "phone trade dialog");
  await page.keyboard.press("Escape");
  await tradeDialog.waitFor({ state: "hidden" });
  assert(
    await recordTrade.evaluate((node) => node === document.activeElement),
    "trade dialog did not return focus",
  );
  const unlinkTrade = page.getByRole("button", { name: "紐付けを解除" });
  await assertTapTarget(unlinkTrade, "phone unlink-trade button");
  await unlinkTrade.click();
  const unlinkDialog = page.getByRole("alertdialog");
  await unlinkDialog.waitFor();
  assert(
    (await unlinkDialog.textContent()).includes("売上とロットは記録されたまま変わりません"),
    "unlink confirmation did not explain that both booked sides remain",
  );
  const unlinkResponse = page.waitForResponse((response) =>
    response.url().includes("/rest/v1/rpc/unlink_trade"));
  await unlinkDialog.getByRole("button", { name: "紐付けを解除" }).click();
  assert((await unlinkResponse).ok(), "unlink_trade did not return success");
  await renderedTradeRow(page).waitFor({ state: "hidden" });
  const trades = await rest("trades?select=trade_id&sale_group=eq.9000001");
  assert(trades.length === 0, "unlink left a trade row behind");
  await assertNoPageOverflow(page, "phone trades view");

  let balanceReadOutage = true;
  let failedBalanceReads = 0;
  await page.route("**/rest/v1/buyer_float_balance_v**", async (route) => {
    if (route.request().method() !== "GET" || !balanceReadOutage) {
      await route.continue();
      return;
    }
    failedBalanceReads += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ code: "E2E_READ", message: "injected read failure" }),
    });
  });
  await gotoView(page, "finances", "財務");
  const agentsTab = page.getByRole("tab", { name: "購入担当者資金" });
  await assertTapTarget(agentsTab, "phone buyer-float tab");
  await agentsTab.click();
  const alert = page.getByRole("alert").filter({ hasText: "担当者残高" });
  await alert.waitFor();
  assert(failedBalanceReads > 0, "balance outage did not intercept a read");
  assert((await alert.textContent()).includes("担当者残高"), "failed source was not localized");
  assert(
    await page.getByText(/送金はまだありません/).count() === 0,
    "read failure rendered a false empty balance",
  );
  const retry = page.getByRole("button", { name: "再試行" });
  await assertTapTarget(retry, "phone buyer-float retry");
  balanceReadOutage = false;
  await retry.click();
  await page.getByText("購入担当者へ送金", { exact: true }).waitFor();
  await page.getByText("¥11,340", { exact: true }).waitFor();
  await assertNoPageOverflow(page, "phone Japanese buyer-float view");
  await page.screenshot({ path: `${artifactRoot}/phone-japanese-buyer-float.png`, fullPage: true });

  await page.context().clearCookies();
  await page.goto(`${appUrl}/dashboard?view=finances`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/login(?:\?|$)/);
  assert(page.url().includes("/login"), `expired session stayed on ${page.url()}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const browserErrors = [];
const failedRequests = [];
const failedResponses = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("requestfailed", (request) => failedRequests.push({
  method: request.method(),
  url: request.url(),
  failure: request.failure()?.errorText ?? "unknown request failure",
}));
page.on("response", (response) => {
  if (response.ok()) return;
  failedResponses.push({
    method: response.request().method(),
    url: response.url(),
    status: response.status(),
  });
});
try {
  await authenticate(context);
  await createSealedListing(page);
  await linkTrade(page);
  await exerciseBuyerFloat(page);
  await verifyPostgrestMutationFirewall();
  await verifyPhoneJourney(page);
  assert(browserErrors.length === 0, `browser errors: ${browserErrors.join(" | ")}`);
  console.log(`Financial-integrity browser CUJ passed. Artifacts: ${artifactRoot}`);
} catch (cause) {
  const failure = {
    error: cause instanceof Error ? cause.stack ?? cause.message : String(cause),
    pageUrl: page.url(),
    pageText: await page.locator("body").innerText().catch(() => "<unavailable>"),
    browserErrors,
    failedRequests,
    failedResponses,
  };
  writeFileSync(
    `${artifactRoot}/failure.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
    { mode: 0o600 },
  );
  await page.screenshot({
    path: `${artifactRoot}/failure.png`,
    fullPage: true,
  }).catch(() => undefined);
  console.error(JSON.stringify(failure, null, 2));
  throw cause;
} finally {
  await context.close();
  await browser.close();
}

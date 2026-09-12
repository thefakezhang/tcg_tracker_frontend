import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const dependencyRoot = process.env.TCG_FRONTEND_DEPENDENCY_ROOT;
const require = dependencyRoot
  ? createRequire(`${dependencyRoot}/package.json`)
  : createRequire(import.meta.url);
const { firefox } = require("playwright");

const appUrl = process.env.APP_URL;
const artifactRoot = process.env.E2E_ARTIFACT_ROOT;
if (!appUrl || !artifactRoot) throw new Error("APP_URL and E2E_ARTIFACT_ROOT are required");
mkdirSync(artifactRoot, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "content-type": "application/json",
};

async function assertNoOverflow(page, stage) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(
    dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1,
    `${stage} horizontal overflow: ${JSON.stringify(dimensions)}`,
  );
  return dimensions;
}

async function assertTapTarget(locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert(box, `${label} has no bounds`);
  assert(box.width >= 44 && box.height >= 44, `${label} is ${box.width}x${box.height}, below 44px`);
  return { width: box.width, height: box.height };
}

async function clickStableTarget(page, locator, label) {
  const before = await locator.boundingBox();
  assert(before, `${label} has no bounds`);
  await page.waitForTimeout(100);
  const after = await locator.boundingBox();
  assert(after, `${label} disappeared before the click`);
  assert(
    Math.abs(before.x - after.x) < 0.5 && Math.abs(before.y - after.y) < 0.5,
    `${label} moved before the click`,
  );
  const actionable = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !element.matches(":disabled") && hit != null && element.contains(hit);
  });
  assert(actionable, `${label} is not pointer-actionable at its center`);
  await page.mouse.click(after.x + after.width / 2, after.y + after.height / 2);
}

async function captureFullPage(_context, page, path) {
  await page.screenshot({
    path,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    timeout: 30_000,
  });
}

function planLine(planLineId, cardName, over = {}) {
  return {
    plan_line_id: planLineId,
    source: "cardrush",
    source_listing_url: `https://shop.example.test/${planLineId}`,
    planned_quantity: 2,
    unit_price_orig: 1200,
    currency: "JPY",
    source_observed_at: new Date().toISOString(),
    card_name: cardName,
    card_english_name: null,
    set_code: "SV-P",
    card_number: `${planLineId}/999`,
    image_url: null,
    want_id: null,
    want_max: null,
    want_filled: null,
    want_ceiling: null,
    outcome: "pending",
    purchased_quantity: 0,
    unit_price_jpy: null,
    condition_seen: null,
    note: null,
    delivery_status: null,
    delivery_status_at: null,
    delivery_flow: "direct",
    ...over,
  };
}

async function runViewport(browser, viewportName, viewport) {
  const stage = (name) => process.stdout.write(`[${viewportName}] ${name}\n`);
  stage("starting");
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const plans = [
    { plan_id: 7, name: "東京仕入れ", status: "ordered", line_count: 3, recorded_count: 1, finalized: false, handed_back: false },
    { plan_id: 8, name: "大阪仕入れ", status: "ordered", line_count: 1, recorded_count: 0, finalized: false, handed_back: false },
  ];
  const linesByPlan = new Map([
    [7, [
      planLine(101, "リザードン", {
        outcome: "purchased",
        purchased_quantity: 1,
        unit_price_jpy: 1200,
        condition_seen: "LP",
        delivery_status: "ordered",
        source_observed_at: "2020-01-02T03:04:00Z",
        want_id: 501,
        want_max: 4,
        want_filled: 1,
        want_ceiling: 1300,
      }),
      planLine(102, "ピカチュウ"),
      planLine(103, "イーブイ", {
        planned_quantity: 20,
        want_id: 502,
        want_max: 20,
        want_filled: 20,
        want_ceiling: 1000,
      }),
    ]],
    [8, [planLine(201, "ミュウ")]],
  ]);
  const successfulWrites = [];
  const receiptUploads = [];
  const receiptRegistrations = [];
  const savedReceipts = [];
  let expectedReceiptFailures = 0;
  let observedReceiptFailureResponses = 0;
  const writeAttempts = [];
  const lineReads = [];
  let mockedRpcRequests = 0;
  let unexpectedExternalRequests = 0;
  let failNextWrite = false;
  let expectedSaveFailures = 0;
  let failInitialPlanLoad = true;
  let expectedPlanLoadFailures = 0;
  let delayNextWrite = false;
  let delayedWrite = null;
  let delayedWriteStarted = null;

  await context.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    mockedRpcRequests += 1;
    const url = new URL(request.url());
    if (url.pathname.startsWith("/storage/v1/object/lot-receipts/") && request.method() === "POST") {
      const path = decodeURIComponent(url.pathname.slice("/storage/v1/object/lot-receipts/".length));
      assert(/^plan-receipts\/7\/cardrush\/[a-z0-9-]+-receipt\.pdf$/.test(path), `unexpected upload path ${path}`);
      receiptUploads.push(path);
      await route.fulfill({ status: 200, headers: corsHeaders, body: JSON.stringify({ Key: `lot-receipts/${path}` }) });
      return;
    }
    const rpcName = url.pathname.split("/").at(-1);
    const body = request.postDataJSON?.() ?? {};
    const fulfill = (data) => route.fulfill({
      status: 200,
      headers: corsHeaders,
      body: JSON.stringify(data),
    });

    if (rpcName === "buyer_assigned_plans") {
      if (failInitialPlanLoad && new URL(page.url()).searchParams.get("empty") !== "1") {
        failInitialPlanLoad = false;
        expectedPlanLoadFailures += 1;
        await route.fulfill({
          status: 503,
          headers: corsHeaders,
          body: JSON.stringify({ message: "fixture plan load failed", code: "P0001" }),
        });
        return;
      }
      await fulfill(new URL(page.url()).searchParams.get("empty") === "1" ? [] : plans);
      return;
    }
    if (rpcName === "buyer_plan_lines") {
      const planId = Number(body.p_plan_id);
      lineReads.push(planId);
      await fulfill(linesByPlan.get(planId) ?? []);
      return;
    }
    if (rpcName === "buyer_record_source_receipt") {
      receiptRegistrations.push(body);
      assert(body.p_plan_id === 7 && body.p_source === "cardrush" && receiptUploads.includes(body.p_storage_path), "registration is not bound to the uploaded object");
      if (receiptRegistrations.length === 1) {
        expectedReceiptFailures += 1;
        await route.fulfill({ status: 503, headers: corsHeaders, body: JSON.stringify({ message: "fixture receipt save failed", code: "P0001" }) });
        return;
      }
      savedReceipts.push({ receipt_id: 1, source: "cardrush", storage_path: body.p_storage_path, original_name: body.p_original_name, uploaded_at: "2026-09-12T00:00:00Z" });
      await fulfill(null);
      return;
    }
    if (rpcName === "buyer_source_receipts") {
      await fulfill(body.p_plan_id === 7 ? savedReceipts : []);
      return;
    }
    if (rpcName === "buyer_source_totals" || rpcName === "buyer_source_costs") {
      await fulfill([]);
      return;
    }
    if (rpcName === "buyer_record_result") {
      writeAttempts.push(body);
      if (delayNextWrite) {
        delayNextWrite = false;
        delayedWrite = deferred();
        delayedWriteStarted?.resolve();
        await delayedWrite.promise;
      }
      if (failNextWrite) {
        failNextWrite = false;
        expectedSaveFailures += 1;
        await route.fulfill({
          status: 503,
          headers: corsHeaders,
          body: JSON.stringify({ message: "fixture save failed", code: "P0001" }),
        });
        return;
      }
      for (const rows of linesByPlan.values()) {
        const target = rows.find((line) => line.plan_line_id === Number(body.p_plan_line_id));
        if (!target) continue;
        Object.assign(target, {
          outcome: body.p_outcome,
          purchased_quantity: Number(body.p_purchased_quantity ?? 0),
          unit_price_jpy: body.p_unit_price_jpy == null ? null : Number(body.p_unit_price_jpy),
          condition_seen: body.p_condition_seen,
          note: body.p_note,
        });
      }
      successfulWrites.push(body);
      await fulfill(null);
      return;
    }

    await route.fulfill({
      status: 500,
      headers: corsHeaders,
      body: JSON.stringify({ message: `Unexpected fixture RPC: ${rpcName}` }),
    });
  });
  await context.route("https://**/*", async (route) => {
    unexpectedExternalRequests += 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });

  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const expectedConsoleErrors = [];
  let observedExpectedRpcConsoleErrors = 0;
  let observedSaveFailureResponses = 0;
  let observedPlanLoadFailureResponses = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().endsWith("/rpc/buyer_record_source_receipt") && response.status() === 503) observedReceiptFailureResponses += 1;
    if (response.url().endsWith("/rpc/buyer_record_result") && response.status() === 503) {
      observedSaveFailureResponses += 1;
    }
    if (response.url().endsWith("/rpc/buyer_assigned_plans") && response.status() === 503) {
      observedPlanLoadFailureResponses += 1;
    }
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (
      text === "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
      && observedExpectedRpcConsoleErrors < expectedSaveFailures + expectedPlanLoadFailures + expectedReceiptFailures
    ) {
      observedExpectedRpcConsoleErrors += 1;
      expectedConsoleErrors.push(text);
      return;
    }
    if (
      text.includes("downloadable font: download failed")
      && text.includes("status=2152398850")
      && text.includes(`${appUrl}/_next/static/media/`)
    ) {
      expectedConsoleErrors.push(text);
      return;
    }
    consoleErrors.push(text);
  });

  await page.goto(`${appUrl}/e2e/buyer-result-grid`, { waitUntil: "networkidle" });
  await page.getByRole("alert").filter({ hasText: "購入リストを読み込めませんでした。" }).waitFor();
  await page.getByText("接続を確認するか、もう一度ログインしてから再試行してください。").waitFor();
  const retryPlanLoad = page.getByRole("button", { name: "再試行" });
  if (viewport.width === 390) await assertTapTarget(retryPlanLoad, `${viewportName} plan-load retry`);
  await clickStableTarget(page, retryPlanLoad, `${viewportName} plan-load retry`);
  await page.getByText("リザードン").waitFor();
  assert(await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.status === "loaded";
  }), `${viewportName} result-grid fonts did not load`);
  stage("loaded result grid");
  assert(await page.locator('[data-cell="101:condition"]').inputValue() === "LP", `${viewportName} did not restore condition_seen`);
  await page.getByRole("note").filter({ hasText: "価格が古い可能性があります。" }).waitFor();
  await page.getByRole("note").filter({ hasText: "最終確認:" }).waitFor();
  const sharedWantNotes = page.getByRole("note").filter({ hasText: "全購入先の合計" });
  await sharedWantNotes.first().waitFor();
  assert(await sharedWantNotes.count() === 2, `${viewportName} did not explain both shared wants`);
  stage("verified initial load failure and retry");

  await page.locator('#receipt-7-cardrush').setInputFiles({ name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("disposable receipt fixture") });
  await page.getByRole("alert").filter({ hasText: "fixture receipt save failed" }).waitFor();
  const receiptRetry = page.getByRole("button", { name: "領収書の登録を再試行" });
  await receiptRetry.waitFor();
  if (viewport.width === 390) await assertTapTarget(receiptRetry, `${viewportName} receipt retry`);
  const receiptPendingOverflow = await assertNoOverflow(page, `${viewportName} pending receipt`);
  const receiptPendingScreenshot = `${artifactRoot}/${viewportName}-receipt-retry.png`;
  await captureFullPage(context, page, receiptPendingScreenshot);
  await clickStableTarget(page, receiptRetry, `${viewportName} receipt retry`);
  await page.getByText("領収書 1件", { exact: true }).waitFor();
  assert(receiptUploads.length === 1 && receiptRegistrations.length === 2, `${viewportName} receipt retry duplicated upload or registration`);
  assert(JSON.stringify(receiptRegistrations[0]) === JSON.stringify(receiptRegistrations[1]), `${viewportName} receipt retry changed its uploaded path`);
  assert(expectedReceiptFailures === 1 && observedReceiptFailureResponses === 1, `${viewportName} expected receipt failure was not observed exactly once`);
  stage("verified same-object receipt retry");

  const filledOutcome = page.locator('[data-cell="103:outcome"]');
  const attemptsBeforeFilledWant = writeAttempts.length;
  await filledOutcome.selectOption("purchased");
  await page.getByRole("alert").filter({ hasText: "購入希望数はすでに満たされています。" }).waitFor();
  assert(await filledOutcome.inputValue() === "pending", `${viewportName} changed a fully filled want to bought`);
  await page.waitForTimeout(500);
  assert(writeAttempts.length === attemptsBeforeFilledWant, `${viewportName} queued a write for a fully filled want`);
  stage("verified fully filled shared want boundary");

  const quantity = page.locator('[data-cell="101:qty"]');
  await quantity.focus();
  await quantity.press("ArrowRight");
  assert(await page.evaluate(() => document.activeElement?.getAttribute("data-cell")) === "101:price", `${viewportName} ArrowRight did not reach price`);
  await page.keyboard.press("ArrowRight");
  assert(await page.evaluate(() => document.activeElement?.getAttribute("data-cell")) === "101:condition", `${viewportName} ArrowRight did not reach condition`);
  await page.keyboard.press("ArrowLeft");
  assert(await page.evaluate(() => document.activeElement?.getAttribute("data-cell")) === "101:price", `${viewportName} ArrowLeft did not return to price`);
  stage("verified navigation and condition restoration");

  const secondOutcome = page.locator('[data-cell="102:outcome"]');
  const attemptsBeforeInvalidPaste = writeAttempts.length;
  await secondOutcome.evaluate((element) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "購入した\t1\t1500\tEXCELLENT\t無効" },
    });
    element.dispatchEvent(event);
  });
  await page.getByText("状態はNM、LP、MP、HP、DAMAGED、または空欄にしてください。").waitFor();
  await page.waitForTimeout(500);
  assert(writeAttempts.length === attemptsBeforeInvalidPaste, `${viewportName} invalid paste issued a write`);
  assert(await secondOutcome.inputValue() === "pending", `${viewportName} invalid paste changed the outcome`);

  await secondOutcome.evaluate((element) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "購入した\t1\t1500\tMP\t確認済み" },
    });
    element.dispatchEvent(event);
  });
  await page.waitForFunction(() => document.querySelector('[data-cell="102:condition"]')?.value === "MP");
  await page.waitForFunction(() => document.querySelector('[data-cell="102:note"]')?.value === "確認済み");
  await page.waitForFunction(() => document.querySelector('[data-cell="102:outcome"]')?.value === "purchased");
  const secondRow = secondOutcome.locator("xpath=ancestor::tr");
  await secondRow.getByText("保存待ち").waitFor();
  await secondRow.getByText("保存済み").waitFor();
  assert(successfulWrites.some((write) => write.p_plan_line_id === 102 && write.p_condition_seen === "MP"), `${viewportName} valid paste did not save its complete row`);
  stage("verified paste validation and save");

  failNextWrite = true;
  const firstNote = page.locator('[data-cell="101:note"]');
  const firstRow = firstNote.locator("xpath=ancestor::tr");
  await firstNote.fill("retry this note");
  await firstNote.blur();
  const retry = page.getByRole("button", { name: "保存を再試行" });
  await retry.waitFor();
  assert(await firstNote.inputValue() === "retry this note", `${viewportName} transient failure discarded the edit`);
  if (viewport.width === 390) await assertTapTarget(retry, `${viewportName} retry`);
  await clickStableTarget(page, retry, `${viewportName} retry`);
  await firstRow.getByText("保存済み").waitFor();
  assert(successfulWrites.some((write) => write.p_plan_line_id === 101 && write.p_note === "retry this note"), `${viewportName} retry did not persist the edit`);
  stage("verified retry");

  const resultOverflow = await assertNoOverflow(page, `${viewportName} result grid`);
  const resultScreenshot = `buyer-result-${viewportName}.png`;
  stage("capturing result grid");
  await captureFullPage(context, page, `${artifactRoot}/${resultScreenshot}`);
  stage("captured result grid");

  if (viewport.width === 390) {
    const targets = [
      [page.getByLabel("購入リスト"), "plan picker"],
      [page.locator('[data-cell="101:outcome"]'), "outcome"],
      [page.locator('[data-cell="101:qty"]'), "quantity"],
      [page.locator('[data-cell="101:price"]'), "price"],
      [page.locator('[data-cell="101:condition"]'), "condition"],
      [page.locator('[data-cell="101:note"]'), "note"],
    ];
    for (const [target, label] of targets) await assertTapTarget(target, `${viewportName} ${label}`);
  }

  delayNextWrite = true;
  delayedWriteStarted = deferred();
  await firstNote.fill("flush before plan switch");
  await firstRow.getByText("保存待ち").waitFor();
  const planPicker = page.getByLabel("購入リスト");
  await planPicker.selectOption("8");
  await delayedWriteStarted.promise;
  assert(await planPicker.inputValue() === "7", `${viewportName} changed plans before the pending save completed`);
  assert(!lineReads.includes(8), `${viewportName} loaded the next plan before flushing edits`);
  await firstRow.getByText("保存中…").waitFor();
  delayedWrite.resolve();
  await page.getByText("ミュウ").waitFor();
  assert(lineReads.includes(8), `${viewportName} did not load the next plan after the save completed`);
  stage("verified pending-save plan switch");

  await page.goto(`${appUrl}/e2e/buyer-result-grid?empty=1`, { waitUntil: "networkidle" });
  await page.getByText("割り当てられた購入リストはありません").waitFor();
  assert(await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.status === "loaded";
  }), `${viewportName} empty-state fonts did not load`);
  assert(await page.getByText("オペレーターが次のリストを送信すると、ここに表示されます。").isVisible(), `${viewportName} empty-state help is missing`);
  const emptyOverflow = await assertNoOverflow(page, `${viewportName} empty state`);
  const emptyScreenshot = `buyer-result-${viewportName}-empty.png`;
  stage("capturing empty state");
  await captureFullPage(context, page, `${artifactRoot}/${emptyScreenshot}`);
  stage("captured empty state");

  assert(unexpectedExternalRequests === 0, `${viewportName} made ${unexpectedExternalRequests} external request(s)`);
  assert(pageErrors.length === 0, `${viewportName} page errors: ${pageErrors.join(" | ")}`);
  assert(expectedSaveFailures === 1, `${viewportName} did not exercise exactly one controlled save failure`);
  assert(observedSaveFailureResponses === 1, `${viewportName} did not observe the controlled 503 response`);
  assert(expectedPlanLoadFailures === 1, `${viewportName} did not exercise the initial plan-load failure`);
  assert(observedPlanLoadFailureResponses === 1, `${viewportName} did not observe the plan-load 503 response`);
  assert(consoleErrors.length === 0, `${viewportName} console errors: ${consoleErrors.join(" | ")}`);
  stage("complete");
  return {
    viewportName,
    viewport,
    mockedRpcRequests,
    receiptUploads,
    receiptRegistrations,
    observedReceiptFailureResponses,
    receiptPendingOverflow,
    receiptPendingScreenshot,
    writeAttempts: writeAttempts.length,
    successfulWrites: successfulWrites.length,
    lineReads,
    resultOverflow,
    emptyOverflow,
    resultScreenshot,
    emptyScreenshot,
    pageErrors,
    consoleErrors,
    expectedConsoleErrors,
    observedSaveFailureResponses,
    observedPlanLoadFailureResponses,
    unexpectedExternalRequests,
  };
}

const browser = await firefox.launch({ headless: true });
try {
  const results = [];
  results.push(await runViewport(browser, "desktop-1440x900", { width: 1440, height: 900 }));
  results.push(await runViewport(browser, "phone-390x844", { width: 390, height: 844 }));
  const report = {
    generatedAt: new Date().toISOString(),
    browser: { name: "firefox", version: browser.version() },
    fixtureOnly: true,
    databaseMutations: 0,
    externalRequests: 0,
    journey: [
      "initial plan-load failure and retry",
      "receipt registration failure and same-object retry",
      "fully filled shared-want boundary",
      "condition restoration",
      "visible stale timestamp and shared-want context",
      "left and right keyboard navigation",
      "invalid and valid rectangular paste",
      "failed save and retry",
      "pending-save plan switch",
      "Japanese empty state",
      "phone tap targets and overflow",
    ],
    results,
  };
  writeFileSync(`${artifactRoot}/buyer-result-browser-evidence.json`, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}

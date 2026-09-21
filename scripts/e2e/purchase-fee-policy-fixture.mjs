import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const dependencyRoot = process.env.TCG_FRONTEND_DEPENDENCY_ROOT;
const require = dependencyRoot
  ? createRequire(`${dependencyRoot}/package.json`)
  : createRequire(import.meta.url);
const { chromium } = require("playwright");

const appUrl = process.env.APP_URL;
const artifactRoot = process.env.E2E_ARTIFACT_ROOT;
if (!appUrl || !artifactRoot) throw new Error("APP_URL and E2E_ARTIFACT_ROOT are required");
if (process.env.E2E_HEADED !== "1" || process.env.TCG_PURCHASE_FEE_XVFB !== "1" || !process.env.DISPLAY) {
  throw new Error("purchase-fee acceptance requires headed Chromium under Xvfb");
}
mkdirSync(artifactRoot, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const responseHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "apikey, authorization, content-type, prefer, range, x-client-info",
  "access-control-allow-methods": "GET, HEAD, OPTIONS, POST",
  "access-control-expose-headers": "content-range",
  "content-type": "application/json",
};

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({ status, headers: responseHeaders, body: JSON.stringify(body) });
}

async function assertNoPageOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(
    dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1,
    `${label} horizontal overflow: ${JSON.stringify(dimensions)}`,
  );
  return dimensions;
}

async function assertVisibleBounds(page, locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert(box, `${label} has no visible bounds`);
  const viewport = page.viewportSize();
  assert(viewport, `${label} has no viewport`);
  assert(
    box.x >= -1 && box.x + box.width <= viewport.width + 1,
    `${label} is clipped horizontally: ${JSON.stringify({ box, viewport })}`,
  );
  return box;
}

async function assertTapTarget(page, locator, label) {
  const box = await assertVisibleBounds(page, locator, label);
  assert(box.width >= 44 && box.height >= 44, `${label} is ${box.width}x${box.height}, below 44px`);
  return { width: box.width, height: box.height };
}

async function clickStableTarget(page, locator, label) {
  const before = await assertVisibleBounds(page, locator, label);
  await page.waitForTimeout(100);
  const after = await locator.boundingBox();
  assert(after, `${label} disappeared before click`);
  assert(
    Math.abs(before.x - after.x) < 0.5 && Math.abs(before.y - after.y) < 0.5,
    `${label} moved before click`,
  );
  const actionable = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !element.matches(":disabled") && hit != null && element.contains(hit);
  });
  assert(actionable, `${label} is not pointer-actionable at its center`);
  await page.mouse.click(after.x + after.width / 2, after.y + after.height / 2);
}

async function screenshot(page, name) {
  await page.screenshot({
    path: `${artifactRoot}/${name}`,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    timeout: 30_000,
  });
}

const plan = {
  plan_id: 949,
  name: "Fee policy fixture",
  status: "draft",
  trip_id: 49,
  line_count: 0,
  want_count: 0,
  budget_amount: 50000,
  budget_currency: "JPY",
  notes: null,
  assigned_buyer_email: "buyer.fixture@example.test",
  sent_at: null,
  handed_back_at: null,
};

const candidate = {
  card_id: 9491,
  source: "cardrush",
  listing_url: "https://shop.example.test/fee-card",
  asking_price: 1000,
  currency: "JPY",
  observed_at: "2026-09-11T12:00:00Z",
  stale: false,
  available_quantity: 4,
};

const buyerPlans = [{
  plan_id: 949,
  name: "17 JPY split order",
  status: "ordered",
  line_count: 2,
  recorded_count: 2,
  finalized: false,
  handed_back: false,
}];

function buyerLine(id, source) {
  return {
    plan_line_id: id,
    source,
    source_listing_url: `https://shop.example.test/${source}/${id}`,
    planned_quantity: 1,
    unit_price_orig: 17,
    currency: "JPY",
    source_observed_at: "2026-09-11T12:00:00Z",
    card_name: source === "cardrush" ? "ピカチュウ" : "イーブイ",
    card_english_name: source === "cardrush" ? "Pikachu" : "Eevee",
    set_code: "TST",
    card_number: `${id}/100`,
    image_url: null,
    want_id: null,
    want_max: null,
    want_filled: null,
    want_ceiling: null,
    outcome: "purchased",
    purchased_quantity: 1,
    unit_price_jpy: 17,
    condition_seen: "NM",
    note: null,
    delivery_status: "ordered",
    delivery_status_at: null,
    delivery_flow: "direct",
  };
}

const buyerLines = [buyerLine(94901, "cardrush"), buyerLine(94902, "hareruya2")];
const buyerTotals = [
  {
    source: "cardrush",
    total_lines: 1,
    recorded_lines: 1,
    purchased_lines: 1,
    cards_bought: 1,
    card_value_jpy: 17,
    projected_handling_jpy: 1,
    projected_line_fee_jpy: 100,
    shipping_jpy: 0,
    other_costs_jpy: 0,
    spent_total_jpy: 118,
    agent_payout_jpy: 101,
    fee_policy_key: "jpy-buyer-fees-2026-09-11-v1",
    fee_policy_effective_from: "2026-09-11",
    fee_handling_rate: "0.03",
    fee_per_line_jpy: "100",
    fee_date: "2026-09-11",
    fee_policy_provenance: "effective_policy",
  },
  {
    source: "hareruya2",
    total_lines: 1,
    recorded_lines: 1,
    purchased_lines: 1,
    cards_bought: 1,
    card_value_jpy: 17,
    projected_handling_jpy: 0,
    projected_line_fee_jpy: 100,
    shipping_jpy: 0,
    other_costs_jpy: 0,
    spent_total_jpy: 117,
    agent_payout_jpy: 100,
    fee_policy_key: "jpy-buyer-fees-2026-09-11-v1",
    fee_policy_effective_from: "2026-09-11",
    fee_handling_rate: "0.03",
    fee_per_line_jpy: "100",
    fee_date: "2026-09-11",
    fee_policy_provenance: "effective_policy",
  },
];

async function runViewport(browser, viewportName, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const unexpectedRequests = [];
  const policyRequests = [];
  const phoneTargets = {};
  const candidateGeometry = {};
  let mockedRequests = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await context.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: responseHeaders });
      return;
    }
    mockedRequests += 1;
    const url = new URL(request.url());
    const tableMatch = /^\/rest\/v1\/([^/]+)$/.exec(url.pathname);
    if (tableMatch && request.method() === "GET") {
      const table = tableMatch[1];
      if (table === "trips") {
        await fulfillJson(route, [{
          trip_id: 49,
          name: "Tokyo fee fixture",
          status: "active",
          started_at: "2026-09-11",
          ended_at: null,
          notes: null,
          created_at: "2026-09-11T00:00:00Z",
        }]);
        return;
      }
      if (table === "purchase_plans") {
        await fulfillJson(route, [plan]);
        return;
      }
      if (["purchase_plan_lines_v", "purchase_plan_allocations_v", "purchase_plan_coverage_v", "pokemon_external_identifiers"].includes(table)) {
        await fulfillJson(route, []);
        return;
      }
      if (table === "pokemon_card_definitions") {
        await fulfillJson(route, [{
          card_id: 9491,
          card_uid: "94910000-0000-4000-8000-000000000001",
          regional_name: "手数料ピカチュウ",
          english_name: "Fee Test Pikachu",
          set_code: "TST",
          card_number: "001/100",
          misc_info: null,
        }]);
        return;
      }
      if (table === "pokemon_purchase_candidate_listings_v") {
        await fulfillJson(route, [candidate]);
        return;
      }
      if (table === "purchase_fee_policy_current_v") {
        policyRequests.push({
          select: url.searchParams.get("select"),
          currency: url.searchParams.get("currency"),
        });
        await fulfillJson(route, {
          policy_key: "jpy-buyer-fees-browser-v2",
          currency: "JPY",
          effective_from: "2027-01-01",
          handling_rate: "0.05",
          line_fee_jpy: "250",
        });
        return;
      }
    }

    const rpcMatch = /^\/rest\/v1\/rpc\/([^/]+)$/.exec(url.pathname);
    if (rpcMatch && request.method() === "POST") {
      const rpc = rpcMatch[1];
      if (rpc === "assignable_buyers") {
        await fulfillJson(route, [{ email: "buyer.fixture@example.test", has_account: true }]);
        return;
      }
      if (rpc === "buyer_assigned_plans") {
        await fulfillJson(route, buyerPlans);
        return;
      }
      if (rpc === "buyer_plan_lines") {
        await fulfillJson(route, buyerLines);
        return;
      }
      if (rpc === "buyer_source_totals") {
        await fulfillJson(route, buyerTotals);
        return;
      }
      if (rpc === "buyer_source_receipts" || rpc === "buyer_source_costs") {
        await fulfillJson(route, []);
        return;
      }
    }

    unexpectedRequests.push(`${request.method()} ${url.pathname}${url.search}`);
    await fulfillJson(route, { message: "Unexpected fixture request" }, 500);
  });
  await context.route("https://**/*", async (route) => {
    unexpectedRequests.push(`${route.request().method()} ${route.request().url()}`);
    await route.abort("blockedbyclient");
  });
  await context.route("http://**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === new URL(appUrl).origin) {
      await route.continue();
      return;
    }
    if (requestUrl.origin === "http://127.0.0.1:54321") {
      await route.fallback();
      return;
    }
    unexpectedRequests.push(`${route.request().method()} ${route.request().url()}`);
    await route.abort("blockedbyclient");
  });

  await page.goto(`${appUrl}/e2e/purchase-fees`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Purchase planner" }).waitFor();
  const addLine = page.getByRole("button", { name: "Add card" });
  if (viewport.width === 390) phoneTargets.plannerAdd = await assertTapTarget(page, addLine, `${viewportName} planner Add line`);
  await clickStableTarget(page, addLine, `${viewportName} planner Add line`);
  const dialog = page.getByRole("dialog", { name: "Add card" });
  await dialog.waitFor();
  if (viewport.width === 390) phoneTargets.plannerDialog = await assertVisibleBounds(page, dialog, `${viewportName} planner dialog`);
  const game = dialog.locator("select").first();
  if (viewport.width === 390) phoneTargets.plannerGame = await assertTapTarget(page, game, `${viewportName} planner game`);
  const search = dialog.getByPlaceholder("Search the catalog");
  if (viewport.width === 390) phoneTargets.plannerSearch = await assertTapTarget(page, search, `${viewportName} planner catalog search`);
  await search.click();
  await search.pressSequentially("Fee Test Pikachu");
  const result = dialog.getByRole("button", { name: /Fee Test Pikachu/ });
  await result.waitFor();
  if (viewport.width === 390) phoneTargets.plannerResult = await assertTapTarget(page, result, `${viewportName} planner catalog result`);
  await clickStableTarget(page, result, `${viewportName} planner catalog result`);

  const policyStatus = dialog.locator('[data-fee-policy-status="ready"]');
  await policyStatus.waitFor();
  assert(
    (await policyStatus.innerText()).includes("5% handling plus 250 JPY per purchased listing"),
    `${viewportName} English policy terms are missing`,
  );
  await dialog.getByText("1,300 JPY / card").waitFor();
  const candidateScroller = dialog.getByTestId("purchase-fee-candidates");
  await assertVisibleBounds(page, candidateScroller, `${viewportName} planner candidate scroller`);
  candidateGeometry.english = await candidateScroller.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
  }));
  if (viewport.width === 390) {
    assert(
      candidateGeometry.english.scrollWidth > candidateGeometry.english.clientWidth
      && candidateGeometry.english.overflowX === "auto",
      `${viewportName} candidate table is not internally scrollable: ${JSON.stringify(candidateGeometry.english)}`,
    );
  }
  const grade = dialog.locator("select").nth(1);
  const quantity = dialog.locator('input[type="number"]');
  const listingLink = dialog.getByRole("link", { name: "open" });
  const checkbox = dialog.getByRole("checkbox", { name: "select cardrush" });
  if (viewport.width === 390) {
    phoneTargets.plannerGrade = await assertTapTarget(page, grade, `${viewportName} planner grade`);
    phoneTargets.plannerQuantity = await assertTapTarget(page, quantity, `${viewportName} planner quantity`);
    phoneTargets.plannerListingLink = await assertTapTarget(page, listingLink, `${viewportName} planner listing link`);
    phoneTargets.plannerCheckbox = await assertTapTarget(page, checkbox.locator(".."), `${viewportName} planner listing checkbox`);
  }
  await checkbox.focus();
  await checkbox.press("Space");
  assert(await checkbox.isChecked(), `${viewportName} listing checkbox did not respond to keyboard`);
  await assertVisibleBounds(page, policyStatus, `${viewportName} English planner policy`);
  const plannerEnglishOverflow = await assertNoPageOverflow(page, `${viewportName} English planner`);
  await screenshot(page, `purchase-fee-planner-${viewportName}-en.png`);

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const plannerLanguage = page.getByLabel("Language");
  if (viewport.width === 390) phoneTargets.plannerLanguage = await assertTapTarget(page, plannerLanguage, `${viewportName} planner language`);
  await plannerLanguage.selectOption("ja");
  await page.getByRole("heading", { name: "購入プランナー" }).waitFor();
  const addJapanese = page.getByRole("button", { name: "カードを追加" });
  if (viewport.width === 390) phoneTargets.plannerAddJapanese = await assertTapTarget(page, addJapanese, `${viewportName} Japanese planner Add card`);
  await clickStableTarget(page, addJapanese, `${viewportName} Japanese planner Add card`);
  const japaneseDialog = page.getByRole("dialog", { name: "カードを追加" });
  await japaneseDialog.waitFor();
  if (viewport.width === 390) phoneTargets.plannerDialogJapanese = await assertVisibleBounds(page, japaneseDialog, `${viewportName} Japanese planner dialog`);
  const japaneseSearch = japaneseDialog.getByPlaceholder("カタログを検索");
  if (viewport.width === 390) phoneTargets.plannerSearchJapanese = await assertTapTarget(page, japaneseSearch, `${viewportName} Japanese planner catalog search`);
  await japaneseSearch.click();
  await japaneseSearch.pressSequentially("Fee Test Pikachu");
  const japaneseResult = japaneseDialog.getByRole("button", { name: /Fee Test Pikachu/ });
  await japaneseResult.waitFor();
  if (viewport.width === 390) phoneTargets.plannerResultJapanese = await assertTapTarget(page, japaneseResult, `${viewportName} Japanese planner catalog result`);
  await clickStableTarget(page, japaneseResult, `${viewportName} Japanese planner catalog result`);
  const japanesePolicyStatus = japaneseDialog.locator('[data-fee-policy-status="ready"]');
  await japanesePolicyStatus.waitFor();
  await japaneseDialog.getByText("1枚 1,300円").waitFor();
  const japaneseCandidateScroller = japaneseDialog.getByTestId("purchase-fee-candidates");
  await assertVisibleBounds(page, japaneseCandidateScroller, `${viewportName} Japanese planner candidate scroller`);
  candidateGeometry.japanese = await japaneseCandidateScroller.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
  }));
  assert(
    (await japanesePolicyStatus.innerText()).includes("取扱手数料5%、購入明細1行につき250円"),
    `${viewportName} Japanese policy terms are missing`,
  );
  await assertVisibleBounds(page, japanesePolicyStatus, `${viewportName} Japanese planner policy`);
  const plannerJapaneseOverflow = await assertNoPageOverflow(page, `${viewportName} Japanese planner`);
  await screenshot(page, `purchase-fee-planner-${viewportName}-ja.png`);

  await page.goto(`${appUrl}/e2e/buyer-result-grid`, { waitUntil: "networkidle" });
  await page.getByText("ピカチュウ").waitFor();
  const buyerPolicy = page.locator('[data-fee-policy-provenance="effective_policy"]');
  await buyerPolicy.waitFor();
  assert(
    (await buyerPolicy.innerText()).includes("取扱手数料3%、購入明細1行につき100円"),
    `${viewportName} Japanese buyer policy terms are missing`,
  );
  const japaneseBuyerText = await page.locator("body").innerText();
  assert(japaneseBuyerText.includes("購入明細2行 ¥200"), `${viewportName} Japanese listing total is missing`);
  assert(japaneseBuyerText.includes("取扱手数料 ¥1"), `${viewportName} Japanese order handling total is missing`);
  assert(japaneseBuyerText.includes("¥201"), `${viewportName} Japanese total buyer fee is missing`);
  await assertVisibleBounds(page, buyerPolicy, `${viewportName} Japanese buyer policy`);
  const buyerJapaneseOverflow = await assertNoPageOverflow(page, `${viewportName} Japanese buyer`);
  await screenshot(page, `purchase-fee-buyer-${viewportName}-ja.png`);

  const buyerLanguage = page.getByLabel("Language");
  if (viewport.width === 390) phoneTargets.buyerLanguage = await assertTapTarget(page, buyerLanguage, `${viewportName} buyer language`);
  await buyerLanguage.selectOption("en");
  await page.getByRole("heading", { name: "Purchase list" }).waitFor();
  assert(
    (await buyerPolicy.innerText()).includes("3% handling plus 100 JPY per purchased listing"),
    `${viewportName} English buyer policy terms are missing`,
  );
  const englishBuyerText = await page.locator("body").innerText();
  assert(englishBuyerText.includes("2 purchased listings ¥200"), `${viewportName} English listing total is missing`);
  assert(englishBuyerText.includes("Handling ¥1"), `${viewportName} English order handling total is missing`);
  assert(englishBuyerText.includes("¥201"), `${viewportName} English total buyer fee is missing`);
  await assertVisibleBounds(page, buyerPolicy, `${viewportName} English buyer policy`);
  const buyerEnglishOverflow = await assertNoPageOverflow(page, `${viewportName} English buyer`);
  await screenshot(page, `purchase-fee-buyer-${viewportName}-en.png`);

  assert(policyRequests.length === 2, `${viewportName} policy request count=${policyRequests.length}, want 2`);
  assert(
    policyRequests.every((request) =>
      request.select === "policy_key,currency,effective_from,handling_rate,line_fee_jpy"
      && request.currency === "eq.JPY"),
    `${viewportName} policy query contract mismatch: ${JSON.stringify(policyRequests)}`,
  );
  assert(unexpectedRequests.length === 0, `${viewportName} unexpected requests: ${unexpectedRequests.join(" | ")}`);
  assert(pageErrors.length === 0, `${viewportName} page errors: ${pageErrors.join(" | ")}`);
  assert(consoleErrors.length === 0, `${viewportName} console errors: ${consoleErrors.join(" | ")}`);

  await context.close();
  return {
    viewportName,
    viewport,
    mockedRequests,
    policyRequests,
    phoneTargets,
    candidateGeometry,
    plannerEnglishOverflow,
    plannerJapaneseOverflow,
    buyerJapaneseOverflow,
    buyerEnglishOverflow,
    screenshots: [
      `purchase-fee-planner-${viewportName}-en.png`,
      `purchase-fee-planner-${viewportName}-ja.png`,
      `purchase-fee-buyer-${viewportName}-ja.png`,
      `purchase-fee-buyer-${viewportName}-en.png`,
    ],
    pageErrors,
    consoleErrors,
    unexpectedRequests,
  };
}

const browser = await chromium.launch({ headless: false });
try {
  const results = [];
  results.push(await runViewport(browser, "desktop-1440x900", { width: 1440, height: 900 }));
  results.push(await runViewport(browser, "phone-390x844", { width: 390, height: 844 }));
  const report = {
    generatedAt: new Date().toISOString(),
    browser: { name: "chromium", version: browser.version(), headed: true },
    fixtureOnly: true,
    databaseMutations: 0,
    externalRequests: 0,
    policyFixture: {
      handlingRate: 0.05,
      lineFeeJpy: 250,
      oneCardLandedJpy: 1300,
    },
    buyerFixture: {
      cardValueJpy: 34,
      purchasedListings: 2,
      orderHandlingJpy: 1,
      listingFeesJpy: 200,
      totalBuyerFeeJpy: 201,
    },
    journey: [
      "production PurchasePlannerView catalog search and listing selection",
      "authoritative explicit current-policy query",
      "dynamic non-default fee estimate",
      "production BuyerOrderView server allocation and policy provenance",
      "English and Japanese desktop and phone parity",
      "phone tap targets, visible bounds, and page overflow",
      "zero console, page, external, or unexpected fixture errors",
    ],
    results,
  };
  writeFileSync(`${artifactRoot}/purchase-fee-browser-evidence.json`, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}

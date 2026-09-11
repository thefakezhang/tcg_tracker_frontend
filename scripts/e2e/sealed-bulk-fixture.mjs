import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const dependencyRoot = process.env.TCG_FRONTEND_DEPENDENCY_ROOT;
const require = dependencyRoot
  ? createRequire(`${dependencyRoot}/package.json`)
  : createRequire(import.meta.url);
const { chromium } = require("playwright");

const appUrl = process.env.APP_URL;
const artifactRoot = process.env.E2E_ARTIFACT_ROOT;
if (!appUrl || !artifactRoot) {
  throw new Error("APP_URL and E2E_ARTIFACT_ROOT are required");
}
if (
  process.env.E2E_HEADED !== "1" ||
  process.env.TCG_SEALED_BULK_XVFB !== "1" ||
  !process.env.DISPLAY
) {
  throw new Error("sealed bulk acceptance requires headed Chromium under Xvfb");
}
mkdirSync(artifactRoot, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertJson(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`,
  );
}

const rows = [
  {
    card_id: 41,
    product_uid: "11111111-1111-4111-8111-111111111111",
    regional_name: "アルファボックス",
    english_name: "Alpha Box",
    set_code: "TST",
    card_number: null,
    misc_info: "Tokyo release",
    image_url: null,
    product_type: "booster_box",
    language: "ja",
    sealed_condition: "shrink",
    variant_edition: "1ed",
    best_buy_price: 1800,
    best_buy_currency: "JPY",
    best_buy_symbol: "¥",
    best_buy_location: "Tokyo Trade",
    best_buy_region: "JP",
    best_buy_normalized: 1800,
    best_buy_kind: null,
    best_sell_price: 1200,
    best_sell_currency: "JPY",
    best_sell_symbol: "¥",
    best_sell_location: "cardrush",
    best_sell_region: "JP",
    best_sell_normalized: 1200,
    best_sell_kind: null,
    roi: 0.5,
  },
  {
    card_id: 42,
    product_uid: "22222222-2222-4222-8222-222222222222",
    regional_name: "ベータボックス",
    english_name: "Beta Box",
    set_code: "TST",
    card_number: null,
    misc_info: "General release",
    image_url: null,
    product_type: "booster_box",
    language: "ja",
    sealed_condition: "standard",
    variant_edition: "standard",
    best_buy_price: 1300,
    best_buy_currency: "JPY",
    best_buy_symbol: "¥",
    best_buy_location: "Osaka Trade",
    best_buy_region: "JP",
    best_buy_normalized: 1300,
    best_buy_kind: null,
    best_sell_price: 900,
    best_sell_currency: "JPY",
    best_sell_symbol: "¥",
    best_sell_location: "shinsoku",
    best_sell_region: "JP",
    best_sell_normalized: 900,
    best_sell_kind: null,
    roi: 0.44,
  },
];

const secondPageRows = [{
  ...rows[0],
  card_id: 43,
  product_uid: "33333333-3333-4333-8333-333333333333",
  regional_name: "ガンマボックス",
  english_name: "Gamma Box",
  sealed_condition: "no_shrink",
  variant_edition: "unlimited",
}];

const copy = {
  en: {
    alpha: "Alpha Box",
    beta: "Beta Box",
    selectAlpha: "Select Alpha Box",
    selectBeta: "Select Beta Box",
    selectedOne: "1 selected",
    selectedTwo: "2 selected",
    addToPlan: "Add to plan",
    dialogTitle: "Add 2 selected sealed variants to a plan",
    itemAlpha: "Alpha Box · 1st Edition · Shrink",
    itemBeta: "Beta Box · Standard · Standard",
    copiesAlpha: "Copies of Alpha Box · 1st Edition · Shrink",
    copiesBeta: "Copies of Beta Box · Standard · Standard",
    ceilingAlpha: "Max price per copy for Alpha Box · 1st Edition · Shrink",
    ceilingBeta: "Max price per copy for Beta Box · Standard · Standard",
    addCopies: "Add 5 copies",
    partial: "1 of 2 are on the plan",
    complete: "2 of 2 are on the plan",
    refusal: "No eligible JPY listing at or below the ceiling",
    retry: "Retry 1 not added",
    retryReadiness: "Retry",
    unavailable: "Sealed purchase planning is temporarily unavailable.",
    unavailableHelp: "You can keep browsing sealed products and check again when planning is available.",
    checkAgain: "Check again",
    checkFailed: "Could not check sealed purchase planning availability.",
    close: "Close",
    setPlaceholder: "Set name or code...",
    modes: { list: "List", grid: "Grid" },
    selectAll: "Select all on this page",
    selectRow: "Select row",
    refresh: "Refresh",
    plans: ["Tokyo September [Draft]", "Osaka Ready [Ready]"],
    pageOne: "Page 1 of 2",
    pageTwo: "Page 2 of 2",
    next: "Next",
  },
  ja: {
    alpha: "アルファボックス",
    beta: "ベータボックス",
    selectAlpha: "アルファボックス を選択",
    selectBeta: "ベータボックス を選択",
    selectedOne: "1件を選択中",
    selectedTwo: "2件を選択中",
    addToPlan: "プランに追加",
    dialogTitle: "選択した未開封商品の仕様2件をプランに追加",
    itemAlpha: "アルファボックス · 初版 · シュリンク付き",
    itemBeta: "ベータボックス · 標準 · 標準",
    copiesAlpha: "アルファボックス · 初版 · シュリンク付きの数量",
    copiesBeta: "ベータボックス · 標準 · 標準の数量",
    ceilingAlpha: "アルファボックス · 初版 · シュリンク付きの1点あたり上限価格",
    ceilingBeta: "ベータボックス · 標準 · 標準の1点あたり上限価格",
    addCopies: "5点を追加",
    partial: "2件中1件がプランにあります",
    complete: "2件中2件がプランにあります",
    refusal: "上限価格以下の円建て出品がありません",
    retry: "未追加の1件を再試行",
    retryReadiness: "再試行",
    unavailable: "未開封商品の購入プランは一時的に利用できません。",
    unavailableHelp: "未開封商品は引き続き閲覧できます。購入プランが利用可能になったら、もう一度確認してください。",
    checkAgain: "もう一度確認",
    checkFailed: "未開封商品の購入プランが利用可能か確認できませんでした。",
    close: "閉じる",
    setPlaceholder: "セット名またはコード...",
    modes: { list: "リスト", grid: "グリッド" },
    selectAll: "このページをすべて選択",
    selectRow: "行を選択",
    refresh: "更新",
    plans: ["Tokyo September [下書き]", "Osaka Ready [準備完了]"],
    pageOne: "1 / 2 ページ",
    pageTwo: "2 / 2 ページ",
    next: "次へ",
  },
};

const fullPayload = {
  p_plan_id: 501,
  p_items: [
    {
      product_id: 41,
      sealed_condition: "shrink",
      variant_edition: "1ed",
      quantity: 3,
      ceiling_jpy: 1500,
    },
    {
      product_id: 42,
      sealed_condition: "standard",
      variant_edition: "standard",
      quantity: 2,
      ceiling_jpy: 800,
    },
  ],
};

const retryPayload = {
  p_plan_id: 501,
  p_items: [fullPayload.p_items[1]],
};

const partialResults = [
  {
    product_id: 41,
    sealed_condition: "shrink",
    variant_edition: "1ed",
    added: true,
    source: "cardrush",
    asking_price: 1200,
    available_quantity: null,
    reason: null,
  },
  {
    product_id: 42,
    sealed_condition: "standard",
    variant_edition: "standard",
    added: false,
    source: null,
    asking_price: null,
    available_quantity: null,
    reason: "no eligible JPY listing at or below the ceiling",
  },
];

const retryResults = [{
  product_id: 42,
  sealed_condition: "standard",
  variant_edition: "standard",
  added: true,
  source: "shinsoku",
  asking_price: 790,
  available_quantity: null,
  reason: null,
}];

function responseHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "apikey, authorization, content-type, prefer, range, x-client-info",
    "access-control-allow-methods": "GET, HEAD, OPTIONS, POST",
    "access-control-expose-headers": "content-range",
    "content-type": "application/json",
    ...extra,
  };
}

async function fulfillJson(route, body, options = {}) {
  const status = options.status ?? 200;
  await route.fulfill({
    status,
    headers: responseHeaders(options.headers),
    body: options.head ? "" : JSON.stringify(body),
  });
}

async function captureViewport(page, path) {
  await page.screenshot({
    path,
    fullPage: false,
    animations: "disabled",
    caret: "hide",
    timeout: 30_000,
  });
}

async function assertNoHorizontalOverflow(page, stage) {
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

async function assertHorizontalFit(locator, viewportWidth, label) {
  const box = await locator.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0,
    };
  });
  assert(box.visible && box.width > 0 && box.height > 0, `${label} is not visibly measurable: ${JSON.stringify(box)}`);
  assert(
    box.x >= -0.5 && box.x + box.width <= viewportWidth + 0.5,
    `${label} escapes horizontally: ${JSON.stringify(box)}`,
  );
  return box;
}

async function assertTapTarget(locator, label) {
  const box = await locator.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0,
    };
  });
  assert(box.visible && box.width > 0 && box.height > 0, `${label} is not visibly measurable: ${JSON.stringify(box)}`);
  assert(
    box.width >= 43.5 && box.height >= 43.5,
    `${label} is ${box.width}x${box.height}, below 44px`,
  );
  return box;
}

async function assertUnclippedText(locator, label) {
  const measurement = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowX: style.overflowX,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  assert(
    measurement.scrollWidth <= measurement.clientWidth + 1
      && measurement.scrollHeight <= measurement.clientHeight + 1
      && measurement.textOverflow !== "ellipsis",
    `${label} is clipped: ${JSON.stringify(measurement)}`,
  );
  return measurement;
}

async function clickAction(locator, viewportWidth, label) {
  await locator.waitFor({ state: "visible" });
  const box = await assertHorizontalFit(locator, viewportWidth, label);
  assert(box.width > 0 && box.height > 0, `${label} has an empty hit area`);
  await locator.click({ timeout: 10_000 });
}

async function assertPhoneTargets(page, root, label) {
  const targets = root.locator('button, input:not([type="checkbox"]), select');
  let checked = 0;
  for (let index = 0; index < await targets.count(); index += 1) {
    const target = targets.nth(index);
    if (!(await target.isVisible())) continue;
    await assertTapTarget(target, `${label} control ${index + 1}`);
    checked += 1;
  }
  assert(checked > 0, `${label} exposed no phone controls`);
  return checked;
}

async function selectRows(page, viewport, language, mode) {
  const labels = copy[language];
  const checkboxes = page.getByRole("checkbox", { name: labels.selectRow });
  const first = mode === "list"
    ? checkboxes.nth(0)
    : page.getByRole("checkbox", { name: labels.selectAlpha });
  const second = mode === "list"
    ? checkboxes.nth(1)
    : page.getByRole("checkbox", { name: labels.selectBeta });

  await first.waitFor({ state: "visible" });
  await assertHorizontalFit(first, viewport.width, `${language} first row checkbox`);
  if (viewport.width < 640) {
    await assertTapTarget(first.locator("xpath=.."), `${language} first row selection handle`);
  }
  await first.click({ timeout: 10_000 });
  assert(await page.getByText(labels.selectedOne, { exact: true }).isVisible(), `${language} first selection missing`);
  assert(await page.locator('[data-slot="dialog-content"]').count() === 0, `${language} pointer selection opened detail`);

  await assertHorizontalFit(second, viewport.width, `${language} second row checkbox`);
  if (viewport.width < 640) {
    await assertTapTarget(second.locator("xpath=.."), `${language} second row selection handle`);
  }
  await second.evaluate((node) => node.focus());
  assert(await second.evaluate((node) => document.activeElement === node), `${language} second checkbox did not receive focus`);
  await page.keyboard.press("Space");
  assert(await page.getByText(labels.selectedTwo, { exact: true }).isVisible(), `${language} keyboard selection missing`);
  assert(await page.locator('[data-slot="dialog-content"]').count() === 0, `${language} keyboard selection opened detail`);

  let tapTargets = 0;
  if (viewport.width < 640) {
    await assertTapTarget(page.getByRole("button", { name: labels.addToPlan }), `${language} Add to plan`);
    tapTargets = 3;
  }
  return tapTargets;
}

async function runJourney(browser, name, viewport, language, mode, readinessMode = "ready") {
  const labels = copy[language];
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((chosenLanguage) => {
    localStorage.setItem("language", chosenLanguage);
    localStorage.setItem("displayCurrency", "none");
  }, language);

  const rpcPayloads = [];
  const readinessRequests = [];
  const requestOrder = [];
  const routeErrors = [];
  const unknownRequests = [];
  await context.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    try {
      if (method === "OPTIONS") {
        await route.fulfill({ status: 204, headers: responseHeaders() });
        return;
      }
      if (url.pathname.startsWith("/auth/v1/")) {
        await fulfillJson(route, { message: "fixture has no authenticated session" }, { status: 401 });
        return;
      }
      const table = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
      if (table === "pokemon_sealed_purchase_candidate_listings_v") {
        const attempt = readinessRequests.length + 1;
        const authorization = request.headers().authorization ?? "";
        const observation = {
          attempt,
          method,
          select: url.searchParams.get("select"),
          limit: url.searchParams.get("limit"),
          authenticated: authorization.startsWith("Bearer "),
        };
        readinessRequests.push(observation);
        requestOrder.push("readiness");
        assert(method === "GET", `${name} readiness probe used ${method}, want GET`);
        assert(observation.select === "product_id", `${name} readiness probe selected ${observation.select}`);
        assert(observation.limit === "0", `${name} readiness probe limit was ${observation.limit}`);
        assert(observation.authenticated, `${name} readiness probe omitted authorization`);
        if (readinessMode === "unavailable") {
          await fulfillJson(route, {
            code: "PGRST205",
            message: "Could not find the table 'public.pokemon_sealed_purchase_candidate_listings_v' in the schema cache",
          }, { status: 404 });
          return;
        }
        if (readinessMode === "transient" && attempt === 1) {
          await fulfillJson(route, {
            code: "PGRST000",
            message: "temporary fixture transport failure",
          }, { status: 503 });
          return;
        }
        await fulfillJson(route, [], { headers: { "content-range": "*/0" } });
        return;
      }
      if (table === "pokemon_sealed_summaries_best_v" || table === "pokemon_sealed_summaries_v") {
        const range = request.headers().range ?? "0-49";
        const start = Number(url.searchParams.get("offset") ?? range.split("-")[0]);
        const pageRows = start >= 10 ? secondPageRows : rows;
        const end = start + pageRows.length - 1;
        await fulfillJson(route, pageRows, {
          head: method === "HEAD",
          headers: { "content-range": `${start}-${end}/11` },
        });
        return;
      }
      if (table === "owned_inventory_counts_v" || table === "buylists") {
        await fulfillJson(route, [], {
          head: method === "HEAD",
          headers: { "content-range": "*/0" },
        });
        return;
      }
      if (table === "trips") {
        await fulfillJson(route, [{
          trip_id: 44,
          name: "Tokyo September",
          status: "active",
          started_at: "2026-09-10",
          ended_at: null,
          notes: null,
          created_at: "2026-09-01T00:00:00Z",
        }]);
        return;
      }
      if (table === "purchase_plans") {
        await fulfillJson(route, [
          { plan_id: 501, name: "Tokyo September", status: "draft", trip_id: 44 },
          { plan_id: 502, name: "Osaka Ready", status: "ready", trip_id: 45 },
        ]);
        return;
      }
      if (table === "pokemon_sealed_external_identifiers") {
        await fulfillJson(route, []);
        return;
      }
      if (table === "add_sealed_to_purchase_plan" && method === "POST") {
        requestOrder.push("mutation");
        const payload = request.postDataJSON();
        rpcPayloads.push(payload);
        const expected = rpcPayloads.length === 1 ? fullPayload : retryPayload;
        assertJson(payload, expected, `${name} RPC attempt ${rpcPayloads.length}`);
        await fulfillJson(route, rpcPayloads.length === 1 ? partialResults : retryResults);
        return;
      }
      unknownRequests.push({ method, url: request.url() });
      await fulfillJson(route, { message: "unexpected controlled-fixture request" }, { status: 500 });
    } catch (error) {
      routeErrors.push(String(error));
      await fulfillJson(route, { message: "controlled-fixture assertion failed" }, { status: 500 });
    }
  });

  await context.route("https://**/*", (route) => route.fulfill({
    status: 200,
    contentType: "text/plain",
    body: "controlled fixture",
  }));

  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const expectedReadinessConsoleErrors = [];
  const requestFailures = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location().url;
    if (
      readinessMode !== "ready"
      && location.includes("pokemon_sealed_purchase_candidate_listings_v")
      && message.text().includes("Failed to load resource")
    ) {
      expectedReadinessConsoleErrors.push({ message: message.text(), location });
      return;
    }
    consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown request failure";
    if (!failure.includes("ERR_ABORTED")) requestFailures.push(`${request.method()} ${request.url()}: ${failure}`);
  });

  await page.goto(`${appUrl}/e2e/sealed-bulk`, { waitUntil: "networkidle" });
  await page.waitForFunction((expectedLanguage) => document.documentElement.lang === expectedLanguage, language);
  await page.getByText(labels.alpha, { exact: true }).first().waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector(".animate-spin"));
  await page.addStyleTag({ content: `
    *, *::before, *::after {
      animation: none !important;
      scroll-behavior: auto !important;
      transition: none !important;
    }
  ` });
  await page.waitForFunction((expectedMode) => Array.from(
    document.querySelectorAll('[role="tab"]'),
  ).some((tab) =>
    tab.textContent?.trim() === expectedMode && tab.getAttribute("aria-selected") === "true"
  ), labels.modes[mode]);
  for (const modeLabel of Object.values(labels.modes)) {
    assert(
      await page.getByRole("tab", { name: modeLabel, exact: true }).isVisible(),
      `${name} lacks localized ${modeLabel} view control`,
    );
  }
  const selectAll = page.getByRole("checkbox", { name: labels.selectAll, exact: true });
  assert(await selectAll.isVisible(), `${name} lacks localized select-all control`);
  const refreshButton = page.getByRole("button", { name: labels.refresh, exact: true });
  assert(await refreshButton.isVisible(), `${name} refresh icon lacks an accessible name`);
  await assertNoHorizontalOverflow(page, `${name} initial`);

  const tapTargetCount = await selectRows(page, viewport, language, mode);
  const addToPlanButton = page.getByRole("button", { name: labels.addToPlan });

  if (readinessMode === "unavailable") {
    await page.getByText(labels.unavailable, { exact: true }).waitFor({ state: "visible" });
    assert(await page.getByText(labels.unavailableHelp, { exact: true }).isVisible(), `${name} missing schema reason is hidden`);
    assert(await addToPlanButton.isDisabled(), `${name} enabled sealed add while its schema was absent`);
    assert(await page.getByText(labels.alpha, { exact: true }).first().isVisible(), `${name} hid ordinary sealed browsing`);
    const checkAgain = page.getByRole("button", { name: labels.checkAgain, exact: true });
    if (viewport.width < 640) await assertTapTarget(checkAgain, `${name} check again`);
    const checkAgainResponse = page.waitForResponse((response) =>
      response.url().includes("pokemon_sealed_purchase_candidate_listings_v"),
    );
    await clickAction(checkAgain, viewport.width, `${name} check again`);
    await checkAgainResponse;
    const unavailableScreenshot = `${artifactRoot}/sealed-bulk-${name}-unavailable.png`;
    await captureViewport(page, unavailableScreenshot);
    assert(readinessRequests.length >= 2, `${name} check again did not repeat schema readiness`);
    assert(rpcPayloads.length === 0, `${name} called the mutating RPC while unavailable`);
    assert(!requestOrder.includes("mutation"), `${name} used the mutation as a readiness probe`);
    assert(routeErrors.length === 0, `${name} route assertion errors: ${routeErrors.join(" | ")}`);
    assert(unknownRequests.length === 0, `${name} unexpected fixture requests: ${JSON.stringify(unknownRequests)}`);
    assert(pageErrors.length === 0, `${name} page errors: ${pageErrors.join(" | ")}`);
    assert(consoleErrors.length === 0, `${name} console errors: ${consoleErrors.join(" | ")}`);
    assert(requestFailures.length === 0, `${name} request failures: ${requestFailures.join(" | ")}`);
    const result = {
      name, language, viewport, mode, readinessMode, readinessRequests,
      mutationRequests: rpcPayloads.length,
      ordinaryBrowsingVisible: true,
      addToPlanDisabled: true,
      tapTargets: tapTargetCount,
      screenshots: { unavailable: unavailableScreenshot },
      expectedReadinessConsoleErrors,
      pageErrors, consoleErrors, requestFailures, routeErrors, unknownRequests,
    };
    await context.close();
    return result;
  }

  if (readinessMode === "transient") {
    await page.getByText(labels.checkFailed, { exact: true }).waitFor({ state: "visible" });
    assert(await addToPlanButton.isDisabled(), `${name} enabled sealed add after a readiness error`);
    const errorScreenshot = `${artifactRoot}/sealed-bulk-${name}-readiness-error.png`;
    await captureViewport(page, errorScreenshot);
    const retryReadiness = page.getByRole("button", { name: labels.retryReadiness, exact: true });
    if (viewport.width < 640) await assertTapTarget(retryReadiness, `${name} readiness retry`);
    await clickAction(retryReadiness, viewport.width, `${name} readiness retry`);
    await page.waitForFunction((label) => Array.from(document.querySelectorAll("button"))
      .some((button) => button.textContent?.trim() === label && !button.disabled), labels.addToPlan);
    assert(readinessRequests.length >= 2, `${name} retry did not repeat the zero-row read`);
    assert(rpcPayloads.length === 0, `${name} called the mutating RPC during readiness recovery`);
    const recoveredScreenshot = `${artifactRoot}/sealed-bulk-${name}-readiness-recovered.png`;
    await captureViewport(page, recoveredScreenshot);
    assert(routeErrors.length === 0, `${name} route assertion errors: ${routeErrors.join(" | ")}`);
    assert(unknownRequests.length === 0, `${name} unexpected fixture requests: ${JSON.stringify(unknownRequests)}`);
    assert(pageErrors.length === 0, `${name} page errors: ${pageErrors.join(" | ")}`);
    assert(consoleErrors.length === 0, `${name} console errors: ${consoleErrors.join(" | ")}`);
    assert(requestFailures.length === 0, `${name} request failures: ${requestFailures.join(" | ")}`);
    const result = {
      name, language, viewport, mode, readinessMode, readinessRequests,
      mutationRequests: rpcPayloads.length,
      addToPlanDisabledBeforeRetry: true,
      addToPlanEnabledAfterRetry: true,
      tapTargets: tapTargetCount,
      screenshots: { error: errorScreenshot, recovered: recoveredScreenshot },
      expectedReadinessConsoleErrors,
      pageErrors, consoleErrors, requestFailures, routeErrors, unknownRequests,
    };
    await context.close();
    return result;
  }

  const selectedScreenshot = `${artifactRoot}/sealed-bulk-${name}-selected.png`;
  await captureViewport(page, selectedScreenshot);

  await clickAction(
    addToPlanButton,
    viewport.width,
    `${name} Add to plan`,
  );
  const dialog = page.getByRole("dialog", { name: labels.dialogTitle });
  await dialog.waitFor({ state: "visible" });
  const plan = dialog.locator("#add-to-plan-plan");
  await plan.locator('option[value="501"]').waitFor({ state: "attached" });
  assert((await plan.inputValue()) === "501", `${name} did not default to the intended plan`);
  assertJson(await plan.locator("option").allTextContents(), labels.plans, `${name} editable plan choices`);
  await plan.selectOption("502");
  assert((await plan.inputValue()) === "502", `${name} could not choose the ready plan`);
  await plan.selectOption("501");

  const copiesAlpha = dialog.getByLabel(labels.copiesAlpha);
  const copiesBeta = dialog.getByLabel(labels.copiesBeta);
  const ceilingAlpha = dialog.getByLabel(labels.ceilingAlpha);
  const ceilingBeta = dialog.getByLabel(labels.ceilingBeta);
  await copiesAlpha.fill("3");
  await ceilingAlpha.fill("1500");
  await copiesBeta.fill("2");
  await ceilingBeta.fill("800");
  const addButton = dialog.getByRole("button", { name: labels.addCopies });
  await addButton.waitFor({ state: "visible" });

  let itemTextMeasurements = [];
  if (viewport.width < 640) {
    itemTextMeasurements = [
      await assertUnclippedText(dialog.getByText(labels.itemAlpha, { exact: true }), `${name} first exact variant label`),
      await assertUnclippedText(dialog.getByText(labels.itemBeta, { exact: true }), `${name} second exact variant label`),
    ];
    const titlePaddingRight = await dialog.locator('[data-slot="dialog-title"]').evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingRight),
    );
    assert(titlePaddingRight >= 40, `${name} title reserves only ${titlePaddingRight}px for the close action`);
  }

  const dialogBox = await assertHorizontalFit(dialog, viewport.width, `${name} add dialog`);
  const dialogOverflow = await dialog.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  assert(dialogOverflow.scroll <= dialogOverflow.client + 1, `${name} add dialog overflows: ${JSON.stringify(dialogOverflow)}`);
  let dialogTapTargets = 0;
  if (viewport.width < 640) {
    dialogTapTargets = await assertPhoneTargets(page, dialog, `${name} add dialog`);
    await dialog.evaluate((element) => { element.scrollTop = 0; });
  }
  const dialogScreenshot = `${artifactRoot}/sealed-bulk-${name}-dialog.png`;
  await captureViewport(page, dialogScreenshot);

  await clickAction(addButton, viewport.width, `${name} submit bulk add`);
  await page.getByText(labels.partial, { exact: true }).waitFor({ state: "visible" });
  assert(await dialog.getByText(labels.refusal, { exact: false }).isVisible(), `${name} refusal reason missing`);
  assert(await dialog.getByText(/cardrush.*¥1,200/).isVisible(), `${name} chosen source evidence missing`);
  assert((await dialog.getByText(/reports|在庫表示/).count()) === 0, `${name} invented a stock shortfall from null depth`);
  const partialScreenshot = `${artifactRoot}/sealed-bulk-${name}-partial.png`;
  await captureViewport(page, partialScreenshot);

  const retry = dialog.getByRole("button", { name: labels.retry });
  if (viewport.width < 640) await assertTapTarget(retry, `${name} retry`);
  await clickAction(retry, viewport.width, `${name} retry unresolved variant`);
  await page.getByText(labels.complete, { exact: true }).waitFor({ state: "visible" });
  assert(await dialog.getByText(/shinsoku.*¥790/).isVisible(), `${name} retried source evidence missing`);
  assert((await dialog.getByRole("button", { name: labels.retry }).count()) === 0, `${name} kept retry after success`);
  const completeScreenshot = `${artifactRoot}/sealed-bulk-${name}-complete.png`;
  await captureViewport(page, completeScreenshot);

  const close = dialog
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: labels.close, exact: true });
  if (viewport.width < 640) await assertTapTarget(close, `${name} result close`);
  await clickAction(close, viewport.width, `${name} close result`);
  await dialog.waitFor({ state: "hidden" });

  const setFilter = page.getByPlaceholder(labels.setPlaceholder);
  await setFilter.fill("OTHER");
  await page.getByText(labels.selectedTwo, { exact: true }).waitFor({ state: "hidden" });
  await setFilter.fill("");

  const pageSize = page.locator("main select").last();
  await pageSize.selectOption("10");
  await page.getByText(labels.pageOne, { exact: true }).waitFor({ state: "visible" });
  const pageChecks = mode === "list"
    ? page.getByRole("checkbox", { name: labels.selectRow })
    : page.getByRole("checkbox", { name: labels.selectAlpha });
  await clickAction(pageChecks.first(), viewport.width, `${name} pagination selection`);
  await page.getByText(labels.selectedOne, { exact: true }).waitFor({ state: "visible" });
  await clickAction(
    page.locator("main").getByRole("button", { name: labels.next, exact: true }),
    viewport.width,
    `${name} next page`,
  );
  await page.getByText(labels.pageTwo, { exact: true }).waitFor({ state: "visible" });
  await page.getByText(labels.selectedOne, { exact: true }).waitFor({ state: "hidden" });
  await page.getByText(language === "en" ? "Gamma Box" : "ガンマボックス", { exact: true }).first().waitFor({ state: "visible" });

  let pageTapTargets = 0;
  if (viewport.width < 640) {
    pageTapTargets = await assertPhoneTargets(page, page.locator("main"), `${name} page`);
    const visibleCheckboxes = page.locator('main input[type="checkbox"]');
    for (let index = 0; index < await visibleCheckboxes.count(); index += 1) {
      const checkbox = visibleCheckboxes.nth(index);
      if (!(await checkbox.isVisible())) continue;
      await assertTapTarget(checkbox.locator("xpath=.."), `${name} checkbox handle ${index + 1}`);
      pageTapTargets += 1;
    }
  }
  const finalOverflow = await assertNoHorizontalOverflow(page, `${name} final`);
  assertJson(rpcPayloads, [fullPayload, retryPayload], `${name} RPC payload sequence`);
  assert(readinessRequests.length >= 1, `${name} never checked schema readiness`);
  assert(requestOrder.indexOf("readiness") < requestOrder.indexOf("mutation"), `${name} mutated before its readiness read`);
  assert(routeErrors.length === 0, `${name} route assertion errors: ${routeErrors.join(" | ")}`);
  assert(unknownRequests.length === 0, `${name} unexpected fixture requests: ${JSON.stringify(unknownRequests)}`);
  assert(pageErrors.length === 0, `${name} page errors: ${pageErrors.join(" | ")}`);
  assert(consoleErrors.length === 0, `${name} console errors: ${consoleErrors.join(" | ")}`);
  assert(requestFailures.length === 0, `${name} request failures: ${requestFailures.join(" | ")}`);

  const result = {
    name,
    language,
    viewport,
    mode,
    readinessMode,
    readinessRequests,
    intendedPlan: { planId: 501, label: labels.plans[0] },
    rpcPayloads,
    tapTargets: tapTargetCount + dialogTapTargets + pageTapTargets,
    dialogBox,
    dialogOverflow,
    itemTextMeasurements,
    finalOverflow,
    screenshots: {
      selected: selectedScreenshot,
      dialog: dialogScreenshot,
      partial: partialScreenshot,
      complete: completeScreenshot,
    },
    pageErrors,
    consoleErrors,
    expectedReadinessConsoleErrors,
    requestFailures,
    routeErrors,
    unknownRequests,
  };
  await context.close();
  return result;
}

const browser = await chromium.launch({ headless: process.env.E2E_HEADED !== "1" });
try {
  const results = [];
  for (const language of ["en", "ja"]) {
    results.push(await runJourney(
      browser,
      `desktop-1440x900-${language}`,
      { width: 1440, height: 900 },
      language,
      "list",
    ));
    results.push(await runJourney(
      browser,
      `phone-390x844-${language}`,
      { width: 390, height: 844 },
      language,
      "grid",
    ));
  }
  results.push(await runJourney(
    browser,
    "schema-unavailable-desktop-1440x900-en",
    { width: 1440, height: 900 },
    "en",
    "list",
    "unavailable",
  ));
  results.push(await runJourney(
    browser,
    "schema-unavailable-phone-390x844-ja",
    { width: 390, height: 844 },
    "ja",
    "grid",
    "unavailable",
  ));
  results.push(await runJourney(
    browser,
    "readiness-retry-phone-390x844-en",
    { width: 390, height: 844 },
    "en",
    "grid",
    "transient",
  ));
  results.push(await runJourney(
    browser,
    "readiness-retry-desktop-1440x900-ja",
    { width: 1440, height: 900 },
    "ja",
    "list",
    "transient",
  ));
  const evidence = {
    route: "/e2e/sealed-bulk",
    fixtureOnly: true,
    browserMode: "headed-xvfb",
    authenticatedSession: false,
    databaseAccess: false,
    viewports: ["1440x900", "390x844"],
    languages: ["en", "ja"],
    assertions: [
      "table and grid selection retain exact product, condition, and edition",
      "every sealed planning surface performs an authorized zero-row candidate-view read before mutation",
      "missing schema keeps ordinary sealed browsing visible while disabling Add to plan with an explicit localized reason",
      "transport failures keep Add to plan disabled, surface a localized error, and recover through Retry",
      "no readiness path calls the mutating RPC as a capability probe",
      "pointer and keyboard checkbox selection never opens the detail dialog",
      "localized list, grid, select-all, row-selection, and refresh accessible names are present",
      "all pointer interactions pass normal Playwright actionability without force",
      "the acceptance wrapper runs headed Chromium inside an isolated Xvfb display",
      "filter, page-size, and page changes clear selection",
      "draft and ready plans are visible and the intended draft plan is selected",
      "each selected variant has an independent bounded quantity and ceiling",
      "the first RPC reports one exact success and one visible exact refusal",
      "retry sends only the unresolved exact variant and merges its success",
      "chosen source and ask remain visible while null depth never becomes a shortfall",
      "phone controls and checkbox handles are at least 44 by 44 pixels",
      "page and dialog content fit horizontally in every language and viewport",
      "no page errors, console errors, failed requests, or unexpected fixture reads",
    ],
    results,
  };
  writeFileSync(`${artifactRoot}/result.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await browser.close();
}

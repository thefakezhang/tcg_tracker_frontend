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
    ceilingAlpha: "Max price for Alpha Box · 1st Edition · Shrink",
    ceilingBeta: "Max price for Beta Box · Standard · Standard",
    addCopies: "Add 5 copies",
    partial: "1 of 2 are on the plan",
    complete: "2 of 2 are on the plan",
    refusal: "No eligible JPY listing at or below the ceiling",
    retry: "Retry 1 not added",
    close: "Close",
    setPlaceholder: "Set name or code...",
    modes: { list: "List", grid: "Grid" },
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
    ceilingAlpha: "アルファボックス · 初版 · シュリンク付きの上限価格",
    ceilingBeta: "ベータボックス · 標準 · 標準の上限価格",
    addCopies: "5点を追加",
    partial: "2件中1件がプランにあります",
    complete: "2件中2件がプランにあります",
    refusal: "上限価格以下の円建て出品がありません",
    retry: "未追加の1件を再試行",
    close: "閉じる",
    setPlaceholder: "セット名またはコード...",
    modes: { list: "リスト", grid: "グリッド" },
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

async function forceClick(locator, viewportWidth, label) {
  await locator.waitFor({ state: "visible" });
  const box = await assertHorizontalFit(locator, viewportWidth, label);
  assert(box.width > 0 && box.height > 0, `${label} has an empty hit area`);
  await locator.click({ force: true });
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
  const checkboxes = page.getByRole("checkbox", { name: "Select row" });
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
  await first.click({ force: true });
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

async function runJourney(browser, name, viewport, language, mode) {
  const labels = copy[language];
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((chosenLanguage) => {
    localStorage.setItem("language", chosenLanguage);
    localStorage.setItem("displayCurrency", "none");
  }, language);

  const rpcPayloads = [];
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
  const requestFailures = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
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
  await assertNoHorizontalOverflow(page, `${name} initial`);

  const tapTargetCount = await selectRows(page, viewport, language, mode);
  const selectedScreenshot = `${artifactRoot}/sealed-bulk-${name}-selected.png`;
  await captureViewport(page, selectedScreenshot);

  await forceClick(
    page.getByRole("button", { name: labels.addToPlan }),
    viewport.width,
    `${name} Add to plan`,
  );
  const dialog = page.getByRole("dialog", { name: labels.dialogTitle });
  await dialog.waitFor({ state: "visible" });
  const plan = dialog.locator("#add-to-plan-plan");
  await plan.locator('option[value="501"]').waitFor({ state: "attached" });
  assert((await plan.inputValue()) === "501", `${name} did not default to the intended plan`);
  assertJson(await plan.locator("option").allTextContents(), [
    "Tokyo September [draft]",
    "Osaka Ready [ready]",
  ], `${name} editable plan choices`);
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

  await forceClick(addButton, viewport.width, `${name} submit bulk add`);
  await page.getByText(labels.partial, { exact: true }).waitFor({ state: "visible" });
  assert(await dialog.getByText(labels.refusal, { exact: false }).isVisible(), `${name} refusal reason missing`);
  assert(await dialog.getByText(/cardrush.*¥1,200/).isVisible(), `${name} chosen source evidence missing`);
  assert((await dialog.getByText(/reports|在庫表示/).count()) === 0, `${name} invented a stock shortfall from null depth`);
  const partialScreenshot = `${artifactRoot}/sealed-bulk-${name}-partial.png`;
  await captureViewport(page, partialScreenshot);

  const retry = dialog.getByRole("button", { name: labels.retry });
  if (viewport.width < 640) await assertTapTarget(retry, `${name} retry`);
  await forceClick(retry, viewport.width, `${name} retry unresolved variant`);
  await page.getByText(labels.complete, { exact: true }).waitFor({ state: "visible" });
  assert(await dialog.getByText(/shinsoku.*¥790/).isVisible(), `${name} retried source evidence missing`);
  assert((await dialog.getByRole("button", { name: labels.retry }).count()) === 0, `${name} kept retry after success`);
  const completeScreenshot = `${artifactRoot}/sealed-bulk-${name}-complete.png`;
  await captureViewport(page, completeScreenshot);

  const close = dialog
    .locator('[data-slot="dialog-footer"]')
    .getByRole("button", { name: labels.close, exact: true });
  if (viewport.width < 640) await assertTapTarget(close, `${name} result close`);
  await forceClick(close, viewport.width, `${name} close result`);
  await dialog.waitFor({ state: "hidden" });

  const setFilter = page.getByPlaceholder(labels.setPlaceholder);
  await setFilter.fill("OTHER");
  await page.getByText(labels.selectedTwo, { exact: true }).waitFor({ state: "hidden" });
  await setFilter.fill("");

  const pageSize = page.locator("main select").last();
  await pageSize.selectOption("10");
  await page.getByText(labels.pageOne, { exact: true }).waitFor({ state: "visible" });
  const pageChecks = mode === "list"
    ? page.getByRole("checkbox", { name: "Select row" })
    : page.getByRole("checkbox", { name: labels.selectAlpha });
  await forceClick(pageChecks.first(), viewport.width, `${name} pagination selection`);
  await page.getByText(labels.selectedOne, { exact: true }).waitFor({ state: "visible" });
  await forceClick(
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
    intendedPlan: { planId: 501, label: "Tokyo September [draft]" },
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
  const evidence = {
    route: "/e2e/sealed-bulk",
    fixtureOnly: true,
    authenticatedSession: false,
    databaseAccess: false,
    viewports: ["1440x900", "390x844"],
    languages: ["en", "ja"],
    assertions: [
      "table and grid selection retain exact product, condition, and edition",
      "pointer and keyboard checkbox selection never opens the detail dialog",
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

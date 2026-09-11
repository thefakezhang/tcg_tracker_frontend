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
  process.env.E2E_HEADED !== "1"
  || process.env.TCG_POKEMON_VARIANT_XVFB !== "1"
  || !process.env.DISPLAY
) {
  throw new Error("Pokemon variant projection acceptance requires headed Chromium under Xvfb");
}
mkdirSync(artifactRoot, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const variantLabel = "SA,ミラー,1ED";
const mtgLabel = "Showcase,etched";

const pokemonCards = [
  {
    card_id: 101,
    card_uid: "11111111-1111-4111-8111-111111111111",
    english_name_version: 1,
    regional_name: "旧複合カード",
    english_name: "Legacy Compound Card",
    set_code: "SV-P",
    card_number: "001/SV-P",
    language: "jp",
    misc_info: "SA,ミラー,1ED",
    edition: "first",
    foil_treatment: "mirror",
    variant_attrs: ["SA"],
    image_url: null,
    rarity: "Promo",
    is_cute: false,
    japan_exclusive_artwork: false,
    japan_exclusive_artwork_reason: null,
    japan_exclusive_artwork_evidence_url: null,
    japan_exclusive_stamps: false,
    japan_exclusive_stamps_reason: null,
    japan_exclusive_stamps_evidence_url: null,
  },
  {
    card_id: 102,
    card_uid: "22222222-2222-4222-8222-222222222222",
    english_name_version: 1,
    regional_name: "書換済みカード",
    english_name: "Rewritten Residual Card",
    set_code: "SV-P",
    card_number: "002/SV-P",
    language: "jp",
    misc_info: "SA",
    edition: "first",
    foil_treatment: "mirror",
    variant_attrs: ["SA"],
    image_url: null,
    rarity: "Promo",
    is_cute: false,
    japan_exclusive_artwork: false,
    japan_exclusive_artwork_reason: null,
    japan_exclusive_artwork_evidence_url: null,
    japan_exclusive_stamps: false,
    japan_exclusive_stamps_reason: null,
    japan_exclusive_stamps_evidence_url: null,
  },
];

const mtgCard = {
  card_id: 201,
  card_uid: "33333333-3333-4333-8333-333333333333",
  regional_name: "Black Lotus Fixture",
  set_code: "TST",
  card_number: "201",
  misc_info: mtgLabel,
  image_url: null,
  is_foil: true,
  foil_type: "etched",
  language: "en",
};

function summary(card, cardKey) {
  return {
    card_id: card.card_id,
    tier: 1,
    psa_grade: 0,
    best_buy_price: null,
    best_buy_currency: null,
    best_buy_symbol: null,
    best_buy_location: null,
    best_buy_region: null,
    best_buy_normalized: null,
    best_buy_kind: null,
    best_sell_price: null,
    best_sell_currency: null,
    best_sell_symbol: null,
    best_sell_location: null,
    best_sell_region: null,
    best_sell_normalized: null,
    best_sell_kind: null,
    roi: null,
    best_opportunity_grade: null,
    deal_net_usd: null,
    deal_annualized: null,
    raw_to_grade_ev_usd: null,
    deal_relative_value_pct: null,
    deal_updated_at: null,
    [cardKey]: card,
  };
}

const pokemonSummaries = pokemonCards.map((card) => summary(card, "pokemon_card_definitions"));
const mtgSummaries = [summary(mtgCard, "mtg_card_definitions_v")];

const copy = {
  en: {
    browserNames: ["Legacy Compound Card", "Rewritten Residual Card"],
    grid: "Grid",
  },
  ja: {
    browserNames: ["旧複合カード", "書換済みカード"],
    grid: "グリッド",
  },
};

const knownTables = new Set([
  "acquisition_lots",
  "buylists",
  "cardladder_slab_sales",
  "card_browser_source_options_v",
  "cohort_changepoint_annotations_v",
  "conditions",
  "exchange_rates",
  "exit_cost_profiles",
  "inventory_holdings_v",
  "inventory_theoretical_roi_v",
  "locations",
  "market_events",
  "mtg_buylist_entries",
  "mtg_lot_lines",
  "mtg_market_listings",
  "mtg_price_summaries",
  "owned_inventory_counts_v",
  "pokemon_buylist_entries",
  "pokemon_card_definitions_operator_v",
  "pokemon_external_identifiers",
  "pokemon_grade_signals",
  "pokemon_lot_lines",
  "pokemon_market_listings",
  "pokemon_price_summaries",
  "pokemon_price_summaries_browser_v",
  "pokemon_sealed_buylist_entries",
  "pokemon_tcgplayer_market",
  "refresh_requests",
  "trip_observations_v",
  "trips",
]);

const knownRpcs = new Set([
  "card_refresh_targets",
  "record_deal_opportunity_exposures",
]);

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

function requestRangeStart(request) {
  const offset = new URL(request.url()).searchParams.get("offset");
  if (offset != null) return Number(offset) || 0;
  const value = request.headers().range ?? "0-999";
  return Number(value.split("-")[0]) || 0;
}

async function fulfillRows(route, rows, total = rows.length) {
  const request = route.request();
  const head = request.method() === "HEAD";
  const start = requestRangeStart(request);
  const range = rows.length > 0 ? `${start}-${start + rows.length - 1}/${total}` : `*/${total}`;
  await route.fulfill({
    status: 200,
    headers: responseHeaders({ "content-range": range }),
    body: head ? "" : JSON.stringify(rows),
  });
}

async function assertNoHorizontalOverflow(page, root, stage) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  const production = await root.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      width: rect.width,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
    };
  });
  assert(
    dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1,
    `${stage} page overflow: ${JSON.stringify(dimensions)}`,
  );
  assert(
    production.x >= -0.5 && production.x + production.width <= dimensions.viewport + 0.5,
    `${stage} production bounds escape viewport: ${JSON.stringify(production)}`,
  );
  assert(
    production.scrollWidth <= production.clientWidth + 1,
    `${stage} production content is clipped: ${JSON.stringify(production)}`,
  );
  return { dimensions, production };
}

async function assertTarget(locator, label) {
  const box = await locator.boundingBox();
  assert(box, `${label} has no measurable bounds`);
  assert(box.width >= 43.5 && box.height >= 43.5, `${label} is ${box.width}x${box.height}, below 44px`);
  return box;
}

async function assertFits(locator, viewportWidth, label) {
  const box = await locator.boundingBox();
  assert(box, `${label} has no measurable bounds`);
  assert(box.x >= -0.5 && box.x + box.width <= viewportWidth + 0.5, `${label} is clipped: ${JSON.stringify(box)}`);
  const text = await locator.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    textOverflow: getComputedStyle(element).textOverflow,
  }));
  assert(
    text.scrollWidth <= text.clientWidth + 1 && text.scrollHeight <= text.clientHeight + 1,
    `${label} text is clipped: ${JSON.stringify(text)}`,
  );
  return { box, text };
}

async function capture(page, name) {
  const path = `${artifactRoot}/${name}.png`;
  await page.screenshot({
    path,
    fullPage: false,
    animations: "disabled",
    caret: "hide",
    timeout: 30_000,
  });
  return path;
}

function cardTile(root, name) {
  return root
    .getByText(name, { exact: true })
    .first()
    .locator("xpath=ancestor::*[@role='button'][1]");
}

function assertTypedSelects(requests, journey) {
  const typedFields = ["edition", "foil_treatment", "variant_attrs"];
  const browser = requests.filter((request) =>
    request.method === "GET"
    && request.table === "pokemon_price_summaries_browser_v"
    && request.select?.includes("pokemon_card_definitions!inner(")
  );
  const buylist = requests.filter((request) =>
    request.method === "GET"
    && request.table === "pokemon_price_summaries"
    && request.select?.includes("pokemon_card_definitions!inner(")
  );
  const index = requests.filter((request) =>
    request.method === "GET"
    && request.table === "pokemon_card_definitions_operator_v"
    && request.select?.includes("regional_name")
  );
  const mtg = requests.filter((request) =>
    request.method === "GET"
    && request.table === "mtg_price_summaries"
    && request.select?.includes("mtg_card_definitions_v!inner(")
  );

  for (const [surface, matches] of [["Browser", browser], ["Buy List", buylist], ["Card Index", index]]) {
    assert(matches.length > 0, `${journey} did not execute the ${surface} typed read`);
    for (const field of typedFields) {
      assert(matches.every((request) => request.select.includes(field)), `${journey} ${surface} omitted ${field}`);
    }
  }
  assert(mtg.length >= 2, `${journey} did not execute both Browser and Buy List MTG reads`);
  assert(
    mtg.every((request) => typedFields.every((field) => !request.select.includes(field))),
    `${journey} changed the MTG projection: ${JSON.stringify(mtg)}`,
  );
  return {
    browser: [...new Set(browser.map((request) => request.select))],
    buylist: [...new Set(buylist.map((request) => request.select))],
    index: [...new Set(index.map((request) => request.select))],
    mtg: [...new Set(mtg.map((request) => request.select))],
  };
}

async function runJourney(browser, name, viewport, language) {
  const labels = copy[language];
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((chosenLanguage) => {
    localStorage.setItem("language", chosenLanguage);
    localStorage.setItem("displayCurrency", "none");
  }, language);

  const requests = [];
  const unknownRequests = [];
  const externalRequests = [];
  await context.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: responseHeaders() });
      return;
    }
    if (url.pathname.startsWith("/auth/v1/")) {
      await route.fulfill({
        status: 401,
        headers: responseHeaders(),
        body: JSON.stringify({ message: "controlled fixture has no authenticated session" }),
      });
      return;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    const table = decodeURIComponent(segments.at(-1) ?? "");
    const select = url.searchParams.get("select");
    requests.push({ method, table, select, range: request.headers().range ?? null, url: request.url() });

    if (segments.includes("rpc")) {
      if (!knownRpcs.has(table)) unknownRequests.push({ method, table, url: request.url() });
      await fulfillRows(route, []);
      return;
    }
    if (!knownTables.has(table)) unknownRequests.push({ method, table, url: request.url() });

    const start = requestRangeStart(request);
    if (table === "conditions") {
      await fulfillRows(route, [{ condition_id: 1, tier: 1 }]);
    } else if (table === "trips") {
      await fulfillRows(route, []);
    } else if (table === "buylists") {
      await fulfillRows(route, [{ buylist_id: 77, name: "Variant Fixture", description: null, created_at: "2026-09-11T00:00:00Z" }]);
    } else if (table === "pokemon_price_summaries_browser_v") {
      await fulfillRows(route, pokemonSummaries, 2);
    } else if (table === "mtg_price_summaries") {
      const isBuylist = url.searchParams.has("card_id");
      await fulfillRows(route, isBuylist && start > 0 ? [] : mtgSummaries, 1);
    } else if (table === "pokemon_buylist_entries") {
      await fulfillRows(route, start > 0 ? [] : [
        { entry_id: 1, card_id: 101, psa_grade: 0, target_price_usd: null },
        { entry_id: 2, card_id: 102, psa_grade: 0, target_price_usd: null },
      ], 2);
    } else if (table === "mtg_buylist_entries") {
      await fulfillRows(route, start > 0 ? [] : [
        { entry_id: 3, card_id: 201, psa_grade: 0, target_price_usd: null },
      ], 1);
    } else if (table === "pokemon_sealed_buylist_entries") {
      await fulfillRows(route, []);
    } else if (table === "pokemon_price_summaries") {
      await fulfillRows(route, start > 0 ? [] : pokemonSummaries, 2);
    } else if (table === "pokemon_card_definitions_operator_v") {
      await fulfillRows(route, method === "HEAD" ? [] : pokemonCards, 2);
    } else {
      await fulfillRows(route, []);
    }
  });
  await context.route("https://**/*", async (route) => {
    externalRequests.push(route.request().url());
    await route.fulfill({ status: 503, contentType: "text/plain", body: "external access disabled" });
  });

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

  await page.goto(`${appUrl}/e2e/pokemon-variant-projection`, { waitUntil: "networkidle" });
  await page.waitForFunction((expectedLanguage) => document.documentElement.lang === expectedLanguage, language);
  await page.getByRole("heading", { name: "Pokemon typed variant projection" }).waitFor({ state: "visible" });
  const fixtureControls = [
    page.getByTestId("fixture-surface-browser"),
    page.getByTestId("fixture-surface-buylist"),
    page.getByTestId("fixture-surface-index"),
    page.getByTestId("fixture-game-pokemon"),
    page.getByTestId("fixture-game-mtg"),
  ];
  const phoneTargets = [];
  const recordPhoneTarget = async (locator, label) => {
    const box = await assertTarget(locator, label);
    phoneTargets.push({ label, ...box });
  };
  if (viewport.width < 640) {
    for (let index = 0; index < fixtureControls.length; index += 1) {
      await recordPhoneTarget(fixtureControls[index], `${name} fixture control ${index + 1}`);
    }
  }

  const browserRoot = page.getByTestId("fixture-production-browser");
  await browserRoot.getByText(labels.browserNames[0], { exact: true }).first().waitFor({ state: "visible" });
  const browserGrid = browserRoot.getByRole("tab", { name: labels.grid, exact: true });
  await browserGrid.click();
  const oldTile = cardTile(browserRoot, labels.browserNames[0]);
  const residualTile = cardTile(browserRoot, labels.browserNames[1]);
  await oldTile.waitFor({ state: "visible" });
  await residualTile.waitFor({ state: "visible" });
  assert(await oldTile.getByText(variantLabel, { exact: true }).count() === 1, `${name} Browser old compound label changed`);
  assert(await residualTile.getByText(variantLabel, { exact: true }).count() === 1, `${name} Browser rewritten residual label changed`);
  await assertFits(oldTile.getByText(variantLabel, { exact: true }), viewport.width, `${name} Browser old label`);
  await assertFits(residualTile.getByText(variantLabel, { exact: true }), viewport.width, `${name} Browser residual label`);
  if (viewport.width < 640) {
    await recordPhoneTarget(browserGrid, `${name} Browser grid tab`);
    await recordPhoneTarget(oldTile, `${name} Browser old card tile`);
    await recordPhoneTarget(residualTile, `${name} Browser residual card tile`);
    const selection = oldTile.getByRole("checkbox");
    await recordPhoneTarget(selection.locator("xpath=.."), `${name} Browser selection target`);
  }
  const selection = oldTile.getByRole("checkbox");
  await selection.click();
  assert(await selection.isChecked(), `${name} Browser selection did not toggle on`);
  assert(await page.getByRole("dialog").count() === 0, `${name} Browser selection opened card details`);
  await selection.click();
  assert(!(await selection.isChecked()), `${name} Browser selection did not toggle off`);
  if (viewport.width < 640) await oldTile.getByText(variantLabel, { exact: true }).scrollIntoViewIfNeeded();
  const browserOverflow = await assertNoHorizontalOverflow(page, browserRoot, `${name} Browser Pokemon grid`);
  const browserScreenshot = await capture(page, `${name}-browser-pokemon-grid`);

  await oldTile.getByText(labels.browserNames[0], { exact: true }).click();
  let dialog = page.getByRole("dialog");
  await page.waitForTimeout(500);
  assert(await dialog.count() === 1, `${name} pointer activation did not open one detail dialog`);
  const oldDialogText = await dialog.textContent();
  assert(oldDialogText?.includes(variantLabel), `${name} old detail label missing from: ${oldDialogText}`);
  assert(await dialog.getByRole("heading", { name: labels.browserNames[0], exact: true }).isVisible(), `${name} old detail title missing`);
  const oldDetailOverflow = await assertNoHorizontalOverflow(page, dialog, `${name} Browser old detail`);
  const oldDetailScreenshot = await capture(page, `${name}-browser-old-detail`);
  let close = dialog.getByRole("button", { name: "Close" });
  if (viewport.width < 640) {
    await recordPhoneTarget(close, `${name} old detail close`);
  }
  await close.click();
  await dialog.waitFor({ state: "hidden" });

  await residualTile.focus();
  assert(await residualTile.evaluate((node) => document.activeElement === node), `${name} rewritten card did not receive keyboard focus`);
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog");
  await dialog.getByText(variantLabel, { exact: true }).waitFor({ state: "visible" });
  assert(await dialog.getByRole("heading", { name: labels.browserNames[1], exact: true }).isVisible(), `${name} rewritten detail title missing`);
  const residualDetailOverflow = await assertNoHorizontalOverflow(page, dialog, `${name} Browser rewritten detail`);
  const residualDetailScreenshot = await capture(page, `${name}-browser-residual-detail`);
  close = dialog.getByRole("button", { name: "Close" });
  await close.click();
  await dialog.waitFor({ state: "hidden" });

  await page.getByTestId("fixture-game-mtg").click();
  const mtgRoot = page.getByTestId("fixture-production-browser");
  await mtgRoot.getByText(mtgCard.regional_name, { exact: true }).first().waitFor({ state: "visible" });
  await mtgRoot.getByRole("tab", { name: labels.grid, exact: true }).click();
  const mtgTile = cardTile(mtgRoot, mtgCard.regional_name);
  await mtgTile.waitFor({ state: "visible" });
  assert(await mtgTile.getByText(mtgLabel, { exact: true }).count() === 1, `${name} Browser changed MTG misc label`);
  await assertFits(mtgTile.getByText(mtgLabel, { exact: true }), viewport.width, `${name} Browser MTG label`);
  if (viewport.width < 640) {
    await recordPhoneTarget(mtgTile, `${name} Browser MTG card tile`);
    await mtgTile.getByText(mtgLabel, { exact: true }).scrollIntoViewIfNeeded();
  }
  const mtgOverflow = await assertNoHorizontalOverflow(page, mtgRoot, `${name} Browser MTG grid`);
  const mtgScreenshot = await capture(page, `${name}-browser-mtg-grid`);
  await mtgTile.focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog");
  await dialog.getByText(mtgLabel, { exact: true }).waitFor({ state: "visible" });
  assert(await dialog.getByRole("heading", { name: mtgCard.regional_name, exact: true }).isVisible(), `${name} MTG detail title missing`);
  await assertNoHorizontalOverflow(page, dialog, `${name} Browser MTG detail`);
  await dialog.getByRole("button", { name: "Close" }).click();
  await dialog.waitFor({ state: "hidden" });

  await page.getByTestId("fixture-surface-buylist").click();
  const buylistRoot = page.getByTestId("fixture-production-buylist");
  await buylistRoot.getByText(labels.browserNames[0], { exact: true }).first().waitFor({ state: "visible" });
  const buylistGrid = buylistRoot.getByRole("tab", { name: labels.grid, exact: true });
  await buylistGrid.click();
  assert(await buylistRoot.getByText(variantLabel, { exact: true }).count() === 2, `${name} Buy List lacks exact old/residual parity`);
  assert(await buylistRoot.getByText(mtgLabel, { exact: true }).count() === 1, `${name} Buy List changed MTG misc label`);
  for (const label of [variantLabel, mtgLabel]) {
    const matches = buylistRoot.getByText(label, { exact: true });
    for (let index = 0; index < await matches.count(); index += 1) {
      await assertFits(matches.nth(index), viewport.width, `${name} Buy List ${label} ${index + 1}`);
    }
  }
  if (viewport.width < 640) {
    await recordPhoneTarget(buylistGrid, `${name} Buy List grid tab`);
    await buylistRoot.getByText(variantLabel, { exact: true }).first().scrollIntoViewIfNeeded();
  }
  const buylistOverflow = await assertNoHorizontalOverflow(page, buylistRoot, `${name} Buy List`);
  const buylistScreenshot = await capture(page, `${name}-buylist`);

  await page.getByTestId("fixture-surface-index").click();
  const indexRoot = page.getByTestId("fixture-production-index");
  await indexRoot.getByText(pokemonCards[0].regional_name, { exact: true }).waitFor({ state: "visible" });
  assert(await indexRoot.getByText(variantLabel, { exact: true }).count() === 2, `${name} Card Index lacks exact old/residual parity`);
  const oldIndexRow = indexRoot
    .getByText(pokemonCards[0].regional_name, { exact: true })
    .locator("xpath=ancestor::tr[1]");
  const indexEdit = oldIndexRow.getByRole("button");
  await indexEdit.focus();
  assert(await indexEdit.evaluate((node) => document.activeElement === node), `${name} Card Index edit action is not keyboard focusable`);
  if (viewport.width < 640) {
    await recordPhoneTarget(indexEdit, `${name} Card Index edit action`);
  }
  const indexLabels = indexRoot.getByText(variantLabel, { exact: true });
  for (let index = 0; index < await indexLabels.count(); index += 1) {
    await assertFits(indexLabels.nth(index), viewport.width, `${name} Card Index variant ${index + 1}`);
  }
  const indexOverflow = await assertNoHorizontalOverflow(page, indexRoot, `${name} Card Index`);
  const indexScreenshot = await capture(page, `${name}-card-index`);

  const queryEvidence = assertTypedSelects(requests, name);
  assert(unknownRequests.length === 0, `${name} unexpected fixture requests: ${JSON.stringify(unknownRequests)}`);
  assert(externalRequests.length === 0, `${name} made external requests: ${JSON.stringify(externalRequests)}`);
  assert(pageErrors.length === 0, `${name} page errors: ${pageErrors.join(" | ")}`);
  assert(consoleErrors.length === 0, `${name} console errors: ${consoleErrors.join(" | ")}`);
  assert(requestFailures.length === 0, `${name} request failures: ${requestFailures.join(" | ")}`);

  const result = {
    name,
    viewport,
    language,
    variantLabel,
    mtgLabel,
    queryEvidence,
    phoneTargetCount: phoneTargets.length,
    phoneTargets,
    overflow: {
      browser: browserOverflow,
      oldDetail: oldDetailOverflow,
      residualDetail: residualDetailOverflow,
      mtg: mtgOverflow,
      buylist: buylistOverflow,
      index: indexOverflow,
    },
    screenshots: {
      browser: browserScreenshot,
      oldDetail: oldDetailScreenshot,
      residualDetail: residualDetailScreenshot,
      mtg: mtgScreenshot,
      buylist: buylistScreenshot,
      index: indexScreenshot,
    },
    pageErrors,
    consoleErrors,
    requestFailures,
    unknownRequests,
    externalRequests,
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
    ));
    results.push(await runJourney(
      browser,
      `phone-390x844-${language}`,
      { width: 390, height: 844 },
      language,
    ));
  }
  const evidence = {
    route: "/e2e/pokemon-variant-projection",
    fixtureOnly: true,
    browserMode: "headed-xvfb",
    authenticatedSession: false,
    databaseAccess: false,
    externalRequests: 0,
    viewports: ["1440x900", "390x844"],
    languages: ["en", "ja"],
    productionSurfaces: ["CardBrowser grid", "CardDetailModal", "BuyListView", "PokemonCardIndex"],
    assertions: [
      "old compound and rewritten residual Pokemon rows render exactly SA,ミラー,1ED",
      "MTG renders Showcase,etched unchanged",
      "Browser, detail, Buy List, and Card Index production components execute the fixture journey",
      "Browser, Buy List, and Card Index PostgREST reads select edition, foil_treatment, and variant_attrs",
      "MTG PostgREST reads do not add Pokemon typed fields",
      "pointer and keyboard activation open production card details",
      "interacted phone controls, card tiles, and Pokemon selection handles are at least 44 by 44 pixels",
      "Pokemon selection toggles normally without opening card details",
      "production content and exact labels fit horizontally without a fixture clipping wrapper",
      "no page errors, console errors, failed requests, unexpected reads, external calls, or database access",
    ],
    results,
  };
  writeFileSync(`${artifactRoot}/result.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await browser.close();
}

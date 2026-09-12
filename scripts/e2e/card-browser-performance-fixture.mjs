import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import {
  classifyConsoleEvidence,
  recordsStartedInSample,
} from "./card-browser-performance-console-evidence.mjs";

const dependencyRoot = process.env.TCG_FRONTEND_DEPENDENCY_ROOT;
const require = dependencyRoot
  ? createRequire(`${dependencyRoot}/package.json`)
  : createRequire(import.meta.url);
const { chromium } = require("playwright");

const appUrl = process.env.APP_URL;
const artifactWriteRoot = process.env.E2E_ARTIFACT_ROOT;
const artifactRoot = process.env.E2E_DURABLE_ARTIFACT_ROOT ?? artifactWriteRoot;
const expectedMode = process.env.TCG_CARD_BROWSER_EXPECT_MODE;
const baselineResultPath = process.env.TCG_CARD_BROWSER_BASELINE_RESULT ?? "";
const sampleCount = Number(process.env.TCG_CARD_BROWSER_SAMPLES ?? "3");
const diagnosticMode = process.env.TCG_CARD_BROWSER_DIAGNOSTIC === "1";
const requestedJourneys = (process.env.TCG_CARD_BROWSER_JOURNEYS ?? "")
  .split(",")
  .map((journey) => journey.trim())
  .filter(Boolean);
const requestedMatrices = (process.env.TCG_CARD_BROWSER_MATRICES ?? "")
  .split(",")
  .map((matrix) => matrix.trim())
  .filter(Boolean);
if (!appUrl || !artifactWriteRoot || !artifactRoot || !["legacy", "bounded"].includes(expectedMode)) {
  throw new Error("APP_URL, E2E_ARTIFACT_ROOT, and TCG_CARD_BROWSER_EXPECT_MODE=legacy|bounded are required");
}
if (!Number.isInteger(sampleCount) || sampleCount < (diagnosticMode ? 1 : 2) || sampleCount > 5) {
  throw new Error(`TCG_CARD_BROWSER_SAMPLES must be an integer from ${diagnosticMode ? 1 : 2} through 5`);
}
if (process.env.E2E_HEADED !== "1" || process.env.TCG_CARD_BROWSER_XVFB !== "1" || !process.env.DISPLAY) {
  throw new Error("Card Browser performance acceptance requires headed Chromium under Xvfb");
}
mkdirSync(artifactWriteRoot, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const copy = {
  en: {
    name: "Name...",
    set: "Set name or code...",
    filters: "Filters",
    sourceAll: "All sources",
    raw: "Raw",
    psa: "PSA",
    list: "List",
    grid: "Grid",
    sortBuy: "Buy",
    next: "Next",
    empty: "No results found",
    watch: "Watch",
    loading: "Cards are ready. Grade evidence is still loading.",
    unavailable: "Cards are ready, but grade evidence is temporarily unavailable.",
  },
  ja: {
    name: "名前...",
    set: "セット名またはコード...",
    filters: "絞り込み",
    sourceAll: "すべてのソース",
    raw: "未鑑定",
    psa: "PSA",
    list: "リスト",
    grid: "グリッド",
    sortBuy: "購入",
    next: "次へ",
    empty: "結果が見つかりません",
    watch: "ウォッチ",
    loading: "カードを表示しました。グレード別エビデンスを読み込んでいます。",
    unavailable: "カードを表示しましたが、グレード別エビデンスは一時的に利用できません。",
  },
};

function makeCard(id, prefix, index, setCode = index % 2 === 0 ? "SV3" : "SV2A") {
  const padded = String(index).padStart(4, "0");
  return {
    card_id: id,
    card_uid: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    regional_name: `${prefix} 日本語 ${padded}`,
    english_name: `${prefix} ${padded}`,
    set_code: setCode,
    card_number: `${padded}/9999`,
    language: "jp",
    misc_info: null,
    edition: null,
    foil_treatment: null,
    variant_attrs: [],
    image_url: null,
    rarity: "Common",
    is_cute: false,
    japan_exclusive_artwork: false,
    japan_exclusive_artwork_reason: null,
    japan_exclusive_artwork_evidence_url: null,
    japan_exclusive_stamps: false,
    japan_exclusive_stamps_reason: null,
    japan_exclusive_stamps_evidence_url: null,
  };
}

function makePool(idBase, prefix, count = 50, setCode) {
  return Array.from({ length: count }, (_, index) => makeCard(idBase + index, prefix, index + 1, setCode));
}

const defaultCards = makePool(1001, "Default Card", 100);
const pools = {
  set: makePool(2001, "Set Card", 50, "SV2A"),
  source: makePool(3001, "Source Card"),
  search: makePool(4001, "Search Card", 20),
  slow: makePool(5001, "Slow Card", 20),
  fast: makePool(6001, "Fast Card", 20),
  grade: makePool(7001, "Grade Card"),
  sort: makePool(8001, "Sort Card"),
};

function summary(card, grade = 0) {
  return {
    card_id: card.card_id,
    tier: grade > 0 ? -1 : 1,
    psa_grade: grade,
    best_buy_price: 100 + card.card_id,
    best_buy_currency: "USD",
    best_buy_symbol: "$",
    best_buy_location: "ebay",
    best_buy_region: "NA",
    best_buy_normalized: 100 + card.card_id,
    best_buy_kind: "sold",
    best_sell_price: 1000 + card.card_id,
    best_sell_currency: "JPY",
    best_sell_symbol: "¥",
    best_sell_location: "cardrush",
    best_sell_region: "JP",
    best_sell_normalized: 10 + card.card_id / 100,
    best_sell_kind: "ask",
    roi: card.card_id,
    best_opportunity_grade: 10,
    deal_net_usd: 20,
    deal_annualized: 0.2,
    raw_to_grade_ev_usd: 15,
    deal_relative_value_pct: 0.1,
    deal_updated_at: "2026-09-11T12:00:00Z",
    pokemon_card_definitions: card,
  };
}

function signal(cardId, grade, modelVersion) {
  return {
    card_id: cardId,
    psa_grade: grade,
    model_version: modelVersion,
    computed_at: modelVersion === "v2" ? "2026-09-11T12:00:00Z" : "2026-09-10T12:00:00Z",
    tier: "tier_1",
    best_jp_bid_jpy: 7000 + grade,
    best_jp_bid_location: 7,
    best_jp_bid_age_days: 1,
    band_p10: 9000 + grade,
    band_p25: 10000 + grade,
    band_p50: 11000 + grade,
    band_p75: 12000 + grade,
    last_sale_jpy: 10500 + grade,
    last_sale_at: "2026-09-10T12:00:00Z",
    trend_slope: 0,
    trend_direction: "flat",
    comp_count_recent: 4,
    comp_count_lifetime: 8,
    listing_count: 2,
    sell_through: 0.5,
    clearing_vs_ask: 0.9,
    days_to_exit_est: 20,
    cohort: cardId % 2 === 0 ? "set:SV3" : "set:SV2A",
    pop: 10,
    pop_velocity: 1,
    entry_at_default: 20,
    net_at_default: 10,
    annualized_at_default: 0.2,
    exit_platform: "ebay",
    raw_to_grade_ev_usd: 15,
    relative_value_pct: 0.1,
    recent_volatility: 0.05,
    slab_confidence: "high",
    flags: {},
  };
}

const profile = {
  platform: "ebay",
  fee_pct: 0.136,
  fixed_fee: 0.4,
  shipping_jpy: 1400,
  grading_cost_jpy: 3500,
  grading_days: 45,
  margin_pct: 0.15,
  floor_usd: 0,
  updated_at: "2026-09-11T12:00:00Z",
};
const rate = { rate: 0.0068, last_updated: "2026-09-11T12:00:00Z" };
const pageChangepoints = [
  { cohort: "set:SV2A", detected_on: "2026-09-10", direction: "up", magnitude: 0.1, event_title: "Fixture", unexplained: false },
  { cohort: "set:SV3", detected_on: "2026-09-10", direction: "down", magnitude: 0.1, event_title: "Fixture", unexplained: false },
];
const broadChangepoints = Array.from({ length: 1000 }, (_, index) => ({
  cohort: index < 2 ? pageChangepoints[index].cohort : `unrelated:${index}`,
  detected_on: "2026-09-10",
  direction: index % 2 === 0 ? "up" : "down",
  magnitude: 0.1,
  event_title: `Fixture annotation ${String(index).padStart(4, "0")} ${"x".repeat(96)}`,
  unexplained: false,
}));

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

function rangeFor(request, fallbackLength) {
  const url = new URL(request.url());
  const header = request.headers().range;
  const [headerStart, headerEnd] = header ? header.split("-").map(Number) : [0, fallbackLength - 1];
  const offset = Number(url.searchParams.get("offset") ?? headerStart) || 0;
  const limit = Number(url.searchParams.get("limit") ?? (headerEnd - headerStart + 1)) || fallbackLength;
  return { offset, limit };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function summarize(samples, field) {
  const values = samples.map((sample) => sample[field]);
  return {
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function firstName(cards, language) {
  const card = cards[0];
  return language === "en" ? card.english_name : card.regional_name;
}

function descendingFirstName(cards, language) {
  return firstName([cards[cards.length - 1]], language);
}

async function waitUntil(predicate, message, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(message);
}

async function waitUntilEnabled(locator, enabled, message, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await locator.isEnabled() === enabled) return;
    await sleep(20);
  }
  throw new Error(message);
}

async function assertNoOverflow(page, root, label) {
  const geometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  const rootBox = await root.boundingBox();
  assert(rootBox, `${label} root has no bounds`);
  assert(geometry.documentWidth <= geometry.viewportWidth + 1, `${label} document overflow: ${JSON.stringify(geometry)}`);
  assert(geometry.bodyWidth <= geometry.viewportWidth + 1, `${label} body overflow: ${JSON.stringify(geometry)}`);
  assert(rootBox.x >= -0.5 && rootBox.x + rootBox.width <= geometry.viewportWidth + 0.5, `${label} root escapes viewport: ${JSON.stringify(rootBox)}`);
  return { ...geometry, root: rootBox };
}

async function assertPhoneTarget(locator, label) {
  const box = await locator.boundingBox();
  assert(box, `${label} has no bounds`);
  assert(box.width >= 43.5 && box.height >= 43.5, `${label} is ${box.width}x${box.height}, below 44px`);
  return { label, ...box };
}

function hasDefinitionSearchTokens(url, tokens) {
  const filters = url.searchParams
    .getAll("pokemon_card_definitions.or")
    .map((filter) => filter.toLowerCase());
  return tokens.every((token) => filters.some((filter) => filter.includes(`.ilike.%${token.toLowerCase()}%`)));
}

function selectedCardsFor(url, table) {
  const decoded = decodeURIComponent(url.toString()).toLowerCase();
  if (hasDefinitionSearchTokens(url, ["no", "match"])) return { cards: [], total: 0, delay: 120, mode: "empty" };
  if (hasDefinitionSearchTokens(url, ["fast", "card"])) return { cards: pools.fast, total: 20, delay: 120, mode: "fast" };
  if (hasDefinitionSearchTokens(url, ["slow", "card"])) return { cards: pools.slow, total: 20, delay: 800, mode: "slow" };
  if (hasDefinitionSearchTokens(url, ["search", "card"])) return { cards: pools.search, total: 20, delay: 120, mode: "search" };
  if (decoded.includes("set_code=in.(sv2a)")) return { cards: pools.set, total: 550, delay: 120, mode: "set" };
  if (table === "pokemon_price_summaries_by_source_v") return { cards: pools.source, total: 550, delay: 120, mode: "source" };
  if (decoded.includes("tier=eq.-1") || decoded.includes("psa_grade=gt.0")) return { cards: pools.grade, total: 1100, delay: 120, mode: "grade", grade: 10 };
  if (decoded.includes("order=best_sell_normalized")) return { cards: pools.sort, total: 1100, delay: 120, mode: "sort", ascending: true };
  return { cards: defaultCards, total: 1100, delay: 120, mode: "default" };
}

async function runSample(browser, matrix, journey, sampleIndex, forceUnavailable = false) {
  const labels = copy[matrix.language];
  const context = await browser.newContext({ viewport: matrix.viewport, deviceScaleFactor: 1 });
  await context.addInitScript((language) => {
    localStorage.setItem("language", language);
    localStorage.setItem("displayCurrency", "none");
  }, matrix.language);

  const records = [];
  const unexpectedRequests = [];
  const externalRequests = [];
  let currentCardIds = [];
  let detailOpen = false;
  let releaseInitialEnrichment = null;
  const initialEnrichmentGate = expectedMode === "bounded" && journey === "default" && sampleIndex === 0
    ? new Promise((resolve) => { releaseInitialEnrichment = resolve; })
    : null;
  async function fulfill(route, body, {
    delay = 0,
    total = null,
    rangeOffset = 0,
    endpoint,
    kind = "support",
    requestedAt = Date.now(),
  } = {}) {
    const request = route.request();
    if (delay) await sleep(delay);
    const serialized = request.method() === "HEAD" ? "" : JSON.stringify(body);
    const headers = responseHeaders(total == null ? {} : {
      "content-range": Array.isArray(body) && body.length > 0
        ? `${rangeOffset}-${rangeOffset + body.length - 1}/${total}`
        : `*/${total}`,
    });
    try {
      await route.fulfill({ status: 200, headers, body: serialized });
      let requestBody = null;
      if (request.postData() != null) {
        try {
          requestBody = request.postDataJSON();
        } catch {
          requestBody = request.postData();
        }
      }
      records.push({
        endpoint,
        kind,
        method: request.method(),
        url: request.url(),
        requestedAt,
        bytes: Buffer.byteLength(serialized),
        completedAt: Date.now(),
        requestBody,
      });
    } catch (error) {
      if (!String(error).includes("Request is already handled") && !String(error).includes("Target page")) throw error;
    }
  }

  await context.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: responseHeaders(), body: "" });
      return;
    }
    if (url.pathname.startsWith("/auth/v1/")) {
      await route.fulfill({ status: 401, headers: responseHeaders(), body: JSON.stringify({ message: "fixture has no session" }) });
      return;
    }
    const endpoint = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
    if (url.pathname.includes("/rpc/")) {
      if (endpoint === "pokemon_card_browser_enrichment") {
        const requestedAt = Date.now();
        const body = request.postDataJSON();
        const ids = Array.isArray(body?.p_card_ids) ? body.p_card_ids.map(Number) : [];
        assert(ids.length > 0 && ids.length <= 100, `bounded RPC ids invalid: ${JSON.stringify(body)}`);
        assert(new Set(ids).size === ids.length, `bounded RPC ids are not unique: ${JSON.stringify(ids)}`);
        assert(isISODate(body?.p_changepoint_since), `bounded RPC cutoff invalid: ${JSON.stringify(body)}`);
        const transitionDelay = journey === "default" && sampleIndex === 0 ? 1500 : 430;
        if (initialEnrichmentGate) await initialEnrichmentGate;
        else await sleep(transitionDelay);
        if (forceUnavailable) {
          const serialized = JSON.stringify({ message: "function is unavailable in fixture" });
          await route.fulfill({ status: 404, headers: responseHeaders(), body: serialized });
          records.push({ endpoint, kind: "bounded", method: request.method(), url: request.url(), requestBody: body, requestedAt, bytes: Buffer.byteLength(serialized), completedAt: Date.now(), status: 404 });
          return;
        }
        const signals = ids.flatMap((id) => Array.from({ length: 11 }, (_, grade) => signal(id, grade, "v2")));
        await fulfill(route, {
          signals,
          exit_cost_profile: profile,
          exchange_rate: rate,
          changepoints: pageChangepoints,
        }, { endpoint, kind: "bounded", requestedAt });
        return;
      }
      if (["record_deal_opportunity_exposures", "card_refresh_targets"].includes(endpoint)) {
        await fulfill(route, [], { endpoint });
        return;
      }
      unexpectedRequests.push(`${request.method()} ${request.url()}`);
      await route.fulfill({ status: 500, headers: responseHeaders(), body: JSON.stringify({ message: "unexpected RPC" }) });
      return;
    }

    const { offset, limit } = rangeFor(request, 1000);
    if (endpoint === "pokemon_price_summaries_browser_v" || endpoint === "pokemon_price_summaries_by_source_v") {
      const selection = selectedCardsFor(url, endpoint);
      let selected = [...selection.cards];
      if (!selection.ascending) selected.reverse();
      const pageCards = selected.slice(offset, offset + limit);
      currentCardIds = pageCards.map((card) => card.card_id);
      await fulfill(route, pageCards.map((card) => summary(card, selection.grade ?? 0)), {
        delay: selection.delay,
        total: selection.total,
        rangeOffset: offset,
        endpoint,
        kind: "summary",
      });
      return;
    }
    if (endpoint === "pokemon_set_search_v") {
      await fulfill(route, [{ set_code: "SV2A" }], { endpoint });
      return;
    }
    if (endpoint === "pokemon_grade_signals") {
      const all = currentCardIds.flatMap((id) => Array.from({ length: 11 }, (_, grade) => [signal(id, grade, "v1"), signal(id, grade, "v2")]).flat());
      await fulfill(route, all.slice(offset, offset + limit), {
        delay: 430,
        total: all.length,
        rangeOffset: offset,
        endpoint,
        kind: detailOpen && expectedMode === "bounded" ? "detail" : "legacy",
      });
      return;
    }
    if (endpoint === "exit_cost_profiles") {
      await fulfill(route, [profile], {
        delay: 260,
        total: 1,
        endpoint,
        kind: detailOpen && expectedMode === "bounded" ? "detail" : "legacy",
      });
      return;
    }
    if (endpoint === "exchange_rates") {
      await fulfill(route, [rate], {
        delay: 220,
        total: 1,
        endpoint,
        kind: detailOpen && expectedMode === "bounded" ? "detail" : "legacy",
      });
      return;
    }
    if (endpoint === "cohort_changepoint_annotations_v") {
      await fulfill(route, broadChangepoints.slice(offset, offset + limit), {
        delay: 620,
        total: broadChangepoints.length,
        rangeOffset: offset,
        endpoint,
        kind: detailOpen && expectedMode === "bounded" ? "detail" : "legacy",
      });
      return;
    }
    if (endpoint === "conditions") {
      await fulfill(route, [{ condition_id: 1, tier: 1 }], { endpoint });
      return;
    }
    if (endpoint === "card_browser_source_options_v") {
      await fulfill(route, [{ source: "cardrush" }], { endpoint });
      return;
    }
    if ([
      "pokemon_external_identifiers", "inventory_holdings_v", "pokemon_lot_lines",
      "owned_inventory_counts_v", "trip_observations_v", "pokemon_tcgplayer_market",
      "pokemon_market_listings", "refresh_requests", "trips", "acquisition_lots",
      "market_events", "locations", "cardladder_slab_sales", "buylists",
      "inventory_theoretical_roi_v",
    ].includes(endpoint)) {
      await fulfill(route, [], { endpoint });
      return;
    }
    unexpectedRequests.push(`${request.method()} ${request.url()}`);
    await route.fulfill({ status: 500, headers: responseHeaders(), body: JSON.stringify({ message: "unexpected fixture request" }) });
  });
  await context.route("https://**/*", async (route) => {
    externalRequests.push(`${route.request().method()} ${route.request().url()}`);
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
    externalRequests.push(`${route.request().method()} ${route.request().url()}`);
    await route.abort("blockedbyclient");
  });

  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const responseStatuses = [];
  const requestEvents = [];
  const pendingRequests = new Map();
  const isLocalRequest = (url) => url.startsWith(appUrl) || url.startsWith("http://127.0.0.1:54321/");
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (!isLocalRequest(request.url())) return;
    const entry = { method: request.method(), url: request.url() };
    pendingRequests.set(request, entry);
    requestEvents.push({ phase: "started", ...entry });
  });
  page.on("requestfinished", (request) => {
    const entry = pendingRequests.get(request);
    if (!entry) return;
    pendingRequests.delete(request);
    requestEvents.push({ phase: "finished", ...entry });
  });
  page.on("requestfailed", (request) => {
    const entry = pendingRequests.get(request);
    if (!entry) return;
    pendingRequests.delete(request);
    requestEvents.push({ phase: "failed", ...entry, failure: request.failure()?.errorText ?? null });
  });
  page.on("response", (response) => {
    const url = response.url();
    if (isLocalRequest(url)) {
      responseStatuses.push({ method: response.request().method(), status: response.status(), url });
    }
  });

  async function captureFailure(error, phase) {
    const failureStem = `failure-${expectedMode}-${matrix.name}-${journey}-${sampleIndex + 1}-${phase}`;
    const screenshot = `${artifactRoot}/${failureStem}.png`;
    await page.screenshot({ path: `${artifactWriteRoot}/${failureStem}.png`, animations: "disabled", caret: "hide", fullPage: false }).catch(() => {});
    writeFileSync(`${artifactWriteRoot}/${failureStem}.json`, `${JSON.stringify({
      phase,
      expectedText,
      pageUrl: page.url(),
      bodyText: await page.locator("body").innerText().catch(() => ""),
      records,
      responseStatuses,
      requestEvents,
      pendingRequests: [...pendingRequests.values()],
      performanceResources: await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name,
        duration: entry.duration,
        initiatorType: entry.initiatorType,
        transferSize: "transferSize" in entry ? entry.transferSize : null,
      }))).catch(() => []),
      unexpectedRequests,
      externalRequests,
      pageErrors,
      consoleErrors,
      screenshot,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`);
  }

  const routeUrl = `${appUrl}/e2e/pokemon-variant-projection`;
  let startedAt;
  let expectedText;
  let action;
  if (journey === "default") {
    expectedText = descendingFirstName(defaultCards, matrix.language);
    action = async () => page.goto(routeUrl, { waitUntil: "domcontentloaded" });
  } else {
    await page.goto(routeUrl, { waitUntil: "domcontentloaded" });
    await page.getByText(descendingFirstName(defaultCards, matrix.language), { exact: true }).first().waitFor();
    if (journey === "set") {
      expectedText = descendingFirstName(pools.set, matrix.language);
      action = () => page.getByPlaceholder(labels.set).fill("SV2A");
    } else if (journey === "source") {
      expectedText = descendingFirstName(pools.source, matrix.language);
      action = async () => {
        if (matrix.viewport.width < 640) await page.getByRole("button", { name: labels.filters }).click();
        await page.getByRole("button", { name: labels.sourceAll }).click();
        await page.getByRole("menuitemradio", { name: "Cardrush" }).click();
      };
    } else if (journey === "text") {
      expectedText = descendingFirstName(pools.search, matrix.language);
      action = () => page.getByPlaceholder(labels.name).fill("Search Card");
    } else if (journey === "grade") {
      expectedText = descendingFirstName(pools.grade, matrix.language);
      action = () => page.getByRole("tab", { name: labels.psa, exact: true }).click();
    } else if (journey === "sort") {
      expectedText = firstName(pools.sort, matrix.language);
      action = async () => {
        if (matrix.viewport.width < 640) await page.getByRole("tab", { name: labels.list, exact: true }).click();
        await page.getByRole("button", { name: labels.sortBuy, exact: true }).click();
      };
    } else if (journey === "later") {
      expectedText = firstName([defaultCards[49]], matrix.language);
      action = () => page.getByRole("button", { name: labels.next, exact: true }).click();
    } else if (journey === "empty") {
      expectedText = labels.empty;
      action = () => page.getByPlaceholder(labels.name).fill("No Match");
    } else if (journey === "rapid") {
      expectedText = descendingFirstName(pools.fast, matrix.language);
      action = async () => {
        const input = page.getByPlaceholder(labels.name);
        await input.fill("Slow Card");
        await sleep(360);
        await input.fill("Fast Card");
      };
    } else {
      throw new Error(`unknown journey ${journey}`);
    }
  }

  startedAt = Date.now();
  await action();
  const expected = page.getByText(expectedText, { exact: true }).first();
  try {
    await expected.waitFor({ state: "visible", timeout: 20_000 });
  } catch (error) {
    await captureFailure(error, "expected-row");
    throw error;
  }
  const firstUsefulMS = Date.now() - startedAt;

  let detailDialog = null;
  let detailWatch = null;
  let detailTransition = null;
  let loadingObserved = false;
  if (expectedMode === "bounded" && journey === "default" && sampleIndex === 0) {
    try {
      const loadingStatus = page.getByText(labels.loading, { exact: true });
      await loadingStatus.waitFor({ state: "visible" });
      loadingObserved = true;
      detailOpen = true;
      const detailTrigger = expected.locator("xpath=ancestor::*[@role='button'][1]");
      await detailTrigger.click();
      detailDialog = page.getByRole("dialog").first();
      await detailDialog.waitFor({ state: "visible" });
      detailWatch = detailDialog.getByRole("button", { name: labels.watch, exact: true }).first();
      await detailWatch.waitFor({ state: "visible" });
      const loadingVisible = await loadingStatus.isVisible();
      const initialWatchDisabled = await detailWatch.isDisabled();
      detailTransition = { openedWhile: "loading", loadingVisible, initialWatchDisabled, finalStatus: null };
      assert(loadingVisible, `${matrix.name} loading status disappeared before the detail action check`);
      assert(initialWatchDisabled, `${matrix.name} detail Watch was enabled while enrichment loaded`);
    } catch (error) {
      await captureFailure(error, "detail-loading-action");
      throw error;
    }
    releaseInitialEnrichment?.();
  }

  if (expectedMode === "bounded" && journey !== "empty" && !forceUnavailable && !loadingObserved) {
    await page.getByText(labels.loading, { exact: true }).waitFor({ state: "visible" });
  }

  if (journey !== "empty") {
    if (expectedMode === "bounded") {
      await waitUntil(
        () => records.some((record) => record.kind === "bounded" && record.completedAt >= startedAt),
        `${matrix.name} ${journey} bounded enrichment did not complete`,
      );
    } else {
      for (const endpoint of ["pokemon_grade_signals", "exit_cost_profiles", "exchange_rates", "cohort_changepoint_annotations_v"]) {
        await waitUntil(
          () => records.some((record) => record.endpoint === endpoint && record.completedAt >= startedAt),
          `${matrix.name} ${journey} legacy ${endpoint} did not complete`,
        );
      }
    }
  }
  if (expectedMode === "bounded" && journey !== "empty") {
    if (forceUnavailable) {
      await page.getByText(labels.unavailable, { exact: true }).waitFor({ state: "visible" });
      assert(await expected.isVisible(), `${matrix.name} unavailable RPC hid summary cards`);
    } else {
      await page.getByText(labels.loading, { exact: true }).waitFor({ state: "hidden" });
      assert(await page.getByText(labels.unavailable, { exact: true }).count() === 0, `${matrix.name} marked successful enrichment unavailable`);
    }
  }
  if (detailDialog && detailWatch && detailTransition) {
    assert(await detailDialog.isVisible(), `${matrix.name} detail closed during enrichment replacement`);
    if (forceUnavailable) {
      await waitUntilEnabled(
        detailWatch,
        false,
        `${matrix.name} detail Watch enabled after unavailable enrichment`,
      );
      detailTransition.finalStatus = "unavailable";
    } else {
      await waitUntilEnabled(
        detailWatch,
        true,
        `${matrix.name} detail Watch stayed disabled after ready enrichment`,
      );
      detailTransition.finalStatus = "ready";
    }
    await page.keyboard.press("Escape");
    await detailDialog.waitFor({ state: "hidden" });
    detailOpen = false;
  }
  const sampleRecords = recordsStartedInSample(records, startedAt);
  const measuredRecords = sampleRecords.filter((record) => record.kind !== "detail");
  const summaryRecords = measuredRecords.filter((record) => record.kind === "summary");
  assert(summaryRecords.length >= 1, `${matrix.name} ${journey} captured no summary request`);
  const enrichmentRecords = measuredRecords.filter((record) => record.kind === (expectedMode === "bounded" ? "bounded" : "legacy"));
  const optionalCompleteMS = enrichmentRecords.length === 0
    ? firstUsefulMS
    : Math.max(...enrichmentRecords.map((record) => record.completedAt - startedAt));
  const summaryMS = Math.min(...summaryRecords.map((record) => record.completedAt - startedAt));

  const consoleEvidence = classifyConsoleEvidence({ forceUnavailable, consoleErrors, records: sampleRecords, responseStatuses });
  try {
    assert(
      consoleEvidence.hasExactUnavailableEvidence === forceUnavailable,
      `${matrix.name} ${journey} forced unavailable evidence mismatch: ${JSON.stringify(consoleEvidence)}`,
    );
    assert(unexpectedRequests.length === 0, `${matrix.name} ${journey} unexpected requests: ${JSON.stringify(unexpectedRequests)}`);
    assert(externalRequests.length === 0, `${matrix.name} ${journey} external requests: ${JSON.stringify(externalRequests)}`);
    assert(
      consoleEvidence.unexpectedConsoleErrors.length === 0,
      `${matrix.name} ${journey} unexpected console errors: ${consoleEvidence.unexpectedConsoleErrors.join(" | ")}`,
    );
    assert(pageErrors.length === 0, `${matrix.name} ${journey} page errors: ${pageErrors.join(" | ")}`);
  } catch (error) {
    await captureFailure(error, "terminal-invariants");
    throw error;
  }

  const root = page.getByTestId("fixture-production-browser");
  const geometry = await assertNoOverflow(page, root, `${matrix.name} ${journey}`);
  const phoneTargets = [];
  if (matrix.viewport.width < 640 && journey === "default" && sampleIndex === 0) {
    phoneTargets.push(await assertPhoneTarget(page.getByPlaceholder(labels.name), `${matrix.name} search`));
    phoneTargets.push(await assertPhoneTarget(page.getByRole("tab", { name: labels.grid, exact: true }), `${matrix.name} grid`));
    phoneTargets.push(await assertPhoneTarget(page.getByRole("tab", { name: labels.raw, exact: true }), `${matrix.name} raw`));
    phoneTargets.push(await assertPhoneTarget(page.getByRole("tab", { name: labels.psa, exact: true }), `${matrix.name} psa`));
    phoneTargets.push(await assertPhoneTarget(page.getByRole("button", { name: labels.next, exact: true }), `${matrix.name} next`));
  }
  let screenshot = null;
  if (sampleIndex === 0 && journey === "default") {
    screenshot = `${artifactRoot}/${expectedMode}-${matrix.name}-default.png`;
    await page.screenshot({ path: `${artifactWriteRoot}/${expectedMode}-${matrix.name}-default.png`, animations: "disabled", caret: "hide", fullPage: false });
  }

  const result = {
    journey,
    sample: sampleIndex + 1,
    summaryMS,
    firstUsefulMS,
    optionalCompleteMS,
    requestCount: measuredRecords.length,
    responseBytes: measuredRecords.reduce((total, record) => total + record.bytes, 0),
    enrichmentRequestCount: enrichmentRecords.length,
    enrichmentBytes: enrichmentRecords.reduce((total, record) => total + record.bytes, 0),
    summaryEndpoints: [...new Set(summaryRecords.map((record) => record.endpoint))],
    enrichmentEndpoints: [...new Set(enrichmentRecords.map((record) => record.endpoint))],
    summaryRequests: summaryRecords.map(({ method, url }) => ({ method, url })),
    enrichmentRequests: enrichmentRecords.map(({ method, url, requestBody }) => ({ method, url, requestBody })),
    geometry,
    phoneTargets,
    screenshot,
    detailTransition,
    pageErrors,
    consoleErrors,
    expectedConsoleErrors: consoleEvidence.expectedConsoleErrors,
    unexpectedConsoleErrors: consoleEvidence.unexpectedConsoleErrors,
    unavailableConsoleEvidence: {
      hasExactEvidence: consoleEvidence.hasExactUnavailableEvidence,
      recordCount: consoleEvidence.unavailableRecordCount,
      responseCount: consoleEvidence.unavailableResponseCount,
      messageCount: consoleEvidence.expectedMessageCount,
    },
    unexpectedRequests,
    externalRequests,
  };
  await context.close();
  return result;
}

const allMatrices = [
  { name: "desktop-1440x900-en", viewport: { width: 1440, height: 900 }, language: "en" },
  { name: "phone-390x844-en", viewport: { width: 390, height: 844 }, language: "en" },
  { name: "desktop-1440x900-ja", viewport: { width: 1440, height: 900 }, language: "ja" },
  { name: "phone-390x844-ja", viewport: { width: 390, height: 844 }, language: "ja" },
];
if (requestedMatrices.length > 0 && !diagnosticMode) {
  throw new Error("TCG_CARD_BROWSER_MATRICES is available only in diagnostic mode");
}
for (const matrix of requestedMatrices) {
  assert(allMatrices.some((candidate) => candidate.name === matrix), `unknown requested matrix ${matrix}`);
}
const matrices = requestedMatrices.length > 0
  ? allMatrices.filter((matrix) => requestedMatrices.includes(matrix.name))
  : allMatrices;
const allJourneys = ["default", "set", "source", "text", "grade", "sort", "later", "empty", "rapid"];
const journeys = requestedJourneys.length > 0 ? requestedJourneys : allJourneys;
for (const journey of journeys) {
  assert(allJourneys.includes(journey), `unknown requested journey ${journey}`);
}

const browser = await chromium.launch({ headless: false });
try {
  const results = [];
  for (const matrix of matrices) {
    for (const journey of journeys) {
      for (let sample = 0; sample < sampleCount; sample += 1) {
        results.push({ matrix: matrix.name, ...(await runSample(browser, matrix, journey, sample)) });
      }
    }
  }
  const observedModes = new Set(results.flatMap((result) => result.enrichmentEndpoints));
  if (expectedMode === "bounded" && !diagnosticMode) {
    assert(observedModes.has("pokemon_card_browser_enrichment"), "bounded run did not call the RPC");
    assert(!observedModes.has("pokemon_grade_signals"), "bounded run retained the direct signal fanout");
  } else {
    assert(observedModes.has("pokemon_grade_signals"), "legacy run did not call direct signals");
    assert(!observedModes.has("pokemon_card_browser_enrichment"), "legacy run unexpectedly called the bounded RPC");
  }

  const unavailable = [];
  if (expectedMode === "bounded") {
    for (const matrix of matrices) {
      const result = await runSample(browser, matrix, "default", 0, true);
      unavailable.push({ matrix: matrix.name, ...result });
    }
  }

  writeFileSync(`${artifactWriteRoot}/sample-results.json`, `${JSON.stringify({
    schemaVersion: 1,
    artifactRoot,
    expectedMode,
    sampleCount,
    matrices: matrices.map((matrix) => matrix.name),
    journeys,
    results,
    unavailable,
  }, null, 2)}\n`);

  const summaries = matrices.flatMap((matrix) => journeys.map((journey) => {
    const samples = results.filter((result) => result.matrix === matrix.name && result.journey === journey);
    return {
      matrix: matrix.name,
      journey,
      samples: samples.length,
      summaryMS: summarize(samples, "summaryMS"),
      firstUsefulMS: summarize(samples, "firstUsefulMS"),
      optionalCompleteMS: summarize(samples, "optionalCompleteMS"),
      requestCount: summarize(samples, "requestCount"),
      responseBytes: summarize(samples, "responseBytes"),
      enrichmentRequestCount: summarize(samples, "enrichmentRequestCount"),
      enrichmentBytes: summarize(samples, "enrichmentBytes"),
    };
  }));
  let comparison = null;
  if (expectedMode === "bounded" && baselineResultPath) {
    const baselineBytes = readFileSync(baselineResultPath);
    const baseline = JSON.parse(baselineBytes.toString("utf8"));
    assert(baseline.expectedMode === "legacy", "comparison baseline is not a legacy result");
    assert(baseline.sampleCount === sampleCount, "comparison baseline sample count differs");
    assert(JSON.stringify(baseline.journeys) === JSON.stringify(journeys), "comparison baseline journeys differ");
    const baselineKeys = baseline.summaries.map((summary) => `${summary.matrix}:${summary.journey}`);
    const currentKeys = summaries.map((summary) => `${summary.matrix}:${summary.journey}`);
    assert(JSON.stringify(baselineKeys) === JSON.stringify(currentKeys), "comparison baseline matrix or journey order differs");
    const baselineByKey = new Map(baseline.summaries.map((summary) => [`${summary.matrix}:${summary.journey}`, summary]));
    const metric = (before, after) => ({
      beforeMedian: before,
      afterMedian: after,
      delta: after - before,
      reductionPct: before === 0 ? null : Number((((before - after) / before) * 100).toFixed(2)),
    });
    const rows = summaries.map((after) => {
      const before = baselineByKey.get(`${after.matrix}:${after.journey}`);
      assert(before, `comparison baseline lacks ${after.matrix}:${after.journey}`);
      if (after.journey !== "empty") {
        assert(after.enrichmentRequestCount.median === 1, `${after.matrix} ${after.journey} did not use one bounded enrichment request`);
        assert(after.enrichmentRequestCount.median < before.enrichmentRequestCount.median, `${after.matrix} ${after.journey} did not reduce enrichment request count`);
        assert(after.enrichmentBytes.median < before.enrichmentBytes.median, `${after.matrix} ${after.journey} did not reduce enrichment bytes`);
      }
      return {
        matrix: after.matrix,
        journey: after.journey,
        summaryMS: metric(before.summaryMS.median, after.summaryMS.median),
        firstUsefulMS: metric(before.firstUsefulMS.median, after.firstUsefulMS.median),
        optionalCompleteMS: metric(before.optionalCompleteMS.median, after.optionalCompleteMS.median),
        requestCount: metric(before.requestCount.median, after.requestCount.median),
        responseBytes: metric(before.responseBytes.median, after.responseBytes.median),
        enrichmentRequestCount: metric(before.enrichmentRequestCount.median, after.enrichmentRequestCount.median),
        enrichmentBytes: metric(before.enrichmentBytes.median, after.enrichmentBytes.median),
      };
    });
    comparison = {
      baselineResult: baselineResultPath,
      baselineSha256: createHash("sha256").update(baselineBytes).digest("hex"),
      conditions: "controlled localhost fixture timings; concurrent host load must be disclosed separately",
      rows,
    };
  }
  const evidence = {
    schemaVersion: 1,
    artifactRoot,
    route: "/e2e/pokemon-variant-projection",
    expectedMode,
    fixtureOnly: true,
    productionComponent: "CardBrowser",
    browserMode: "headed-xvfb",
    viewports: matrices.map((matrix) => matrix.viewport),
    languages: [...new Set(matrices.map((matrix) => matrix.language))],
    sampleCount,
    diagnosticMode,
    journeys,
    assertions: [
      "real CardBrowser summary request parameters and response shapes are retained",
      "summary, first useful card, and optional enrichment completion are timed separately",
      "latest-model signal payloads retain card, grade, JP bid, profile, FX, and page-cohort evidence",
      "a detail opened during enrichment stays open and its Watch action follows ready or unavailable row replacement",
      "rapid filter replacement leaves only the final requested cards visible",
      "phone controls are at least 44 by 44 pixels and production content stays inside the viewport",
      "no unexpected database surface or external HTTP or HTTPS request is permitted",
    ],
    comparison,
    summaries,
    results,
    unavailable,
  };
  writeFileSync(`${artifactWriteRoot}/result.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ expectedMode, artifactRoot, summaries }, null, 2)}\n`);
} finally {
  await browser.close();
}

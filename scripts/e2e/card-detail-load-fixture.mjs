import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { assertNoPageOverflow } from "./financial-integrity-browser-helpers.mjs";

const appUrl = process.env.APP_URL;
const artifactRoot = process.env.E2E_ARTIFACT_ROOT;
if (!appUrl || new URL(appUrl).hostname !== "127.0.0.1" || !artifactRoot) throw new Error("Loopback APP_URL and E2E_ARTIFACT_ROOT required");
mkdirSync(artifactRoot, { recursive: true });
const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "apikey, authorization, content-type, prefer, range, x-client-info", "access-control-allow-methods": "GET, HEAD, OPTIONS, POST", "content-type": "application/json" };
const currentLocations = [{ location_id: 1, name: "Current shop", market_region: "JP" }];
const emptyTables = new Set(["buylists", "trips", "acquisition_lots", "pokemon_grade_signals", "cardladder_slab_sales", "market_events", "inventory_theoretical_roi_v"]);
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}
const results = [];
const browser = await chromium.launch({ headless: process.env.E2E_HEADED !== "1" });
let page;
let diagnostics;
try {
  for (const [label, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    page = await context.newPage();
    const exposures = [], unexpected = [], errors = [], requests = [];
    diagnostics = { label, exposures, unexpected, errors, requests };
    page.on("pageerror", (error) => errors.push(error.message));
    let locationCount = 0, releaseRefresh, releaseB;
    let heldRefreshResolve, heldBResolve;
    const heldRefresh = new Promise((resolve) => { heldRefreshResolve = resolve; });
    const heldB = new Promise((resolve) => { heldBResolve = resolve; });
    await context.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(appUrl).origin) return route.continue();
      if (url.origin !== "http://127.0.0.1:54321" || !url.pathname.startsWith("/rest/v1/")) {
        unexpected.push(request.url()); return route.abort();
      }
      const respond = (data) => route.fulfill({ status: 200, headers, body: JSON.stringify(data) });
      if (request.method() === "OPTIONS") return respond({});
      const table = url.pathname.slice("/rest/v1/".length);
      requests.push({ table, method: request.method(), query: url.search });
      if (table === "rpc/record_deal_opportunity_exposures" && request.method() === "POST") {
        exposures.push(...request.postDataJSON().p_exposures); return respond(null);
      }
      if (request.method() !== "GET") { unexpected.push(`${request.method()} ${table}`); return route.abort(); }
      const id = Number((url.searchParams.get("card_id") ?? "eq.0").replace("eq.", ""));
      const single = request.headers().accept?.includes("object");
      if (table === "locations") {
        locationCount += 1;
        if (locationCount === 2) {
          releaseRefresh = () => respond([...currentLocations, { location_id: 9, name: "Old shop", market_region: "JP" }]);
          heldRefreshResolve(); return;
        }
        return respond(currentLocations);
      }
      if (table === "exchange_rates") return respond(single ? { rate: 0.0067 } : [{ from_currency: "USD", to_currency: "USD", rate: 1 }, { from_currency: "JPY", to_currency: "USD", rate: 0.0067 }]);
      if (table === "conditions") return respond([{ condition_id: 1, tier: 1, code: "NM", standard: "tcgplayer" }]);
      if (table === "pokemon_tcgplayer_market") return respond(single ? { market_usd: 30 } : [{ market_usd: 30 }]);
      if (table === "exit_cost_profiles") return respond(single ? null : []);
      if (table === "pokemon_market_listings") {
        const rows = [{ card_id: id, price_type: "Sell", price_kind: "ask", price: id, currency: "USD", currencies: { symbol: "$" }, psa_grade: 0, condition: 1, location_id: id === 11 ? 9 : 1, listing_url: `https://example.test/card/${id}`, last_updated: "2026-11-19T01:00:00Z" }];
        if (id === 22 && !releaseB) { releaseB = () => respond(rows); heldBResolve(); return; }
        return respond(rows);
      }
      if (table === "inventory_holdings_v") return respond([{ condition_id: 1, psa_grade: 0, qty_on_hand: id }]);
      if (table === "owned_inventory_counts_v") return respond([{ qty_incoming: id }]);
      if (table === "pokemon_lot_lines") return respond([{ line_id: id * 100, quantity: 2, qty_remaining: 2, consigned_qty: 0, allocated_cost_usd: 20, direct_purchase_cost_usd: 10, acquisition_lots: { shop_label: `Owned source ${id}`, acquired_at: "2026-11-01", leg: "import", trips: null } }]);
      if (table === "trip_observations_v") return respond([{ sighting_id: id, psa_grade: 0, store_name: `Observed source ${id}`, observed_price: id, currency: "USD", price_usd: id, observed_at: "2026-11-01", trip_name: null }]);
      if (emptyTables.has(table)) return respond([]);
      unexpected.push(`GET ${table}`); return route.abort();
    });
    await page.goto(`${appUrl}/e2e/card-detail-load`);
    await page.getByRole("button", { name: "Open Card 11", exact: true }).click();
    await bounded(heldRefresh, "A metadata refresh");
    assert.deepEqual(exposures, [], "Card11 must still be awaiting its held metadata refresh");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Open Card 22", exact: true }).click();
    await bounded(heldB, "B listing request");
    const refreshResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/rest/v1/locations");
    await releaseRefresh();
    await (await refreshResponse).finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await dialog.evaluate(async (node) => { await Promise.all(node.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => undefined))); });
    assert.equal(await dialog.getByRole("tablist").count(), 0, "old metadata must not clear the new card's loading state");
    assert.equal(await dialog.getByText(/Owned source 11|Observed source 11/).count(), 0, "old history must not appear under Card22");
    assert.deepEqual(exposures, [], "obsolete card load must not record exposure");
    await page.screenshot({ path: `${artifactRoot}/${label}-pending.png`, fullPage: true });
    const exposureResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/rest/v1/rpc/record_deal_opportunity_exposures");
    await releaseB();
    await (await exposureResponse).finished();
    await dialog.getByRole("link", { name: "Current shop", exact: true }).waitFor();
    assert.deepEqual(exposures.map((row) => row.card_id), [22]);
    assert.equal(exposures[0].source_name, "Current shop");
    assert.equal(exposures[0].entry_price, 22);
    assert.equal(exposures[0].entry_currency, "USD");
    assert.equal(await dialog.getByText(/Owned source 11|Observed source 11/).count(), 0);
    await assertNoPageOverflow(page, `${label} current card`);
    await page.screenshot({ path: `${artifactRoot}/${label}-loaded.png`, fullPage: true });
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    results.push({ label, width, height, exposures, result: "PASS" });
    await context.close();
  }
  writeFileSync(`${artifactRoot}/results.json`, JSON.stringify({ transport: "mocked", results }, null, 2));
  console.log(`PASS: ${results.length} real card-detail browser journeys; all Supabase requests intercepted`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: `${artifactRoot}/failure.png`, fullPage: true });
    writeFileSync(`${artifactRoot}/failure.html`, await page.content());
  }
  writeFileSync(`${artifactRoot}/failure.json`, JSON.stringify({ error: String(error), diagnostics }, null, 2));
  throw error;
} finally { await browser.close(); }

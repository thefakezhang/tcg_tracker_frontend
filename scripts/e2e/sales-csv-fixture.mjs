import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { assertNoPageOverflow, assertTapTarget } from "./financial-integrity-browser-helpers.mjs";

const appUrl = process.env.APP_URL;
const artifactRoot = process.env.E2E_ARTIFACT_ROOT;
if (!appUrl || !artifactRoot || new URL(appUrl).hostname !== "127.0.0.1") {
  throw new Error("Loopback APP_URL and E2E_ARTIFACT_ROOT are required");
}
mkdirSync(artifactRoot, { recursive: true });

const csv = "Quantity,Name,Set,Card Number,Condition,Printing,Price\n2,Charizard,BASE,4/102,NM,Holofoil,$12.50\n3,Lightning Bolt,M11,156,NM,Normal,$4.25";
const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "apikey, authorization, content-type, prefer, range, x-client-info",
  "access-control-allow-methods": "GET, HEAD, OPTIONS, POST",
  "content-type": "application/json",
};

function holding(game, leg) {
  return {
    game, leg, item_type: "single", card_id: 1, product_id: null,
    name: game === "pokemon" ? "Charizard" : "Lightning Bolt",
    set_code: game === "pokemon" ? "BASE" : "M11",
    card_number: game === "pokemon" ? "4/102" : "156",
    misc_info: null, variant_label: null, condition_id: 1, psa_grade: 0,
    sealed_condition: null, variant_edition: null, qty_on_hand: game === "pokemon" ? 3 : 4,
    avg_cost_usd: 10, total_cost_usd: game === "pokemon" ? 90 : 40,
  };
}

async function settleAnimations(locator) {
  await locator.evaluate(async (node) => {
    await Promise.all(node.getAnimations({ subtree: true }).map((animation) =>
      animation.finished.catch(() => undefined)));
  });
}

const browser = await chromium.launch({ headless: process.env.E2E_HEADED !== "1" });
const results = [];
let activePage;
let diagnostics;
try {
  for (const [label, width, height, secondLeg] of [
    ["desktop-export", 1440, 900, "export"],
    ["phone-mixed", 390, 844, "import"],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    activePage = page;
    const errors = [];
    const unexpected = [];
    const mutations = [];
    const requests = [];
    diagnostics = { label, errors, unexpected, mutations, requests };
    const holdings = [holding("pokemon", "export"), holding("mtg", secondLeg)];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === new URL(appUrl).origin) return route.continue();
      const respond = (body) => route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
      if (url.origin !== "http://127.0.0.1:54321" || !url.pathname.startsWith("/rest/v1/")) {
        unexpected.push(request.url());
        return route.abort();
      }
      if (request.method() === "OPTIONS") return respond({});
      const table = url.pathname.slice("/rest/v1/".length);
      requests.push({ method: request.method(), table, query: url.search });
      if (table === "rpc/record_lot_sale" && request.method() === "POST") {
        mutations.push(request.postDataJSON());
        return respond([{ sale_group: 91 }]);
      }
      const rows = {
        inventory_holdings_v: holdings,
        pokemon_card_definitions: [{ card_id: 1, english_name: "Charizard", image_url: null }],
        mtg_card_definitions_v: [{ card_id: 1, image_url: null }],
        exchange_rates: [{ from_currency: "JPY", to_currency: "USD", rate: 0.0067 }],
        customers: [], sales_ledger_v: [],
      }[table];
      if (request.method() !== "GET" || !rows) {
        unexpected.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? rows.length);
      return respond(rows.slice(offset, offset + limit));
    });

    await page.goto(`${appUrl}/e2e/sales-csv`);
    await page.getByText(/Charizard/).first().waitFor();
    const trigger = page.getByRole("button", { name: "Import TCGplayer CSV" });
    await trigger.click();
    const importer = page.getByRole("dialog", { name: "Stage a sell lot from a TCGplayer CSV" });
    await importer.waitFor({ timeout: 5_000 });
    await importer.getByLabel("Import TCGplayer CSV").setInputFiles({
      name: "collection.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
    });
    await importer.getByText("2 matched", { exact: true }).waitFor();
    const included = importer.getByRole("checkbox", { name: "CSV row: Charizard" });
    const beforeAnimation = await included.locator("..").boundingBox();
    await settleAnimations(importer);
    const afterAnimation = await included.locator("..").boundingBox();
    if (width === 390) await assertTapTarget(included.locator(".."), "CSV row selection");
    await included.focus();
    await page.keyboard.press("Space");
    await importer.getByRole("button", { name: "Stage 1 for review" }).waitFor();
    await page.keyboard.press("Space");
    const quantityHeader = importer.getByRole("columnheader", { name: "Quantity", exact: true });
    assert(await quantityHeader.evaluate((node) => node.scrollWidth <= node.clientWidth), "quantity header must not collide with price");
    assert.equal(mutations.length, 0, "preview must not record a sale");
    await assertNoPageOverflow(page, `${label} preview`);
    await page.screenshot({ path: `${artifactRoot}/${label}-preview.png`, fullPage: true });
    const stage = importer.getByRole("button", { name: "Stage 2 for review" });
    if (width === 390) await assertTapTarget(stage, "CSV stage");
    await stage.focus();
    await page.keyboard.press("Enter");
    const sale = page.getByRole("dialog", { name: "Sell 2 items as a lot" });
    await sale.waitFor();
    await settleAnimations(sale);
    const field = (name) => sale.getByText(name, { exact: true }).locator("..").locator("input");
    assert.equal(await field("Currency").inputValue(), "USD");
    assert.equal(await field("Total proceeds (USD)").inputValue(), "37.75");
    await field("Shared sale expense (USD)").fill("2.25");
    await sale.getByLabel("Item expense (USD)", { exact: true }).first().fill("1.50");
    assert.equal(mutations.length, 0, "staging must not record a sale");
    await assertNoPageOverflow(page, `${label} staged sale`);
    await page.screenshot({ path: `${artifactRoot}/${label}-staged.png`, fullPage: true });
    await sale.getByRole("button", { name: "Record sale" }).click();
    await sale.waitFor({ state: "hidden" });
    assert.equal(mutations.length, 1, "one explicit confirmation records one sale");
    const payload = mutations[0];
    assert.equal(payload.p_orig_currency, null);
    assert.equal(payload.p_fx_rate, 1);
    assert.equal(payload.p_gross_total, 37.75);
    assert.equal(payload.p_allocation_method, "explicit_prices");
    assert.deepEqual(payload.p_items.map(({ game, quantity, explicit_gross }) => ({ game, quantity, explicit_gross })), [
      { game: "pokemon", quantity: 2, explicit_gross: 25 },
      { game: "mtg", quantity: 3, explicit_gross: 12.75 },
    ]);
    assert.deepEqual(payload.p_sale_expenses, [
      { category: "platform_fee", amount_orig: 2.25, orig_currency: "USD", fx_rate_used: 1 },
      { item_index: 1, category: "shipping", amount_orig: 1.5, orig_currency: "USD", fx_rate_used: 1 },
    ]);
    assert.deepEqual(errors, [], "browser errors");
    assert.deepEqual(unexpected, [], "unexpected or external requests");
    results.push({ label, viewport: { width, height }, rowTarget: { beforeAnimation, afterAnimation }, mutations, result: "PASS" });
    await context.close();
  }
  writeFileSync(`${artifactRoot}/results.json`, JSON.stringify({ transport: "mocked", results }, null, 2));
  console.log(`PASS: ${results.length} Sales CSV browser journeys; all Supabase requests intercepted`);
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${artifactRoot}/failure.png`, fullPage: true });
    writeFileSync(`${artifactRoot}/failure.html`, await activePage.content());
  }
  writeFileSync(`${artifactRoot}/failure.json`, JSON.stringify({ error: String(error), diagnostics }, null, 2));
  throw error;
} finally {
  await browser.close();
}

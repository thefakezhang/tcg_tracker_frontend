import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { assertNoPageOverflow } from "./financial-integrity-browser-helpers.mjs";

const appUrl = process.env.APP_URL, artifactRoot = process.env.E2E_ARTIFACT_ROOT;
if (!appUrl || new URL(appUrl).hostname !== "127.0.0.1" || !artifactRoot) throw new Error("Loopback APP_URL and E2E_ARTIFACT_ROOT required");
mkdirSync(artifactRoot, { recursive: true });
const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "apikey, authorization, content-type, prefer, range, x-client-info", "access-control-allow-methods": "GET, HEAD, OPTIONS, POST", "content-type": "application/json" };
const emptyTables = new Set(["buylists", "trips", "acquisition_lots", "pokemon_grade_signals", "cardladder_slab_sales", "market_events", "inventory_theoretical_roi_v"]);
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 10000); })]); }
  finally { clearTimeout(timer); }
}
const results = [], browser = await chromium.launch({ headless: process.env.E2E_HEADED !== "1" });
let page, diagnostics;
try {
  for (const [viewport, width, height] of [["desktop",1440,900],["phone",390,844]]) {
    for (const transition of ["switch","reopen"]) {
      const label = `${viewport}-${transition}`;
      const context = await browser.newContext({ viewport: { width, height } });
      page = await context.newPage();
      const sales = [], exposures = [], unexpected = [], errors = [], requests = [];
      const holdingReads = new Map();
      const writeStarted = deferred(), inventoryRefreshed = deferred();
      let releaseSale, waitingForRefresh;
      diagnostics = { label, sales, exposures, unexpected, errors, requests };
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("**/*", async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === new URL(appUrl).origin) return route.continue();
        if (url.origin !== "http://127.0.0.1:54321" || !url.pathname.startsWith("/rest/v1/")) { unexpected.push(request.url()); return route.abort(); }
        const respond = (data) => route.fulfill({ status: 200, headers, body: JSON.stringify(data) });
        if (request.method() === "OPTIONS") return respond({});
        const table = url.pathname.slice("/rest/v1/".length);
        requests.push({ table, method: request.method(), query: url.search });
        if (table === "rpc/record_deal_opportunity_exposures" && request.method() === "POST") { exposures.push(...request.postDataJSON().p_exposures); return respond(null); }
        if (table === "rpc/record_line_sale" && request.method() === "POST") {
          sales.push(request.postDataJSON());
          releaseSale = () => respond([{ margin_usd: 7.89 }]);
          writeStarted.resolve(); return;
        }
        if (request.method() !== "GET") { unexpected.push(`${request.method()} ${table}`); return route.abort(); }
        const id = Number((url.searchParams.get("card_id") ?? "eq.0").replace("eq.", ""));
        if (table === "locations") return respond([{ location_id:1, name:"Current shop", market_region:"JP" }]);
        if (table === "exchange_rates") return respond(url.searchParams.get("select")?.includes("from_currency") ? [{ from_currency:"USD",to_currency:"USD",rate:1 },{ from_currency:"JPY",to_currency:"USD",rate:0.0067 }] : [{ rate:0.0067,last_updated:"2026-11-19T00:00:00Z" }]);
        if (table === "conditions") return respond([{ condition_id:1,tier:1,code:"NM",standard:"tcgplayer" }]);
        if (table === "pokemon_tcgplayer_market") return respond([{ market_usd:30 }]);
        if (table === "exit_cost_profiles") return respond([]);
        if (table === "pokemon_market_listings") return respond([{ card_id:id,price_type:"Sell",price_kind:"ask",price:24.75,currency:"USD",currencies:{symbol:"$"},psa_grade:0,condition:1,location_id:1,listing_url:`https://example.test/card/${id}`,last_updated:"2026-11-19T01:00:00Z" }]);
        if (table === "inventory_holdings_v") {
          const count = (holdingReads.get(id) ?? 0) + 1; holdingReads.set(id,count);
          if (waitingForRefresh?.id === id && count > waitingForRefresh.after) inventoryRefreshed.resolve();
          return respond([{ condition_id:1,psa_grade:0,qty_on_hand:2 }]);
        }
        if (table === "owned_inventory_counts_v") return respond([{ qty_incoming:0 }]);
        if (table === "pokemon_lot_lines") return respond([{ line_id:id*100,quantity:2,qty_remaining:2,consigned_qty:0,allocated_cost_usd:20,direct_purchase_cost_usd:10,acquisition_lots:{shop_label:`Owned source ${id}`,acquired_at:"2026-11-01",leg:"import",trips:null} }]);
        if (table === "trip_observations_v" || emptyTables.has(table)) return respond([]);
        unexpected.push(`GET ${table}`); return route.abort();
      });
      await page.goto(`${appUrl}/e2e/card-detail-load`);
      await page.getByRole("button",{name:"Open Card 11",exact:true}).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("link",{name:"Current shop",exact:true}).waitFor();
      await dialog.getByRole("button",{name:"Sell",exact:true}).click();
      await dialog.getByLabel("Proceeds",{exact:true}).fill("24.75");
      await dialog.getByRole("button",{name:"Record sale",exact:true}).click();
      await bounded(writeStarted.promise,"sale request");
      const original = sales[0];
      assert.equal(original.p_lot_line_id,1100); assert.equal(original.p_game,"pokemon");
      assert.equal(original.p_gross_usd,24.75); assert.equal(original.p_proceeds_orig,24.75);
      assert.equal(original.p_orig_currency,"USD"); assert.equal(original.p_fx_rate,1); assert.equal(original.p_fees_usd,0);
      await dialog.getByRole("button",{name:"Close",exact:true}).click();
      await dialog.waitFor({state:"hidden"});
      const target = transition === "switch" ? 22 : 11;
      await page.getByRole("button",{name:`Open Card ${target}`,exact:true}).click();
      await dialog.getByRole("link",{name:"Current shop",exact:true}).waitFor();
      assert.equal(await dialog.getByRole("button",{name:"Sell",exact:true}).isDisabled(),true,"pending sale must stay locked across openings");
      assert.equal(sales.length,1,"reopening must not create a second sale");
      assert.equal(await dialog.getByLabel("Proceeds",{exact:true}).count(),0,"the old opening's form must not reappear");
      waitingForRefresh = { id:target,after:holdingReads.get(target) };
      await releaseSale();
      await bounded(inventoryRefreshed.promise,"global inventory refresh after the successful old write");
      await dialog.getByRole("link",{name:"Current shop",exact:true}).waitFor();
      assert.equal(await dialog.getByRole("status").count(),0,"old sale success must not appear in the new opening");
      assert.equal(await dialog.getByRole("alert").count(),0);
      assert.equal(await dialog.getByRole("button",{name:"Sell",exact:true}).isEnabled(),true,"mutation lock must release after settlement");
      assert.equal(sales.length,1); assert.equal(sales[0],original);
      await dialog.evaluate(async (node) => { await Promise.all(node.getAnimations({subtree:true}).filter((a)=>a.effect?.getTiming().iterations!==Infinity).map((a)=>a.finished.catch(()=>undefined))); });
      await assertNoPageOverflow(page,label);
      await page.screenshot({path:`${artifactRoot}/${label}.png`,fullPage:true});
      assert.deepEqual(unexpected,[]); assert.deepEqual(errors,[]);
      results.push({label,viewport:{width,height},sale:original,inventoryRefreshObserved:true,result:"PASS"});
      await context.close();
    }
  }
  writeFileSync(`${artifactRoot}/results.json`,JSON.stringify({transport:"mocked",results},null,2));
  console.log(`PASS: ${results.length} quick-sale feedback browser journeys; all writes intercepted`);
} catch(error) {
  if(page&&!page.isClosed()) { await page.screenshot({path:`${artifactRoot}/failure.png`,fullPage:true}); writeFileSync(`${artifactRoot}/failure.html`,await page.content()); }
  writeFileSync(`${artifactRoot}/failure.json`,JSON.stringify({error:String(error),diagnostics},null,2)); throw error;
} finally { await browser.close(); }

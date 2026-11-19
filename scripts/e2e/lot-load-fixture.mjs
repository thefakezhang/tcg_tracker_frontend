import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { firefox } from "playwright";

const appUrl = process.env.APP_URL;
const artifacts = process.env.E2E_ARTIFACT_ROOT;
assert(appUrl && artifacts, "APP_URL and E2E_ARTIFACT_ROOT are required");
assert.equal(new URL(appUrl).hostname, "127.0.0.1");
mkdirSync(artifacts, { recursive: true });
const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "content-type": "application/json",
};
const browser = await firefox.launch({ headless: true });
const results = [];
try {
  for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    let draftA = false;
    const pauses = [];
    function delayNext(lotId, cardId = lotId * 100) {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      const pause = { lotId, cardId, promise, release, started: false };
      pauses.push(pause);
      return pause;
    }
    const old = delayNext(1);
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === appUrl) return route.continue();
      assert.equal(url.origin, "http://127.0.0.1:54321", `Unexpected external request: ${url.origin}`);
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      assert.equal(route.request().method(), "GET", "Browser acceptance must not mutate data");
      const table = url.pathname.split("/").at(-1);
      const lotId = Number(url.searchParams.get("lot_id")?.replace("eq.", ""));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      requests.push({ table, lotId, offset });
      let rows = [];
      if (table === "acquisition_lots") rows = [2, 1].map((id) => ({
        lot_id: id, leg: "import", acquired_at: "2026-01-01", shop_label: `Lot ${id === 1 ? "A" : "B"}`,
        orig_currency: "USD", total_cost_orig: id * 100, total_cost_usd: id * 100, fx_rate_used: 1, lines_imported: !(draftA && id === 1),
      }));
      if (table === "conditions") rows = [{ condition_id: 1, code: "NM", display_name: "Near Mint" }];
      if (table === "pokemon_lot_lines") {
        const pause = pauses.find((entry) => entry.lotId === lotId && !entry.started && offset === 0);
        if (pause) { pause.started = true; await pause.promise; }
        const cardId = pause?.cardId ?? lotId * 100;
        rows = [{ line_id: cardId, card_id: cardId, condition_id: 1, psa_grade: 0,
          quantity: 2, allocated_cost_usd: 20, direct_purchase_cost_usd: 20, acquisition_cost_alloc_usd: 0,
          qty_remaining: draftA && lotId === 1 ? null : 1, price_override_usd: 10 }];
      }
      if (table === "pokemon_card_definitions") {
        const filter = url.searchParams.get("card_id") ?? "";
        const id = filter.includes("900") ? 9 : filter.includes("100") ? 1 : 2;
        rows = [{ card_id: id * 100, regional_name: id === 9 ? "Obsolete card" : `Card ${id === 1 ? "A" : "B"}`, english_name: null,
          set_code: "TEST", card_number: String(id), image_url: null }];
      }
      if (table === "acquisition_costs") rows = [{ cost_id: lotId, category: "shipping", amount_orig: lotId * 11,
        amount_usd: lotId * 11, orig_currency: "USD", fx_rate_used: 1, note: `Cost ${lotId === 1 ? "A" : "B"}` }];
      if (table === "inventory_theoretical_roi_v" && lotId && !(draftA && lotId === 1)) rows = [{ line_key: `pokemon:${lotId * 100}`,
        lot_id: lotId, game: "pokemon", qty_on_hand: 1, priced: true, on_hand_cost_usd: 20,
        exit_net_usd: lotId * 1111, exit_unit_usd: lotId * 1111, theoretical_roi_pct: 10, net_pct: 1 }];
      if (table === "inventory_economics_v" && !(draftA && lotId === 1)) rows = [{ line_key: `pokemon:${lotId * 100}`, qty_sold: 1,
        gross_usd: lotId * 3333, profit_usd: 10 }];
      await route.fulfill({ headers, body: JSON.stringify(offset > 0 ? [] : rows) });
    });
    await page.goto(`${appUrl}/e2e/lot-load`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.startsWith("Lot B")));
    while (!old.started) await page.waitForTimeout(20);
    await page.getByRole("button", { name: /^Lot B USD/ }).click();
    await page.getByText(/^Card B/).waitFor();
    await page.getByText("Cost B", { exact: true }).waitFor();
    old.release();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${artifacts}/${name}-after-late-response.png`, fullPage: true });
    const body = await page.locator("body").innerText();
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    results.push({ viewport: name, requests, errors, dimensions, body });
    writeFileSync(`${artifacts}/results.json`, JSON.stringify(results, null, 2));
    assert(!body.includes("Card A"), "Late lot A lines replaced lot B in the real component");
    assert(!body.includes("Cost A"), "Late lot A cost replaced lot B");
    assert(!body.includes("$1,111.00"), "Late lot A ROI replaced lot B");
    assert(body.includes("Card B") && body.includes("$2,222.00") && body.includes("$6,666.00"), "Current lot B snapshot disappeared");
    assert(dimensions.scroll <= dimensions.width + 1, "Lot view overflows the viewport");
    assert.deepEqual(errors, []);
    const button = await page.getByRole("button", { name: /^Lot A USD/ }).boundingBox();
    assert(button && button.height >= 44 && button.width >= 44, "Lot selector must retain phone tap targets");
    const firstVisit = delayNext(1, 900);
    const selectA = page.getByRole("button", { name: /^Lot A USD/ });
    await selectA.focus();
    await selectA.press("Enter");
    while (!firstVisit.started) await page.waitForTimeout(20);
    await page.getByRole("button", { name: /^Lot B USD/ }).click();
    await page.getByText(/^Card B/).waitFor();
    await selectA.click();
    await page.getByText(/^Card A/).waitFor();
    firstVisit.release();
    await page.waitForTimeout(200);
    assert.equal(await page.getByText(/^Obsolete card/).count(), 0, "First A visit replaced the second A visit");
    await page.getByText(/^Card A/).waitFor();

    const closing = delayNext(2);
    await page.getByRole("button", { name: /^Lot B USD/ }).click();
    while (!closing.started) await page.waitForTimeout(20);
    await page.getByRole("button", { name: "Close lots", exact: true }).click();
    const countAtClose = requests.length;
    closing.release();
    await page.waitForTimeout(200);
    assert.equal(requests.length, countAtClose, "Closed lot started downstream requests");
    assert.equal(await page.getByText(/^Card [AB]/).count(), 0);
    assert.deepEqual(errors, []);
    draftA = true;
    await page.getByRole("button", { name: "Open lots", exact: true }).click();
    await page.getByText(/^Card A/).waitFor();
    const costNote = page.getByLabel("Note", { exact: true });
    const costRow = costNote.locator("..").locator("..");
    const amount = costRow.getByRole("spinbutton", { name: "Amount", exact: true });
    const currency = costRow.getByRole("textbox", { name: "Currency", exact: true });
    assert.equal(await costNote.inputValue(), "Cost A");
    assert.equal(await amount.inputValue(), "11");
    assert.equal(await currency.inputValue(), "USD");
    const noteBox = await costNote.boundingBox();
    const amountBox = await amount.boundingBox();
    const deleteBox = await costRow.getByRole("button", { name: "Remove", exact: true }).boundingBox();
    assert(noteBox && noteBox.width > 40, "Cost label/note collapsed");
    assert(amountBox && amountBox.width >= 44, "Cost numeric input collapsed");
    if (name === "phone") {
      assert(amountBox.height >= 44, "Cost amount must retain a phone tap target");
      assert(deleteBox && deleteBox.width >= 44 && deleteBox.height >= 44, "Cost delete must be 44px on phones");
    }
    const draftDimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(draftDimensions.scroll <= draftDimensions.width + 1, "Draft costs overflow the viewport");
    await page.screenshot({ path: `${artifacts}/${name}-draft-costs.png`, fullPage: true });
    results.at(-1).draftCosts = { noteBox, amountBox, deleteBox, dimensions: draftDimensions };
    results.at(-1).roundtripAndClosePassed = true;
    results.at(-1).requests = requests;
    writeFileSync(`${artifacts}/results.json`, JSON.stringify(results, null, 2));
    await context.close();
    console.log(`${name}: A to B, A to B to A, close during load, keyboard, tap target, and overflow passed`);
  }
} finally {
  await browser.close();
}

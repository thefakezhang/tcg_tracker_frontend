// Browser evidence for the mtgtop8 format labels and the MTG meta view
// (backend 000664, #2770). Serves the meta view's two PostgREST reads from
// app/e2e/mtg-format-meta/fixture-data.json, then checks the rendered page at
// desktop and phone widths and saves screenshots.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const dependencyRoot = process.env.TCG_FRONTEND_DEPENDENCY_ROOT;
const require = dependencyRoot
  ? createRequire(`${dependencyRoot}/package.json`)
  : createRequire(import.meta.url);
const { chromium } = require("playwright");

const appUrl = process.env.APP_URL;
const artifactRoot = process.env.E2E_ARTIFACT_ROOT;
if (!appUrl || !artifactRoot) throw new Error("APP_URL and E2E_ARTIFACT_ROOT are required");
mkdirSync(artifactRoot, { recursive: true });

const fixture = JSON.parse(readFileSync(new URL("../../app/e2e/mtg-format-meta/fixture-data.json", import.meta.url), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// PostgREST semantics the view relies on: eq on format_code, order, and the
// offset/limit selectAll pages with.
function answer(route, rows) {
  const url = new URL(route.request().url());
  const code = (url.searchParams.get("format_code") ?? "").replace(/^eq\./, "");
  let out = rows[code] ?? [];
  const order = url.searchParams.get("order");
  if (order) {
    const cols = order.split(",").map((c) => c.split(".")[0]);
    out = [...out].sort((a, b) => {
      for (const c of cols) {
        const av = a[c], bv = b[c];
        if (av < bv) return -1;
        if (av > bv) return 1;
      }
      return 0;
    });
  }
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? out.length);
  const range = route.request().headers()["range"];
  let page = out.slice(offset, offset + limit);
  if (range) {
    const [from, to] = range.split("-").map(Number);
    page = out.slice(from, to + 1);
  }
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(page) });
}

async function assertNoOverflow(page, stage) {
  const r = await page.evaluate(() => ({
    inner: window.innerWidth,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(r.doc <= r.inner + 1 && r.body <= r.inner + 1, `${stage} overflows horizontally: ${JSON.stringify(r)}`);
  return r;
}

const browser = await chromium.launch();
const evidence = [];
try {
  for (const viewport of [{ name: "desktop", width: 1440, height: 960 }, { name: "phone", width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, colorScheme: "dark" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.route("**/rest/v1/mtg_format_archetypes_v**", (route) => answer(route, fixture.archetypes));
    await page.route("**/rest/v1/mtg_format_card_play_v**", (route) => answer(route, fixture.cards));
    await page.goto(`${appUrl}/e2e/mtg-format-meta`);

    // Labels: one evidence row per active format, a badge per format.
    const mesa = page.getByTestId("fixture-label-ARID MESA");
    await mesa.waitFor();
    for (const code of ["MO", "LE", "cEDH"]) {
      assert(await mesa.getByTestId(`mtg-label-format-${code}`).count() === 1, `${viewport.name}: Arid Mesa has no ${code} evidence row`);
      assert(await mesa.getByTestId(`mtg-format-badge-${code}`).count() === 1, `${viewport.name}: Arid Mesa has no ${code} badge`);
    }
    assert(await mesa.getByTestId("mtg-label-format-ST").count() === 0, "Arid Mesa shows a Standard row it does not have");
    const passage = page.getByTestId("fixture-label-MULTIVERSAL PASSAGE");
    assert(await passage.getByTestId("mtg-label-format-ST-trend-up").count() === 1, "Multiversal Passage (33.0% -> 43.4%) shows no rising arrow");

    // Meta view, Modern by default.
    const archetypes = page.getByTestId("mtg-meta-archetype-table");
    await archetypes.waitFor();
    const firstArchetype = (await archetypes.locator("tbody tr").first().textContent()) ?? "";
    // By share, not by the page's class-grouped order: Broodscale Bloodchief
    // (16%, COMBO) is Modern's largest deck and sat 47th on the page.
    assert(firstArchetype.includes("Broodscale Bloodchief"), `first Modern archetype reads ${firstArchetype}`);
    assert(await archetypes.locator("tbody tr").count() === 15, "the archetype table should open on the top 15");
    await page.getByTestId("mtg-meta-archetypes-toggle").click();
    assert(await archetypes.locator("tbody tr").count() === 70, "Show all should list every Modern archetype");
    const firstCard = (await page.getByTestId("mtg-meta-card-row").first().textContent()) ?? "";
    assert(firstCard.startsWith("Arid Mesa"), `first Modern card reads ${firstCard}`);
    // The price is the lowest near-mint US ask (backend 000666). The median it
    // replaced showed Force of Negation at $1,530.38 off two RFIN J1 rows.
    const negation = page.getByTestId("mtg-meta-card-row").filter({ hasText: "Force of Negation" });
    const negationText = (await negation.first().textContent()) ?? "";
    assert(negationText.includes("$35.28"), `Force of Negation is priced ${negationText}, want the $35.28 lowest US ask`);
    await assertNoOverflow(page, `${viewport.name} Modern`);
    await page.screenshot({ path: `${artifactRoot}/${viewport.name}-modern.png`, fullPage: true });

    // cEDH: no archetype table, commanders on the second board.
    await page.getByTestId("mtg-meta-format-cEDH").click();
    await page.getByText("mtgtop8 publishes no archetype breakdown for cEDH", { exact: false }).waitFor();
    await page.getByRole("tab", { name: "Commanders" }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="mtg-meta-card-row"]')?.textContent?.startsWith("Tymna the Weaver"));
    await assertNoOverflow(page, `${viewport.name} cEDH commanders`);
    await page.screenshot({ path: `${artifactRoot}/${viewport.name}-cedh-commanders.png`, fullPage: true });

    // Rising: every remaining row is rising or new.
    await page.getByTestId("mtg-meta-format-MO").click();
    await page.getByTestId("mtg-meta-archetype-table").waitFor();
    await page.getByRole("button", { name: "Rising" }).click();
    const rising = await page.getByTestId("mtg-meta-card-row").count();
    assert(rising > 0, "the Rising filter left no Modern rows");
    await page.screenshot({ path: `${artifactRoot}/${viewport.name}-modern-rising.png`, fullPage: true });

    assert(errors.length === 0, `${viewport.name}: page errors ${errors.join("; ")}`);
    evidence.push({ viewport: viewport.name, risingModernRows: rising });
    await context.close();
  }
} finally {
  await browser.close();
}
writeFileSync(`${artifactRoot}/evidence.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));

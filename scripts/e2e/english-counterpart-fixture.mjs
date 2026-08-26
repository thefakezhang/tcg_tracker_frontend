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
mkdirSync(artifactRoot, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertNoOverflow(page, stage) {
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

async function assertTapTarget(locator, label) {
  const box = await locator.boundingBox();
  assert(box, `${label} has no bounds`);
  assert(box.width >= 44 && box.height >= 44, `${label} is ${box.width}x${box.height}, below 44px`);
  return box;
}

async function capture(page, viewportName, state) {
  const filename = `english-counterpart-${viewportName}-${state}.png`;
  const path = `${artifactRoot}/${filename}`;
  await page.screenshot({ path, fullPage: false });
  return filename;
}

async function runViewport(browser, viewportName, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  let unexpectedDatabaseRequests = 0;
  await context.route("http://127.0.0.1:54321/**", async (route) => {
    unexpectedDatabaseRequests += 1;
    await route.fulfill({
      status: 503,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json",
      },
      body: JSON.stringify({ message: "fixture database access is prohibited" }),
    });
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${appUrl}/e2e/english-counterparts`, { waitUntil: "networkidle" });
  assert(
    await page.getByRole("heading", { name: "English counterpart operator fixture" }).isVisible(),
    `${viewportName} fixture heading missing`,
  );

  const stateButtons = page.getByRole("group", { name: "Fixture state" }).getByRole("button");
  assert(await stateButtons.count() === 3, `${viewportName} fixture has the wrong state count`);
  for (let index = 0; index < await stateButtons.count(); index += 1) {
    const button = stateButtons.nth(index);
    await button.focus();
    assert(await button.evaluate((node) => document.activeElement === node), `${viewportName} state button ${index + 1} is not focusable`);
    if (viewport.width < 640) await assertTapTarget(button, `${viewportName} state button ${index + 1}`);
  }

  await page.getByTestId("fixture-state-mapped").click();
  await page.getByTestId("fixture-panel-mapped").waitFor({ state: "visible" });
  assert(await page.getByText("Exact English printing").isVisible(), `${viewportName} exact status missing`);
  assert(await page.getByText("SVP · 101").isVisible(), `${viewportName} exact English identity missing`);
  assert(await page.getByText("Raw tier 1").isVisible(), `${viewportName} raw comparison missing`);
  assert(await page.getByText("Exact PSA 10").isVisible(), `${viewportName} exact PSA comparison missing`);
  const currentAsks = page.getByRole("group", { name: "Current US ask" });
  const realizedComps = page.getByRole("group", { name: "Realized sold comps" });
  assert((await currentAsks.count()) === 2, `${viewportName} current asks are not separately labeled`);
  assert((await realizedComps.count()) === 2, `${viewportName} realized comps are not separately labeled`);
  for (let index = 0; index < await currentAsks.count(); index += 1) {
    assert((await currentAsks.nth(index).textContent()).includes("tcgplayer"), `${viewportName} current ask ${index + 1} is not from the current-listing source`);
    assert(!(await currentAsks.nth(index).textContent()).includes("cardladder"), `${viewportName} current ask ${index + 1} blended sold-comp provenance`);
    assert((await realizedComps.nth(index).textContent()).includes("130point/"), `${viewportName} realized comp ${index + 1} lacks 130point provenance`);
    assert((await realizedComps.nth(index).textContent()).includes("cardladder/"), `${viewportName} realized comp ${index + 1} lacks Card Ladder provenance`);
  }
  assert((await page.getByText(/Conservative decision price/).count()) === 2, `${viewportName} conservative decision basis missing`);
  assert((await page.getByText("Liquidity penalty").count()) === 2, `${viewportName} liquidity penalties missing`);
  assert((await page.getByText("ROI denominator").count()) === 2, `${viewportName} profit denominators missing`);
  assert((await page.getByText("Completeness: complete").count()) >= 2, `${viewportName} completeness labels missing`);
  const evidence = page.getByRole("link", { name: /Mapping evidence/ });
  assert(await evidence.getAttribute("href") === "https://example.test/releases/svp-101", `${viewportName} mapping evidence link wrong`);
  await evidence.focus();
  assert(await evidence.evaluate((node) => document.activeElement === node), `${viewportName} mapping evidence is not focusable`);
  const mappedOverflow = await assertNoOverflow(page, `${viewportName} mapped`);
  const mappedScreenshot = await capture(page, viewportName, "mapped");

  await page.getByTestId("fixture-state-unknown").click();
  await page.getByTestId("fixture-panel-unknown").waitFor({ state: "visible" });
  assert(await page.getByText("Unknown: realized sold-comp sample is below minimum").isVisible(), `${viewportName} insufficient sold-comp state is not explicit`);
  const unknownAsk = page.getByRole("group", { name: "Current US ask" });
  const unknownRealized = page.getByRole("group", { name: "Realized sold comps" });
  assert((await unknownAsk.textContent()).includes("$150.00 · tcgplayer"), `${viewportName} known current ask was hidden by incomplete sold comps`);
  assert((await unknownRealized.textContent()).includes("$125.00 · 1 sold comp(s) · 130point/ebay"), `${viewportName} incomplete realized evidence lost its sample/provenance`);
  assert(await page.getByText(/ask fallback; profit unknown/).isVisible(), `${viewportName} conservative fallback is not explicit`);
  assert((await page.getByRole("group", { name: "JP" }).textContent()).includes("$80.00 · snkrdunk"), `${viewportName} known Japanese price was hidden by incomplete sold comps`);
  assert(await page.getByText("Exact PSA comparison: unknown").isVisible(), `${viewportName} missing PSA state is not explicit`);
  assert((await page.getByText(/unprofitable/i).count()) === 0, `${viewportName} unknown data was labeled unprofitable`);
  const unknownOverflow = await assertNoOverflow(page, `${viewportName} unknown`);
  const unknownScreenshot = await capture(page, viewportName, "unknown");

  await page.getByTestId("fixture-state-review").click();
  await page.getByTestId("fixture-panel-review").waitFor({ state: "visible" });
  assert(await page.getByText("name only").isVisible(), `${viewportName} name-only review basis missing`);
  assert(await page.getByText("This card is marked as Japanese-exclusive artwork. Confirm no counterpart unless printing-level evidence proves otherwise.").isVisible(), `${viewportName} artwork warning missing`);
  assert(await page.getByText("Candidate evidence").isVisible(), `${viewportName} candidate evidence missing`);
  assert(await page.getByText("Unknown: exact mapping missing").isVisible(), `${viewportName} missing mapping was not rendered unknown`);
  const exactButton = page.getByRole("button", { name: "Confirm exact printing" });
  const noCounterpartButton = page.getByRole("button", { name: "Confirm no counterpart" });
  assert(await exactButton.isDisabled(), `${viewportName} exact decision enabled without evidence`);
  assert(await noCounterpartButton.isDisabled(), `${viewportName} no-counterpart decision enabled without evidence`);
  const reviewTopOverflow = await assertNoOverflow(page, `${viewportName} review top`);
  const reviewTopScreenshot = await capture(page, viewportName, "review-top");

  const evidenceUrl = page.getByLabel("HTTPS evidence URL");
  const decisionNote = page.getByLabel("Evidence note");
  const englishCardId = page.getByLabel("Exact English card ID");
  await evidenceUrl.fill("https://example.test/release-proof");
  await decisionNote.fill("Official release checklist establishes the exact illustrated printing.");
  assert(await englishCardId.inputValue() === "84", `${viewportName} exact English candidate ID not visible`);
  assert(!(await exactButton.isDisabled()), `${viewportName} evidence-backed exact decision stayed disabled`);
  assert(!(await noCounterpartButton.isDisabled()), `${viewportName} evidence-backed no-counterpart decision stayed disabled`);
  await exactButton.scrollIntoViewIfNeeded();
  await exactButton.focus();
  assert(await exactButton.evaluate((node) => document.activeElement === node), `${viewportName} exact decision is not keyboard focusable`);
  if (viewport.width < 640) {
    await assertTapTarget(evidenceUrl, `${viewportName} evidence URL`);
    await assertTapTarget(englishCardId, `${viewportName} English card ID`);
    await assertTapTarget(exactButton, `${viewportName} exact action`);
    await assertTapTarget(noCounterpartButton, `${viewportName} no-counterpart action`);
    await assertTapTarget(page.getByRole("button", { name: "Reject candidate" }), `${viewportName} reject action`);
  }
  const reviewActionOverflow = await assertNoOverflow(page, `${viewportName} review actions`);
  const reviewActionScreenshot = await capture(page, viewportName, "review-actions");

  assert(unexpectedDatabaseRequests === 0, `${viewportName} fixture made ${unexpectedDatabaseRequests} database request(s)`);
  assert(pageErrors.length === 0, `${viewportName} page errors: ${pageErrors.join(" | ")}`);
  await context.close();
  return {
    viewportName,
    viewport,
    mapped: { overflow: mappedOverflow, screenshot: mappedScreenshot },
    unknown: { overflow: unknownOverflow, screenshot: unknownScreenshot },
    review: {
      topOverflow: reviewTopOverflow,
      actionOverflow: reviewActionOverflow,
      topScreenshot: reviewTopScreenshot,
      actionScreenshot: reviewActionScreenshot,
    },
    unexpectedDatabaseRequests,
    pageErrors,
  };
}

const browser = await chromium.launch({ headless: true });
try {
  const results = [];
  results.push(await runViewport(browser, "desktop-1440x900", { width: 1440, height: 900 }));
  results.push(await runViewport(browser, "phone-390x844", { width: 390, height: 844 }));
  const report = {
    generatedAt: new Date().toISOString(),
    fixtureOnly: true,
    externalRequests: 0,
    databaseRequests: 0,
    states: ["mapped", "unknown", "review"],
    results,
  };
  writeFileSync(`${artifactRoot}/english-counterpart-browser-evidence.json`, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}

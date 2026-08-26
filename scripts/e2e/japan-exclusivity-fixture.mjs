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

async function visibleCardIDs(page) {
  return page.locator('[data-testid^="fixture-card-"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-testid").replace("fixture-card-", "")).sort(),
  );
}

async function selectDimensions(page, dimensions, expectedIDs) {
  for (const dimension of ["artwork", "stamps"]) {
    const button = page.getByTestId(`japan-exclusivity-${dimension}`);
    const active = (await button.getAttribute("aria-pressed")) === "true";
    if (active !== dimensions.includes(dimension)) await button.click();
  }
  await page.waitForFunction(
    ({ count }) => document.querySelectorAll('[data-testid^="fixture-card-"]').length === count,
    { count: expectedIDs.length },
  );
  const actual = await visibleCardIDs(page);
  const label = dimensions.length ? dimensions.join("+") : "all";
  assert(JSON.stringify(actual) === JSON.stringify([...expectedIDs].sort()), `${label} returned ${actual}, want ${expectedIDs}`);
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
}

async function assertTapTarget(locator, label) {
  const box = await locator.boundingBox();
  assert(box, `${label} has no bounds`);
  assert(box.width >= 44 && box.height >= 44, `${label} is ${box.width}x${box.height}, below 44px`);
}

async function waitForSubtreeAnimations(locator) {
  await locator.evaluate(async (element) => {
    const animations = element.getAnimations({ subtree: true });
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function assertEvidencePopup(page, link, activation, label) {
  const href = await link.getAttribute("href");
  assert(href, `${label} has no href`);
  const parentUrl = page.url();
  const popupPromise = page.waitForEvent("popup");
  if (activation === "keyboard") {
    await link.focus();
    await page.keyboard.press("Enter");
  } else {
    await link.click();
  }
  const popup = await popupPromise;
  await popup.waitForURL(href);
  assert(page.url() === parentUrl, `${label} navigated the parent page to ${page.url()}`);
  await popup.close();
}

async function evidenceAlignment(link, label) {
  const measurement = await link.evaluate((row) => {
    const badge = row.querySelector('[data-slot="badge"]');
    if (!(badge instanceof HTMLElement)) return null;
    const rowBox = row.getBoundingClientRect();
    const badgeBox = badge.getBoundingClientRect();
    return {
      rowCenter: rowBox.top + rowBox.height / 2,
      badgeCenter: badgeBox.top + badgeBox.height / 2,
    };
  });
  assert(measurement, `${label} badge has no measurable bounds`);
  const offset = Math.abs(measurement.rowCenter - measurement.badgeCenter);
  assert(offset <= 2, `${label} badge center is ${offset.toFixed(2)}px from its row center`);
  return { ...measurement, offset };
}

async function captureCompactToggles(page, name, viewport) {
  const group = page.getByTestId("japan-exclusivity-filter");
  await group.scrollIntoViewIfNeeded();
  await waitForSubtreeAnimations(group);
  const buttons = group.getByRole("button");
  assert(await buttons.count() === 2, `${name} filter does not expose exactly two dimension toggles`);
  const bounds = await group.boundingBox();
  assert(bounds, `${name} filter toggles have no bounds`);
  assert(bounds.width <= 300 && bounds.height <= 56, `${name} filter toggles are not compact: ${JSON.stringify(bounds)}`);
  assert(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, `${name} filter toggles escape horizontally: ${JSON.stringify(bounds)}`);
  assert(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, `${name} filter toggles escape vertically: ${JSON.stringify(bounds)}`);
  if (viewport.width < 640) {
    for (let index = 0; index < await buttons.count(); index += 1) {
      await assertTapTarget(buttons.nth(index), `phone filter toggle ${index + 1}`);
    }
  }
  const screenshot = `${artifactRoot}/japan-exclusivity-${name}-toggles.png`;
  await page.screenshot({ path: screenshot, fullPage: true });
  return { bounds, screenshot };
}

async function runViewport(browser, name, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  let criterionInsertCount = 0;
  await context.route("http://127.0.0.1:54321/rest/v1/**", async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "apikey, authorization, content-type, prefer, x-client-info",
      "access-control-allow-methods": "GET, HEAD, OPTIONS, POST",
      "content-type": "application/json",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (request.method() === "POST") criterionInsertCount += 1;
    await route.fulfill({ status: request.method() === "POST" ? 201 : 200, headers, body: "[]" });
  });
  await context.route("https://**/*", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>Controlled evidence target</title>",
  }));
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${appUrl}/e2e/japan-exclusivity`, { waitUntil: "networkidle" });
  assert(await page.getByRole("heading", { name: "Japanese-exclusive printing evidence" }).isVisible(), `${name} fixture heading missing`);
  assert((await page.getByText(/Both requires independent evidence/).count()) >= 1, `${name} typed-category copy missing`);
  assert((await page.getByText(/Reviewed through Aug 26, 2026/).count()) >= 1, `${name} reviewed corpus scope missing`);
  assert(await page.getByTestId("japan-exclusive-master-list-download").count() === 0, `${name} still exposes the removed CSV download`);

  const selections = [
    [[], ["artwork", "both", "neither", "stamps"]],
    [["artwork"], ["artwork", "both"]],
    [["artwork", "stamps"], ["artwork", "both", "stamps"]],
    [["stamps"], ["both", "stamps"]],
  ];
  for (const [dimensions, expected] of selections) {
    await selectDimensions(page, dimensions, expected);
    await assertNoOverflow(page, `${name} ${dimensions.join("+") || "all"}`);
  }

  await selectDimensions(page, ["artwork", "stamps"], ["artwork", "both", "stamps"]);
  const search = page.getByLabel("Search fixture cards");
  await search.fill("no such printing");
  await page.getByTestId("fixture-empty-state").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Reset" }).click();
  assert((await visibleCardIDs(page)).length === 4, `${name} reset did not restore all cards`);

  await selectDimensions(page, ["artwork", "stamps"], ["artwork", "both", "stamps"]);
  const artworkLink = page.getByTestId("fixture-card-both").getByTestId("japan-exclusive-artwork");
  const stampsLink = page.getByTestId("fixture-card-both").getByTestId("japan-exclusive-stamps");
  assert(await artworkLink.getAttribute("href") !== await stampsLink.getAttribute("href"), `${name} evidence links are not independent`);
  await artworkLink.focus();
  assert(await artworkLink.evaluate((node) => document.activeElement === node), `${name} artwork evidence is not keyboard focusable`);
  await stampsLink.focus();
  assert(await stampsLink.evaluate((node) => document.activeElement === node), `${name} stamp evidence is not keyboard focusable`);
  await assertEvidencePopup(page, artworkLink, "keyboard", `${name} artwork evidence`);
  await assertEvidencePopup(page, stampsLink, "click", `${name} stamp evidence`);
  const evidenceAlignmentResult = {
    artwork: await evidenceAlignment(artworkLink, `${name} artwork evidence`),
    stamps: await evidenceAlignment(stampsLink, `${name} stamp evidence`),
  };

  const criterion = page.getByLabel("Japanese exclusivity");
  for (const [value, count] of [["artwork", 2], ["stamps", 2], ["either", 3], ["both", 1]]) {
    await criterion.selectOption(value);
    const text = await page.getByTestId("fixture-shopping-count").textContent();
    assert(text.startsWith(String(count)), `${name} customer ${value} produced ${text}, want ${count}`);
  }

  const addCriterion = page.getByRole("button", { name: "Add criterion" });
  if (viewport.width < 640) {
    await assertTapTarget(addCriterion, "phone Add criterion trigger");
  }
  await addCriterion.click();
  const criterionDialog = page.getByRole("dialog", { name: "Add criterion" });
  await criterionDialog.waitFor({ state: "visible" });
  await waitForSubtreeAnimations(criterionDialog);
  const dialogBounds = await criterionDialog.boundingBox();
  const cancelCriterion = criterionDialog.getByRole("button", { name: "Cancel" });
  const saveCriterion = criterionDialog.getByRole("button", { name: "Save" });
  const cancelBounds = await cancelCriterion.boundingBox();
  const saveBounds = await saveCriterion.boundingBox();
  assert(dialogBounds, `${name} Add criterion dialog has no bounds`);
  assert(cancelBounds && saveBounds, `${name} Add criterion actions are clipped or unavailable`);
  assert(dialogBounds.y >= 0 && dialogBounds.y + dialogBounds.height <= viewport.height,
    `${name} Add criterion dialog escapes viewport: ${JSON.stringify(dialogBounds)}`);
  assert(cancelBounds.y >= 0 && cancelBounds.y + cancelBounds.height <= viewport.height,
    `${name} Add criterion Cancel is clipped: ${JSON.stringify(cancelBounds)}`);
  assert(saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= viewport.height,
    `${name} Add criterion Save is clipped: ${JSON.stringify(saveBounds)}`);
  if (viewport.width < 640) {
    await assertTapTarget(cancelCriterion, "phone Add criterion Cancel");
    await assertTapTarget(saveCriterion, "phone Add criterion Save");
  }
  await criterionDialog.getByLabel("Japanese exclusivity").selectOption("both");
  await saveCriterion.click();
  await criterionDialog.waitFor({ state: "hidden" });
  assert(criterionInsertCount === 1, `${name} Add criterion Save sent ${criterionInsertCount} writes, want 1`);
  await addCriterion.click();
  await criterionDialog.waitFor({ state: "visible" });
  await criterionDialog.getByRole("button", { name: "Cancel" }).click();
  await criterionDialog.waitFor({ state: "hidden" });

  if (viewport.width < 640) {
    await assertTapTarget(page.getByTestId("japan-exclusivity-artwork"), "phone artwork filter toggle");
    await assertTapTarget(page.getByTestId("japan-exclusivity-stamps"), "phone stamp filter toggle");
    await assertTapTarget(search, "phone search");
    await assertTapTarget(page.getByRole("button", { name: "Reset" }), "phone reset");
    await assertTapTarget(criterion, "phone customer criterion");
    await assertTapTarget(artworkLink, "phone artwork evidence");
    await assertTapTarget(stampsLink, "phone stamp evidence");
  }

  const compactToggles = await captureCompactToggles(page, name, viewport);

  await assertNoOverflow(page, `${name} final`);
  assert(pageErrors.length === 0, `${name} page errors: ${pageErrors.join(" | ")}`);
  await page.waitForFunction(() =>
    !document.querySelector('[role="dialog"]'),
  );
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  ));
  const screenshot = `${artifactRoot}/japan-exclusivity-${name}.png`;
  await page.screenshot({ path: screenshot, fullPage: true });
  await context.close();
  return {
    name,
    viewport,
    screenshot,
    filters: 2,
    customerModes: 4,
    criterionActions: 2,
    criterionDialog: { dialogBounds, cancelBounds, saveBounds },
    compactToggles,
    evidenceAlignment: evidenceAlignmentResult,
    pageErrors,
  };
}

const browser = await chromium.launch();
try {
  const results = [];
  results.push(await runViewport(browser, "desktop-1440x900", { width: 1440, height: 900 }));
  results.push(await runViewport(browser, "phone-390x844", { width: 390, height: 844 }));
  const evidence = {
    route: "/e2e/japan-exclusivity",
    databaseAccess: false,
    assertions: [
      "all/artwork/stamps/inclusive-union exact result sets",
      "search empty state and reset",
      "independent keyboard and pointer evidence-link popups without parent navigation",
      "customer and shopping artwork/stamps/either/both semantics",
      "real Add criterion dialog Save and Cancel remain reachable inside 390x844",
      "CSV download is absent",
      "compact two-button Artwork and Stamp / marking filter",
      "artwork and stamp badges are vertically centered in their evidence rows",
      "44px phone toggles, fields, actions, and evidence links",
      "no page-level horizontal overflow",
    ],
    results,
  };
  writeFileSync(`${artifactRoot}/result.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await browser.close();
}

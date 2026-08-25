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

const modes = [
  ["JP type: All cards", ["artwork", "both", "neither", "stamps"]],
  ["JP type: Artwork", ["artwork", "both"]],
  ["JP type: Stamp / marking", ["both", "stamps"]],
  ["JP type: Either", ["artwork", "both", "stamps"]],
  ["JP type: Both", ["both"]],
];

async function visibleCardIDs(page) {
  return page.locator('[data-testid^="fixture-card-"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-testid").replace("fixture-card-", "")).sort(),
  );
}

async function selectMode(page, label, expectedIDs) {
  const trigger = page.getByTestId("japan-exclusivity-filter-trigger");
  await trigger.click();
  const option = page.locator('[role="menuitemradio"]:visible').filter({ hasText: label }).first();
  await option.waitFor({ state: "visible" });
  await page.waitForTimeout(300);
  await option.click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="japan-exclusivity-filter-trigger"]')?.getAttribute("aria-expanded") !== "true",
  );
  await page.waitForFunction(
    ({ count }) => document.querySelectorAll('[data-testid^="fixture-card-"]').length === count,
    { count: expectedIDs.length },
  );
  const actual = await visibleCardIDs(page);
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

async function runViewport(browser, name, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
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
  const masterDownload = page.getByTestId("japan-exclusive-master-list-download");
  assert(await masterDownload.getAttribute("download") === "pokemon-japan-exclusives-master-list.csv", `${name} master list is not a download`);
  const masterHref = await masterDownload.getAttribute("href");
  assert(masterHref === "/pokemon-japan-exclusives-master-list.csv", `${name} master list href is ${masterHref}`);
  const masterResponse = await page.request.get(`${appUrl}${masterHref}`);
  assert(masterResponse.ok(), `${name} master list request failed: ${masterResponse.status()}`);
  const masterCSV = await masterResponse.text();
  assert(masterCSV.startsWith("era,release_date,set_name,set_code,card_number"), `${name} master list header changed`);
  assert(masterCSV.trimEnd().split("\n").length === 367, `${name} master list does not contain 366 approved rows`);

  for (const [label, expected] of modes) {
    await selectMode(page, label, expected);
    await assertNoOverflow(page, `${name} ${label}`);
  }

  await selectMode(page, "JP type: Either", ["artwork", "both", "stamps"]);
  const search = page.getByLabel("Search fixture cards");
  await search.fill("no such printing");
  await page.getByTestId("fixture-empty-state").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Reset" }).click();
  assert((await visibleCardIDs(page)).length === 4, `${name} reset did not restore all cards`);

  await selectMode(page, "JP type: Both", ["both"]);
  const artworkLink = page.getByTestId("fixture-card-both").getByTestId("japan-exclusive-artwork");
  const stampsLink = page.getByTestId("fixture-card-both").getByTestId("japan-exclusive-stamps");
  assert(await artworkLink.getAttribute("href") !== await stampsLink.getAttribute("href"), `${name} evidence links are not independent`);
  await artworkLink.focus();
  assert(await artworkLink.evaluate((node) => document.activeElement === node), `${name} artwork evidence is not keyboard focusable`);
  await stampsLink.focus();
  assert(await stampsLink.evaluate((node) => document.activeElement === node), `${name} stamp evidence is not keyboard focusable`);
  await assertEvidencePopup(page, artworkLink, "keyboard", `${name} artwork evidence`);
  await assertEvidencePopup(page, stampsLink, "click", `${name} stamp evidence`);

  const criterion = page.getByLabel("Japanese exclusivity");
  for (const [value, count] of [["artwork", 2], ["stamps", 2], ["either", 3], ["both", 1]]) {
    await criterion.selectOption(value);
    const text = await page.getByTestId("fixture-shopping-count").textContent();
    assert(text.startsWith(String(count)), `${name} customer ${value} produced ${text}, want ${count}`);
  }

  if (viewport.width < 640) {
    await assertTapTarget(page.getByTestId("japan-exclusivity-filter-trigger"), "phone filter trigger");
    await assertTapTarget(search, "phone search");
    await assertTapTarget(page.getByRole("button", { name: "Reset" }), "phone reset");
    await assertTapTarget(masterDownload, "phone master list download");
    await assertTapTarget(criterion, "phone customer criterion");
    await assertTapTarget(artworkLink, "phone artwork evidence");
    await assertTapTarget(stampsLink, "phone stamp evidence");
    await page.getByTestId("japan-exclusivity-filter-trigger").click();
    await page.waitForTimeout(300);
    const menuItems = page.locator('[role="menuitemradio"]:visible');
    for (let index = 0; index < await menuItems.count(); index += 1) {
      await assertTapTarget(menuItems.nth(index), `phone filter option ${index + 1}`);
    }
    await page.keyboard.press("Escape");
  }

  await assertNoOverflow(page, `${name} final`);
  assert(pageErrors.length === 0, `${name} page errors: ${pageErrors.join(" | ")}`);
  const screenshot = `${artifactRoot}/japan-exclusivity-${name}.png`;
  await page.screenshot({ path: screenshot, fullPage: true });
  await context.close();
  return { name, viewport, screenshot, filters: 5, customerModes: 4, masterRows: 366, pageErrors };
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
      "all/artwork/stamps/either/both exact result sets",
      "search empty state and reset",
      "independent keyboard and pointer evidence-link popups without parent navigation",
      "customer and shopping artwork/stamps/either/both semantics",
      "366-row buyer-readable master CSV download",
      "44px phone trigger, options, fields, actions, download, and evidence links",
      "no page-level horizontal overflow",
    ],
    results,
  };
  writeFileSync(`${artifactRoot}/result.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await browser.close();
}

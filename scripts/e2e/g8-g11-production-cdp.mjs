import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { chromium } from "playwright";

const appUrl = process.env.APP_URL;
const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9229";
const artifactRoot = process.env.E2E_ARTIFACT_ROOT;
const expectedRevision = process.env.EXPECTED_FRONTEND_REVISION;
const cardUid = "da807f6b-e540-44a1-bbbc-1b3179cf9211";
const uidPrefix = cardUid.slice(0, 8);
const externalId = "545661";
const englishName = "Iono";
const regionalName = "ナンジャモ";
const searchTerms = ["Iono 124", "ナンジャモ 124", cardUid, externalId];
const viewports = [
  { name: "desktop", width: 1440, height: 960 },
  { name: "phone", width: 390, height: 844 },
];

if (!appUrl || !artifactRoot || !expectedRevision) {
  throw new Error("APP_URL, E2E_ARTIFACT_ROOT, and EXPECTED_FRONTEND_REVISION are required");
}

const appOrigin = new URL(appUrl).origin;
const parsedAppUrl = new URL(appUrl);
assert(!parsedAppUrl.username && !parsedAppUrl.password && !parsedAppUrl.search && !parsedAppUrl.hash, "APP_URL must not contain credentials, query parameters, or a fragment");

mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function visibleCount(locator) {
  let count = 0;
  for (let index = 0; index < await locator.count(); index++) {
    if (await locator.nth(index).isVisible()) count++;
  }
  return count;
}

async function assertNoOverflow(page, label) {
  const result = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert(
    result.documentWidth <= result.innerWidth + 1 && result.bodyWidth <= result.innerWidth + 1,
    `${label} overflowed: ${JSON.stringify(result)}`,
  );
  return result;
}

function exactExternalIdFromRequest(requestUrl) {
  const url = new URL(requestUrl);
  if (!url.pathname.endsWith("/pokemon_external_identifiers")) return null;
  const predicate = url.searchParams.get("external_reference_id");
  return predicate?.startsWith("eq.") ? predicate.slice(3) : null;
}

function isResultResponse(response, table) {
  const url = new URL(response.url());
  return url.pathname.endsWith(`/${table}`)
    && (url.searchParams.get("select") ?? "").includes("card_uid")
    && response.status() >= 200
    && response.status() < 300;
}

function collectCardUids(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectCardUids(entry, found);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "card_uid" && typeof entry === "string") found.add(entry);
      collectCardUids(entry, found);
    }
  }
  return [...found];
}

async function resultResponseEvidence(response, label) {
  const body = await response.json();
  const cardUids = collectCardUids(body);
  assert(cardUids.length === 1 && cardUids[0] === cardUid, `${label} response returned ${JSON.stringify(cardUids)}`);
  return { status: response.status(), cardUids };
}

function assertResponseMatchesTerm(response, term, label) {
  if (term === externalId) return;
  const decodedUrl = decodeURIComponent(response.url()).toLowerCase();
  const markers = term === cardUid ? [cardUid] : term.toLowerCase().split(/\s+/);
  assert(markers.every((marker) => decodedUrl.includes(marker)), `${label} response URL does not bind ${JSON.stringify(term)}`);
}

async function waitForExactExternalIdResponse(page, term) {
  const response = await page.waitForResponse((candidate) => (
    exactExternalIdFromRequest(candidate.url()) === term && candidate.status() >= 200 && candidate.status() < 300
  ), { timeout: 30_000 });
  return { url: response.url(), status: response.status() };
}

function newSurfaceEvidence(viewport) {
  return {
    viewport,
    searches: {},
    activation: {},
    recovery: {},
    measurements: {},
  };
}

async function assertFitsViewport(locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const viewport = await locator.page().evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  assert(
    box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    `${label} is outside the viewport: ${JSON.stringify({ box, viewport })}`,
  );
  return { box, viewport };
}

async function assertTouchTarget(locator, label) {
  const box = await locator.boundingBox();
  assert(box && box.width >= 44 && box.height >= 44, `${label} is smaller than 44x44: ${JSON.stringify(box)}`);
  return box;
}

async function activate(page, target, label) {
  const outcomes = {};
  for (const input of ["pointer", "Enter", "Space"]) {
    if (input === "pointer") {
      await target.click();
    } else {
      await target.focus();
      assert(await target.evaluate((element) => document.activeElement === element), `${label} ${input} lost focus`);
      await page.keyboard.press(input);
    }
    const dialog = page.getByRole("dialog").last();
    await dialog.waitFor({ state: "visible", timeout: 30_000 });
    const dialogText = (await dialog.textContent()) ?? "";
    assert(dialogText.includes(englishName) || dialogText.includes(regionalName), `${label} ${input} opened the wrong dialog`);
    outcomes[input] = { passed: true, dialogIdentity: englishName };
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 30_000 });
  }
  return outcomes;
}

function browserResults(page, mobile) {
  return mobile
    ? page.locator('[data-slot="sidebar-inset"] > main [data-slot="card"]').filter({ hasText: englishName })
    : page.locator("tbody tr").filter({ hasText: englishName });
}

async function browserSearch(page, term, mobile) {
  const responsePromise = term === externalId ? waitForExactExternalIdResponse(page, term) : null;
  const resultResponsePromise = page.waitForResponse(
    (candidate) => isResultResponse(candidate, "pokemon_price_summaries"),
    { timeout: 30_000 },
  );
  const input = page.getByPlaceholder("Name...");
  await input.fill("");
  await input.fill(term);
  const response = responsePromise ? await responsePromise : null;
  const resultResponse = await resultResponsePromise;
  assertResponseMatchesTerm(resultResponse, term, "Card Browser");
  const resultEvidence = await resultResponseEvidence(resultResponse, `Card Browser ${JSON.stringify(term)}`);
  const results = browserResults(page, mobile);
  await results.first().waitFor({ state: "visible", timeout: 30_000 });
  assert(await visibleCount(results) === 1, `Card Browser ${JSON.stringify(term)} did not return one result`);
  const allVisibleResults = page.getByRole("button", { name: /^Open details for / });
  assert(await visibleCount(allVisibleResults) === 1, `Card Browser ${JSON.stringify(term)} rendered more than one visible result`);
  const result = results.first();
  const text = (await result.textContent()) ?? "";
  const label = (await result.getAttribute("aria-label")) ?? "";
  assert(text.includes(englishName) && label.includes(englishName), `Card Browser ${JSON.stringify(term)} lost Iono identity`);
  if (!mobile) assert(text.includes(uidPrefix), `Card Browser ${JSON.stringify(term)} omitted ${uidPrefix}`);
  return { locator: result, signature: label, response, resultEvidence };
}

async function openPokemonIndex(page, mobile) {
  if (mobile) await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  await page.getByRole("button", { name: "Index", exact: true }).click();
  if (mobile) await page.keyboard.press("Escape");
  const main = page.locator('[data-slot="sidebar-inset"] > main');
  await main.getByRole("button", { name: "Pokémon Sealed", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await main.getByRole("button", { name: "Pokémon", exact: true }).click();
  await main.getByPlaceholder("Search name / set / uid / platform id…").waitFor({ state: "visible" });
}

function indexResults(page) {
  return page.locator("tbody tr").filter({ hasText: regionalName });
}

async function indexSearch(page, term) {
  const responsePromise = term === externalId ? waitForExactExternalIdResponse(page, term) : null;
  const resultResponsePromise = page.waitForResponse(
    (candidate) => isResultResponse(candidate, "pokemon_card_definitions"),
    { timeout: 30_000 },
  );
  const input = page.getByPlaceholder("Search name / set / uid / platform id…");
  await input.fill("");
  await input.fill(term);
  const response = responsePromise ? await responsePromise : null;
  const resultResponse = await resultResponsePromise;
  assertResponseMatchesTerm(resultResponse, term, "Card Index");
  const resultEvidence = await resultResponseEvidence(resultResponse, `Card Index ${JSON.stringify(term)}`);
  const results = indexResults(page);
  await results.first().waitFor({ state: "visible", timeout: 30_000 });
  assert(await visibleCount(results) === 1, `Card Index ${JSON.stringify(term)} did not return one result`);
  const result = results.first();
  const text = (await result.textContent()) ?? "";
  assert(text.includes(regionalName) && text.includes(englishName) && text.includes(uidPrefix), `Card Index ${JSON.stringify(term)} lost exact identity`);
  return { locator: result, signature: text.replace(/\s+/g, " ").trim(), response, resultEvidence };
}

async function currentBrowserResult(page, mobile) {
  const results = browserResults(page, mobile);
  await results.first().waitFor({ state: "visible", timeout: 30_000 });
  assert(await visibleCount(results) === 1, "Card Browser recovery did not retain one Iono result");
  return { locator: results.first(), signature: (await results.first().getAttribute("aria-label")) ?? "" };
}

async function currentIndexResult(page) {
  const results = indexResults(page);
  await results.first().waitFor({ state: "visible", timeout: 30_000 });
  assert(await visibleCount(results) === 1, "Card Index recovery did not retain one Iono result");
  return { locator: results.first(), signature: ((await results.first().textContent()) ?? "").replace(/\s+/g, " ").trim() };
}

async function screenshot(page, name, artifacts) {
  const path = join(artifactRoot, name);
  await page.screenshot({ path, fullPage: false });
  artifacts.push(path);
}

async function exerciseRecovery({ page, surface, viewport, resultTable, currentResult, input, retained, artifacts }) {
  let fail = true;
  let failedRequests = 0;
  let recoveredRequests = 0;
  const routeHandler = async (route) => {
    if (exactExternalIdFromRequest(route.request().url()) !== externalId) return route.continue();
    if (fail) {
      failedRequests++;
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "PGRST500", message: "catalog link lookup unavailable" }),
      });
    }
    const response = await route.fetch();
    assert(response.status() >= 200 && response.status() < 300, `${viewport.name} ${surface} Retry returned ${response.status()}`);
    recoveredRequests++;
    return route.fulfill({ response });
  };

  await page.route("**/rest/v1/pokemon_external_identifiers**", routeHandler);
  await input.fill(externalId);
  const alert = page.getByRole("alert").filter({ hasText: "External ID lookup is temporarily unavailable." });
  await alert.waitFor({ state: "visible", timeout: 30_000 });
  assert(failedRequests > 0, `${viewport.name} ${surface} did not intercept the exact external ID`);
  assert(await visibleCount(retained.locator) === 1, `${viewport.name} ${surface} discarded the retained result`);
  assert((await retained.locator.textContent())?.includes(englishName), `${viewport.name} ${surface} retained the wrong result`);
  assert(await page.getByText("catalog link lookup unavailable", { exact: false }).count() === 0, `${viewport.name} ${surface} exposed the raw error`);
  const retry = alert.getByRole("button", { name: "Retry", exact: true });
  await retry.waitFor({ state: "visible" });
  const alertFit = await assertFitsViewport(alert, `${viewport.name} ${surface} alert`);
  const errorOverflow = await assertNoOverflow(page, `${viewport.name} ${surface} error state`);
  const retryBox = await retry.boundingBox();
  const retryTouchTarget = viewport.name === "phone" ? await assertTouchTarget(retry, `${surface} phone Retry`) : null;
  await screenshot(page, `${viewport.name}-${surface}-retry-before.png`, artifacts);

  fail = false;
  const resultResponsePromise = page.waitForResponse(
    (candidate) => isResultResponse(candidate, resultTable),
    { timeout: 30_000 },
  );
  await retry.click();
  const resultResponse = await resultResponsePromise;
  const resultEvidence = await resultResponseEvidence(resultResponse, `${viewport.name} ${surface} Retry`);
  await alert.waitFor({ state: "hidden", timeout: 30_000 });
  const recovered = await currentResult(page);
  assert(recovered.signature === retained.signature, `${viewport.name} ${surface} Retry recovered a different result`);
  assert(recoveredRequests > 0, `${viewport.name} ${surface} Retry did not restore the exact request`);
  const recoveredOverflow = await assertNoOverflow(page, `${viewport.name} ${surface} recovered state`);
  await screenshot(page, `${viewport.name}-${surface}-retry-after.png`, artifacts);
  await page.unroute("**/rest/v1/pokemon_external_identifiers**", routeHandler);
  return {
    passed: true,
    exactExternalId: externalId,
    failedRequests,
    recoveredRequests,
    retainedSignature: retained.signature,
    roleAlert: true,
    safeCopy: true,
    rawErrorHidden: true,
    retryVisible: true,
    retryBox,
    retryTouchTarget,
    alertFit,
    errorOverflow,
    recoveredSignature: recovered.signature,
    resultEvidence,
    recoveredOverflow,
  };
}

async function runViewport(page, viewport, artifacts) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`${appUrl}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  assert(page.url().includes("/dashboard"), `${viewport.name} session is not authenticated: ${page.url()}`);
  const runtimeViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  assert(runtimeViewport.width === viewport.width && runtimeViewport.height === viewport.height, `${viewport.name} runtime viewport mismatch: ${JSON.stringify(runtimeViewport)}`);
  const mobile = viewport.name === "phone";
  const matrix = {
    cardBrowser: newSurfaceEvidence(runtimeViewport),
    cardIndex: newSurfaceEvidence(runtimeViewport),
  };

  for (const term of searchTerms) matrix.cardBrowser.searches[term] = await browserSearch(page, term, mobile).then(({ locator, ...evidence }) => ({ passed: true, ...evidence }));
  const retainedBrowser = await browserSearch(page, "Iono 124", mobile);
  matrix.cardBrowser.activation = await activate(page, retainedBrowser.locator, `${viewport.name} Card Browser result`);
  matrix.cardBrowser.recovery = await exerciseRecovery({
    page,
    surface: "card-browser",
    viewport,
    resultTable: "pokemon_price_summaries",
    currentResult: (targetPage) => currentBrowserResult(targetPage, mobile),
    input: page.getByPlaceholder("Name..."),
    retained: retainedBrowser,
    artifacts,
  });
  matrix.cardBrowser.measurements.normalOverflow = await assertNoOverflow(page, `${viewport.name} Card Browser normal state`);
  await screenshot(page, `${viewport.name}-card-browser.png`, artifacts);

  await openPokemonIndex(page, mobile);
  for (const term of searchTerms) matrix.cardIndex.searches[term] = await indexSearch(page, term).then(({ locator, ...evidence }) => ({ passed: true, ...evidence }));
  const retainedIndex = await indexSearch(page, "Iono 124");
  const edit = retainedIndex.locator.getByRole("button", { name: `Edit ${regionalName} 124`, exact: true });
  await edit.waitFor({ state: "visible" });
  const editBox = await edit.boundingBox();
  if (mobile) await assertTouchTarget(edit, "Card Index phone edit action");
  matrix.cardIndex.measurements.editAction = { passed: true, accessibleName: await edit.getAttribute("aria-label"), box: editBox };
  matrix.cardIndex.activation = await activate(page, edit, `${viewport.name} Card Index edit action`);
  matrix.cardIndex.recovery = await exerciseRecovery({
    page,
    surface: "card-index",
    viewport,
    resultTable: "pokemon_card_definitions",
    currentResult: currentIndexResult,
    input: page.getByPlaceholder("Search name / set / uid / platform id…"),
    retained: retainedIndex,
    artifacts,
  });
  matrix.cardIndex.measurements.normalOverflow = await assertNoOverflow(page, `${viewport.name} Card Index normal state`);
  await screenshot(page, `${viewport.name}-card-index.png`, artifacts);
  return matrix;
}

const browser = await chromium.connectOverCDP(cdpUrl);
const contexts = browser.contexts();
assert(contexts.length === 1, `expected one Edge context, got ${contexts.length}`);
const context = contexts[0];
const pages = context.pages();
assert(pages.length <= 1, `expected a fresh app-scoped Edge context with at most one page, got ${pages.length}`);
const page = pages[0] ?? await context.newPage();
const artifacts = [];
const matrix = {};

try {
  assert(page.context().browser()?.browserType().name() === "chromium", "CDP target is not Chromium-compatible Edge");
  const userAgent = await page.evaluate(() => navigator.userAgent);
  assert(userAgent.includes("Edg/"), `CDP target is not Microsoft Edge: ${userAgent}`);
  const initialOrigin = new URL(page.url() === "about:blank" ? appUrl : page.url()).origin;
  assert(initialOrigin === appOrigin, `CDP page origin ${initialOrigin} is not ${appOrigin}`);
  const blockedMutations = [];
  await page.route("**/rest/v1/**", async (route) => {
    const method = route.request().method();
    if (method === "GET" || method === "HEAD") return route.continue();
    const url = new URL(route.request().url());
    blockedMutations.push({ method, path: url.pathname });
    await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
  });
  const revisionResponse = await page.request.get(`${appOrigin}/api/build-revision`);
  assert(revisionResponse.status() === 200, `deployed revision endpoint returned ${revisionResponse.status()}`);
  const observedRevision = (await revisionResponse.json()).revision;
  assert(observedRevision === expectedRevision, `deployed revision ${observedRevision} does not match ${expectedRevision}`);
  for (const viewport of viewports) matrix[viewport.name] = await runViewport(page, viewport, artifacts);
  const artifactDigests = Object.fromEntries(artifacts.map((path) => [
    basename(path),
    createHash("sha256").update(readFileSync(path)).digest("hex"),
  ]));
  const manifest = {
    status: "pass",
    completedAt: new Date().toISOString(),
    appUrl: appOrigin,
    finalUrl: page.url(),
    deployedFrontendRevision: { expected: expectedRevision, observed: observedRevision, verified: true },
    mutationFirewall: { scope: "/rest/v1/**", blockedRequests: blockedMutations, allowedMutationRequests: 0, passed: true },
    exactCardUid: cardUid,
    exactExternalId: externalId,
    matrix,
    artifactDigests,
  };
  writeFileSync(join(artifactRoot, "result.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(`G8/G11 production acceptance passed; artifacts: ${artifactRoot}`);
} finally {
  await browser.close();
}

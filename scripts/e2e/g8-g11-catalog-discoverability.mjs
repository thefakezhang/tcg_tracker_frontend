import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const appUrl = process.env.APP_URL;
const apiUrl = process.env.API_URL;
const anonKey = process.env.ANON_KEY;
const authEmail = process.env.E2E_AUTH_EMAIL;
const authPassword = process.env.E2E_AUTH_PASSWORD;
const authSecret = process.env.E2E_AUTH_SECRET;
const artifactRoot = process.env.E2E_ARTIFACT_ROOT;

const cardUid = "da807f6b-e540-44a1-bbbc-1b3179cf9211";
const uidPrefix = cardUid.slice(0, 8);
const expectedRegionalName = "ナンジャモ";
const expectedEnglishName = "Iono";
const expectedTCGPlayerID = "545661";
const expectedCardNumber = "124/SV-P";
const searchTerms = [
  "Iono 124",
  "ナンジャモ 124",
  cardUid,
  expectedTCGPlayerID,
];

if (
  !appUrl
  || !apiUrl
  || !anonKey
  || !authEmail
  || !authPassword
  || !authSecret
  || !artifactRoot
) {
  throw new Error(
    "APP_URL, API_URL, ANON_KEY, E2E_AUTH_EMAIL, E2E_AUTH_PASSWORD, E2E_AUTH_SECRET, and E2E_ARTIFACT_ROOT are required",
  );
}
mkdirSync(artifactRoot, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function authenticate(context) {
  const response = await context.request.post(`${appUrl}/auth/e2e`, {
    headers: { "x-tcg-e2e-secret": authSecret },
  });
  assert(response.status() === 200, `E2E auth returned ${response.status()}`);
}

async function directSession() {
  const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: authEmail, password: authPassword }),
  });
  const body = await response.json();
  assert(response.ok && body.access_token, `direct sign-in failed: ${response.status}`);
  return body.access_token;
}

async function directRequest(token, path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  assert(response.ok, `direct request failed ${response.status}: ${text}`);
  return body;
}

async function getIono(token) {
  const rows = await directRequest(
    token,
    `/rest/v1/pokemon_card_definitions?card_uid=eq.${cardUid}&select=card_id,card_uid,regional_name,english_name,english_name_override,english_name_override_origin,english_name_version`,
  );
  assert(rows.length === 1, `expected one Iono row, got ${rows.length}`);
  return rows[0];
}

async function setEnglishOverride(token, expectedVersion, englishName, evidence) {
  return directRequest(token, "/rest/v1/rpc/card_index_set_pokemon_english_name_override", {
    method: "POST",
    body: JSON.stringify({
      p_card_uid: cardUid,
      p_expected_version: expectedVersion,
      p_english_name: englishName,
      p_expected_tcgplayer_id: expectedTCGPlayerID,
      p_evidence: { browser_evidence: evidence },
    }),
  });
}

async function ensureExpectedIono(token, evidence) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await getIono(token);
    assert(current.regional_name === expectedRegionalName, "Iono regional name changed during fixture reset");
    if (current.english_name === expectedEnglishName) return current;
    const result = await setEnglishOverride(
      token,
      current.english_name_version,
      expectedEnglishName,
      evidence,
    );
    if (result.status === "version_conflict") continue;
    assert(
      result.status === "changed" || result.status === "unchanged",
      `Iono fixture reset was refused: ${JSON.stringify(result)}`,
    );
  }
  const current = await getIono(token);
  assert(current.english_name === expectedEnglishName, "Iono fixture reset exhausted CAS retries");
  return current;
}

async function assertSession(page) {
  assert(page.url().includes("/dashboard"), `session redirected away from dashboard: ${page.url()}`);
  await page.getByText(authEmail, { exact: true }).first().waitFor({ state: "visible", timeout: 30_000 });
}

async function assertNoPageOverflow(page, label) {
  const sizes = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const offenders = [...document.querySelectorAll("body *")]
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          slot: element.getAttribute("data-slot"),
          className: typeof element.className === "string" ? element.className : "",
          left: Math.round(box.left),
          right: Math.round(box.right),
          width: Math.round(box.width),
        };
      })
      .filter((box) => box.left < -1 || box.right > viewport + 1)
      .slice(0, 12);
    return {
      viewport,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      offenders,
    };
  });
  assert(
    sizes.document <= sizes.viewport + 1 && sizes.body <= sizes.viewport + 1,
    `${label} has page overflow: ${JSON.stringify(sizes)}`,
  );
}

async function assertFitsViewport(locator, label) {
  const result = await locator.evaluate((root) => {
    const viewport = window.innerWidth;
    const elements = [root, ...root.querySelectorAll("*")];
    const offenders = elements
      .map((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          text: element.textContent?.replace(/\s+/g, " ").trim().slice(0, 80),
          left: Math.round(box.left),
          right: Math.round(box.right),
          display: style.display,
          visibility: style.visibility,
        };
      })
      .filter((box) => box.display !== "none" && box.visibility !== "hidden" && (box.left < -1 || box.right > viewport + 1));
    return { viewport, offenders: offenders.slice(0, 12) };
  });
  assert(result.offenders.length === 0, `${label} clips visible content: ${JSON.stringify(result)}`);
}

async function assertVisibleInViewport(locator, label) {
  const result = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      top: Math.round(box.top),
      right: Math.round(box.right),
      bottom: Math.round(box.bottom),
      left: Math.round(box.left),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  assert(
    result.top >= 0
      && result.left >= 0
      && result.right <= result.viewportWidth
      && result.bottom <= result.viewportHeight,
    `${label} is outside the viewport: ${JSON.stringify(result)}`,
  );
}

async function assertTouchTarget(locator, label) {
  const box = await locator.boundingBox();
  assert(box && box.height >= 44, `${label} is shorter than 44px: ${JSON.stringify(box)}`);
}

async function assertFocus(locator, label) {
  await locator.focus();
  assert(await locator.evaluate((element) => element === document.activeElement), `${label} did not retain focus`);
}

async function visibleCount(locator) {
  const count = await locator.count();
  let visible = 0;
  for (let index = 0; index < count; index++) {
    if (await locator.nth(index).isVisible()) visible++;
  }
  return visible;
}

async function exerciseBrowserResultActivation(page, result, label) {
  const openAndClose = async (activation) => {
    if (activation === "pointer") {
      await result.click();
    } else {
      await assertFocus(result, `${label} ${activation} target`);
      await page.keyboard.press(activation);
    }
    const dialog = page.getByRole("dialog").last();
    await dialog.waitFor({ state: "visible", timeout: 30_000 });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: 30_000 });
  };

  await openAndClose("pointer");
  await openAndClose("Enter");
  await openAndClose("Space");
}

async function browserSearch(page, term, mobile = false) {
  const input = page.getByPlaceholder("Name...");
  await input.fill(term);
  const result = mobile
    ? page.locator('[data-slot="sidebar-inset"] > main [data-slot="card"]').filter({ hasText: expectedEnglishName })
    : page.locator("tbody tr").filter({ hasText: expectedEnglishName });
  try {
    await result.first().waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    const visibleResults = await page.locator('tbody tr, [data-slot="sidebar-inset"] > main [data-slot="card"]').evaluateAll(
      (elements) => elements
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .map((element) => element.textContent?.replace(/\s+/g, " ").trim()),
    );
    console.error(`Card Browser search ${JSON.stringify(term)} diagnostics: ${JSON.stringify(visibleResults)}`);
    await page.screenshot({ path: `${artifactRoot}/${mobile ? "phone" : "desktop"}-browser-search-failure.png`, fullPage: false });
    throw error;
  }
  await page.waitForTimeout(250);
  assert(await visibleCount(result) === 1, `Card Browser search ${JSON.stringify(term)} did not return one Iono result`);
  const text = await result.first().textContent();
  assert(text?.includes(expectedEnglishName), `Card Browser search ${JSON.stringify(term)} lost the English name`);
  if (mobile) {
    assert(text?.includes(expectedCardNumber), `Card Browser search ${JSON.stringify(term)} returned a card without ${expectedCardNumber}`);
  } else {
    assert(text?.includes(uidPrefix), `Card Browser search ${JSON.stringify(term)} returned a row without ${uidPrefix}`);
  }
  return result.first();
}

async function navigationDiagnostics(page, label) {
  const visibleControls = await page.locator('[data-slot="sidebar-inset"], [data-slot="sidebar"]').evaluateAll((roots) => {
    const seen = new Set();
    return roots.flatMap((root) => [...root.querySelectorAll("button, [role=tab], h1, h2, h3")])
      .filter((element) => {
        if (seen.has(element)) return false;
        seen.add(element);
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        slot: element.getAttribute("data-slot"),
        text: element.textContent?.replace(/\s+/g, " ").trim(),
      }));
  });
  console.error(`${label} navigation diagnostics: ${JSON.stringify(visibleControls)}`);
  await page.screenshot({ path: `${artifactRoot}/${label}-navigation-failure.png`, fullPage: false });
}

async function openPokemonIndex(page, mobile) {
  const dashboardMain = page.locator('[data-slot="sidebar-inset"] > main');
  if (mobile) {
    await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
  }
  const indexNavigation = page.getByRole("button", { name: "Index", exact: true });
  const catalogSelector = dashboardMain.getByRole("button", { name: "Pokémon Sealed", exact: true });
  let transitioned = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    await indexNavigation.click();
    if (mobile) await page.keyboard.press("Escape");
    try {
      await catalogSelector.waitFor({ state: "visible", timeout: 3_000 });
      transitioned = true;
      break;
    } catch {
      await page.waitForTimeout(500);
      if (mobile) await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
    }
  }
  if (!transitioned) {
    await navigationDiagnostics(page, mobile ? "phone" : "desktop");
    throw new Error("Index navigation did not render the catalog selector after three verified clicks");
  }
  await dashboardMain.getByRole("button", { name: "Pokémon", exact: true }).click();
  await dashboardMain.getByPlaceholder("Search name / set / uid / platform id…").waitFor({ state: "visible" });
}

async function indexSearch(page, term) {
  const input = page.getByPlaceholder("Search name / set / uid / platform id…");
  await input.fill(term);
  // Let the 300 ms application debounce invalidate the preceding result before
  // accepting a visible row. Without this boundary, a prior Iono result can
  // satisfy waitFor and disappear while the new PostgREST request is in flight.
  await page.waitForTimeout(500);
  const row = page.locator("tbody tr").filter({ hasText: expectedRegionalName });
  await row.first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(250);
  const count = await visibleCount(row);
  assert(count === 1, `Card Index search ${JSON.stringify(term)} returned ${count} visible Iono rows instead of one`);
  const text = await row.first().textContent();
  assert(text?.includes(expectedRegionalName), `Card Index lost regional name for ${JSON.stringify(term)}`);
  assert(text?.includes(expectedEnglishName), `Card Index lost English name for ${JSON.stringify(term)}`);
  assert(text?.includes(uidPrefix), `Card Index row omitted uid prefix for ${JSON.stringify(term)}`);
  return row.first();
}

async function runDesktop(browser, token) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await authenticate(context);
  const page = await context.newPage();
  await page.goto(`${appUrl}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await assertSession(page);

  for (const term of searchTerms) await browserSearch(page, term);
  const desktopBrowserResult = await browserSearch(page, "Iono 124");
  await exerciseBrowserResultActivation(page, desktopBrowserResult, "desktop Card Browser result");

  let failBrowserExternalLookups = true;
  let failedBrowserExternalRequests = 0;
  const browserExternalRoute = async (route) => {
    if (!failBrowserExternalLookups) return route.continue();
    failedBrowserExternalRequests++;
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: "PGRST500", message: "catalog link lookup unavailable" }),
    });
  };
  await page.route("**/rest/v1/pokemon_external_identifiers**", browserExternalRoute);
  await page.getByPlaceholder("Name...").fill(expectedTCGPlayerID);
  const browserLoadAlert = page.getByRole("alert").filter({ hasText: "External ID lookup is temporarily unavailable." });
  await browserLoadAlert.waitFor({ state: "visible", timeout: 30_000 });
  assert(failedBrowserExternalRequests > 0, "Card Browser external-id failure route did not intercept a request");
  assert(await visibleCount(desktopBrowserResult) === 1, "Card Browser discarded the last successful result after external-id failure");
  assert(await page.getByText("catalog link lookup unavailable", { exact: false }).count() === 0, "Card Browser exposed the raw lookup failure");
  const browserRetry = browserLoadAlert.getByRole("button", { name: "Retry", exact: true });
  await browserRetry.waitFor({ state: "visible" });
  await page.screenshot({ path: `${artifactRoot}/desktop-browser-external-lookup-error.png`, fullPage: false });
  failBrowserExternalLookups = false;
  await browserRetry.click();
  await browserLoadAlert.waitFor({ state: "hidden", timeout: 30_000 });
  await browserSearch(page, expectedTCGPlayerID);
  await page.unroute("**/rest/v1/pokemon_external_identifiers**", browserExternalRoute);

  await assertNoPageOverflow(page, "desktop Card Browser");
  await page.screenshot({ path: `${artifactRoot}/desktop-card-browser.png`, fullPage: false });

  await openPokemonIndex(page, false);
  for (const term of searchTerms) await indexSearch(page, term);
  const indexInput = page.getByPlaceholder("Search name / set / uid / platform id…");

  const retainedIndexRow = await indexSearch(page, "Iono 124");
  let failExternalLookups = true;
  let failedExternalRequests = 0;
  const externalRoute = async (route) => {
    if (!failExternalLookups) return route.continue();
    failedExternalRequests++;
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: "PGRST500", message: "catalog link lookup unavailable" }),
    });
  };
  await page.route("**/rest/v1/pokemon_external_identifiers**", externalRoute);
  await indexInput.fill(expectedTCGPlayerID);
  const loadError = page.getByRole("alert").filter({ hasText: "External ID lookup is temporarily unavailable." });
  await loadError.waitFor({ state: "visible", timeout: 30_000 });
  assert(failedExternalRequests > 0, "external-id failure route did not intercept a request");
  assert(await visibleCount(retainedIndexRow) === 1, "Card Index discarded the last successful result after external-id failure");
  assert(await page.getByText("catalog link lookup unavailable", { exact: false }).count() === 0, "Card Index exposed the raw lookup failure");
  const retry = loadError.getByRole("button", { name: "Retry", exact: true });
  await retry.waitFor({ state: "visible" });
  await page.screenshot({ path: `${artifactRoot}/desktop-external-lookup-error.png`, fullPage: false });
  failExternalLookups = false;
  await retry.click();
  await loadError.waitFor({ state: "hidden", timeout: 30_000 });
  await indexSearch(page, expectedTCGPlayerID);
  await page.unroute("**/rest/v1/pokemon_external_identifiers**", externalRoute);

  const staleRow = await indexSearch(page, "Iono 124");
  const before = await getIono(token);
  assert(before.regional_name === expectedRegionalName, "regional name was wrong before stale-CAS evidence");
  assert(before.english_name === expectedEnglishName, "English name was wrong before stale-CAS evidence");
  await staleRow.getByTitle("Edit").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("heading", { name: "Edit pokemon card", exact: true }).waitFor({ state: "visible" });
  const modalInputs = dialog.locator('input:not([type="file"])');
  assert(await modalInputs.nth(0).inputValue() === expectedRegionalName, "edit modal changed the regional name");
  assert(await modalInputs.nth(1).inputValue() === expectedEnglishName, "edit modal did not load the effective English name");
  const platformDeleteButtons = dialog.locator('button[aria-label^="Remove link:"]');
  const platformDeleteCount = await platformDeleteButtons.count();
  assert(platformDeleteCount > 0, "edit modal did not expose any named platform-link delete actions");
  for (let index = 0; index < platformDeleteCount; index++) {
    const button = platformDeleteButtons.nth(index);
    const label = await button.getAttribute("aria-label");
    const title = await button.getAttribute("title");
    assert(label?.trim(), `platform-link delete action ${index} has no accessible name`);
    assert(title?.trim(), `platform-link delete action ${index} has no title`);
  }

  let concurrent;
  try {
    concurrent = await setEnglishOverride(
      token,
      before.english_name_version,
      "Iono concurrent browser evidence",
      "stale-conflict-concurrent-write",
    );
    assert(concurrent.status === "changed", `concurrent update did not change: ${JSON.stringify(concurrent)}`);
    await modalInputs.nth(1).fill("Iono stale browser attempt");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    const conflictAlert = dialog.getByRole("alert").filter({
      hasText: "This card changed while the editor was open. Reload it before saving again.",
    });
    await conflictAlert.waitFor({ state: "visible", timeout: 30_000 });
    await assertVisibleInViewport(conflictAlert, "stale-CAS mutation alert");
    assert(
      await conflictAlert.evaluate((element) => document.activeElement === element),
      "stale-CAS mutation alert did not receive programmatic focus",
    );
    await page.screenshot({ path: `${artifactRoot}/desktop-version-conflict.png`, fullPage: false });

    const afterConflict = await getIono(token);
    assert(
      afterConflict.english_name === "Iono concurrent browser evidence"
        && afterConflict.english_name_version === concurrent.version,
      "stale UI save changed the concurrently written English name",
    );
  } finally {
    await ensureExpectedIono(token, "stale-conflict-finally-restore");
  }

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.screenshot({ path: `${artifactRoot}/desktop-after-conflict-close.png`, fullPage: false });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForLoadState("load");
  await assertSession(page);
  await openPokemonIndex(page, false);
  await indexSearch(page, "Iono 124");
  const restoredRow = page.locator("tbody tr").filter({ hasText: expectedRegionalName }).first();
  const restoredText = await restoredRow.textContent();
  assert(restoredText?.includes(expectedRegionalName), "reload lost the regional Japanese name");
  assert(restoredText?.includes(expectedEnglishName), "reload did not show the restored English name");
  await assertNoPageOverflow(page, "desktop Card Index");
  await page.screenshot({ path: `${artifactRoot}/desktop-card-index.png`, fullPage: false });
  await context.close();
}

async function runPhone(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await authenticate(context);
  const page = await context.newPage();
  await page.goto(`${appUrl}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  assert(page.url().includes("/dashboard"), `phone session redirected away from dashboard: ${page.url()}`);

  const browserName = page.getByPlaceholder("Name...");
  await page.getByText("Name or identifier", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("Card number", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("Set code", { exact: true }).waitFor({ state: "visible" });
  const refreshButton = page.getByRole("button", { name: "Refresh", exact: true });
  await refreshButton.waitFor({ state: "visible" });
  assert(await refreshButton.getAttribute("title") === "Refresh", "Card Browser refresh action has no matching title");
  await assertTouchTarget(browserName, "phone Card Browser name search");
  await assertTouchTarget(page.getByLabel("No.", { exact: true }), "phone card-number numerator");
  await assertTouchTarget(page.getByLabel("Total", { exact: true }), "phone card-number denominator");
  await assertTouchTarget(page.getByPlaceholder("Set code..."), "phone set-code search");
  await assertFocus(browserName, "phone Card Browser name search");
  for (const term of searchTerms) await browserSearch(page, term, true);
  await browserName.fill("Iono 124");
  const phoneBrowserCard = page.locator('[data-slot="sidebar-inset"] > main [data-slot="card"]')
    .filter({ hasText: expectedEnglishName })
    .first();
  await phoneBrowserCard.waitFor({ state: "visible" });
  await exerciseBrowserResultActivation(page, phoneBrowserCard, "phone Card Browser result");
  const columns = await page.getByTestId("browser-search-grid").evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
  );
  assert(columns === 1, `phone Card Browser search grid has ${columns} columns`);
  const priceFilters = page.getByTestId("browser-price-filters");
  const priceColumns = await priceFilters.evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length,
  );
  assert(priceColumns === 1, `phone price filter grid has ${priceColumns} columns`);
  const priceFilterBox = await priceFilters.boundingBox();
  assert(priceFilterBox, "phone price filter grid has no bounding box");
  const priceInputs = priceFilters.locator("input");
  assert(await priceInputs.count() === 4, "phone price filter grid does not contain four controls");
  for (let index = 0; index < 4; index++) {
    const input = priceInputs.nth(index);
    const box = await input.boundingBox();
    assert(
      box && Math.abs(box.width - priceFilterBox.width) <= 1,
      `phone price control ${index} is not full-width: ${JSON.stringify({ box, priceFilterBox })}`,
    );
    await assertTouchTarget(input, `phone price control ${index}`);
  }
  await assertFitsViewport(priceFilters, "phone price filters");
  await assertNoPageOverflow(page, "phone Card Browser");
  await assertFitsViewport(phoneBrowserCard, "phone Card Browser result");
  await page.screenshot({ path: `${artifactRoot}/phone-card-browser.png`, fullPage: true });

  await openPokemonIndex(page, true);
  const indexInput = page.getByPlaceholder("Search name / set / uid / platform id…");
  await page.getByText("Catalog search", { exact: true }).waitFor({ state: "visible" });
  await assertTouchTarget(indexInput, "phone Card Index search");
  await assertTouchTarget(page.getByRole("button", { name: "New card", exact: true }), "phone New card action");
  await assertFocus(indexInput, "phone Card Index search");
  for (const term of searchTerms) await indexSearch(page, term);
  await indexInput.fill("Iono 124");
  const phoneIndexRow = page.locator("tbody tr").filter({ hasText: expectedRegionalName }).first();
  await phoneIndexRow.waitFor({ state: "visible" });
  await assertNoPageOverflow(page, "phone Card Index");
  await assertFitsViewport(phoneIndexRow, "phone Card Index result");

  const mainControls = [
    page.getByRole("button", { name: "Pokémon Sealed", exact: true }).last(),
    page.getByRole("button", { name: "Pokémon", exact: true }).last(),
    page.getByRole("button", { name: "Magic: The Gathering", exact: true }).last(),
    indexInput,
    page.getByRole("button", { name: "New card", exact: true }),
  ];
  for (const control of mainControls) {
    const box = await control.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 390, `phone Card Index control is clipped: ${JSON.stringify(box)}`);
  }
  await page.screenshot({ path: `${artifactRoot}/phone-card-index.png`, fullPage: true });
  await context.close();
}

const browser = await chromium.launch();
try {
  const token = await directSession();
  await ensureExpectedIono(token, "browser-evidence-idempotent-setup");
  await runDesktop(browser, token);
  await runPhone(browser);
  const finalIono = await getIono(token);
  assert(finalIono.regional_name === expectedRegionalName, "final regional name changed");
  assert(finalIono.english_name === expectedEnglishName, "final English name was not restored");
  console.log(`G8/G11 catalog browser evidence passed; artifacts: ${artifactRoot}`);
} finally {
  await browser.close();
}

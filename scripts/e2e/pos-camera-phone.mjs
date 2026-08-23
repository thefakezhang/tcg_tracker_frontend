import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const appUrl = process.env.APP_URL;
const authSecret = process.env.E2E_AUTH_SECRET;
const apiUrl = process.env.SUPABASE_API_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userAccessToken = process.env.POS_USER_ACCESS_TOKEN;
const fixture = process.env.POS_FIXTURE_JSON
  ? JSON.parse(process.env.POS_FIXTURE_JSON)
  : null;
const capturePath = process.env.POS_CAPTURE_PATH;
if (!appUrl || !authSecret || !apiUrl || !anonKey || !serviceRoleKey
    || !userAccessToken || !fixture || !capturePath) {
  throw new Error(
    "APP_URL, E2E_AUTH_SECRET, SUPABASE_API_URL, SUPABASE_ANON_KEY, "
      + "SUPABASE_SERVICE_ROLE_KEY, POS_USER_ACCESS_TOKEN, POS_FIXTURE_JSON, "
      + "and POS_CAPTURE_PATH are required",
  );
}

const artifactRoot = process.env.E2E_ARTIFACT_ROOT ?? "/tmp/tcg-pos-camera-e2e";
mkdirSync(artifactRoot, { recursive: true });
const expectedConnectionResetConsoles = new WeakMap();
const browserErrorWatchCleanups = new WeakMap();

const acceptanceViewports = [
  { name: "phone", width: 390, height: 844, hasTouch: true, isMobile: true },
  { name: "desktop", width: 1440, height: 900, hasTouch: false, isMobile: false },
];

function recognitionStatus(inventoryLeg) {
  return {
    status: "ready",
    model_catalog_ready: true,
    sale_ready: true,
    sale_scope_error: null,
    inventory_leg: inventoryLeg,
    model_fingerprint: "pos-browser-model-v1",
    catalog_fingerprint: "pos-browser-catalog-v1",
    catalog_generation: "00000000-0000-4000-8000-000000000001",
    catalog_reload_error: null,
    identity_count: 1,
    recognizer_config_fingerprint: "pos-browser-config-v1",
    feature_cache: { required: 1, available: 1, missing: 0 },
    service_build_sha: "1234512345123451234512345123451234512345",
    runtime_lock_sha256: "2".repeat(64),
    recognizer_device: "cuda:0",
    cuda_device_name: "Local browser gate CUDA fixture",
    cuda_required: true,
    launch_policy: "confirmation_required",
    queue_depth: 0,
    queue_capacity: 1,
  };
}

function recognitionCandidate(card) {
  return {
    card_uid: card.cardUID,
    regional_name: card.regionalName,
    english_name: card.englishName,
    set_code: card.setCode,
    card_number: card.cardNumber,
    misc_info: card.miscInfo,
    language: card.language,
    image_url: null,
    clip_score: 0.98,
    sift_good_matches: 24,
    sift_inliers: 21,
    sift_inlier_ratio: 0.875,
    rank: 1,
    verification_state: "verified",
  };
}

async function installRecognizerRoutes(page, card) {
  await page.route("**/v1/status**", async (route) => {
    const requestURL = new URL(route.request().url());
    const inventoryLeg = requestURL.searchParams.get("inventory_leg");
    assert(
      inventoryLeg === null || inventoryLeg === "import" || inventoryLeg === "export",
      `unexpected recognizer inventory leg ${inventoryLeg}`,
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(recognitionStatus(inventoryLeg)),
    });
  });
  await page.route("**/v1/recognize**", async (route) => {
    const request = route.request();
    const requestURL = new URL(request.url());
    const requestID = request.headers()["x-recognition-request-id"];
    const useCase = requestURL.searchParams.get("use_case");
    const inventoryLeg = requestURL.searchParams.get("inventory_leg");
    const capture = request.postDataBuffer();
    assert(requestID, "recognizer request omitted its stable request UUID");
    assert(capture?.length, "recognizer request omitted capture bytes");
    assert(useCase === "sale" || useCase === "acquisition", "invalid recognizer use case");
    assert(
      (useCase === "sale" && inventoryLeg === "import")
        || (useCase === "acquisition" && inventoryLeg === null),
      "recognizer request used the wrong inventory scope",
    );
    const digest = createHash("sha256").update(capture).digest("hex");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "X-Request-ID": requestID,
        "Server-Timing": "decode;dur=4, clip;dur=12, sift;dur=18, total;dur=40",
      },
      body: JSON.stringify({
          request_id: requestID,
          use_case: useCase,
          capture_sha256: digest,
          capture_bytes: capture.length,
          capture_width: 733,
          capture_height: 1024,
          crop: {},
          scope: useCase === "sale" ? "available_inventory" : "full_catalog",
          inventory_leg: useCase === "sale" ? inventoryLeg : null,
          candidate_count: 1,
          candidates: [recognitionCandidate(card)],
          ambiguous: true,
          confirmation_required: true,
          model_fingerprint: "pos-browser-model-v1",
          catalog_fingerprint: "pos-browser-catalog-v1",
          recognizer_config_fingerprint: "pos-browser-config-v1",
          timing_ms: { decode: 4, clip: 12, sift: 18, total: 40 },
          inventory_age_ms: useCase === "sale" ? 25 : null,
      }),
    });
  });
}

async function installCamera(page) {
  await page.addInitScript(() => {
    window.__posE2EGetUserMediaCalls = 0;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          window.__posE2EGetUserMediaCalls += 1;
          const canvas = document.createElement("canvas");
          canvas.width = 1280;
          canvas.height = 720;
          const context2d = canvas.getContext("2d");
          if (!context2d) throw new Error("camera acceptance canvas is unavailable");
          window.__posE2ECameraFrame = "card";
          const paint = () => {
            const showingCard = window.__posE2ECameraFrame === "card";
            context2d.fillStyle = showingCard ? "rgb(32, 30, 90)" : "rgb(230, 230, 230)";
            context2d.fillRect(0, 0, canvas.width, canvas.height);
            if (showingCard) {
              context2d.fillStyle = "#f7d44a";
              context2d.fillRect(390, 55, 500, 610);
              context2d.fillStyle = "#14365a";
              context2d.fillRect(420, 90, 440, 400);
              context2d.fillStyle = "white";
              context2d.font = "bold 54px sans-serif";
              context2d.fillText("POS CAMERA", 455, 565);
            }
            requestAnimationFrame(paint);
          };
          paint();
          return canvas.captureStream(30);
        },
      },
    });
  });
}

function expectConnectionResetConsole(page, rpcName) {
  const expected = expectedConnectionResetConsoles.get(page) ?? new Map();
  const path = `/rest/v1/rpc/${rpcName}`;
  expected.set(path, (expected.get(path) ?? 0) + 1);
  expectedConnectionResetConsoles.set(page, expected);
}

function consumeExpectedConnectionResetConsole(page, message) {
  if (!/^Failed to load resource: net::ERR_(?:FAILED|CONNECTION_RESET)$/.test(message.text())) {
    return false;
  }
  const url = message.location().url;
  const expected = expectedConnectionResetConsoles.get(page);
  if (!expected || !url) return false;
  for (const [path, count] of expected) {
    if (!url.includes(path) || count < 1) continue;
    if (count === 1) expected.delete(path);
    else expected.set(path, count - 1);
    return true;
  }
  return false;
}

function consumeExpectedStorageReplayConsole(message) {
  return message.text() === "Failed to load resource: the server responded with a status of 400 (Bad Request)"
    && message.location().url.includes(
      `/storage/v1/object/inventory-card-media/${fixture.ownerID}/`,
    );
}

function watchBrowserErrors(page, failures) {
  const onPageError = (error) => failures.push(`pageerror: ${error.message}`);
  const onConsole = (message) => {
    if (
      message.type() === "error"
      && !consumeExpectedConnectionResetConsole(page, message)
      && !consumeExpectedStorageReplayConsole(message)
    ) failures.push(`console: ${message.text()} @ ${message.location().url}`);
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  browserErrorWatchCleanups.set(page, () => {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
  });
}

async function preparedPage(context, viewport, failures, waitForRecognizer = true) {
  const page = await context.newPage();
  await installCamera(page);
  watchBrowserErrors(page, failures);
  await installRecognizerRoutes(page, fixture.card);
  await openPOS(page, viewport, waitForRecognizer);
  return page;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function adminRows(path, init = {}) {
  const response = await fetch(`${apiUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.text();
  assert(response.ok, `local PostgREST ${path} returned ${response.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

async function authenticatedRows(path, init = {}) {
  const response = await fetch(`${apiUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${userAccessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.text();
  assert(response.ok, `authenticated local PostgREST ${path} returned ${response.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

async function authenticate(context) {
  const authResponse = await context.request.post(`${appUrl}/auth/e2e`, {
    headers: { "x-tcg-e2e-secret": authSecret },
  });
  assert(authResponse.status() === 200, `local E2E auth returned ${authResponse.status()}`);
}

async function openPOS(page, viewport, waitForRecognizer = true) {
  await page.goto(`${appUrl}/dashboard`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForLoadState("load");
  if (viewport.isMobile) {
    const sidebarTrigger = page.getByRole("button", { name: "Toggle Sidebar" }).first();
    await assertTapTarget(sidebarTrigger, `${viewport.name} sidebar trigger`);
    await sidebarTrigger.click();
    const mobileSidebar = page.locator('[data-mobile="true"]');
    await mobileSidebar.waitFor({ state: "visible" });
    const navigation = mobileSidebar.getByRole("button", {
      name: "Camera POS",
      exact: true,
    });
    await assertTapTarget(navigation, `${viewport.name} Camera POS navigation`);
    await navigation.click();
    await mobileSidebar.waitFor({ state: "hidden" });
  } else {
    await page.getByRole("button", { name: "Camera POS", exact: true }).click();
  }
  await page.getByTestId("pos-view").waitFor({ state: "visible" });
  if (waitForRecognizer) {
    await page.getByText(/Recognizer ready/).waitFor({ state: "visible" });
  }
  await assertNoHorizontalOverflow(page, `${viewport.width}px Camera POS`);
}

async function verifyJapaneseDocumentLanguage(page, viewport) {
  const sidebarTrigger = page.getByRole("button", { name: "Toggle Sidebar" }).first();
  await sidebarTrigger.click();
  const mobileSidebar = page.locator('[data-mobile="true"]');
  await mobileSidebar.waitFor({ state: "visible" });
  const accountTrigger = mobileSidebar
    .locator('[data-slot="sidebar-footer"] [data-slot="dropdown-menu-trigger"]')
    .first();
  await accountTrigger.scrollIntoViewIfNeeded();
  await accountTrigger.waitFor({ state: "visible" });
  await accountTrigger.click();
  await page.getByRole("menuitemradio", { name: "日本語", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.lang === "ja");
  // Changing locale re-renders the complete sidebar, including the portaled menu
  // trigger. Reset persisted test state before the following independent CUJ
  // rather than coupling its cleanup to that remount timing.
  await page.evaluate(() => localStorage.setItem("language", "en"));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await openPOS(page, viewport);
}

async function selectRecognitionCandidate(page) {
  await page.evaluate(() => { window.__posE2ECameraFrame = "card"; });
  const startCamera = page.getByRole("button", { name: "Start camera", exact: true });
  if (await startCamera.isVisible()) await startCamera.click();
  await page.getByRole("button", { name: "Scan now", exact: true }).waitFor();
  assert(
    await page.evaluate(() => window.__posE2EGetUserMediaCalls > 0),
    "camera path did not request an authenticated media stream",
  );
  const candidate = page.getByTestId("pos-candidates").getByRole("button").first();
  await candidate.waitFor({ state: "visible", timeout: 15_000 });
  await candidate.click();
  await page.getByRole("button", { name: "Confirm identity", exact: true }).click();
}

async function removeCardAndWaitForRearm(page) {
  await page.evaluate(() => { window.__posE2ECameraFrame = "background"; });
  await page.getByText("Watching for a steady card", { exact: true }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

async function reviewRoundTripQuantity(page, viewport) {
  const lineCard = page.getByTestId("pos-sale-lines").locator("div.rounded-lg.border").first();
  await lineCard.getByRole("button", { name: "Decrease quantity" }).click();
  let review = page.getByRole("region", { name: "Review quoted line change" });
  await review.waitFor();
  assert(
    await review.evaluate((element) => element === document.activeElement),
    "quoted decrease review did not receive keyboard focus",
  );
  await assertNoHorizontalOverflow(page, `${viewport.name} decrease quote review`);
  await review.getByRole("button", { name: "Apply quoted change" }).click();
  await lineCard.getByRole("button", { name: "Increase quantity" }).click();
  review = page.getByRole("region", { name: "Review quoted line change" });
  await review.waitFor();
  await assertNoHorizontalOverflow(page, `${viewport.name} increase quote review`);
  await review.getByRole("button", { name: "Apply quoted change" }).click();
}

async function assertTapTarget(locator, label, minimum = 43) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  assert(box, `${label} has no pointer bounds`);
  assert(
    box.width >= minimum && box.height >= minimum,
    `${label} is ${box.width.toFixed(1)}x${box.height.toFixed(1)}, below ${minimum + 1}px`,
  );
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(
    dimensions.document <= dimensions.viewport + 1
      && dimensions.body <= dimensions.viewport + 1,
    `${label} overflowed horizontally: ${JSON.stringify(dimensions)}`,
  );
}

async function clickAndLoseCommittedResponse(page, rpcName, button) {
  let committed = false;
  let resolveCommit;
  const committedRequest = new Promise((resolve) => { resolveCommit = resolve; });
  let resolveReconciliationLoss;
  const reconciliationLost = new Promise((resolve) => { resolveReconciliationLoss = resolve; });
  const reconciliationRPC = rpcName === "add_pos_sale_line"
    ? "get_pos_sale_session_state"
    : "get_pos_acquisition_operation_state";
  await page.route(`**/rest/v1/rpc/${reconciliationRPC}`, async (route) => {
    if (committed) {
      expectConnectionResetConsole(page, reconciliationRPC);
      await route.abort("connectionreset");
      resolveReconciliationLoss();
      return;
    }
    await route.continue();
  });
  await page.route(`**/rest/v1/rpc/${rpcName}`, async (route) => {
    if (committed) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const responseText = await response.text();
    assert(
      response.ok(),
      `${rpcName} did not commit before simulated response loss: ${responseText}`,
    );
    committed = true;
    expectConnectionResetConsole(page, rpcName);
    await route.abort("connectionreset");
    resolveCommit();
  });
  try {
    await button.click();
  } catch (cause) {
    await page.screenshot({
      path: `${artifactRoot}/${rpcName}-disabled.png`,
      fullPage: true,
    });
    throw new Error(
      `${rpcName} control did not become actionable: `
        + `${await page.getByTestId("pos-view").innerText()}`,
      { cause },
    );
  }
  let timeout;
  try {
    await Promise.all([
      page.waitForFunction(
        (name) => [...Object.keys(localStorage)].some((key) => (
          key.includes("tcg-pos-camera:v1:") && key.endsWith(`:${name}`)
        )),
        rpcName === "add_pos_sale_line" ? "sale-add" : "acquisition-add",
      ),
      Promise.race([
        Promise.all([committedRequest, reconciliationLost]),
        new Promise((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error(
              `${rpcName} did not reach its committed response-loss and reconciliation-loss boundaries`,
            )),
            30_000,
          );
        }),
      ]),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  assert(committed, `${rpcName} response-loss route was not exercised`);
  await page.unroute(`**/rest/v1/rpc/${rpcName}`);
  await page.unroute(`**/rest/v1/rpc/${reconciliationRPC}`);
}

async function interruptAfterFirstMediaUpload(page, button) {
  const uploaded = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes("/storage/v1/object/inventory-card-media/")
  ));
  const clicked = button.click().catch(() => undefined);
  const response = await uploaded;
  assert(response.ok(), `first durable media upload failed with ${response.status()}`);
  const storagePath = new URL(response.url()).pathname;
  assert(
    storagePath.includes(`/inventory-card-media/${fixture.ownerID}/`),
    "partial upload escaped the authenticated owner's exact storage prefix",
  );
  browserErrorWatchCleanups.get(page)?.();
  await page.close({ runBeforeUnload: false });
  await clicked;
}

async function loseCommittedMediaRegistrationOnReload(page) {
  let committed = false;
  let resolveCommit;
  const committedRequest = new Promise((resolve) => { resolveCommit = resolve; });
  let resolveReconciliationLoss;
  const reconciliationLost = new Promise((resolve) => { resolveReconciliationLoss = resolve; });
  let timeout;
  await page.route("**/rest/v1/rpc/get_pos_acquisition_operation_state", async (route) => {
    if (committed) {
      expectConnectionResetConsole(page, "get_pos_acquisition_operation_state");
      await route.abort("connectionreset");
      resolveReconciliationLoss();
      return;
    }
    await route.continue();
  });
  await page.route("**/rest/v1/rpc/register_inventory_card_media", async (route) => {
    assert(!committed, "media registration unexpectedly retried before reload");
    const response = await route.fetch();
    const responseText = await response.text();
    assert(
      response.ok(),
      `media registration did not commit before response loss: ${responseText}`,
    );
    committed = true;
    expectConnectionResetConsole(page, "register_inventory_card_media");
    await route.abort("connectionreset");
    resolveCommit();
  });
  await page.reload({ waitUntil: "load" });
  try {
    await Promise.race([
      Promise.all([committedRequest, reconciliationLost]),
      new Promise((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("media registration was not attempted during reload recovery")),
          30_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  await page.waitForFunction(() => (
    Object.keys(localStorage).some((key) => key.endsWith(":acquisition-add"))
  ));
  assert(committed, "media registration response-loss route was not exercised");
  await page.unroute("**/rest/v1/rpc/register_inventory_card_media");
  await page.unroute("**/rest/v1/rpc/get_pos_acquisition_operation_state");
}

async function runSaleCUJ(page, viewport, index) {
  const startSale = page.getByRole("button", { name: "Start sale", exact: true });
  if (await startSale.isVisible()) await startSale.click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByText("Paused", { exact: true }).waitFor();
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("pos-view").waitFor();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByText("Draft", { exact: true }).waitFor();

  await selectRecognitionCandidate(page);
  const sku = page.getByTestId("pos-sale-skus").getByRole("button").first();
  await sku.waitFor();
  await sku.click();
  await page.locator("#pos-sale-qty").fill("3");
  const add = page.getByRole("button", { name: "Add to saved sale", exact: true });
  await assertTapTarget(add, `${viewport.name} sale add`, viewport.hasTouch ? 43 : 31);
  if (index === 0) {
    await clickAndLoseCommittedResponse(page, "add_pos_sale_line", add);
    const pendingKey = await page.evaluate(() => (
      Object.keys(localStorage).find((key) => key.endsWith(":sale-add")) ?? null
    ));
    assert(pendingKey, "sale response loss did not retain its exact durable operation");
    await page.reload({ waitUntil: "load" });
    const recovery = page.getByTestId("pos-pending-sale-recovery");
    if (await recovery.isVisible()) {
      const resume = recovery.getByRole("button", { name: "Retry exact saved add" });
      await assertTapTarget(resume, `${viewport.name} sale recovery`, viewport.hasTouch ? 43 : 31);
      await resume.click();
    }
    await page.getByTestId("pos-sale-lines").locator("div.rounded-lg.border").first().waitFor();
    await page.waitForFunction(() => (
      !Object.keys(localStorage).some((key) => key.endsWith(":sale-add"))
    ));
  } else {
    await add.click();
    await page.getByText(/was added/).waitFor();
  }
  if (index === 1) {
    await page.getByText(/Remove it from the guide/).waitFor();
    const cameraAction = page.getByRole("button", { name: "Scan now", exact: true });
    const cameraHandle = await cameraAction.elementHandle();
    assert(cameraHandle, "warm camera action disappeared after the saved sale");
    await page.waitForFunction(
      (element) => element === document.activeElement,
      cameraHandle,
    );
    assert(
      await cameraAction.evaluate((element) => element === document.activeElement),
      "saved sale did not return keyboard focus to the warm camera",
    );
    await removeCardAndWaitForRearm(page);
  }
  const lineCard = page.getByTestId("pos-sale-lines").locator("div.rounded-lg.border").first();
  await lineCard.waitFor();
  const expectedPreview = index === 0 ? "$50.00" : "$90.00";
  assert(
    (await lineCard.textContent()).includes(expectedPreview),
    `sale preview did not use expected FIFO COGS ${expectedPreview}`,
  );
  await reviewRoundTripQuantity(page, viewport);
  if (index === 0) {
    await adminRows("rpc/record_lot_sale", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        p_items: [{
          kind: "single",
          game: "pokemon",
          card_id: fixture.cardID,
          condition_id: fixture.conditionID,
          psa_grade: 0,
          lot_line_id: fixture.layerIDs[0],
          quantity: 2,
          market_value_usd: 100,
          explicit_gross: 200,
        }],
        p_sold_at: "2026-08-11",
        p_leg: "import",
        p_orig_currency: "USD",
        p_fx_rate: 1,
        p_platform_label: `POS camera E2E competing ${fixture.token}`,
        p_notes: "authoritative competing FIFO sale for browser revalidation",
        p_gross_total: 200,
        p_sale_expenses: [],
        p_allocation_method: "explicit_prices",
      }),
    });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Finalize sale", exact: true }).click();
    const changed = page.getByText("Preview COGS changed from $50.00 to $90.00.", {
      exact: true,
    });
    await changed.waitFor();
    const changedLine = page.getByTestId("pos-sale-lines").locator('[tabindex="-1"]').first();
    assert(await changedLine.evaluate((element) => element === document.activeElement), "changed FIFO line did not receive focus");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", {
      name: "Confirm refreshed FIFO and finalize",
      exact: true,
    }).click();
  } else {
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Finalize sale", exact: true }).click();
  }
  await page.getByText(/Sale finalized:/).waitFor();
  const reverse = page.getByRole("button", { name: "Reverse finalized sale", exact: true });
  await assertTapTarget(reverse, `${viewport.name} sale reversal`, viewport.hasTouch ? 43 : 31);
  page.once("dialog", (dialog) => dialog.accept());
  await reverse.click();
  await page.getByRole("status").getByText(
    "This finalized sale was reversed in the ledger",
    { exact: true },
  ).waitFor();
  await page.screenshot({
    path: `${artifactRoot}/${viewport.name}-sale.png`,
    fullPage: true,
  });
}

async function runAcquisitionCUJ(context, page, viewport, index, failures) {
  const acquire = page.getByRole("tab", { name: "Acquire", exact: true });
  await acquire.click();
  await selectRecognitionCandidate(page);
  await page.locator("#pos-acquisition-lot").selectOption(String(fixture.lotIDs[index]));
  await page.locator("#pos-acq-cost").fill("830");
  await page.locator("#pos-acq-market").fill("12.34");
  const captureToggle = page.getByText(
    "Use this recognition capture as the single private front image",
    { exact: true },
  );
  await captureToggle.waitFor();
  await page.getByTestId("pos-match-panel").getByText(
    new RegExp(`JPY ${index + 1}`),
  ).waitFor();
  await page.getByText(/2026-08-11 · Import · cost currency JPY/).waitFor();
  if (index === 0) {
    const backInput = page.getByText("back", { exact: true })
      .locator('input[type="file"]');
    await backInput.setInputFiles(capturePath);
    await page.getByText(/back: .*exact-reselect.*\.jpg/).waitFor();
  }
  await page.getByText(/830 JPY.*\$5\.478000.*0\.0066/).waitFor();

  const add = page.getByRole("button", { name: "Add to acquisition lot", exact: true });
  await assertTapTarget(add, `${viewport.name} acquisition add`, viewport.hasTouch ? 43 : 31);
  if (index === 0) {
    await interruptAfterFirstMediaUpload(page, add);
    page = await preparedPage(context, viewport, failures, false);
    const recovery = page.getByTestId("pos-pending-acquisition-recovery");
    await recovery.waitFor({ state: "visible" });
    const reselects = recovery.locator('input[type="file"]');
    const reselectCount = await reselects.count();
    assert(
      reselectCount <= 1,
      `partial upload recovery requested more than one file: ${await recovery.innerText()}`,
    );
    if (reselectCount === 1) {
      const pendingCard = reselects.first().locator("xpath=ancestor::div[contains(@class,'rounded-lg')]");
      assert((await pendingCard.textContent()).includes("back"), "partial upload recovery requested the wrong media kind");
      await reselects.first().setInputFiles(capturePath);
    }
    const resume = recovery.getByRole("button", { name: "Resume exact acquisition" });
    await assertTapTarget(resume, `${viewport.name} acquisition recovery`, viewport.hasTouch ? 43 : 31);
    await clickAndLoseCommittedResponse(page, "add_recognized_card_to_lot", resume);
    const committedRecovery = page.getByTestId("pos-pending-acquisition-recovery");
    await committedRecovery.waitFor({ state: "visible" });
    assert(
      await committedRecovery.locator('input[type="file"]').count() === 0,
      "committed acquisition unexpectedly requested media already proven durable",
    );
    await loseCommittedMediaRegistrationOnReload(page);
    await page.reload({ waitUntil: "load" });
  } else {
    await add.click();
  }
  await page.getByText(/was added to acquisition lot/).waitFor();
  await page.screenshot({
    path: `${artifactRoot}/${viewport.name}-acquisition.png`,
    fullPage: true,
  });
  return page;
}

async function assertAuthoritativeState() {
  const sessions = await adminRows(
    `pos_sale_sessions?owner_id=eq.${fixture.ownerID}`
      + "&select=session_id,status,sale_group,finalized_cogs_usd,finalized_gross_usd",
  );
  assert(sessions.length === 2, `expected two owner-scoped sale sessions, got ${sessions.length}`);
  assert(sessions.every((session) => session.status === "finalized"), "a browser sale did not reach durable finalized state");
  assert(
    new Set(sessions.map((session) => session.sale_group)).size === 2
      && sessions.every((session) => Number.isInteger(session.sale_group)),
    "finalized POS sessions did not reference two unique durable sale groups",
  );
  const lines = await adminRows(
    `pos_sale_session_lines?session_id=in.(${sessions.map((row) => row.session_id).join(",")})`
      + "&select=line_id,quantity,preview_cogs_usd",
  );
  assert(lines.length === 2, `expected two sale lines, got ${lines.length}`);
  assert(lines.every((line) => line.quantity === 3), "sale line quantities were not exact");
  assert(
    lines.map((line) => Number(line.preview_cogs_usd)).sort((left, right) => left - right)
      .join(",") === "90,90",
    "FIFO revalidation COGS did not freeze at exactly 90.00 per POS sale",
  );
  const saleItems = await adminRows(
    `sale_lot_items?sale_group=in.(${sessions.map((row) => row.sale_group).join(",")})`
      + "&select=sale_group,item_index,card_id,condition_id,quantity,cogs_usd",
  );
  assert(saleItems.length === 2, `expected two finalized POS sale rows, got ${saleItems.length}`);
  assert(
    saleItems.every((item) => (
      item.card_id === fixture.cardID
      && item.condition_id === fixture.conditionID
      && item.quantity === 3
      && Number(item.cogs_usd) === 90
    )),
    "finalized POS sale rows did not preserve exact identity, quantity, and FIFO COGS",
  );
  const sourceLayers = await adminRows(
    `pokemon_lot_lines?line_id=in.(${fixture.layerIDs.join(",")})`
      + "&select=line_id,quantity,qty_remaining,allocated_cost_usd",
  );
  assert(sourceLayers.length === 2, "authoritative FIFO source layers were missing");
  assert(
    Number(sourceLayers.find((layer) => layer.line_id === fixture.layerIDs[0])?.qty_remaining) === 0
      && Number(sourceLayers.find((layer) => layer.line_id === fixture.layerIDs[1])?.qty_remaining) === 6,
    "POS reversal did not restore the exact POS layers while preserving the competing sale",
  );
  const reversedLots = await adminRows(
    `sale_lots?sale_group=in.(${sessions.map((row) => row.sale_group).join(",")})`
      + "&select=sale_group,status,reversal_sale_group,reversed_at",
  );
  assert(
    reversedLots.length === 2
      && reversedLots.every((lot) => (
        lot.status === "reversed"
        && Number.isInteger(lot.reversal_sale_group)
        && lot.reversed_at
      )),
    "stable-session reversal did not create two authoritative reversal graphs",
  );
  const acquisitions = await adminRows(
    `pokemon_lot_lines?acquisition_operation_owner_id=eq.${fixture.ownerID}`
      + "&select=line_id,lot_id,quantity,price_override_usd,market_value_usd,recognition_request_id",
  );
  assert(acquisitions.length === 2, `expected two acquisition operations, got ${acquisitions.length}`);
  assert(acquisitions.every((line) => Number(line.price_override_usd) === 5.478), "JPY cost was not frozen at six-decimal USD precision");
  const audits = await adminRows(
    `card_recognition_audits?owner_id=eq.${fixture.ownerID}`
      + "&select=request_id,use_case,status,capture_sha256,model_fingerprint,"
      + "catalog_fingerprint,recognizer_config_fingerprint,timing_ms",
  );
  assert(audits.length === 4, `expected four immutable recognition audits, got ${audits.length}`);
  assert(audits.every((audit) => (
    audit.status === "confirmed"
    && audit.model_fingerprint === "pos-browser-model-v1"
    && audit.catalog_fingerprint === "pos-browser-catalog-v1"
    && audit.recognizer_config_fingerprint === "pos-browser-config-v1"
    && Number.isFinite(audit.timing_ms.browser_permission_ms)
    && Number.isFinite(audit.timing_ms.browser_capture_ms)
    && Number.isFinite(audit.timing_ms.browser_capture_to_response_ms)
    && Number.isFinite(audit.timing_ms.browser_response_to_paint_ms)
    && Number.isFinite(audit.timing_ms.browser_audit_ready_ms)
    && Number.isFinite(audit.timing_ms.browser_total_tap_to_ready_ms)
  )), "recognition audits omitted exact provenance or one of the six browser timing boundaries");
  const media = await authenticatedRows(
    `inventory_card_media?owner_id=eq.${fixture.ownerID}`
      + "&select=lot_line_id,object_key,mime_type,byte_size,sha256,is_recognition_capture",
  );
  assert(media.length === 3, `expected two recognition captures and one back image, got ${media.length}`);
  assert(media.filter((row) => row.is_recognition_capture).length === 2, "recognition capture provenance count drifted");
  for (const row of media) {
    const response = await fetch(
      `${apiUrl}/storage/v1/object/authenticated/inventory-card-media/${row.object_key}`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${userAccessToken}` } },
    );
    assert(response.ok, `registered media ${row.object_key} was not readable from local storage`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert(bytes.length === row.byte_size, `stored media size drifted for ${row.object_key}`);
    assert(createHash("sha256").update(bytes).digest("hex") === row.sha256, `stored media digest drifted for ${row.object_key}`);
  }
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [index, viewport] of acceptanceViewports.entries()) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.hasTouch,
      isMobile: viewport.isMobile,
    });
    await authenticate(context);
    const failures = [];
    let page = await preparedPage(context, viewport, failures);
    if (viewport.isMobile) await verifyJapaneseDocumentLanguage(page, viewport);
    await runSaleCUJ(page, viewport, index);
    page = await runAcquisitionCUJ(context, page, viewport, index, failures);
    await assertNoHorizontalOverflow(page, `${viewport.name} completed POS flows`);
    assert(failures.length === 0, `${viewport.name} browser errors: ${failures.join(" | ")}`);
    results.push({
      viewport: `${viewport.width}x${viewport.height}`,
      sale: "pass",
      acquisition: "pass",
      screenshotSale: `${artifactRoot}/${viewport.name}-sale.png`,
      screenshotAcquisition: `${artifactRoot}/${viewport.name}-acquisition.png`,
    });
    await context.close();
  }
  await assertAuthoritativeState();
  console.log(JSON.stringify({ results, authoritativeState: "pass" }, null, 2));
} finally {
  await browser.close();
}

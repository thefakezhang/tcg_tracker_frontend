import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const {
  APP_URL: appUrl,
  E2E_API_URL: apiUrl,
  E2E_AUTH_SECRET: authSecret,
} = process.env;
if (!appUrl || !apiUrl || !authSecret) {
  throw new Error("APP_URL, E2E_API_URL, and E2E_AUTH_SECRET are required");
}

const artifactRoot = process.env.E2E_ARTIFACT_ROOT
  ?? "/tmp/tcg-unresolved-price-observations-authenticated";
mkdirSync(artifactRoot, { recursive: true });

const appOrigin = new URL(appUrl);
const apiOrigin = new URL(apiUrl);
const allowedBrowserOrigins = new Set([
  appOrigin.origin,
  apiOrigin.origin,
  `http://localhost:${appOrigin.port}`,
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function originIsLocal(value) {
  const parsed = new URL(value);
  return parsed.protocol === "data:"
    || parsed.protocol === "blob:"
    || (parsed.protocol === "http:" && allowedBrowserOrigins.has(parsed.origin));
}

function cropSVG(sourceURL) {
  const sealed = sourceURL.includes("sealed");
  const label = sealed ? "Sealed unresolved cell" : "Singles unresolved cell";
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
      <rect width="1200" height="800" fill="#e2e8f0"/>
      <rect x="10" y="10" width="100" height="130" rx="8" fill="#1d4ed8"/>
      <rect x="10" y="150" width="100" height="25" rx="4" fill="#b91c1c"/>
      <text x="600" y="390" text-anchor="middle" fill="#0f172a" font-family="sans-serif" font-size="42">${label}</text>
      <text x="600" y="450" text-anchor="middle" fill="#0f172a" font-family="sans-serif" font-size="28">Verified fixture crop provenance</text>
    </svg>`;
}

async function installNetworkBoundary(context, externalRequests, proxyRequests) {
  await context.route("**/*", async (route) => {
    const requestURL = route.request().url();
    if (!originIsLocal(requestURL)) {
      externalRequests.push(requestURL);
      await route.abort("blockedbyclient");
      return;
    }
    const parsed = new URL(requestURL);
    if (parsed.origin === appOrigin.origin && parsed.pathname === "/api/proxy-image") {
      proxyRequests.push(parsed.searchParams.get("url"));
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: cropSVG(parsed.searchParams.get("url") ?? ""),
      });
      return;
    }
    await route.continue();
  });
}

async function authenticate(context) {
  const response = await context.request.post(`${appUrl}/auth/e2e`, {
    headers: { "x-tcg-e2e-secret": authSecret },
    timeout: 90_000,
  });
  assert(response.status() === 200, `operator E2E authentication returned ${response.status()}`);
}

async function gotoPanel(page) {
  await page.goto(`${appUrl}/dashboard?view=health`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  const panel = page.locator("#unresolved-price-observations-title");
  await panel.filter({ hasText: "Unresolved priced buylist cells" }).waitFor({ timeout: 180_000 });
  return panel.locator("xpath=ancestor::section");
}

function observePage(page, label, events) {
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      events.push({ label, type: `console:${message.type()}`, text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    events.push({ label, type: "pageerror", text: error.message });
  });
  page.on("requestfailed", (request) => {
    events.push({
      label,
      type: "requestfailed",
      text: `${request.failure()?.errorText ?? "unknown"} ${request.url()}`,
    });
  });
  page.on("response", (response) => {
    const parsed = new URL(response.url());
    if (parsed.origin === apiOrigin.origin) {
      events.push({
        label,
        type: "api-response",
        text: `${response.status()} ${parsed.pathname}`,
      });
    }
  });
}

async function waitForCardCount(page, count) {
  const cards = page.getByTestId("unresolved-price-observation-card");
  await cards.nth(count - 1).waitFor({ timeout: 90_000 });
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-testid="unresolved-price-observation-card"]').length === expected,
    count,
    { timeout: 90_000 },
  );
  return cards;
}

async function panelLayout(panel, viewportWidth) {
  const dimensions = await panel.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      left: rect.left,
      right: rect.right,
    };
  });
  assert(
    dimensions.scrollWidth <= dimensions.clientWidth + 1,
    `observation panel overflows internally: ${JSON.stringify(dimensions)}`,
  );
  assert(
    dimensions.left >= -1 && dimensions.right <= viewportWidth + 1,
    `observation panel exceeds viewport: ${JSON.stringify(dimensions)}`,
  );
  return dimensions;
}

const browser = process.env.E2E_CDP_URL
  ? await chromium.connectOverCDP(process.env.E2E_CDP_URL)
  : await chromium.launch({ headless: process.env.E2E_HEADED !== "1" });
const externalRequests = [];
const proxyRequests = [];
const rpcReceipts = [];
const browserEvents = [];
try {
  const noSession = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await installNetworkBoundary(noSession, externalRequests, proxyRequests);
  const noSessionPage = await noSession.newPage();
  observePage(noSessionPage, "no-session", browserEvents);
  await noSessionPage.goto(`${appUrl}/dashboard?view=health`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await noSessionPage.waitForURL(/\/login(?:\?|$)/, { timeout: 90_000 });
  await noSessionPage.screenshot({
    path: `${artifactRoot}/no-session-login.png`,
    fullPage: false,
  });
  await noSession.close();

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installNetworkBoundary(desktop, externalRequests, proxyRequests);
  await authenticate(desktop);
  const desktopPage = await desktop.newPage();
  observePage(desktopPage, "desktop", browserEvents);
  const initialRPCPromise = desktopPage.waitForResponse((response) => {
    const parsed = new URL(response.url());
    return parsed.pathname.endsWith("/rpc/list_unresolved_buylist_price_observations");
  }, { timeout: 300_000 }).then(
    (response) => ({ response, error: null }),
    (error) => ({ response: null, error }),
  );
  const desktopPanel = await gotoPanel(desktopPage);
  const initialRPCResult = await initialRPCPromise;
  if (initialRPCResult.error != null) throw initialRPCResult.error;
  const initialRPC = initialRPCResult.response;
  assert(initialRPC != null, "operator initial RPC response is missing");
  assert(initialRPC.status() === 200, `operator initial RPC returned ${initialRPC.status()}`);
  const initialBody = await initialRPC.json();
  assert(Array.isArray(initialBody) && initialBody.length === 24,
    `operator initial RPC returned ${initialBody?.length}, want 24`);
  rpcReceipts.push({ page: 1, status: initialRPC.status(), count: initialBody.length });

  const desktopCards = await waitForCardCount(desktopPage, 24);
  await desktopPanel.scrollIntoViewIfNeeded();
  assert(await desktopPage.getByText("Unknown identity", { exact: true }).count() === 24,
    "every initial cell did not retain explicit unknown identity");
  assert(await desktopPage.getByText("¥110,000", { exact: true }).count() === 1,
    "110000 JPY tier is missing");
  assert(await desktopPage.getByText("¥74,000", { exact: true }).count() === 1,
    "74000 JPY tier is missing");
  assert(await desktopPage.getByText(/Grade not observed/).count() >= 1,
    "raw card grade absence is missing");
  assert(await desktopPage.getByText(/Observed grade: psa_10/).count() === 1,
    "source-observed PSA grade is missing");
  assert(await desktopPage.getByText(/Observed variant: reverse_holo/).count() === 1,
    "observed variant is missing");
  assert(await desktopPage.getByText(/Source SHA-256: a{64}/).count() === 24,
    "source digest provenance is missing");
  assert(await desktopPage.getByText(/Excluded from every automatic financial and alert path/).count() === 24,
    "financial exclusion is missing");

  const firstCard = desktopCards.first();
  const cardCrop = firstCard.getByRole("img", { name: "Detected item" });
  const priceCrop = firstCard.getByRole("img", { name: "Detected price" });
  const cropEvidence = await Promise.all([cardCrop, priceCrop].map((crop) => crop.evaluate((node) => ({
    backgroundImage: getComputedStyle(node).backgroundImage,
    backgroundSize: getComputedStyle(node).backgroundSize,
    width: node.getBoundingClientRect().width,
    height: node.getBoundingClientRect().height,
  }))));
  assert(cropEvidence.every((crop) => crop.backgroundImage.includes("/api/proxy-image")),
    `crop proxy provenance is missing: ${JSON.stringify(cropEvidence)}`);
  assert(cropEvidence.every((crop) => crop.width > 0 && crop.height > 0),
    `crop geometry did not render: ${JSON.stringify(cropEvidence)}`);
  assert((await firstCard.textContent())?.includes("[10, 10, 110, 140] → [11, 10, 111, 140]"),
    "card source/effective geometry is missing");
  assert((await firstCard.textContent())?.includes("Verified association: grouped_number"),
    "second-tier price association is missing");
  const desktopSourceTarget = await firstCard.getByRole("link", { name: "Open source post" }).boundingBox();
  assert(desktopSourceTarget && desktopSourceTarget.height >= 44,
    "desktop source-post target is below 44px");
  await panelLayout(desktopPanel, 1440);
  await desktopPage.screenshot({
    path: `${artifactRoot}/desktop-observations.png`,
    fullPage: false,
  });

  const secondRPCPromise = desktopPage.waitForResponse((response) => {
    const parsed = new URL(response.url());
    if (!parsed.pathname.endsWith("/rpc/list_unresolved_buylist_price_observations")) return false;
    return response.request().postData()?.includes("p_before_routing_outcome_id") ?? false;
  }, { timeout: 90_000 }).then(
    (response) => ({ response, error: null }),
    (error) => ({ response: null, error }),
  );
  await desktopPage.getByRole("button", { name: "Load older observations" }).click();
  const secondRPCResult = await secondRPCPromise;
  if (secondRPCResult.error != null) throw secondRPCResult.error;
  const secondRPC = secondRPCResult.response;
  assert(secondRPC != null, "operator second RPC response is missing");
  assert(secondRPC.status() === 200, `operator second RPC returned ${secondRPC.status()}`);
  const secondBody = await secondRPC.json();
  assert(Array.isArray(secondBody) && secondBody.length === 1,
    `operator second RPC returned ${secondBody?.length}, want 1`);
  rpcReceipts.push({ page: 2, status: secondRPC.status(), count: secondBody.length });
  await waitForCardCount(desktopPage, 25);
  assert(await desktopPage.getByText(/Grade not applicable/).count() === 1,
    "sealed grade semantics are missing");
  assert(await desktopPage.getByText(/Observed variant: shrink_wrapped/).count() === 1,
    "sealed variant is missing");
  assert(await desktopPage.getByRole("button", { name: "Load older observations" }).count() === 0,
    "terminal keyset page left a load-more action");
  const routingReceipts = await desktopPage.locator("p").evaluateAll((nodes) => nodes
    .map((node) => node.textContent ?? "")
    .filter((value) => value.startsWith("Routing outcome ")));
  assert(routingReceipts.length === 25 && new Set(routingReceipts).size === 25,
    "keyset pagination duplicated or dropped routing observations");
  await desktopCards.last().scrollIntoViewIfNeeded();
  await desktopPage.screenshot({
    path: `${artifactRoot}/desktop-terminal-page.png`,
    fullPage: false,
  });
  await desktop.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installNetworkBoundary(phone, externalRequests, proxyRequests);
  await authenticate(phone);
  const phonePage = await phone.newPage();
  observePage(phonePage, "phone", browserEvents);
  const phonePanel = await gotoPanel(phonePage);
  const phoneCards = await waitForCardCount(phonePage, 24);
  await phonePanel.scrollIntoViewIfNeeded();
  await panelLayout(phonePanel, 390);
  const phoneCard = phoneCards.first();
  await phoneCard.scrollIntoViewIfNeeded();
  const phoneCrop = await phoneCard.getByRole("img", { name: "Detected item" }).evaluate((node) => ({
    backgroundImage: getComputedStyle(node).backgroundImage,
    width: node.getBoundingClientRect().width,
    height: node.getBoundingClientRect().height,
  }));
  assert(phoneCrop.backgroundImage.includes("/api/proxy-image") && phoneCrop.width > 0 && phoneCrop.height > 0,
    `390px crop did not render: ${JSON.stringify(phoneCrop)}`);
  const phoneSourceTarget = await phoneCard.getByRole("link", { name: "Open source post" }).boundingBox();
  const phoneLoadTarget = await phonePage.getByRole("button", { name: "Load older observations" }).boundingBox();
  assert(phoneSourceTarget && phoneSourceTarget.height >= 44 && phoneSourceTarget.width >= 44,
    "390px source-post target is below 44px");
  assert(phoneLoadTarget && phoneLoadTarget.height >= 44 && phoneLoadTarget.width >= 44,
    "390px load-more target is below 44px");
  await phonePage.screenshot({
    path: `${artifactRoot}/phone-observations.png`,
    fullPage: false,
  });
  await phone.close();

  const singlesProxyRequests = proxyRequests.filter((value) => value?.includes("singles"));
  const sealedProxyRequests = proxyRequests.filter((value) => value?.includes("sealed"));
  assert(singlesProxyRequests.length >= 2 && sealedProxyRequests.length >= 1,
    `browser did not request both desktop/phone singles and sealed crop sources: ${JSON.stringify(proxyRequests)}`);
  assert(externalRequests.length === 0,
    `browser attempted external requests: ${JSON.stringify(externalRequests, null, 2)}`);

  const screenshotHashes = {};
  for (const name of [
    "no-session-login.png",
    "desktop-observations.png",
    "desktop-terminal-page.png",
    "phone-observations.png",
  ]) {
    screenshotHashes[name] = createHash("sha256")
      .update(readFileSync(`${artifactRoot}/${name}`))
      .digest("hex");
  }
  writeFileSync(`${artifactRoot}/receipt.json`, `${JSON.stringify({
    schema_version: 1,
    production_route: "/dashboard?view=health",
    postgrest_rpc: "list_unresolved_buylist_price_observations",
    first_page_count: 24,
    terminal_count: 25,
    rpc_receipts: rpcReceipts,
    crop_evidence: cropEvidence,
    proxy_request_count: proxyRequests.length,
    external_requests: externalRequests,
    screenshots: screenshotHashes,
  }, null, 2)}\n`);
} finally {
  writeFileSync(
    `${artifactRoot}/browser-events.json`,
    `${JSON.stringify(browserEvents, null, 2)}\n`,
  );
  await browser.close();
}

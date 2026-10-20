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
  ?? "/tmp/tcg-twitter-arrivals-authenticated";
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

function originIsLoopback(value) {
  const parsed = new URL(value);
  return parsed.protocol === "data:"
    || parsed.protocol === "blob:"
    || (parsed.protocol === "http:" && allowedBrowserOrigins.has(parsed.origin));
}

function fixtureSVG(sourceURL) {
  const portrait = sourceURL.includes("-portrait.jpg");
  const width = portrait ? 480 : 800;
  const height = portrait ? 720 : 450;
  const label = portrait ? "Portrait arrival photo" : "Landscape arrival photo";
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#e9e2d0"/>
      <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="24" fill="#1f2937"/>
      <rect x="48" y="48" width="${width - 96}" height="${height - 96}" rx="18" fill="#d97706"/>
      <text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-size="30">${label}</text>
      <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-size="22">Entire original remains visible</text>
    </svg>`;
}

async function installNetworkBoundary(context, externalRequests) {
  await context.route("**/*", async (route) => {
    const requestURL = route.request().url();
    if (!originIsLoopback(requestURL)) {
      externalRequests.push(requestURL);
      await route.abort("blockedbyclient");
      return;
    }
    const parsed = new URL(requestURL);
    if (parsed.origin === new URL(appUrl).origin
      && parsed.pathname === "/api/proxy-image") {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: fixtureSVG(parsed.searchParams.get("url") ?? ""),
      });
      return;
    }
    await route.continue();
  });
}

async function authenticate(context, identity = "administrator") {
  const response = await context.request.post(`${appUrl}/auth/e2e`, {
    headers: {
      "x-tcg-e2e-secret": authSecret,
      "x-tcg-e2e-identity": identity,
    },
  });
  assert(response.status() === 200, `${identity} E2E authentication returned ${response.status()}`);
}

async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert(
    dimensions.scroll <= dimensions.viewport + 1,
    `${label} horizontally overflows: ${JSON.stringify(dimensions)}`,
  );
}

async function waitForCardCount(page, count) {
  const cards = page.getByTestId("arrival-post-card");
  await cards.nth(count - 1).waitFor({ timeout: 90_000 });
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-testid="arrival-post-card"]').length === expected,
    count,
    { timeout: 90_000 },
  );
  return cards;
}

async function gotoArrivals(page) {
  await page.goto(`${appUrl}/dashboard?view=arrivals`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator("#arrival-posts-title").filter({
    hasText: "Pokemon arrival posts",
  }).waitFor({ timeout: 90_000 });
}

const browser = await chromium.launch({ headless: process.env.E2E_HEADED !== "1" });
const externalRequests = [];
const apiReceipts = [];
try {
  const noAuth = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await installNetworkBoundary(noAuth, externalRequests);
  const noAuthPage = await noAuth.newPage();
  await noAuthPage.goto(`${appUrl}/dashboard?view=arrivals`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await noAuthPage.waitForURL(/\/login(?:\?|$)/, { timeout: 90_000 });
  const noAuthAPI = await noAuth.request.get(`${appUrl}/api/twitter-arrivals?limit=100`);
  assert(noAuthAPI.status() === 401, `no-session API returned ${noAuthAPI.status()}, want 401`);
  apiReceipts.push({ state: "no_session", status: noAuthAPI.status() });
  await noAuth.close();

  const ordinary = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await installNetworkBoundary(ordinary, externalRequests);
  await authenticate(ordinary, "ordinary");
  const ordinaryAPI = await ordinary.request.get(`${appUrl}/api/twitter-arrivals?limit=100`);
  assert(ordinaryAPI.status() === 403, `ordinary-user API returned ${ordinaryAPI.status()}, want 403`);
  apiReceipts.push({ state: "ordinary_user", status: ordinaryAPI.status() });
  const ordinaryPage = await ordinary.newPage();
  await gotoArrivals(ordinaryPage);
  const forbidden = await ordinaryPage.getByRole("alert")
    .filter({ hasText: "Administrator access required" })
    .textContent();
  assert(forbidden?.includes("restricted to administrator accounts"),
    `ordinary dashboard did not explain administrator access: ${forbidden}`);
  assert(await ordinaryPage.getByRole("button", { name: "Try again" }).count() === 0,
    "ordinary dashboard offered a transient retry for permanent refusal");
  const administratorSignIn = ordinaryPage.getByRole("link", {
    name: "Sign in with an administrator account",
  });
  assert(await administratorSignIn.getAttribute("href") === "/login",
    "ordinary dashboard did not provide an administrator sign-in path");
  await ordinaryPage.screenshot({
    path: `${artifactRoot}/ordinary-admin-required.png`,
    fullPage: false,
  });
  await ordinary.close();

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await installNetworkBoundary(desktop, externalRequests);
  await authenticate(desktop);
  const desktopPage = await desktop.newPage();
  const initialResponsePromise = desktopPage.waitForResponse((response) => {
    const parsed = new URL(response.url());
    return parsed.pathname === "/api/twitter-arrivals"
      && parsed.searchParams.get("limit") === "100"
      && !parsed.searchParams.has("before");
  });
  await gotoArrivals(desktopPage);
  const initialResponse = await initialResponsePromise;
  assert(initialResponse.status() === 200, `administrator initial API returned ${initialResponse.status()}`);
  const initialBody = await initialResponse.json();
  assert(initialBody.posts?.length === 100, `initial database page count=${initialBody.posts?.length}, want 100`);
  assert(initialBody.next_cursor?.before_key, "initial database page omitted its stable cursor");
  assert(
    new Set(initialBody.posts.map((post) => post.tweet_created_at)).size === 1,
    "initial database page did not preserve the tied-timestamp fixture",
  );
  for (const post of initialBody.posts) {
    for (const forbiddenField of ["item_identity", "price_jpy", "price_side", "grade", "condition"]) {
      assert(!(forbiddenField in post), `protected API leaked forbidden field ${forbiddenField}`);
    }
  }
  apiReceipts.push({
    state: "administrator_initial",
    status: initialResponse.status(),
    count: initialBody.posts.length,
    cursor: initialBody.next_cursor,
  });

  const desktopCards = await waitForCardCount(desktopPage, 100);
  assert(await desktopPage.getByText("Unverified post", { exact: true }).count() === 100,
    "unverified status was not rendered for every initial post");
  assert(await desktopPage.getByText("Source post time (JST)", { exact: false }).count() === 100,
    "source-post times were not explicitly labeled in JST");
  assert(await desktopPage.getByText("Evidence collected (JST)", { exact: false }).count() === 100,
    "evidence-collection times were not explicitly labeled in JST");
  await desktopCards.nth(0).getByRole("img").waitFor();
  await desktopCards.nth(1).getByRole("img").waitFor();
  await desktopPage.waitForFunction(() => Array.from(
    document.querySelectorAll('[data-testid="arrival-post-card"] img'),
  ).slice(0, 2).every((image) => image.complete && image.naturalWidth > 0));
  const imageEvidence = await Promise.all([0, 1].map(async (index) => {
    const image = desktopCards.nth(index).getByRole("img");
    return image.evaluate((node) => ({
      objectFit: getComputedStyle(node).objectFit,
      naturalWidth: node.naturalWidth,
      naturalHeight: node.naturalHeight,
      complete: node.complete,
    }));
  }));
  assert(imageEvidence.every((item) => item.complete && item.objectFit === "contain"),
    `arrival preview did not preserve the entire image: ${JSON.stringify(imageEvidence)}`);
  assert(imageEvidence.some((item) => item.naturalHeight > item.naturalWidth),
    "portrait arrival evidence did not render");
  assert(imageEvidence.some((item) => item.naturalWidth > item.naturalHeight),
    "landscape arrival evidence did not render");
  assert(await desktopCards.nth(0).getByRole("img").getAttribute("alt"),
    "arrival evidence image was missing an accessible name");
  const firstMediaHref = await desktopCards.nth(0).getByRole("link", { name: "Open original image 1" }).getAttribute("href");
  const firstSourceHref = await desktopCards.nth(0).getByRole("link", { name: "Open original post" }).getAttribute("href");
  assert(firstMediaHref?.startsWith("https://arrival-fixture.invalid/media/"), "original media provenance link changed");
  assert(firstSourceHref?.startsWith("https://x.com/TCGshop_alice/status/"), "source post provenance link changed");
  await assertNoOverflow(desktopPage, "desktop initial arrival browse");
  await desktopPage.screenshot({ path: `${artifactRoot}/desktop-arrivals.png`, fullPage: false });

  await desktop.clearCookies();
  const expiredResponsePromise = desktopPage.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/twitter-arrivals" && response.status() === 401);
  await desktopPage.getByRole("button", { name: "Load more posts" }).click();
  const expiredResponse = await expiredResponsePromise;
  assert(expiredResponse.status() === 401, "expired caller session did not fail with 401");
  const expiredAlertPanel = desktopPage.getByRole("alert")
    .filter({ hasText: "Your session ended" });
  const expiredAlert = await expiredAlertPanel.textContent();
  assert(expiredAlert?.includes("Already loaded posts remain here"),
    `expired-session recovery guidance missing: ${expiredAlert}`);
  assert(await desktopPage.getByTestId("arrival-post-card").count() === 100,
    "expired-session pagination discarded already loaded rows");
  assert(await desktopPage.getByRole("button", { name: "Load more posts" }).count() === 0,
    "expired-session state left an ambiguous Load more action");
  await expiredAlertPanel.evaluate((node) => node.scrollIntoView({ block: "center" }));
  await desktopPage.screenshot({
    path: `${artifactRoot}/desktop-session-expired.png`,
    fullPage: false,
  });
  apiReceipts.push({
    state: "expired_session",
    status: expiredResponse.status(),
    retained: 100,
    visible_sign_in_path: "/login",
    visible_resume_action: "Continue after signing in",
  });

  const signInPagePromise = desktop.waitForEvent("page");
  await desktopPage.getByRole("link", { name: "Sign in again" }).click();
  const signInPage = await signInPagePromise;
  await signInPage.waitForURL(/\/login(?:\?|$)/, { timeout: 90_000 });
  await authenticate(desktop);
  await signInPage.close();
  const secondResponsePromise = desktopPage.waitForResponse((response) => {
    const parsed = new URL(response.url());
    return parsed.pathname === "/api/twitter-arrivals"
      && parsed.searchParams.has("before")
      && parsed.searchParams.has("before_key");
  });
  await desktopPage.getByRole("button", { name: "Continue after signing in" }).click();
  const secondResponse = await secondResponsePromise;
  assert(secondResponse.status() === 200, `pagination retry returned ${secondResponse.status()}`);
  const secondBody = await secondResponse.json();
  assert(secondBody.posts?.length === 6, `second database page count=${secondBody.posts?.length}, want 6`);
  assert(secondBody.next_cursor === null, "terminal database page returned another cursor");
  await waitForCardCount(desktopPage, 106);
  const sourceHrefs = await desktopPage.getByRole("link", { name: "Open original post" })
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  assert(new Set(sourceHrefs).size === 106, "cursor pagination duplicated a rendered post");
  assert(await desktopPage.getByRole("button", { name: "Load more posts" }).count() === 0,
    "terminal page left Load More enabled");
  apiReceipts.push({ state: "administrator_page_2", status: secondResponse.status(), count: 6 });

  const shopFilter = desktopPage.getByLabel("Shop account");
  await shopFilter.fill("cardrush-online");
  const filterResponsePromise = desktopPage.waitForResponse((response) => {
    const parsed = new URL(response.url());
    return parsed.pathname === "/api/twitter-arrivals"
      && parsed.searchParams.get("buyer_handle") === "cardrush-online"
      && !parsed.searchParams.has("before");
  });
  await desktopPage.getByRole("button", { name: "Show posts" }).click();
  assert((await filterResponsePromise).status() === 200, "shop-filter API failed");
  const filteredCards = await waitForCardCount(desktopPage, 1);
  assert((await filteredCards.first().textContent())?.includes("cardrush-online"),
    "shop filter returned the wrong database row");
  await assertNoOverflow(desktopPage, "desktop filtered arrival browse");

  await shopFilter.fill("no-such-shop");
  const emptyResponsePromise = desktopPage.waitForResponse((response) =>
    new URL(response.url()).searchParams.get("buyer_handle") === "no-such-shop");
  await desktopPage.getByRole("button", { name: "Show posts" }).click();
  assert((await emptyResponsePromise).status() === 200, "empty shop-filter API failed");
  await desktopPage.getByText("No arrival posts found", { exact: true }).waitFor();
  assert(await desktopPage.getByTestId("arrival-post-card").count() === 0,
    "empty database result retained stale cards");
  await desktop.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installNetworkBoundary(phone, externalRequests);
  await authenticate(phone);
  const phonePage = await phone.newPage();
  await gotoArrivals(phonePage);
  await waitForCardCount(phonePage, 100);
  await assertNoOverflow(phonePage, "390px arrival browse");
  const phoneFilter = phonePage.getByLabel("Shop account");
  await phoneFilter.fill("cardrush-online");
  await phonePage.getByRole("button", { name: "Show posts" }).click();
  await waitForCardCount(phonePage, 1);
  const phoneImage = phonePage.getByTestId("arrival-post-card").getByRole("img");
  await phoneImage.waitFor();
  const phoneObjectFit = await phoneImage.evaluate((node) => getComputedStyle(node).objectFit);
  assert(phoneObjectFit === "contain", `390px arrival image object-fit=${phoneObjectFit}`);
  const mediaBox = await phonePage.getByRole("link", { name: "Open original image 1" }).boundingBox();
  const sourceBox = await phonePage.getByRole("link", { name: "Open original post" }).boundingBox();
  assert(mediaBox && mediaBox.height >= 44 && mediaBox.width >= 44, "390px media target is below 44px");
  assert(sourceBox && sourceBox.height >= 44 && sourceBox.width >= 44, "390px source target is below 44px");
  await assertNoOverflow(phonePage, "390px filtered arrival browse");
  await phonePage.screenshot({ path: `${artifactRoot}/phone-arrivals.png`, fullPage: false });
  await phone.close();

  assert(externalRequests.length === 0,
    `browser attempted external requests: ${JSON.stringify(externalRequests, null, 2)}`);

  const screenshotHashes = {};
  for (const name of [
    "ordinary-admin-required.png",
    "desktop-session-expired.png",
    "desktop-arrivals.png",
    "phone-arrivals.png",
  ]) {
    screenshotHashes[name] = createHash("sha256")
      .update(readFileSync(`${artifactRoot}/${name}`))
      .digest("hex");
  }
  writeFileSync(`${artifactRoot}/receipt.json`, `${JSON.stringify({
    schema_version: 1,
    production_route: "/dashboard?view=arrivals",
    authenticated_api: "/api/twitter-arrivals",
    postgrest_rpc: "twitter_arrival_posts",
    database_fixture_posts: 106,
    tied_timestamp_posts: 106,
    api_receipts: apiReceipts,
    image_evidence: imageEvidence,
    external_requests: externalRequests,
    screenshots: screenshotHashes,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}

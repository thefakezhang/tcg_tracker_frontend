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
if (
  process.env.E2E_HEADED !== "1"
  || process.env.TCG_TWITTER_ARRIVALS_XVFB !== "1"
  || !process.env.DISPLAY
) {
  throw new Error("Twitter arrivals acceptance requires headed Chromium under Xvfb");
}
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
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert(box, `${label} has no bounds`);
  assert(box.width >= 44 && box.height >= 44, `${label} is ${box.width}x${box.height}, below 44px`);
  return { width: box.width, height: box.height };
}

async function runViewport(browser, name, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, timezoneId: "Asia/Tokyo" });
  await context.addInitScript(() => localStorage.setItem("language", "en"));
  let externalRequests = 0;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
    if ((url.protocol === "http:" || url.protocol === "https:") && !loopback) {
      externalRequests += 1;
      await route.fulfill({ status: 503, contentType: "text/plain", body: "external request refused" });
      return;
    }
    await route.continue();
  });

  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(`${appUrl}/e2e/twitter-arrivals`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Pokemon arrival posts" }).waitFor();
  assert(await page.getByTestId("arrival-post-card").count() === 3, `${name} did not render three arrival posts`);
  assert(await page.getByText("Unverified post").count() === 3, `${name} lost explicit unverified labels`);
  assert(await page.getByText(/Oct 20, 2026/).count() >= 3, `${name} did not render post/acquisition times`);

  const sourceLink = page.getByRole("link", { name: "Open original post" }).first();
  assert(
    await sourceLink.getAttribute("href") === "https://x.com/TCGshop_alice/status/2112064092735521045",
    `${name} source provenance link changed`,
  );
  await sourceLink.focus();
  assert(await sourceLink.evaluate((node) => node === document.activeElement), `${name} source link is not keyboard focusable`);
  const mediaLink = page.getByRole("link", { name: "Open original image 1" }).first();
  await mediaLink.focus();
  assert(await mediaLink.evaluate((node) => node === document.activeElement), `${name} media link is not keyboard focusable`);
  const evidenceImages = page.getByTestId("arrival-post-card").first().locator("img");
  await evidenceImages.first().waitFor();
  const imagePresentation = await evidenceImages.evaluateAll((images) => images.map((item) => ({
    naturalWidth: item.naturalWidth,
    naturalHeight: item.naturalHeight,
    objectFit: getComputedStyle(item).objectFit,
  })));
  assert(imagePresentation.length === 2, `${name} did not render both controlled shape fixtures`);
  assert(
    imagePresentation[0].naturalWidth > imagePresentation[0].naturalHeight,
    `${name} landscape fixture lost its intrinsic shape`,
  );
  assert(
    imagePresentation[1].naturalWidth < imagePresentation[1].naturalHeight,
    `${name} portrait fixture lost its intrinsic shape`,
  );
  assert(
    imagePresentation.every((item) => item.objectFit === "contain"),
    `${name} media preview can crop source evidence: ${JSON.stringify(imagePresentation)}`,
  );

  const filter = page.getByLabel("Shop account");
  await filter.fill("alice");
  await filter.press("Enter");
  assert(await page.getByTestId("arrival-post-card").count() === 1, `${name} keyboard shop filter did not narrow results`);
  assert(await page.getByText("alice", { exact: true }).count() === 1, `${name} filtered shop is missing`);
  await filter.fill("");
  await filter.press("Enter");
  assert(await page.getByTestId("arrival-post-card").count() === 3, `${name} clearing the filter did not restore results`);

  await page.getByRole("button", { name: "empty" }).click();
  await page.getByText("No arrival posts found").waitFor();
  await assertNoOverflow(page, `${name} empty`);
  await page.getByRole("button", { name: "error" }).click();
  await page.getByRole("alert").getByText("Controlled arrival API failure").waitFor();
  await page.getByRole("button", { name: "unauthorized" }).click();
  await page.getByRole("alert").getByText("Forbidden").waitFor();
  await page.getByRole("button", { name: "loaded" }).click();
  assert(await page.getByTestId("arrival-post-card").count() === 3, `${name} loaded recovery failed`);

  const dimensions = await assertNoOverflow(page, `${name} loaded`);
  const tapTargets = viewport.width === 390 ? {
    source: await assertTapTarget(page.getByRole("link", { name: "Open original post" }).first(), `${name} source link`),
    media: await assertTapTarget(page.getByRole("link", { name: "Open original image 1" }).first(), `${name} media link`),
    filter: await assertTapTarget(page.getByRole("button", { name: "Show posts" }), `${name} filter button`),
  } : null;

  await page.screenshot({
    path: `${artifactRoot}/${name}-loaded.png`,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
  assert(externalRequests === 0, `${name} made ${externalRequests} external requests`);
  assert(pageErrors.length === 0, `${name} page errors: ${JSON.stringify(pageErrors)}`);
  assert(consoleErrors.length === 0, `${name} console errors: ${JSON.stringify(consoleErrors)}`);
  await context.close();
  return { viewport, dimensions, tapTargets, externalRequests };
}

const browser = await chromium.launch({ headless: false });
try {
  const results = {
    desktop: await runViewport(browser, "desktop", { width: 1440, height: 900 }),
    phone390: await runViewport(browser, "phone-390", { width: 390, height: 844 }),
  };
  writeFileSync(
    `${artifactRoot}/summary.json`,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} finally {
  await browser.close();
}

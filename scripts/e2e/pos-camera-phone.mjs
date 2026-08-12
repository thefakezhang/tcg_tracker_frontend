import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const appUrl = process.env.APP_URL;
const authSecret = process.env.E2E_AUTH_SECRET;
if (!appUrl || !authSecret) {
  throw new Error("APP_URL and E2E_AUTH_SECRET are required");
}

const artifactRoot = process.env.E2E_ARTIFACT_ROOT ?? "/tmp/tcg-pos-camera-e2e";
mkdirSync(artifactRoot, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertTapTarget(locator, label) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  assert(box, `${label} has no pointer bounds`);
  assert(
    box.width >= 43 && box.height >= 43,
    `${label} is ${box.width.toFixed(1)}x${box.height.toFixed(1)}, below 44px`,
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

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const authResponse = await context.request.post(`${appUrl}/auth/e2e`, {
    headers: { "x-tcg-e2e-secret": authSecret },
  });
  assert(authResponse.status() === 200, `local E2E auth returned ${authResponse.status()}`);

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${appUrl}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForLoadState("load");
  await page.waitForTimeout(750);

  const sidebarTrigger = page.getByRole("button", { name: "Toggle Sidebar" }).first();
  await assertTapTarget(sidebarTrigger, "mobile sidebar trigger");
  await sidebarTrigger.click();
  const mobileSidebar = page.locator('[data-mobile="true"]');
  await mobileSidebar.waitFor({ state: "visible" });

  const posNavigation = mobileSidebar.getByRole("button", { name: "Camera POS", exact: true });
  await assertTapTarget(posNavigation, "Camera POS sidebar navigation");
  await posNavigation.click();
  await mobileSidebar.waitFor({ state: "hidden" });
  await page.getByTestId("pos-view").waitFor({ state: "visible" });
  assert(
    await page.locator('[data-slot="sheet-overlay"]').count() === 0,
    "mobile sidebar overlay remained mounted after navigation",
  );

  const acquire = page.getByRole("tab", { name: "Acquire", exact: true });
  const sell = page.getByRole("tab", { name: "Sell", exact: true });
  const startCamera = page.getByRole("button", { name: "Start camera", exact: true });
  await assertTapTarget(acquire, "Acquire tab");
  await assertTapTarget(sell, "Sell tab");
  await assertTapTarget(startCamera, "Start camera button");
  await acquire.click();
  assert(await acquire.getAttribute("aria-selected") === "true", "Acquire pointer click did not activate");
  await sell.click();
  assert(await sell.getAttribute("aria-selected") === "true", "Sell pointer click did not activate");
  await assertNoHorizontalOverflow(page, "390px Camera POS");
  assert(pageErrors.length === 0, `Camera POS raised page errors: ${pageErrors.join(" | ")}`);

  await page.screenshot({ path: `${artifactRoot}/phone-pos-navigation.png`, fullPage: true });
  console.log(JSON.stringify({
    viewport: "390x844",
    sidebarPointerNavigation: "pass",
    sidebarClosedAfterNavigation: "pass",
    posPointerControls: "pass",
    horizontalOverflow: "pass",
    screenshot: `${artifactRoot}/phone-pos-navigation.png`,
  }, null, 2));
  await context.close();
} finally {
  await browser.close();
}

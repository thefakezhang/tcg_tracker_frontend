import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const dependencyRoot = process.env.TCG_FRONTEND_DEPENDENCY_ROOT;
const require = dependencyRoot
  ? createRequire(`${dependencyRoot}/package.json`)
  : createRequire(import.meta.url);
const { chromium } = require("playwright");

const appUrl = process.env.APP_URL;
const artifactRoot = process.env.E2E_ARTIFACT_ROOT;
if (!appUrl || !artifactRoot) {
  throw new Error("APP_URL and E2E_ARTIFACT_ROOT are required");
}
if (
  process.env.E2E_HEADED !== "1"
  || process.env.TCG_SOURCE_HEALTH_XVFB !== "1"
  || !process.env.DISPLAY
) {
  throw new Error("source-health coverage acceptance requires headed Chromium under Xvfb");
}
mkdirSync(artifactRoot, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const now = new Date();
const runDate = now.toISOString().slice(0, 10);
const commonHealth = {
  run_date: runDate,
  computed_at: now.toISOString(),
  rows_written: 100,
  match_rate: 0.95,
  unmatched_queue_depth: 2,
  drift_count: 0,
  guard_trips: 0,
  refresh_failures: 0,
  freshness_p50_hours: 4,
  table_bytes: 1000,
};
const healthRows = [
  {
    ...commonHealth,
    source: "cardrush",
    notes: { listing_sides: { buy: { rows: 100 } } },
  },
  {
    ...commonHealth,
    source: "fixture_malformed",
    notes: {
      collection_coverage: {
        sell: {
          status: "retired",
          reason: "unexpected_reason",
          last_good_at: "not-a-date",
        },
      },
    },
  },
  {
    ...commonHealth,
    source: "fixture_wrong_source",
    notes: {
      collection_coverage: {
        sell: {
          status: "retired",
          reason: "storefront_access_gate_http_401_since_2026_08_11",
          last_good_at: "2026-08-10T14:30:00Z",
        },
      },
    },
  },
  {
    ...commonHealth,
    source: "torecabank",
    rows_written: 1200,
    freshness_p50_hours: 744,
    notes: {
      last_run_hours: 2,
      listing_sides: {
        buy: {
          rows: 500,
          freshness_p50_hours: 2,
          last_write_at: "2026-09-11T03:00:00Z",
        },
        sell: {
          rows: 700,
          freshness_p50_hours: 744,
          last_write_at: "2026-08-10T14:30:00Z",
        },
      },
      collection_coverage: {
        sell: {
          status: "retired",
          reason: "storefront_access_gate_http_401_since_2026_08_11",
          last_good_at: "2026-08-10T14:30:00Z",
        },
      },
    },
  },
];

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, prefer, range, x-client-info",
  "content-type": "application/json",
};

async function assertNoPageOverflow(page, stage) {
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
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    timezoneId: "America/New_York",
  });
  await context.addInitScript(() => localStorage.setItem("language", "en"));

  let localAPIRequests = 0;
  let unexpectedExternalRequests = 0;
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === "127.0.0.1" && url.port === "54321") {
      if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      localAPIRequests += 1;
      const pathname = url.pathname;
      let data = [];
      if (pathname.endsWith("/source_health")) {
        data = healthRows;
      } else if (pathname.endsWith("/rpc/source_run_control_snapshot")) {
        data = {
          server_time: now.toISOString(),
          jobs: [],
          runs: [],
          hosts: [],
          inventory: [],
        };
      }
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-range": `0-${Array.isArray(data) ? Math.max(0, data.length - 1) : 0}/*` },
        body: JSON.stringify(data),
      });
      return;
    }

    const isLoopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
    if ((url.protocol === "http:" || url.protocol === "https:") && !isLoopback) {
      unexpectedExternalRequests += 1;
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
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

  await page.goto(`${appUrl}/e2e/source-health-coverage`, { waitUntil: "networkidle" });
  const torecabankRow = page.getByRole("row").filter({ hasText: "torecabank" });
  await torecabankRow.getByText("Sell retired", { exact: true }).waitFor();
  await torecabankRow.getByText(
    "The storefront access gate has returned HTTP 401 since Aug 11, 2026.",
    { exact: true },
  ).waitFor();
  const englishLastGood = await torecabankRow.getByText(/^Last good Sell:/).textContent();
  assert(englishLastGood?.includes("Aug 10, 2026"), `${name} English last-good timestamp: ${englishLastGood}`);

  const malformedRow = page.getByRole("row").filter({ hasText: "fixture_malformed" });
  assert(await malformedRow.count() === 1, `${name} malformed fixture row missing`);
  assert(
    await malformedRow.getByText("Sell retired", { exact: true }).count() === 0,
    `${name} malformed note rendered retired coverage`,
  );
  const wrongSourceRow = page.getByRole("row").filter({ hasText: "fixture_wrong_source" });
  assert(await wrongSourceRow.count() === 1, `${name} wrong-source fixture row missing`);
  assert(
    await wrongSourceRow.getByText("Sell retired", { exact: true }).count() === 0,
    `${name} wrong-source notes rendered retired coverage`,
  );
  const ordinaryRow = page.getByRole("row").filter({ hasText: "cardrush" });
  assert(await ordinaryRow.count() === 1, `${name} ordinary row missing`);
  assert(
    await ordinaryRow.getByText("Sell retired", { exact: true }).count() === 0,
    `${name} ordinary row changed`,
  );
  const englishDimensions = await assertNoPageOverflow(page, `${name} English`);
  await page.screenshot({
    path: `${artifactRoot}/${name}-english.png`,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });

  const japaneseButton = page.getByRole("button", { name: "日本語" });
  const japaneseTarget = viewport.width === 390
    ? await assertTapTarget(japaneseButton, `${name} Japanese language button`)
    : null;
  await japaneseButton.click();
  await torecabankRow.getByText("販売価格の収集を廃止", { exact: true }).waitFor();
  await torecabankRow.getByText(
    "ストアフロントのアクセスゲートは2026年8月11日以降HTTP 401を返しています。",
    { exact: true },
  ).waitFor();
  const japaneseLastGood = await torecabankRow.getByText(/^販売価格の最終正常更新:/).textContent();
  assert(japaneseLastGood?.includes("2026年8月10日"), `${name} Japanese last-good timestamp: ${japaneseLastGood}`);
  assert(await page.locator("html").getAttribute("lang") === "ja", `${name} document language did not change`);
  assert(
    await malformedRow.getByText("販売価格の収集を廃止", { exact: true }).count() === 0,
    `${name} malformed note rendered Japanese retired coverage`,
  );
  assert(
    await wrongSourceRow.getByText("販売価格の収集を廃止", { exact: true }).count() === 0,
    `${name} wrong-source notes rendered Japanese retired coverage`,
  );
  const japaneseDimensions = await assertNoPageOverflow(page, `${name} Japanese`);
  await page.screenshot({
    path: `${artifactRoot}/${name}-japanese.png`,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });

  assert(localAPIRequests > 0, `${name} did not exercise the local source-health API path`);
  assert(unexpectedExternalRequests === 0, `${name} made ${unexpectedExternalRequests} external requests`);
  assert(pageErrors.length === 0, `${name} page errors: ${JSON.stringify(pageErrors)}`);
  assert(consoleErrors.length === 0, `${name} console errors: ${JSON.stringify(consoleErrors)}`);
  await context.close();
  return {
    viewport,
    localAPIRequests,
    unexpectedExternalRequests,
    englishLastGood,
    japaneseLastGood,
    japaneseTarget,
    englishDimensions,
    japaneseDimensions,
  };
}

const browser = await chromium.launch({ headless: false });
try {
  const results = {};
  results.desktop = await runViewport(browser, "desktop", { width: 1440, height: 900 });
  results.phone390 = await runViewport(browser, "phone-390", { width: 390, height: 844 });
  writeFileSync(
    `${artifactRoot}/summary.json`,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} finally {
  await browser.close();
}

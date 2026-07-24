import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

// Browser evidence for the optional-lot-total UX: create a lot with NO total,
// see the blank-line finalize warning, price the line, and finalize on a
// derived total. Driven by run-optional-lot-total-evidence.sh.

const appUrl = process.env.APP_URL;
const authSecret = process.env.E2E_AUTH_SECRET;
if (!appUrl || !authSecret) throw new Error("APP_URL and E2E_AUTH_SECRET are required");
const artifactRoot = process.env.E2E_ARTIFACT_ROOT ?? "/tmp/tcg-optional-lot-total";
mkdirSync(artifactRoot, { recursive: true });

const tripName = `Optional total E2E ${Date.now()}`;

function assert(condition, message) { if (!condition) throw new Error(message); }

async function authenticate(context) {
  const response = await context.request.post(`${appUrl}/auth/e2e`, {
    headers: { "x-tcg-e2e-secret": authSecret },
  });
  assert(response.status() === 200, `E2E auth returned ${response.status()}`);
}

async function dialogWithTitle(page, title) {
  const dialog = page.locator('[data-slot="dialog-content"]').filter({ hasText: title }).last();
  await dialog.waitFor({ state: "visible" });
  return dialog;
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await authenticate(context);
  const page = await context.newPage();
  await page.goto(`${appUrl}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForLoadState("load");
  await page.waitForTimeout(1000);

  await page.getByRole("button", { name: "New Trip", exact: true }).click();
  let dialog = await dialogWithTitle(page, "New Trip");
  await dialog.locator("#trip-name").fill(tripName);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const tripButton = page.getByRole("button", { name: tripName, exact: true });
  await tripButton.click();
  await page.getByRole("heading", { name: tripName, exact: true, level: 2 }).waitFor();

  // Create a lot WITHOUT a total. Save must be enabled with the total blank.
  await page.getByRole("button", { name: "New Lot", exact: true }).click();
  dialog = await dialogWithTitle(page, "New Lot");
  const lotInputs = dialog.locator("input");
  await lotInputs.nth(1).fill("E2E No-Total Shop");
  await lotInputs.nth(2).fill("USD");
  // Deliberately leave the total (nth(3)) blank.
  await lotInputs.nth(4).fill("1");
  const saveBtn = dialog.getByRole("button", { name: "Save", exact: true });
  assert(await saveBtn.isEnabled(), "Save is disabled with a blank lot total");
  await page.screenshot({ path: `${artifactRoot}/lot-form-optional-total.png` });
  await saveBtn.click();
  await dialog.waitFor({ state: "hidden" });

  // The lot chip shows "Total from items" rather than a currency figure.
  await page.getByText("Total from items").first().waitFor({ state: "visible" });

  // Add a card line with NO price -> the blank-line finalize warning appears.
  const search = page.getByPlaceholder("Search cards or sealed products to add...");
  await search.fill("Lot E2E Pikachu");
  const cardResult = page.getByRole("button").filter({ hasText: "Lot E2E Pikachu" }).first();
  await cardResult.waitFor({ state: "visible" });
  await cardResult.click();
  await page.getByRole("row").filter({ hasText: "Lot E2E Pikachu" }).waitFor();

  const warning = page.getByText(/have no price/).first();
  await warning.waitFor({ state: "visible", timeout: 15_000 });
  const finalizeBtn = page.locator("button", { hasText: "Finalize" }).last();
  await finalizeBtn.waitFor({ state: "attached", timeout: 15_000 });
  assert(await finalizeBtn.isDisabled(), "Finalize enabled while a line is blank and no total is set");
  await page.screenshot({ path: `${artifactRoot}/blank-line-finalize-warning.png` });

  // Price the line -> the warning clears and finalize enables.
  const priceInput = page.getByRole("row").filter({ hasText: "Lot E2E Pikachu" }).locator('input[type="number"]').last();
  await priceInput.fill("12");
  await priceInput.blur();
  await warning.waitFor({ state: "hidden", timeout: 15_000 });
  assert(await finalizeBtn.isEnabled(), "Finalize still disabled after pricing every line");
  await finalizeBtn.click();

  // Finalized on a derived total: the lot header and the line both reflect the
  // $12 derived from the single priced line (wait for the line refetch to land
  // so the captured artifact is accurate, not mid-reload).
  await page.locator("div", { hasText: /Direct purchase \$12\.00/ }).last()
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.getByRole("row").filter({ hasText: "Lot E2E Pikachu" })
    .getByText("$12.00").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.screenshot({ path: `${artifactRoot}/finalized-derived-total.png` });

  console.log(`optional-lot-total evidence passed; artifacts: ${artifactRoot}`);
} finally {
  await browser.close();
}

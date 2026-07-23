import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const appUrl = process.env.APP_URL;
const authSecret = process.env.E2E_AUTH_SECRET;
if (!appUrl || !authSecret) {
  throw new Error("APP_URL and E2E_AUTH_SECRET are required");
}

const artifactRoot =
  process.env.E2E_ARTIFACT_ROOT ?? "/tmp/tcg-lot-economics-e2e";
mkdirSync(artifactRoot, { recursive: true });

const tripName = `Lot economics E2E ${Date.now()}`;
const dialogs = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function authenticate(context) {
  const response = await context.request.post(`${appUrl}/auth/e2e`, {
    headers: { "x-tcg-e2e-secret": authSecret },
  });
  assert(
    response.status() === 200,
    `local E2E authentication returned ${response.status()}`,
  );
}

function monitor(page) {
  page.on("dialog", async (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    await dialog.dismiss();
  });
  page.on("response", async (response) => {
    if (
      !response.ok()
      && response.url().includes("/rest/v1/rpc/record_lot_sale")
    ) {
      console.error(
        `record_lot_sale HTTP ${response.status()}: ${await response.text()}`,
      );
    }
  });
}

function ensureNoDialogs(stage) {
  if (dialogs.length > 0) {
    throw new Error(`${stage} opened an error dialog: ${dialogs.join(" | ")}`);
  }
}

async function assertNoPageOverflow(page, stage) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert(
    dimensions.document <= dimensions.viewport + 1
      && dimensions.body <= dimensions.viewport + 1,
    `${stage} overflowed horizontally: ${JSON.stringify(dimensions)}`,
  );
}

async function assertTapTarget(locator, label) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  assert(box, `${label} has no tap-target bounds`);
  assert(
    box.width >= 43 && box.height >= 43,
    `${label} is ${box.width.toFixed(1)}x${box.height.toFixed(1)}, below 44px`,
  );
}

function fieldInput(scope, label) {
  return scope
    .getByText(label, { exact: true })
    .first()
    .locator("..")
    .locator("input")
    .first();
}

async function dialogWithTitle(page, title) {
  const dialog = page
    .locator('[data-slot="dialog-content"]')
    .filter({ hasText: title })
    .last();
  await dialog.waitFor({ state: "visible" });
  return dialog;
}

async function waitForHydration(page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(1_000);
}

async function createAndSellLot(page) {
  await page.goto(`${appUrl}/dashboard`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await waitForHydration(page);
  await page.getByRole("button", { name: "New Trip", exact: true }).click();

  let dialog = await dialogWithTitle(page, "New Trip");
  await dialog.locator("#trip-name").fill(tripName);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });

  const tripButton = page.getByRole("button", {
    name: tripName,
    exact: true,
  });
  await tripButton.waitFor({ state: "visible" });
  await tripButton.click();
  await page
    .getByRole("heading", { name: tripName, exact: true, level: 2 })
    .waitFor();

  await page.getByRole("button", { name: "New Lot", exact: true }).click();
  dialog = await dialogWithTitle(page, "New Lot");
  const lotInputs = dialog.locator("input");
  await lotInputs.nth(1).fill("E2E Shop");
  await lotInputs.nth(2).fill("USD");
  await lotInputs.nth(3).fill("100");
  await lotInputs.nth(4).fill("1");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });

  const search = page.getByPlaceholder(
    "Search cards or sealed products to add...",
  );
  await page.locator('input[title="PSA grade (0 = raw)"]').fill("10");
  await search.fill("Lot E2E Pikachu");
  const cardResult = page
    .getByRole("button")
    .filter({ hasText: "Lot E2E Pikachu" })
    .first();
  await cardResult.waitFor({ state: "visible" });
  await cardResult.click();
  const gradeInput = page.locator('input[aria-label="PSA"]').first();
  await gradeInput.waitFor({ state: "visible" });
  assert(
    (await gradeInput.inputValue()) === "10",
    "selected PSA 10 card was not added as PSA 10",
  );

  await page
    .getByRole("combobox", { name: "Item type" })
    .selectOption("pokemon_sealed");
  await search.fill("Lot E2E Booster Box");
  const sealedResult = page
    .getByRole("button")
    .filter({ hasText: "Lot E2E Booster Box" })
    .first();
  await sealedResult.waitFor({ state: "visible" });
  await sealedResult.click();
  await page
    .getByRole("row")
    .filter({ hasText: "Lot E2E Booster Box" })
    .waitFor();

  await page.getByPlaceholder("Amount").fill("25");
  await page.getByPlaceholder("Currency").fill("USD");
  await page.getByPlaceholder("FX rate to USD").fill("1");
  await page.getByPlaceholder("Note").fill("E2E acquisition shipping");
  await page.getByRole("button", { name: "Add cost", exact: true }).click();
  const savedCostNote = page.locator('input[aria-label="Note"]').first();
  await savedCostNote.waitFor({ state: "visible" });
  assert(
    (await savedCostNote.inputValue()) === "E2E acquisition shipping",
    "acquisition cost note did not persist",
  );
  await page.getByText(/Landed cost \$125\.00/).waitFor();
  ensureNoDialogs("draft lot entry");

  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await waitForHydration(page);
  await page
    .getByRole("button", { name: tripName, exact: true })
    .click();
  const reloadedCostNote = page.locator('input[aria-label="Note"]').first();
  await reloadedCostNote.waitFor({ state: "visible" });
  assert(
    (await reloadedCostNote.inputValue()) === "E2E acquisition shipping",
    "acquisition cost note did not persist after reload",
  );
  assert(
    (await page.locator('input[aria-label="PSA"]').first().inputValue()) ===
      "10",
    "PSA 10 did not persist after reload",
  );
  await page
    .getByRole("row")
    .filter({ hasText: "Lot E2E Booster Box" })
    .waitFor();

  await page
    .getByRole("button", { name: "Finalize lot", exact: true })
    .click();
  await page.waitForTimeout(1_000);
  ensureNoDialogs("lot finalization request");
  await page
    .getByRole("button", { name: "Undo finalize", exact: true })
    .waitFor();
  await page.getByText("PSA 10", { exact: true }).waitFor();
  ensureNoDialogs("lot finalization");

  await page.getByRole("tab", { name: "Sales", exact: true }).click();
  const checkboxes = page.getByRole("checkbox", {
    name: "Select cards to sell together for one price",
  });
  await checkboxes.first().waitFor({ state: "visible" });
  assert((await checkboxes.count()) === 2, "expected two sellable holdings");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page
    .getByRole("button", { name: "Sell 2 as lot", exact: true })
    .click();

  dialog = await dialogWithTitle(page, "Sell 2 items as a lot");
  await dialog
    .locator('select:has(option[value="landed_cost"])')
    .selectOption("landed_cost");
  const itemExpenseInputs = dialog
    .getByText("Item expense (USD)", { exact: true })
    .locator("..")
    .locator("input");
  assert(
    (await itemExpenseInputs.count()) === 2,
    "bulk sale did not expose one optional item expense per product",
  );
  await itemExpenseInputs.nth(0).fill("5");
  await fieldInput(dialog, "Total proceeds (USD)").fill("200");
  await fieldInput(dialog, "Shared sale expense (USD)").fill("10");
  await dialog
    .getByRole("button", { name: "Record sale", exact: true })
    .click();
  await page.waitForTimeout(1_000);
  ensureNoDialogs("bulk lot sale request");
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("Lot · 2 items", { exact: true }).first().waitFor();
  ensureNoDialogs("bulk lot sale");

  await page
    .getByRole("button", { name: "Finances", exact: true })
    .click();
  await page.getByRole("tab", { name: "Economics", exact: true }).click();
  await page
    .getByPlaceholder("Search item, set, or trip...")
    .fill(tripName);
  await page
    .getByText("Lot E2E Pikachu", { exact: true })
    .first()
    .waitFor();

  const expectedSummary = [
    ["Direct purchase", "$100.00"],
    ["Acquisition costs", "$25.00"],
    ["Landed basis", "$125.00"],
    ["Net proceeds", "$185.00"],
    ["Realized profit", "$60.00"],
  ];
  for (const [label, value] of expectedSummary) {
    const card = page.getByText(label, { exact: true }).first().locator("..");
    assert(
      (await card.textContent())?.includes(value),
      `${label} summary did not contain ${value}`,
    );
  }

  const row = page
    .getByRole("row")
    .filter({ hasText: "Lot E2E Pikachu" })
    .first();
  await row.click();
  await page
    .getByText(
      "Per-item proceeds and shared selling expenses are allocated estimates from the recorded lot-level totals.",
      { exact: true },
    )
    .waitFor();
  await page.screenshot({
    path: `${artifactRoot}/desktop-economics.png`,
    fullPage: true,
  });
  await assertNoPageOverflow(page, "desktop economics sheet");
}

async function verifyPhone(page) {
  await page.goto(`${appUrl}/dashboard`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await waitForHydration(page);
  const sidebarTrigger = page.getByRole("button", { name: "Toggle Sidebar" });
  await assertTapTarget(sidebarTrigger, "mobile sidebar trigger");
  await sidebarTrigger.click();
  const tripButton = page.getByRole("button", {
    name: tripName,
    exact: true,
  });
  await assertTapTarget(tripButton, "mobile trip navigation");
  await tripButton.click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("heading", { name: tripName, exact: true, level: 2 })
    .waitFor();
  await page.getByRole("tab", { name: "Import", exact: true }).click();
  await page.getByText(/PSA 10/).first().waitFor();
  await page
    .getByText("Lot E2E Booster Box", { exact: true })
    .first()
    .waitFor();
  await assertTapTarget(
    page.getByRole("button", { name: "New Lot", exact: true }),
    "mobile new-lot button",
  );
  await assertTapTarget(
    page.getByRole("tab", { name: "Sales", exact: true }),
    "mobile sales tab",
  );
  await assertNoPageOverflow(page, "mobile finalized lot");
  await page.screenshot({
    path: `${artifactRoot}/phone-finalized-lot.png`,
    fullPage: true,
  });

  await page.getByRole("tab", { name: "Sales", exact: true }).click();
  await page.getByText("Lot · 2 items", { exact: true }).first().waitFor();
  await assertNoPageOverflow(page, "mobile sales history");

  await sidebarTrigger.click();
  const financesButton = page.getByRole("button", {
    name: "Finances",
    exact: true,
  });
  await assertTapTarget(financesButton, "mobile finances navigation");
  await financesButton.click();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Economics", exact: true }).click();
  await page
    .getByPlaceholder("Search item, set, or trip...")
    .fill(tripName);
  const economicsItem = page
    .getByRole("button")
    .filter({ hasText: "Lot E2E Pikachu" })
    .first();
  await assertTapTarget(economicsItem, "mobile economics item");
  await assertNoPageOverflow(page, "mobile economics list");
  await economicsItem.click();
  await page.getByText("Frozen basis", { exact: true }).waitFor();
  await page.getByText("Realized economics", { exact: true }).waitFor();
  await page
    .getByText(
      "Per-item proceeds and shared selling expenses are allocated estimates from the recorded lot-level totals.",
      { exact: true },
    )
    .waitFor();
  await assertNoPageOverflow(page, "mobile economics sheet");
  await page.waitForTimeout(350);
  await page.screenshot({
    path: `${artifactRoot}/phone-economics-sheet.png`,
  });
  ensureNoDialogs("mobile acceptance");
}

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await authenticate(desktop);
  const desktopPage = await desktop.newPage();
  monitor(desktopPage);
  await createAndSellLot(desktopPage);
  await desktop.close();

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await authenticate(phone);
  const phonePage = await phone.newPage();
  monitor(phonePage);
  await verifyPhone(phonePage);
  await phone.close();

  console.log(
    `Lot economics browser acceptance passed for ${tripName}; artifacts: ${artifactRoot}`,
  );
} finally {
  await browser.close();
}

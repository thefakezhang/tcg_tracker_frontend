import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

// Browser evidence for H1 (owned counts incl. draft-lot incoming) and H3
// (uid chip + uid paste) on the card browser. Driven by
// run-owned-uid-evidence.sh, which seeds the fixture holdings first.

const appUrl = process.env.APP_URL;
const authSecret = process.env.E2E_AUTH_SECRET;
const cardUid = process.env.E2E_CARD_UID;
if (!appUrl || !authSecret || !cardUid) {
  throw new Error("APP_URL, E2E_AUTH_SECRET, and E2E_CARD_UID are required");
}
const artifactRoot = process.env.E2E_ARTIFACT_ROOT ?? "/tmp/tcg-owned-uid-evidence";
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

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await authenticate(context);
  const page = await context.newPage();

  await page.goto(`${appUrl}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForLoadState("load");

  // H1: the browse list shows owned + draft-lot incoming on the fixture row.
  await page.getByPlaceholder("Name...").fill("Lot E2E Pikachu");
  const ownedLine = page.getByText(/Owned 2/).first();
  await ownedLine.waitFor({ state: "visible", timeout: 30_000 });
  await page.getByText(/\+2 in draft lot/).first().waitFor({ state: "visible" });
  await page.screenshot({ path: `${artifactRoot}/h1-owned-browser-desktop.png`, fullPage: false });

  // H3: the list uid chip shows the 8-hex prefix.
  const uidPrefix = cardUid.slice(0, 8);
  await page.getByRole("button", { name: new RegExp(uidPrefix) }).first().waitFor({ state: "visible" });

  // H1: the modal owned line with the condition/grade breakdown + incoming.
  await page.getByRole("row").filter({ hasText: "Lot E2E Pikachu" }).first().click();
  const modalOwned = page.getByText(/Owned 2 \(.*PSA 10.*\)/).first();
  await modalOwned.waitFor({ state: "visible", timeout: 30_000 });
  await page.getByText(/\+2 in draft lot/).first().waitFor({ state: "visible" });
  await page.screenshot({ path: `${artifactRoot}/h1-owned-modal-desktop.png` });
  await page.keyboard.press("Escape");

  // H3: pasting the full uid into the browser search lands exactly this card.
  await page.getByPlaceholder("Name...").fill(cardUid);
  await page.getByRole("row").filter({ hasText: "Lot E2E Pikachu" }).first()
    .waitFor({ state: "visible", timeout: 30_000 });
  await page.screenshot({ path: `${artifactRoot}/h3-uid-paste-desktop.png` });

  // Phone width: the modal owned line must be visible without scrolling.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await authenticate(phone);
  const phonePage = await phone.newPage();
  await phonePage.goto(`${appUrl}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await phonePage.waitForLoadState("load");
  await phonePage.getByPlaceholder("Name...").fill("Lot E2E Pikachu");
  await phonePage.getByText(/Owned 2/).first().waitFor({ state: "visible", timeout: 30_000 });
  await phonePage.locator('[data-slot="card"]').filter({ hasText: "Lot E2E Pikachu" }).first().click();
  const phoneOwned = phonePage.getByText(/Owned 2 \(/).first();
  await phoneOwned.waitFor({ state: "visible", timeout: 30_000 });
  assert(
    await phoneOwned.isVisible(),
    "phone modal owned line not visible",
  );
  const box = await phoneOwned.boundingBox();
  assert(box && box.y >= 0 && box.y < 844, "phone owned line is outside the initial viewport");
  await phonePage.screenshot({ path: `${artifactRoot}/h1-owned-modal-phone.png` });

  console.log(`owned/uid browser evidence passed; artifacts: ${artifactRoot}`);
} finally {
  await browser.close();
}

const DASHBOARD_LOAD_OPTIONS = { waitUntil: "domcontentloaded", timeout: 90_000 };

export async function waitForHydratedSearch(page, placeholder) {
  await page.waitForLoadState("load");
  const input = page.getByPlaceholder(placeholder);
  await input.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(750);
  return input;
}

export async function reloadHydratedDashboard(page, label) {
  await page.reload(DASHBOARD_LOAD_OPTIONS);
  if (!page.url().includes("/dashboard")) {
    throw new Error(`${label} reload lost the session: ${page.url()}`);
  }
  await waitForHydratedSearch(page, "Name...");
}

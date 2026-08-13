import { describe, expect, it, vi } from "vitest";
import { reloadHydratedDashboard, waitForHydratedSearch } from "./g8-g11-browser-readiness.mjs";

function pageHarness(url = "https://catalog.test/dashboard") {
  const calls = [];
  const input = {
    waitFor: vi.fn(async () => { calls.push("search-visible"); }),
  };
  const page = {
    reload: vi.fn(async () => { calls.push("reload"); }),
    url: vi.fn(() => url),
    waitForLoadState: vi.fn(async () => { calls.push("load"); }),
    getByPlaceholder: vi.fn(() => {
      calls.push("locate-search");
      return input;
    }),
    waitForTimeout: vi.fn(async () => { calls.push("hydration-settle"); }),
  };
  return { calls, input, page };
}

describe("G8-G11 browser readiness", () => {
  it("waits for the named hydrated search boundary", async () => {
    const { calls, input, page } = pageHarness();

    await expect(waitForHydratedSearch(page, "Name...")).resolves.toBe(input);

    expect(page.getByPlaceholder).toHaveBeenCalledWith("Name...");
    expect(input.waitFor).toHaveBeenCalledWith({ state: "visible", timeout: 30_000 });
    expect(calls).toEqual(["load", "locate-search", "search-visible", "hydration-settle"]);
  });

  it("reloads and proves Card Browser hydration before returning", async () => {
    const { calls, page } = pageHarness();

    await reloadHydratedDashboard(page, "desktop Card Index recovery");

    expect(page.reload).toHaveBeenCalledWith({ waitUntil: "domcontentloaded", timeout: 90_000 });
    expect(calls).toEqual(["reload", "load", "locate-search", "search-visible", "hydration-settle"]);
  });

  it("fails before hydration when the reload loses the dashboard session", async () => {
    const { calls, page } = pageHarness("https://catalog.test/login");

    await expect(reloadHydratedDashboard(page, "phone Card Index recovery"))
      .rejects.toThrow("phone Card Index recovery reload lost the session");
    expect(calls).toEqual(["reload"]);
  });
});

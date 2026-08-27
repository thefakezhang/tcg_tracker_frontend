import { describe, expect, it } from "vitest";
import { createColumns } from "./columns";

describe("Card Browser responsive columns", () => {
  it("keeps primary prices and decisions visible while deferring secondary economics", () => {
    const columns = createColumns((key) => key);
    const byId = new Map(columns.map((column) => [column.id, column]));

    expect(byId.get("lowestSell")?.meta).toBeUndefined();
    expect(byId.get("highestBuy")?.meta).toBeUndefined();
    expect(byId.get("conservativeExit")?.meta).toBeUndefined();
    expect(byId.get("rawToGrade")?.meta).toEqual({ className: "hidden 2xl:table-cell" });
    expect(byId.get("decision")?.meta).toEqual(expect.objectContaining({ className: expect.stringContaining("sticky right-0") }));
  });
});

describe("MTG and Sealed factories defer secondary columns like the Pokemon one", () => {
  it("MTG hides foil type and language on narrow screens, keeps prices visible", async () => {
    const { createMtgColumns } = await import("./columns");
    const byId = new Map(createMtgColumns((key) => key).map((c) => [c.id, c]));
    expect(byId.get("lowestSell")?.meta).toBeUndefined();
    expect(byId.get("highestBuy")?.meta).toBeUndefined();
    expect(byId.get("foil_type")?.meta).toEqual({ className: "hidden lg:table-cell" });
    expect(byId.get("language")?.meta).toEqual({ className: "hidden xl:table-cell" });
  });
  it("Sealed hides product type and set code on narrow screens, keeps prices visible", async () => {
    const { createSealedColumns } = await import("./columns");
    const byId = new Map(createSealedColumns((key) => key).map((c) => [c.id, c]));
    expect(byId.get("lowestSell")?.meta).toBeUndefined();
    expect(byId.get("productType")?.meta).toEqual({ className: "hidden xl:table-cell" });
    expect(byId.get("set_code")?.meta).toEqual({ className: "hidden lg:table-cell" });
  });
  it("Buy list drops the columns its rows can never fill", async () => {
    const { createBuylistColumns } = await import("./columns");
    const ids = new Set(createBuylistColumns((key) => key).map((c) => c.id));
    for (const gone of ["psa_grade", "conservativeExit", "dealNet", "rawToGrade", "relativeValue", "decision"]) {
      expect(ids.has(gone)).toBe(false);
    }
    expect(ids.has("targetPrice")).toBe(true);
    expect(ids.has("lowestSell")).toBe(true);
  });
});

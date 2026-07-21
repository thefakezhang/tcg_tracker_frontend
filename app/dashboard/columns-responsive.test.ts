import { describe, expect, it } from "vitest";
import { createColumns } from "./columns";

describe("Card Browser responsive columns", () => {
  it("keeps primary prices and decisions visible while deferring secondary economics", () => {
    const columns = createColumns((key) => key);
    const byId = new Map(columns.map((column) => [column.id, column]));

    expect(byId.get("lowestSell")?.meta).toBeUndefined();
    expect(byId.get("highestBuy")?.meta).toBeUndefined();
    expect(byId.get("conservativeExit")?.meta).toBeUndefined();
    expect(byId.get("annualized")?.meta).toEqual({ className: "hidden xl:table-cell" });
    expect(byId.get("rawToGrade")?.meta).toEqual({ className: "hidden 2xl:table-cell" });
    expect(byId.get("decision")?.meta).toEqual(expect.objectContaining({ className: expect.stringContaining("sticky right-0") }));
  });
});

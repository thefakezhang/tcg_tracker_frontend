import { describe, expect, it } from "vitest";
import { laneLabel } from "./lane";

describe("laneLabel", () => {
  it("names the direction from the entry region to the exit region", () => {
    expect(laneLabel("JP", "NA")).toBe("JP→NA");
    expect(laneLabel("NA", "JP")).toBe("NA→JP");
  });

  it("is empty when the row has no cross-region lane", () => {
    // Same region on both sides is the informational fallback, not a trade.
    expect(laneLabel("JP", "JP")).toBeNull();
    expect(laneLabel(null, "NA")).toBeNull();
    expect(laneLabel("JP", undefined)).toBeNull();
    expect(laneLabel("", "NA")).toBeNull();
  });
});

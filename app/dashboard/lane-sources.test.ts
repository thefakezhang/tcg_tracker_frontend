import { describe, expect, it } from "vitest";
import { laneSourceSets, laneSourceSetsKey } from "./lane-sources";

const exitOptions = ["130point", "cardladder", "cardrush", "tcgplayer"];
const none = { requiredSource: "", sourceSide: "buy" as const, excludedExits: [], exitOptions };

describe("laneSourceSets", () => {
  it("leaves the stored summaries in charge when nothing restricts the lane", () => {
    expect(laneSourceSets({ game: "pokemon", ...none })).toBeNull();
  });

  it("only restricts Pokemon singles", () => {
    expect(laneSourceSets({ game: "mtg", ...none, requiredSource: "cardrush", sourceSide: "sell" })).toBeNull();
    expect(laneSourceSets({ game: "pokemon_sealed", ...none, excludedExits: ["130point"] })).toBeNull();
  });

  it("buys from the chosen shop", () => {
    expect(laneSourceSets({ game: "pokemon", ...none, requiredSource: "surugaya", sourceSide: "sell" }))
      .toEqual({ entry: ["surugaya"], exit: null });
  });

  it("sells to the chosen buylist", () => {
    expect(laneSourceSets({ game: "pokemon", ...none, requiredSource: "cardrush", sourceSide: "buy" }))
      .toEqual({ entry: null, exit: ["cardrush"] });
  });

  it("keeps every exit but the unticked ones, cardladder included", () => {
    expect(laneSourceSets({ game: "pokemon", ...none, excludedExits: ["130point"] }))
      .toEqual({ entry: null, exit: ["cardladder", "cardrush", "tcgplayer"] });
  });

  it("combines a shop to buy from with exits from A, B and C but not D", () => {
    expect(laneSourceSets({
      game: "pokemon",
      requiredSource: "surugaya",
      sourceSide: "sell",
      excludedExits: ["130point"],
      exitOptions,
    })).toEqual({ entry: ["surugaya"], exit: ["cardladder", "cardrush", "tcgplayer"] });
  });

  it("intersects a chosen buylist with the ticked exits", () => {
    expect(laneSourceSets({ game: "pokemon", ...none, requiredSource: "cardrush", excludedExits: ["130point"] }))
      .toEqual({ entry: null, exit: ["cardrush"] });
    expect(laneSourceSets({ game: "pokemon", ...none, requiredSource: "cardrush", excludedExits: ["cardrush"] }))
      .toEqual({ entry: null, exit: [] });
  });
});

describe("laneSourceSetsKey", () => {
  it("is equal for equal selections and empty for none", () => {
    expect(laneSourceSetsKey(null)).toBe("");
    expect(laneSourceSetsKey({ entry: ["a"], exit: null })).toBe(laneSourceSetsKey({ entry: ["a"], exit: null }));
    expect(laneSourceSetsKey({ entry: ["a"], exit: null })).not.toBe(laneSourceSetsKey({ entry: null, exit: ["a"] }));
  });
});

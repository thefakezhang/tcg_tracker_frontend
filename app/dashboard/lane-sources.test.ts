import { describe, expect, it } from "vitest";
import { laneSourceSets, laneSourceSetsKey } from "./lane-sources";

const exitOptions = ["130point", "cardladder", "cardrush", "surugaya", "tcgplayer"];
const none = { buyAt: "", excludedExits: [], exitOptions };

describe("laneSourceSets", () => {
  it("leaves the stored summaries in charge when nothing restricts the lane", () => {
    expect(laneSourceSets({ game: "pokemon", ...none })).toBeNull();
  });

  it("only restricts Pokemon singles", () => {
    expect(laneSourceSets({ game: "mtg", ...none, buyAt: "cardkingdom" })).toBeNull();
    expect(laneSourceSets({ game: "pokemon_sealed", ...none, excludedExits: ["130point"] })).toBeNull();
  });

  // #2927: "Buy at Suruga-ya" lists cards bought there, never cards sold to
  // Suruga-ya's buylist, even though Suruga-ya is an exit source too.
  it("buys from the chosen shop and leaves every exit open", () => {
    expect(laneSourceSets({ game: "pokemon", ...none, buyAt: "surugaya" }))
      .toEqual({ entry: ["surugaya"], exit: null });
  });

  it("keeps every exit but the unticked ones, cardladder included", () => {
    expect(laneSourceSets({ game: "pokemon", ...none, excludedExits: ["130point"] }))
      .toEqual({ entry: null, exit: ["cardladder", "cardrush", "surugaya", "tcgplayer"] });
  });

  it("sells to one site when every other is unticked", () => {
    expect(laneSourceSets({
      game: "pokemon",
      ...none,
      excludedExits: exitOptions.filter((source) => source !== "cardrush"),
    })).toEqual({ entry: null, exit: ["cardrush"] });
  });

  it("returns nothing when every exit is unticked", () => {
    expect(laneSourceSets({ game: "pokemon", ...none, excludedExits: [...exitOptions] }))
      .toEqual({ entry: null, exit: [] });
  });

  it("combines a shop to buy at with exits from A, B and C but not D", () => {
    expect(laneSourceSets({ game: "pokemon", ...none, buyAt: "surugaya", excludedExits: ["130point"] }))
      .toEqual({ entry: ["surugaya"], exit: ["cardladder", "cardrush", "surugaya", "tcgplayer"] });
  });
});

describe("laneSourceSetsKey", () => {
  it("is equal for equal selections and empty for none", () => {
    expect(laneSourceSetsKey(null)).toBe("");
    expect(laneSourceSetsKey({ entry: ["a"], exit: null })).toBe(laneSourceSetsKey({ entry: ["a"], exit: null }));
    expect(laneSourceSetsKey({ entry: ["a"], exit: null })).not.toBe(laneSourceSetsKey({ entry: null, exit: ["a"] }));
  });
});

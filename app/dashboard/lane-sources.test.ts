import { describe, expect, it } from "vitest";
import {
  laneSourceSets,
  laneSourceSetsKey,
  regionTick,
  soleTickedRegion,
  withRegionExits,
} from "./lane-sources";

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

// "Sell to" by region: NA = 130point, cardladder, tcgplayer; JP = cardrush, surugaya.
const NA = ["130point", "cardladder", "tcgplayer"];
const JP = ["cardrush", "surugaya"];
const byRegion = [
  ["NA", NA.map((source) => ({ source, region: "NA" }))],
  ["JP", JP.map((source) => ({ source, region: "JP" }))],
] as const;

describe("regionTick", () => {
  it("reads all, some or none of a region's sources ticked, with the count", () => {
    expect(regionTick(NA, [])).toEqual({ state: "all", included: 3, total: 3 });
    expect(regionTick(NA, ["130point"])).toEqual({ state: "some", included: 2, total: 3 });
    expect(regionTick(NA, [...NA, "cardrush"])).toEqual({ state: "none", included: 0, total: 3 });
  });
});

describe("withRegionExits", () => {
  it("unticks every source of one region and leaves the other region alone", () => {
    expect(withRegionExits(["130point"], JP, false).sort()).toEqual(["130point", "cardrush", "surugaya"]);
  });

  it("ticks every source of one region back, whatever was unticked inside it", () => {
    expect(withRegionExits(["cardrush", "130point", "tcgplayer"], NA, true)).toEqual(["cardrush"]);
  });

  it("never lists a source twice", () => {
    expect(withRegionExits(["cardrush"], JP, false)).toEqual(["cardrush", "surugaya"]);
  });

  it("feeds the lane function the other region's sources only", () => {
    expect(laneSourceSets({
      game: "pokemon",
      ...none,
      excludedExits: withRegionExits([], JP, false),
    })).toEqual({ entry: null, exit: ["130point", "cardladder", "tcgplayer"] });
  });
});

describe("soleTickedRegion", () => {
  it("names the region when exactly its sources are ticked", () => {
    expect(soleTickedRegion(byRegion, JP)).toBe("NA");
    expect(soleTickedRegion(byRegion, NA)).toBe("JP");
  });

  it("names nothing when every site, no site, or a mix is ticked", () => {
    expect(soleTickedRegion(byRegion, [])).toBeNull();
    expect(soleTickedRegion(byRegion, [...NA, ...JP])).toBeNull();
    expect(soleTickedRegion(byRegion, ["130point"])).toBeNull();
    expect(soleTickedRegion(byRegion, [...JP, "130point"])).toBeNull();
  });
});

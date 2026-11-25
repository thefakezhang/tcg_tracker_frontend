import type { Game } from "./GameContext";

// Source-restricted lanes (backend docs/source_lanes.md, #2890).
//
// A Pokemon summary row carries ONE lane - an entry, an exit and the ROI
// between them - chosen from every source. "Cards I can buy from Suruga-ya"
// and "exits from A, B and C but not D" cannot be answered by filtering those
// rows, because restricting the sources changes which entry and which exit
// win. The backend's compute_price_lanes chooses the lane again from the
// allowed sources, by the same rules the stored summaries use, and
// pokemon_price_lanes_browser returns it shaped as the browser view.
export const LANE_BROWSER_RPC = "pokemon_price_lanes_browser";

// Every source a Pokemon lane can use, per side. Not card_browser_source_options_v:
// that one leaves out cardladder, a real exit, so an "all but X" selection
// built from it would drop cardladder too.
export const LANE_SOURCE_OPTIONS_VIEW = "pokemon_lane_source_options_v";

export interface LaneSourceOption {
  source: string;
  region: string | null;
}

export interface LaneSourceOptions {
  entry: LaneSourceOption[];
  exit: LaneSourceOption[];
}

// What the browser function is called with. NULL means every source.
export interface LaneSourceSets {
  entry: string[] | null;
  exit: string[] | null;
}

// Turns the browser's two Pokemon selectors into the lane function's source
// sets, or null when nothing restricts the lane and the stored summaries
// already answer. Both read from the operator's side (#2927):
//
//   "Buy at X"                -> the card is bought from X: entry set {X}
//   "Sell to", some unticked  -> the card is sold to a ticked site: exit set
//
// A single "Sell to" site is the exit set {X}; every site unticked is the empty
// exit set, which returns nothing, which is what was asked for.
//
// Exclusions are kept rather than inclusions so that a source that starts
// publishing later is included by default, the way it is in the stored view.
export function laneSourceSets(input: {
  game: Game;
  buyAt: string;
  excludedExits: readonly string[];
  exitOptions: readonly string[];
}): LaneSourceSets | null {
  if (input.game !== "pokemon") return null;

  const entry = input.buyAt ? [input.buyAt] : null;
  const exit =
    input.excludedExits.length > 0
      ? input.exitOptions.filter((source) => !input.excludedExits.includes(source))
      : null;

  if (entry === null && exit === null) return null;
  return { entry, exit };
}

// A stable value for effect dependencies: two equal selections compare equal.
export function laneSourceSetsKey(sets: LaneSourceSets | null): string {
  return sets === null ? "" : JSON.stringify([sets.entry, sets.exit]);
}

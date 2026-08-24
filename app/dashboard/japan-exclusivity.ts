export type JapanExclusivityMode = "all" | "artwork" | "stamps" | "either" | "both" | "legacy";

export interface JapanExclusivityFlags {
  japan_exclusive_artwork?: boolean | null;
  japan_exclusive_stamps?: boolean | null;
  is_japan_exclusive?: boolean | null;
}

export type JapanExclusivityColumn =
  | "japan_exclusive_artwork"
  | "japan_exclusive_stamps"
  | "is_japan_exclusive";

export interface JapanExclusivityQueryFilter {
  equalsTrue: JapanExclusivityColumn[];
  anyOfTrue: JapanExclusivityColumn[];
}

export function japanExclusivityQueryFilter(
  mode: JapanExclusivityMode,
): JapanExclusivityQueryFilter {
  switch (mode) {
    case "all": return { equalsTrue: [], anyOfTrue: [] };
    case "artwork": return { equalsTrue: ["japan_exclusive_artwork"], anyOfTrue: [] };
    case "stamps": return { equalsTrue: ["japan_exclusive_stamps"], anyOfTrue: [] };
    case "either": return {
      equalsTrue: [],
      anyOfTrue: ["japan_exclusive_artwork", "japan_exclusive_stamps"],
    };
    case "both": return {
      equalsTrue: ["japan_exclusive_artwork", "japan_exclusive_stamps"],
      anyOfTrue: [],
    };
    case "legacy": return { equalsTrue: ["is_japan_exclusive"], anyOfTrue: [] };
  }
}

export function matchesJapanExclusivity(
  card: JapanExclusivityFlags,
  mode: JapanExclusivityMode,
): boolean {
  const artwork = card.japan_exclusive_artwork === true;
  const stamps = card.japan_exclusive_stamps === true;
  switch (mode) {
    case "all": return true;
    case "artwork": return artwork;
    case "stamps": return stamps;
    case "either": return artwork || stamps;
    case "both": return artwork && stamps;
    case "legacy": return card.is_japan_exclusive === true;
  }
}

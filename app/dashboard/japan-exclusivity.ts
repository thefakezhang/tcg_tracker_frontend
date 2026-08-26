export type JapanExclusivityMode = "all" | "artwork" | "stamps" | "either" | "both";
export type JapanExclusivityDimension = "artwork" | "stamps";

export interface JapanExclusivityFlags {
  japan_exclusive_artwork?: boolean | null;
  japan_exclusive_stamps?: boolean | null;
}

export type JapanExclusivityColumn =
  | "japan_exclusive_artwork"
  | "japan_exclusive_stamps";

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
  }
}

export function japanExclusivitySelectionQueryFilter(
  selected: ReadonlySet<JapanExclusivityDimension>,
): JapanExclusivityQueryFilter {
  if (selected.size === 0) return { equalsTrue: [], anyOfTrue: [] };
  if (selected.size === 1) {
    return {
      equalsTrue: [selected.has("artwork") ? "japan_exclusive_artwork" : "japan_exclusive_stamps"],
      anyOfTrue: [],
    };
  }
  return {
    equalsTrue: [],
    anyOfTrue: ["japan_exclusive_artwork", "japan_exclusive_stamps"],
  };
}

export function matchesJapanExclusivitySelection(
  card: JapanExclusivityFlags,
  selected: ReadonlySet<JapanExclusivityDimension>,
): boolean {
  if (selected.size === 0) return true;
  return (selected.has("artwork") && card.japan_exclusive_artwork === true)
    || (selected.has("stamps") && card.japan_exclusive_stamps === true);
}

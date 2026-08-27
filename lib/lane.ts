// A summary row scores exactly one lane: buy in the entry region, sell in the
// exit region. Both directions are scored by aggregate-prices and the better
// ROI is kept, so the direction is data, not a fixed assumption - JP->NA is
// the import trade, NA->JP the export trade the operator runs on old-back
// cards. This is the label the ROI cell shows under the number.
export function laneLabel(
  entryRegion: string | null | undefined,
  exitRegion: string | null | undefined,
): string | null {
  if (!entryRegion || !exitRegion || entryRegion === exitRegion) return null;
  return `${entryRegion}→${exitRegion}`;
}

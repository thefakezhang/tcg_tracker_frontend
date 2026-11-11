// Pure logic of the Arrivals region filter: which regions the dropdown
// offers, the selection in a canonical form, and which selected regions a
// focus status still knows. The view and ArrivalRegionFilter render it.
import { type ArrivalSource, regionCounts } from "./arrival-accounts";
import type { ArrivalRegion, ArrivalRegionStatus } from "./arrival-regions";

export type RegionFilterOption = {
  region: string;
  /** Posts its accounts made in the window (the summary's recent counts summed); 0 when it has none. */
  recent_count: number;
  /** Posts its accounts made in total. */
  post_count: number;
  /** The region's focus status, or null when the status does not list it (or is unavailable). */
  status: ArrivalRegion | null;
};

/** The selection as the URL and the posts request carry it: each key once, sorted. */
export function canonicalRegions(regions: Iterable<string>): string[] {
  return [...new Set(regions)].sort();
}

/** True when the status has a roster to list; an unpublished one (no regions) does not. */
export function statusListsRegions(status: ArrivalRegionStatus | null): status is ArrivalRegionStatus {
  return status !== null && status.regions.length > 0;
}

/**
 * The dropdown's rows. With a focus status, every region it lists, in its
 * order, whether or not the region has posts (a region just put in focus has
 * none until its first read); without one, the regions the account summary
 * places a shop in, by key. A region the summary uses that the status does
 * not list follows, so its shops stay reachable, and a selected region
 * nothing else lists comes last, so the selection always shows.
 */
export function regionFilterOptions(
  sources: readonly ArrivalSource[],
  status: ArrivalRegionStatus | null,
  selected: readonly string[],
): RegionFilterOption[] {
  const counts = regionCounts(sources);
  const byRegion = new Map(counts.map((count) => [count.region, count]));
  const options: RegionFilterOption[] = [];
  const listed = new Set<string>();
  const add = (region: string, entry: ArrivalRegion | null) => {
    if (listed.has(region)) return;
    listed.add(region);
    const count = byRegion.get(region);
    options.push({
      region,
      recent_count: count?.recent_count ?? 0,
      post_count: count?.post_count ?? 0,
      status: entry,
    });
  };
  if (statusListsRegions(status)) {
    for (const entry of status.regions) add(entry.region, entry);
  }
  for (const count of counts) add(count.region, null);
  for (const region of canonicalRegions(selected)) add(region, null);
  return options;
}

/**
 * The selected regions neither the status nor the summary knows (a mistyped
 * or retired key in a link). Only a listed status is authoritative, so this
 * is empty without one.
 */
export function unknownRegions(
  selected: readonly string[],
  sources: readonly ArrivalSource[],
  status: ArrivalRegionStatus | null,
): string[] {
  if (!statusListsRegions(status)) return [];
  const known = new Set(status.regions.map((entry) => entry.region));
  for (const source of sources) if (source.region != null) known.add(source.region);
  return selected.filter((region) => !known.has(region));
}

/**
 * The selected regions with a read-once request pending, as one key that
 * changes when a request starts or ends ("" when none). The feed polls while
 * it is non-empty, and a new request starts a new polling run.
 */
export function pendingReadKey(status: ArrivalRegionStatus | null, selected: readonly string[]): string {
  if (status === null) return "";
  const chosen = new Set(selected);
  return status.regions
    .filter((entry) => chosen.has(entry.region) && entry.pending_request !== null)
    .map((entry) => `${entry.region}:${entry.pending_request!.request_id}`)
    .sort()
    .join(",");
}

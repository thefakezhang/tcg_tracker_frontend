// Leaf query params: sub-state a single view owns inside /dashboard's query
// string (a trip's ?tab=, the Arrivals ?shop= and ?since=, the Mercari ?feed=,
// ?lane= and ?sort=). The view reads its param on
// mount and writes it in place, with no history entry; UrlStateSync decides
// whether it survives a view-selection change. This module has no imports so
// a view can use it without pulling in the views registry.

/** Read one leaf query param (for components that own a sub-state, e.g. a trip tab). */
export function readUrlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** Write one leaf query param in place (no history entry). */
export function writeUrlParam(name: string, value: string | null) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams(window.location.search);
  if (value == null || value === "") p.delete(name); else p.set(name, value);
  const s = p.toString();
  const next = `${window.location.pathname}${s ? `?${s}` : ""}`;
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
}

/** The Arrivals view's leaf param: the selected shop's buyer_handle. */
export const ARRIVALS_SHOP_PARAM = "shop";

// The same bound the arrivals API route puts on buyer_handle: 1-100 visible
// characters, so a malformed link is ignored here rather than rejected there.
const SHOP_HANDLE = /^[^\u0000-\u001f\u007f]{1,100}$/;

/** The validated `?shop=` value, or null when absent or malformed. */
export function parseShopParam(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return SHOP_HANDLE.test(trimmed) ? trimmed : null;
}

/** The Arrivals view's time window leaf param: how far back the feed and the account counts look. */
export const ARRIVALS_WINDOW_PARAM = "since";

/** The windows the Arrivals tab offers, spelled as they appear in `?since=`. */
export const ARRIVAL_WINDOWS = ["24h", "48h", "7d", "all"] as const;
export type ArrivalWindow = (typeof ARRIVAL_WINDOWS)[number];

/** The window a viewer gets before choosing one; the view keeps it out of the URL. */
export const DEFAULT_ARRIVAL_WINDOW: ArrivalWindow = "48h";

/** The validated `?since=` value, or null when absent or not a window the tab offers. */
export function parseWindowParam(value: string | null | undefined): ArrivalWindow | null {
  const trimmed = value?.trim() ?? "";
  return (ARRIVAL_WINDOWS as readonly string[]).includes(trimmed) ? (trimmed as ArrivalWindow) : null;
}

/** The Mercari view's feed leaf param: `?feed=verified` shows the verified deals; leads, the default, stays out of the URL. */
export const MERCARI_FEED_PARAM = "feed";

export const MERCARI_FEEDS = ["leads", "verified"] as const;
export type MercariFeed = (typeof MERCARI_FEEDS)[number];

/** The feed a viewer gets before choosing one. */
export const DEFAULT_MERCARI_FEED: MercariFeed = "leads";

/** The validated `?feed=` value, or null when absent or not a feed the tab offers. */
export function parseMercariFeedParam(value: string | null | undefined): MercariFeed | null {
  const trimmed = value?.trim() ?? "";
  return (MERCARI_FEEDS as readonly string[]).includes(trimmed) ? (trimmed as MercariFeed) : null;
}

/** The Mercari leads feed's lane leaf param: one lane at a time, so lanes never mix. */
export const MERCARI_LANE_PARAM = "lane";

/** The lead lanes, in the order the tab offers them; the same vocabulary as mercari_leads_v.lane. */
export const MERCARI_LEAD_LANES = ["modern_raw", "vintage_raw", "psa", "unpriced"] as const;
export type MercariLeadLane = (typeof MERCARI_LEAD_LANES)[number];

/** The lane a viewer gets before choosing one; the view keeps it out of the URL. */
export const DEFAULT_MERCARI_LANE: MercariLeadLane = "modern_raw";

/** The validated `?lane=` value, or null when absent or not a lane. */
export function parseMercariLaneParam(value: string | null | undefined): MercariLeadLane | null {
  const trimmed = value?.trim() ?? "";
  return (MERCARI_LEAD_LANES as readonly string[]).includes(trimmed) ? (trimmed as MercariLeadLane) : null;
}

/** The Mercari leads feed's sort leaf param. */
export const MERCARI_SORT_PARAM = "sort";

/** "multiple" is best multiple first; "newest" is the newest first-seen listing first. */
export const MERCARI_LEAD_SORTS = ["multiple", "newest"] as const;
export type MercariLeadSort = (typeof MERCARI_LEAD_SORTS)[number];

/** The sort a viewer gets before choosing one; the view keeps it out of the URL. */
export const DEFAULT_MERCARI_SORT: MercariLeadSort = "multiple";

/** The validated `?sort=` value, or null when absent or not a sort the feed offers. */
export function parseMercariSortParam(value: string | null | undefined): MercariLeadSort | null {
  const trimmed = value?.trim() ?? "";
  return (MERCARI_LEAD_SORTS as readonly string[]).includes(trimmed) ? (trimmed as MercariLeadSort) : null;
}

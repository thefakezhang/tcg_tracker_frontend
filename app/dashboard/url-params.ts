// Leaf query params: sub-state a single view owns inside /dashboard's query
// string (a trip's ?tab=, the Arrivals ?shop=). The view reads its param on
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

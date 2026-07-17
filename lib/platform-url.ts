// Canonical retailer/marketplace URL for a (platform, external id) pair.
//
// Mirrors the backend's PlatformExternalURL (internal/matchreview/candidate.go) so
// the two don't drift. Before this, three frontend copies had each drifted - the
// singles card index only knew tcgplayer + pricecharting, so a snkrdunk/collectr/
// cardrush id rendered as dead text with no link. Returns "" when the platform
// has no stable per-item page (an identity key, a bare SKU, a cert), so callers
// fall back to plain text.
//
// snkrdunk is the one platform whose URL depends on the catalog: singles live at
// /tcg/pokemon/products/, sealed at /apparels/. Pass kind accordingly.
const NUMERIC = /^\d+$/;

export function platformUrl(
  platform: string,
  id: string,
  kind: "single" | "sealed" = "single",
): string {
  if (!platform || !id) return "";
  switch (platform) {
    case "tcgplayer":
      return `https://www.tcgplayer.com/product/${id}`;
    case "pricecharting":
      return `https://www.pricecharting.com/game/${id}`;
    case "snkrdunk":
      return kind === "sealed"
        ? `https://snkrdunk.com/apparels/${id}`
        : `https://snkrdunk.com/tcg/pokemon/products/${id}`;
    case "collectr":
      return `https://app.collectr.com/product/${id}`;
    case "cardrush":
      return `https://www.cardrush-pokemon.jp/product/${id}`;
    case "hareruya":
      return `https://www.hareruyamtg.com/en/products/detail/${id}`;
    case "fukufuku":
      return `https://pokemon.fukufukutoreka.com/products/detail/${id}`;
    case "cardkingdom":
      // Sell ids are numeric EC-CUBE product ids; buylist keys (psa10:…) have no page.
      return NUMERIC.test(id) ? `https://card-kingdom.jp/pokemon/products/detail/${id}` : "";
    case "big_tcg": {
      // Sell ids are "sell:NNN" ocnk product ids; identity keys have no page.
      const n = id.startsWith("sell:") ? id.slice(5) : "";
      return NUMERIC.test(n) ? `https://www.big-toreka.jp/product/${n}` : "";
    }
    // No stable per-item page: tcgplayer_SKU (a SKU, not a product), cardladder
    // (a PSA cert / profile id), surugaya, expedition_gaming (identity keys).
    default:
      return "";
  }
}

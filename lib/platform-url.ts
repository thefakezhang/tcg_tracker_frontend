// Canonical retailer/marketplace URL for a (platform, external id) pair.
//
// Mirrors the backend's PlatformExternalURL (internal/matchreview/candidate.go) so
// the two don't drift. Before this, three frontend copies had each drifted - the
// singles card index only knew tcgplayer + pricecharting, so a snkrdunk/collectr/
// cardrush id rendered as dead text with no link. Returns "" when the platform
// has no stable per-item page (an identity key, a bare SKU, a cert), so callers
// fall back to plain text.
//
// snkrdunk products live at /apparels/<id>, singles and sealed alike. The
// older /en/trading-cards/ route still resolves and is still accepted when a
// curator pastes one, but it serves the ENGLISH title - so a curator checking
// a Japanese card against it reads a translated name, not the one we store.
const NUMERIC = /^\d+$/;

/** Platforms an operator can attach to a Pokemon single in the Card Index. */
export const pokemonSinglePlatforms = [
  "tcgplayer",
  "snkrdunk",
  "pricecharting",
  "collectr",
  "cardladder",
  "cardkingdom",
  "shinsoku",
  "surugaya",
  "expedition_gaming",
  "tcgplayer_SKU",
] as const;

/** Source chips that can gate the singles catalog by a durable identifier. */
export const pokemonSingleFilterPlatforms = pokemonSinglePlatforms.filter(
  (platform) => platform !== "tcgplayer_SKU",
);

export interface NormalizedPlatformID {
  platform: string;
  value: string;
  extracted: boolean;
  invalidURL: boolean;
}

function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function pathMatch(url: URL, pattern: RegExp): string | null {
  return url.pathname.match(pattern)?.[1] ?? null;
}

/**
 * Resolve a copied product URL to the platform and identifier stored by the
 * Card Index. The host and path must both match a known platform so a URL from
 * the wrong site can never be reduced to a plausible-looking numeric id.
 */
export function platformIDFromURL(raw: string): { platform: string; id: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = normalizedHost(url);
  if (host === "tcgplayer.com") {
    const id = pathMatch(url, /^\/product\/(\d+)(?:\/|$)/);
    return id ? { platform: "tcgplayer", id } : null;
  }
  if (host === "snkrdunk.com") {
    const id = pathMatch(url, /^\/(?:tcg\/pokemon\/products|(?:en\/)?trading-cards|apparels)\/([A-Za-z0-9_-]+)(?:\/|$)/);
    return id ? { platform: "snkrdunk", id } : null;
  }
  if (host === "pricecharting.com") {
    const id = pathMatch(url, /^\/game\/(.+?)\/?$/);
    return id ? { platform: "pricecharting", id } : null;
  }
  if (host === "app.collectr.com") {
    const id = pathMatch(url, /^\/product\/(\d+)(?:\/|$)/);
    return id ? { platform: "collectr", id } : null;
  }
  if (host === "app.getcollectr.com" || host === "getcollectr.com") {
    const id = pathMatch(url, /^\/explore\/product\/(\d+)(?:\/|$)/);
    return id ? { platform: "collectr", id } : null;
  }
  if (host === "app.cardladder.com") {
    let decoded = raw;
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // The URL parser accepted it, so a malformed percent escape should only
      // prevent extraction rather than making the field unusable.
    }
    const id = decoded.match(/(?:^|[|?&])profileId(?::|=)([A-Za-z0-9_-]+)/i)?.[1] ?? null;
    return id ? { platform: "cardladder", id } : null;
  }
  if (host === "suruga-ya.jp") {
    const id = pathMatch(url, /^\/product\/detail\/([A-Za-z0-9_-]+)(?:\/|$)/);
    return id ? { platform: "surugaya", id } : null;
  }
  if (host === "card-kingdom.jp") {
    const id = pathMatch(url, /^\/pokemon\/products\/detail\/(\d+)(?:\/|$)/);
    return id ? { platform: "cardkingdom", id } : null;
  }
  return null;
}

/**
 * Normalize an id-field edit and infer the platform when a recognized URL was
 * pasted. Bare ids keep the selected platform. Unknown URLs remain visible and
 * are marked invalid so the UI can block attaching the URL itself as an id.
 */
export function normalizePlatformID(selectedPlatform: string, raw: string): NormalizedPlatformID {
  const input = raw.trim();
  if (!input) return { platform: selectedPlatform, value: "", extracted: false, invalidURL: false };
  if (!/^https?:\/\//i.test(input)) {
    return { platform: selectedPlatform, value: input, extracted: false, invalidURL: false };
  }

  const parsed = platformIDFromURL(input);
  if (!parsed) return { platform: selectedPlatform, value: input, extracted: false, invalidURL: true };
  return { platform: parsed.platform, value: parsed.id, extracted: true, invalidURL: false };
}

/** Build a direct platform search from the card's human-readable identity. */
export function platformSearchURL(platform: string, name: string, setCode: string): string {
  const query = [name.trim(), setCode.trim() !== "UNKNOWN" ? setCode.trim() : ""]
    .filter(Boolean)
    .join(" ");
  if (!query) return "";
  const q = encodeURIComponent(query);
  switch (platform) {
    case "tcgplayer":
    case "tcgplayer_SKU":
      return `https://www.tcgplayer.com/search/all/product?q=${q}`;
    case "snkrdunk":
      return `https://snkrdunk.com/search?keyword=${q}`;
    case "pricecharting":
      return `https://www.pricecharting.com/search-products?q=${q}&type=prices`;
    case "surugaya":
      return `https://www.suruga-ya.jp/search?category=&search_word=${q}`;
    default:
      return "";
  }
}

export function platformUrl(
  platform: string,
  id: string,
  kind: "single" | "sealed" = "single",
  listingUrl?: string | null,
): string {
  if (!platform || !id) return "";
  switch (platform) {
    case "tcgplayer":
      return `https://www.tcgplayer.com/product/${id}`;
    case "pricecharting":
      return `https://www.pricecharting.com/game/${id}`;
    case "snkrdunk":
      // /apparels/ is the canonical product route for both singles and sealed.
      // The /en/trading-cards/ route still resolves, but it serves the English
      // title, so a curator checking a Japanese card against it reads a
      // translated name rather than the one the catalog stores.
      return `https://snkrdunk.com/apparels/${id}`;
    case "collectr":
      // Collectr's product pages live at getcollectr.com/explore/product; the
      // id may be Collectr-native (10xxxxxx) or the card's tcgplayer id - both
      // are real pages there.
      return `https://app.getcollectr.com/explore/product/${id}`;
    case "artofpkm":
      // id is "<aop_set_id>/<ordinal>" - the card page URL's own shape.
      return `https://www.artofpkm.com/sets/${id.replace("/", "/card/")}`;
    case "cardrush":
      return `https://www.cardrush-pokemon.jp/product/${id}`;
    case "hareruya":
      return `https://www.hareruyamtg.com/en/products/detail/${id}`;
    case "fukufuku":
      return `https://pokemon.fukufukutoreka.com/products/detail/${id}`;
    case "cardkingdom":
      // Sell ids are numeric EC-CUBE product ids; buylist keys (psa10:…) have no page.
      return NUMERIC.test(id) ? `https://card-kingdom.jp/pokemon/products/detail/${id}` : "";
    case "shinsoku": {
      // The IAP external id is an identity handle, not the Ochanoko product id.
      // A direct page is available only when the sell populator persisted the
      // scraper's validated per-listing URL.
      if (!listingUrl) return "";
      try {
        const url = new URL(listingUrl);
        return url.protocol === "https:"
          && normalizedHost(url) === "cardshop-shinsoku.jp"
          && /^\/product\/\d+$/.test(url.pathname)
          ? `https://www.cardshop-shinsoku.jp${url.pathname}`
          : "";
      } catch {
        return "";
      }
    }
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

const SOURCE_LABELS: Record<string, string> = {
  "130point": "130point (eBay sold)",
  avereel: "Avereel",
  big_tcg: "BIG TCG",
  cardkingdom: "Card Kingdom",
  cardladder: "Card Ladder",
  cardrush: "Cardrush",
  cardrush_sealed: "Cardrush",
  collectr: "Collectr",
  expedition_gaming: "Expedition Gaming",
  fukufuku: "Fukufuku",
  hareruya: "Hareruya",
  hareruya2: "Hareruya 2",
  laurier: "Laurier",
  pricecharting: "PriceCharting",
  shinsoku: "Shinsoku",
  snkrdunk: "Snkrdunk",
  snkrdunk_sealed: "Snkrdunk",
  surugaya: "Surugaya",
  tcgplayer: "TCGplayer",
  toban: "Kaitori Touban",
  torecabank: "Toreca Bank",
  torecabirth: "Toreca Birth",
  artofpkm: "The Art of Pokémon",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

// Short chip labels for platform links, shared by the card indexes and the
// review queue so a platform reads the same everywhere.
const PLATFORM_SHORT: Record<string, string> = {
  tcgplayer: "TCG",
  tcgplayer_SKU: "SKU",
  snkrdunk: "SNKR",
  pricecharting: "PC",
  collectr: "COLL",
  cardladder: "CL",
  cardkingdom: "CK",
  shinsoku: "SHIN",
  surugaya: "SRG",
  expedition_gaming: "EXP",
  torecabirth: "TB",
  torecabank: "TBK",
  big_tcg: "BIG",
  toban: "TOBAN",
  cardrush: "CR",
  fukufuku: "FUKU",
  hareruya: "HAR",
  hareruya2: "HAR2",
  artofpkm: "AOP",
  cardmarket: "CM",
};

export function platformShort(platform: string): string {
  return PLATFORM_SHORT[platform] ?? platform;
}

// Synthetic link ids: our own composite handles for shops that have no
// per-item page - torecabirth's buyback row uid ("pokemon__<uuid>__N"), the
// torecabank / big_tcg / expedition identity keys ("name|number|misc",
// "SET|number"). They are real links (the price refresh and the matcher key on
// them), but they are not something a person reads, so a chip shows the
// platform and keeps the raw key on the tooltip instead of printing 50
// characters of it.
const TORECABIRTH_ROW = /^[a-z_]+__[0-9a-f-]{16,}__\d+$/i;

export function isOpaqueLinkID(platform: string, id: string): boolean {
  if (platform === "torecabirth") return TORECABIRTH_ROW.test(id) || id.length > 24;
  return id.includes("|");
}

// The text a link chip shows: "TCG 604028" for a platform-native id, just the
// platform for an opaque key.
export function linkChipLabel(platform: string, id: string): string {
  return isOpaqueLinkID(platform, id) ? platformShort(platform) : `${platformShort(platform)} ${id}`;
}

const SOURCE_LABELS: Record<string, string> = {
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
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

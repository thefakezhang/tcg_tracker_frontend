// Parsing + column detection for a TCGplayer app "collection" CSV export, used
// to stage a sell lot. The exact header spelling varies between TCGplayer export
// versions, so columns are detected by fuzzy header match and can be remapped by
// the operator in the dialog - nothing here hardcodes a fixed column order.

// Minimal RFC-4180-ish CSV parser (quoted fields, embedded commas, doubled
// quotes, CRLF). Same shape as the Collectr importer's parser.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export type TcgField = "quantity" | "name" | "set" | "number" | "condition" | "printing" | "price";
export type ColumnMap = Record<TcgField, number>; // -1 = unmapped

const FIELD_ORDER: TcgField[] = ["quantity", "name", "set", "number", "condition", "printing", "price"];

// Ordered candidate header substrings per field. First matching, still-unclaimed
// column wins; more specific patterns are listed before generic ones so, e.g.,
// "Card Number" is preferred for `number` and never mis-claims "Set Number".
const HEADER_HINTS: Record<TcgField, string[]> = {
  quantity: ["quantity", "qty", "count"],
  name: ["product name", "card name", "simple name", "name"],
  set: ["set name", "set code", "set", "edition", "expansion"],
  number: ["card number", "collector number", "number", "card #", "#"],
  condition: ["condition"],
  printing: ["printing", "foil", "finish", "holo"],
  price: ["market price", "tcg market", "price each", "price", "value"],
};

// detectColumns maps each field to a column index by fuzzy header match. A column
// is claimed by at most one field. Returns -1 for any field it cannot place.
export function detectColumns(header: string[]): ColumnMap {
  const norm = header.map((h) => h.trim().toLowerCase());
  const claimed = new Set<number>();
  const map = {} as ColumnMap;
  for (const field of FIELD_ORDER) {
    map[field] = -1;
    for (const hint of HEADER_HINTS[field]) {
      const idx = norm.findIndex((h, i) => !claimed.has(i) && h.includes(hint));
      if (idx >= 0) { map[field] = idx; claimed.add(idx); break; }
    }
  }
  return map;
}

export interface TcgCollectionRow {
  rowIndex: number; // 1-based data row (excludes header), for display
  name: string;
  set: string;
  number: string;
  condition: string;
  printing: string;
  quantity: number;
  priceUsd: number | null;
}

function toMoney(raw: string): number | null {
  const cleaned = raw.replace(/[$,]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function toQty(raw: string): number {
  const n = Math.floor(Number(raw.trim()));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// parseCollectionRows turns the raw matrix (including header) into normalized
// rows using the (possibly operator-corrected) column map. Blank lines and rows
// with no name are dropped.
export function parseCollectionRows(matrix: string[][], map: ColumnMap): TcgCollectionRow[] {
  if (matrix.length < 2) return [];
  const at = (cells: string[], i: number) => (i >= 0 && i < cells.length ? cells[i].trim() : "");
  const out: TcgCollectionRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    if (!cells || cells.every((c) => c.trim() === "")) continue;
    const name = at(cells, map.name);
    if (name === "") continue;
    out.push({
      rowIndex: r,
      name,
      set: at(cells, map.set),
      number: at(cells, map.number),
      condition: at(cells, map.condition),
      printing: at(cells, map.printing),
      quantity: map.quantity >= 0 ? toQty(at(cells, map.quantity)) : 1,
      priceUsd: map.price >= 0 ? toMoney(at(cells, map.price)) : null,
    });
  }
  return out;
}

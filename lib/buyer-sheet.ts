// The buy list as a spreadsheet, and back again.
//
// Thirty-odd lines across several shops is work he would rather do in a
// spreadsheet than a browser grid, and a file is also what he falls back to if
// the app is down when he needs to order. A file he can take away and bring
// back is the honest answer to both.
//
// Two rules shape everything here.
//
// Rows are matched on PLAN LINE ID, never on the card. The same card appears
// on a list more than once at different prices - two カリンのブースター at
// 8,000 and 15,000 - and name-matching would merge them and lose a purchase.
//
// A sheet only carries back what CHANGED. Re-uploading the same file must be a
// no-op, because he will do exactly that when he is not sure it saved.

export type SheetLine = {
  plan_line_id: number;
  source: string;
  card_name: string | null;
  card_english_name: string | null;
  set_code: string | null;
  card_number: string | null;
  source_listing_url: string | null;
  planned_quantity: number;
  unit_price_orig: number | null;
  outcome: string;
  purchased_quantity: number;
  unit_price_jpy: number | null;
  note: string | null;
  game?: string | null;
  sealed_condition?: string | null;
  variant_edition?: string | null;
};

export type SheetUpdate = {
  plan_line_id: number;
  outcome: string;
  purchased_quantity: number;
  unit_price_jpy: number | null;
  note: string | null;
};

export type SheetProblem = { row: number; reason: string };

/** The identity column carries the plan too, so yesterday's sheet cannot be
 *  uploaded onto today's list without anyone noticing. */
export const planTag = (planId: number) => `plan:${planId}`;

export const SHEET_COLUMNS = [
  "id", "shop", "card", "set", "number", "want", "asking",
  "outcome", "qty", "unit_paid", "note", "listing", "condition", "edition",
] as const;

export function toSheetRows(
  planId: number,
  lines: SheetLine[],
  label: (outcome: string) => string,
) {
  return lines.map((l) => ({
    id: `${planTag(planId)}#${l.plan_line_id}`,
    shop: l.source,
    card: l.card_name ?? "",
    set: l.set_code ?? "",
    number: l.card_number ?? "",
    want: l.planned_quantity,
    asking: l.unit_price_orig ?? null,
    outcome: label(l.outcome),
    qty: l.outcome === "purchased" ? l.purchased_quantity : null,
    unit_paid: l.outcome === "purchased" ? l.unit_price_jpy : null,
    note: l.note ?? "",
    listing: l.source_listing_url ?? "",
    condition: l.sealed_condition ?? "",
    edition: l.variant_edition ?? "",
  }));
}

/** He types a number the way it is written on a receipt. Number() gives NaN for
 *  every one of those, and a NaN reaching the database is a lost value. */
export function sheetNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const cleaned = String(v).replace(/[,\s¥￥]/g, "").replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseId(cell: unknown, planId: number): number | "wrong-plan" | null {
  const m = String(cell ?? "").trim().match(/^plan:(\d+)#(\d+)$/);
  if (!m) return null;
  if (Number(m[1]) !== planId) return "wrong-plan";
  return Number(m[2]);
}

/**
 * Turn the rows of an uploaded sheet into the writes that actually differ.
 *
 * `resolveOutcome` takes whatever he typed and returns an outcome value, or
 * null if it is not one of them - he may have typed the Japanese label, the
 * English one, or the raw value, and any of those should work.
 */
export function readSheetRows(
  planId: number,
  rows: Record<string, unknown>[],
  current: SheetLine[],
  resolveOutcome: (text: string) => string | null,
): { updates: SheetUpdate[]; problems: SheetProblem[] } {
  const byId = new Map(current.map((l) => [l.plan_line_id, l]));
  const updates: SheetUpdate[] = [];
  const problems: SheetProblem[] = [];
  const seen = new Set<number>();

  rows.forEach((row, i) => {
    const rowNo = i + 2; // header is row 1, as he sees it in the spreadsheet
    const id = parseId(row.id, planId);
    if (id === null) {
      problems.push({ row: rowNo, reason: "no line id - this row was not from a downloaded sheet" });
      return;
    }
    if (id === "wrong-plan") {
      problems.push({ row: rowNo, reason: "belongs to a different purchase list" });
      return;
    }
    const line = byId.get(id);
    if (!line) {
      problems.push({ row: rowNo, reason: `line ${id} is not on this list any more` });
      return;
    }
    if (seen.has(id)) {
      problems.push({ row: rowNo, reason: `line ${id} appears twice in the file` });
      return;
    }
    seen.add(id);

    const outcome = resolveOutcome(String(row.outcome ?? "").trim());
    if (outcome === null) {
      problems.push({ row: rowNo, reason: `"${String(row.outcome ?? "")}" is not one of the outcomes` });
      return;
    }

    const qty = outcome === "purchased" ? sheetNumber(row.qty) : null;
    const paid = outcome === "purchased" ? sheetNumber(row.unit_paid) : null;
    if (outcome === "purchased" && (qty === null || paid === null)) {
      problems.push({ row: rowNo, reason: "a purchase needs both a quantity and a unit price" });
      return;
    }

    const noteRaw = row.note == null ? "" : String(row.note).trim();
    const note = noteRaw === "" ? null : noteRaw;

    const next: SheetUpdate = {
      plan_line_id: id,
      outcome,
      purchased_quantity: qty ?? 0,
      unit_price_jpy: paid,
      note,
    };

    // Only what changed. Re-uploading the same file must do nothing.
    const same =
      line.outcome === next.outcome &&
      (line.outcome === "purchased"
        ? Number(line.purchased_quantity) === next.purchased_quantity &&
          Number(line.unit_price_jpy ?? 0) === Number(next.unit_price_jpy ?? 0)
        : true) &&
      (line.note ?? null) === next.note;
    if (!same) updates.push(next);
  });

  return { updates, problems };
}

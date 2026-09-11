import type { BuyerResultField, BuyerResultRow } from "./buyer-result-autosave";

export const BUYER_GRID_COLUMNS = [
  "outcome",
  "qty",
  "price",
  "condition",
  "note",
] as const;

export type BuyerGridColumn = (typeof BUYER_GRID_COLUMNS)[number];

export const BUYER_CONDITIONS = ["NM", "LP", "MP", "HP", "DAMAGED"] as const;

type BuyerGridPatch = Partial<Pick<
  BuyerResultRow,
  "outcome" | "purchased_quantity" | "unit_price_jpy" | "condition_seen" | "note"
>>;

export type BuyerPasteEdit<Row extends BuyerResultRow> = {
  prior: Row;
  next: Row;
  fields: BuyerResultField[];
};

export type BuyerPastePlan<Row extends BuyerResultRow> =
  | { ok: true; edits: BuyerPasteEdit<Row>[] }
  | { ok: false; reason: "frozen" | "outside-grid" | "not-rectangle" | "invalid-outcome" | "invalid-number" | "invalid-condition" | "incomplete-purchase" };

export const isPurchaseOutcome = (outcome: string) =>
  outcome === "purchased" || outcome === "price_changed_bought";

export function prepareBuyerResult<Row extends BuyerResultRow>(
  prior: Row,
  patch: BuyerGridPatch,
  defaults?: { plannedQuantity?: number; askingPriceJpy?: number | null },
): Row {
  let next = { ...prior, ...patch } as Row;
  if ("outcome" in patch && isPurchaseOutcome(next.outcome) && !isPurchaseOutcome(prior.outcome)) {
    if (next.purchased_quantity <= 0) {
      next = { ...next, purchased_quantity: Math.max(0, defaults?.plannedQuantity ?? 1) };
    }
    if (next.unit_price_jpy == null && defaults?.askingPriceJpy != null) {
      next = { ...next, unit_price_jpy: defaults.askingPriceJpy };
    }
  }
  if ("outcome" in patch && !isPurchaseOutcome(next.outcome)) {
    next = { ...next, purchased_quantity: 0, unit_price_jpy: null };
  }
  return next;
}

function clipboardRows(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const rows = normalized.split("\n").map((row) => row.split("\t"));
  if (rows.length > 1 && rows.at(-1)?.every((cell) => cell === "")) rows.pop();
  return rows;
}

function parseNonNegativeInteger(value: string): number | null {
  const normalized = value.replace(/[\s,，]/g, "");
  if (normalized === "") return 0;
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNonNegativePrice(value: string): number | null | "invalid" {
  const normalized = value.replace(/[\s,，¥￥]/g, "");
  if (normalized === "") return null;
  if (!/^\d+$/.test(normalized)) return "invalid";
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : "invalid";
}

function patchForCell(
  column: BuyerGridColumn,
  raw: string,
  outcomeAliases: ReadonlyMap<string, string>,
): { patch: BuyerGridPatch; field: BuyerResultField } | null {
  const value = raw.trim();
  if (column === "outcome") {
    const outcome = outcomeAliases.get(value.toLocaleLowerCase());
    return outcome ? { patch: { outcome }, field: "outcome" } : null;
  }
  if (column === "qty") {
    const quantity = parseNonNegativeInteger(value);
    return quantity == null
      ? null
      : { patch: { purchased_quantity: quantity }, field: "purchased_quantity" };
  }
  if (column === "price") {
    const price = parseNonNegativePrice(value);
    return price === "invalid"
      ? null
      : { patch: { unit_price_jpy: price }, field: "unit_price_jpy" };
  }
  if (column === "condition") {
    const condition = value.toUpperCase();
    if (condition !== "" && !BUYER_CONDITIONS.includes(condition as (typeof BUYER_CONDITIONS)[number])) {
      return null;
    }
    return { patch: { condition_seen: condition || null }, field: "condition_seen" };
  }
  return { patch: { note: value || null }, field: "note" };
}

/**
 * Validate a complete clipboard rectangle before returning any queued edits.
 * Callers must schedule writes only from an `ok` result, so a bad final cell
 * cannot leave the first rows partially saved.
 */
export function planBuyerGridPaste<Row extends BuyerResultRow>({
  rows,
  startLineId,
  startColumn,
  text,
  frozen,
  outcomeAliases,
  defaultsForRow,
}: {
  rows: Row[];
  startLineId: number;
  startColumn: BuyerGridColumn;
  text: string;
  frozen: boolean;
  outcomeAliases: ReadonlyMap<string, string>;
  defaultsForRow?: (row: Row) => { plannedQuantity?: number; askingPriceJpy?: number | null };
}): BuyerPastePlan<Row> {
  if (frozen) return { ok: false, reason: "frozen" };
  const matrix = clipboardRows(text);
  const width = matrix[0]?.length ?? 0;
  if (matrix.some((row) => row.length !== width)) {
    return { ok: false, reason: "not-rectangle" };
  }
  const startRow = rows.findIndex((row) => row.plan_line_id === startLineId);
  const startCol = BUYER_GRID_COLUMNS.indexOf(startColumn);
  if (
    startRow < 0
    || startCol < 0
    || matrix.length === 0
    || matrix.some((row) => row.length === 0)
    || startRow + matrix.length > rows.length
    || matrix.some((row) => startCol + row.length > BUYER_GRID_COLUMNS.length)
  ) {
    return { ok: false, reason: "outside-grid" };
  }

  const edits: BuyerPasteEdit<Row>[] = [];
  for (let rowOffset = 0; rowOffset < matrix.length; rowOffset += 1) {
    const prior = rows[startRow + rowOffset];
    let next = prior;
    const fields: BuyerResultField[] = [];
    for (let colOffset = 0; colOffset < matrix[rowOffset].length; colOffset += 1) {
      const column = BUYER_GRID_COLUMNS[startCol + colOffset];
      const parsed = patchForCell(column, matrix[rowOffset][colOffset], outcomeAliases);
      if (!parsed) {
        const reason = column === "outcome"
          ? "invalid-outcome"
          : column === "condition"
            ? "invalid-condition"
            : "invalid-number";
        return { ok: false, reason };
      }
      next = prepareBuyerResult(next, parsed.patch, defaultsForRow?.(next));
      fields.push(parsed.field);
    }
    if (
      isPurchaseOutcome(next.outcome)
      && (next.purchased_quantity <= 0 || next.unit_price_jpy == null)
    ) {
      return { ok: false, reason: "incomplete-purchase" };
    }
    if (
      !isPurchaseOutcome(next.outcome)
      && (next.purchased_quantity !== 0 || next.unit_price_jpy != null)
    ) {
      return { ok: false, reason: "incomplete-purchase" };
    }
    edits.push({ prior, next, fields });
  }
  return { ok: true, edits };
}

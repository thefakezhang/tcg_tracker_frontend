// Draft persistence for the multi-card "sell a lot" flow (SalesTab). Entering a
// large lot means dozens of selected holdings, per-line quantities, and expense
// splits; an accidental refresh used to wipe all of it. We snapshot that state
// to localStorage (survives a reload and even a crash), scoped per trip, and
// clear it once the sale is recorded. Only the Flow-A lot-sale fields are kept -
// nothing here is authoritative; it is a convenience buffer.
import type { SaleAllocationMethod, SaleExpenseCategory } from "./sale-lot-model";

export interface SellLotDraft {
  selected: string[]; // holdingKey[]
  lotQty: Record<string, string>;
  lotGross: string;
  lotFees: string;
  lotCurrency: string;
  lotFx: string;
  lotDate: string;
  lotAllocationMethod: SaleAllocationMethod;
  lotExpenseCategory: SaleExpenseCategory;
  lotItemExpenses: Record<string, string>;
  lotItemExpenseCategories: Record<string, SaleExpenseCategory>;
  lotExplicitGross: Record<string, string>;
  lotCustomerId: number | null;
  lotOpen: boolean;
  savedAt: number;
}

const key = (tripId: number) => `tcg:selllot-draft:v1:${tripId}`;

// A draft is worth keeping only if the operator has actually started one: at
// least one holding selected, or a gross entered. Empty state clears the draft
// so a finished/abandoned lot does not resurrect itself.
export function draftHasContent(draft: Pick<SellLotDraft, "selected" | "lotGross">): boolean {
  return draft.selected.length > 0 || draft.lotGross.trim() !== "";
}

export function loadSellLotDraft(tripId: number): SellLotDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(tripId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SellLotDraft;
    if (!parsed || !Array.isArray(parsed.selected)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSellLotDraft(tripId: number, draft: SellLotDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(tripId), JSON.stringify(draft));
  } catch {
    // Quota or privacy-mode failures must never break the sale flow.
  }
}

export function clearSellLotDraft(tripId: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(tripId));
  } catch {
    // ignore
  }
}

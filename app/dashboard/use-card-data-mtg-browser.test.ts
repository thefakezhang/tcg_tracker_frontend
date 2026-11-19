import { describe, expect, it, vi } from "vitest";
import {
  MTG_BROWSER_VIEW,
  MTG_CARD_DEF_COLS,
  applyMtgTagQuery,
  mtgBrowserRowToSummaryRow,
} from "./use-card-data";

// The MTG browse page reads the flat mtg_price_summaries_browser_v (backend
// 000660) instead of embedding mtg_card_definitions_v, because the embed made
// Postgres join and JSON-encode every summary row to return one page and timed
// out at 8 s. These pin that the flat rows come back in exactly the shape the
// embed produced, so nothing downstream of the hook can tell the difference.

const flatRow: Record<string, unknown> = {
  card_id: 442863,
  tier: 1,
  psa_grade: 0,
  best_buy_normalized: 56.47,
  best_sell_normalized: 36.27,
  net_roi: 0.42,
  roi: 0.55,
  card_uid: "8f1c0000-0000-0000-0000-000000000000",
  regional_name: "WAN SHI TONG, LIBRARIAN",
  set_code: "TLA",
  card_number: "78",
  misc_info: "UNKNOWN",
  image_url: null,
  is_foil: true,
  foil_type: "STANDARD",
  language: "en",
  is_cedh_staple: false,
  is_cedh_exclusive: false,
  is_top_commander: false,
  edhrec_tags_reason: null,
  edhrec_tags_evidence_url: null,
  edhrec_tags_as_of: null,
  is_commander_stockable: true,
  commander_demand_reason: "50,339 decks",
  commander_demand_evidence_url: null,
  commander_demand_as_of: null,
};

describe("mtgBrowserRowToSummaryRow", () => {
  it("puts every card field back under the embed key and leaves the summary fields on top", () => {
    const row = mtgBrowserRowToSummaryRow(flatRow, "mtg_card_definitions_v");
    const card = row.mtg_card_definitions_v as Record<string, unknown>;
    const cardCols = MTG_CARD_DEF_COLS.split(",").map((c) => c.trim());
    expect(Object.keys(card).sort()).toEqual([...cardCols].sort());
    for (const col of cardCols) expect(card[col]).toEqual(flatRow[col]);
    expect(row.card_id).toBe(442863);
    expect(row.net_roi).toBe(0.42);
    expect(row.best_buy_normalized).toBe(56.47);
    for (const col of cardCols.filter((c) => c !== "card_id")) {
      expect(row).not.toHaveProperty(col);
    }
  });

  it("names the view the backend migration creates", () => {
    expect(MTG_BROWSER_VIEW).toBe("mtg_price_summaries_browser_v");
  });
});

describe("applyMtgTagQuery", () => {
  function recorder() {
    const calls: { method: string; args: unknown[] }[] = [];
    const q: Record<string, unknown> = {};
    for (const method of ["eq", "or"]) {
      q[method] = vi.fn((...args: unknown[]) => {
        calls.push({ method, args });
        return q;
      });
    }
    return { q, calls };
  }

  it("filters the top-level columns when reading the flat view", () => {
    const { q, calls } = recorder();
    applyMtgTagQuery(q, null, new Set(["cedhStaple", "commanderStockable"]));
    const or = calls.find((c) => c.method === "or");
    expect(or).toBeDefined();
    expect(or!.args[0]).toBe("is_cedh_staple.eq.true,is_commander_stockable.eq.true");
    expect(or!.args[1]).toBeUndefined();
  });

  it("still targets the embedded table when one is named", () => {
    const { q, calls } = recorder();
    applyMtgTagQuery(q, "mtg_card_definitions_v", new Set(["cedhStaple", "commanderStockable"]));
    const or = calls.find((c) => c.method === "or");
    expect(or!.args[1]).toEqual({ referencedTable: "mtg_card_definitions_v" });
  });
});

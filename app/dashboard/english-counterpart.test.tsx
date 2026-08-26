// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { createClient } from "@/lib/supabase/client";
import {
  EnglishCounterpartPanel,
  fetchEnglishCounterparts,
  reviewEnglishCounterpart,
  type EnglishCounterpartCardRow,
} from "./english-counterpart";

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      let value = key;
      for (const [name, replacement] of Object.entries(params ?? {})) {
        value = value.replace(`{${name}}`, String(replacement));
      }
      return value;
    },
  }),
}));

afterEach(cleanup);

function mappedRow(overrides: Partial<EnglishCounterpartCardRow> = {}): EnglishCounterpartCardRow {
  return {
    card_id: 42,
    card_uid: "11111111-1111-4111-8111-111111111111",
    counterpart_status: "exact",
    english_card_uid: "22222222-2222-4222-8222-222222222222",
    english_card_id: 84,
    english_regional_name: "Pikachu",
    english_name: "Pikachu",
    english_set_code: "SVP",
    english_card_number: "101",
    english_misc_info: "Cosmos Holo",
    english_edition: "unlimited",
    english_foil_treatment: "holo",
    confidence: 1,
    identity_basis: "operator_reference",
    evidence: { source: "release manifest" },
    provenance: "review",
    review_posture: "operator_confirmed",
    decision_note: "Same illustrated release.",
    evidence_url: "https://example.test/manifest",
    mapping_version: 1,
    reviewed_at: "2026-08-26T00:00:00Z",
    reviewed_by: "operator@example.test",
    review_candidate_count: 0,
    failed_candidate_count: 0,
    gate_status: "profit_eligible",
    completeness: "complete",
    best_net_profit_usd: 32,
    best_roi_ratio: 0.4,
    profit_denominator_usd: 80,
    comparison_rows: 2,
    complete_rows: 2,
    coverage_ratio: 1,
    best_raw: {
      comparison_kind: "raw",
      raw_tier: 1,
      psa_grade: 0,
      english_card_uid: "22222222-2222-4222-8222-222222222222",
      jp_price_usd: 80,
      jp_source: "snkrdunk",
      jp_listing_count: 4,
      jp_price_as_of: "2026-08-26T00:00:00Z",
      us_ask_price_usd: 150,
      us_ask_source: "tcgplayer",
      us_ask_listing_count: 5,
      us_ask_price_as_of: "2026-08-26T00:00:00Z",
      realized_price_usd: 130,
      realized_sources: ["130point/ebay", "cardladder/ebay"],
      realized_sample_count: 4,
      realized_window_start: "2026-05-28T00:00:00Z",
      realized_latest_sold_at: "2026-08-25T00:00:00Z",
      realized_completeness: "complete",
      decision_price_usd: 130,
      profit_price_basis: "realized_comp_cap",
      liquidity_penalty_ratio: 0.12,
      net_exit_usd: 112,
      net_profit_usd: 32,
      roi_ratio: 0.4,
      profit_denominator_usd: 80,
      completeness: "complete",
      profitable: true,
      computed_at: "2026-08-26T00:00:00Z",
    },
    best_psa: {
      comparison_kind: "psa",
      raw_tier: 0,
      psa_grade: 10,
      english_card_uid: "22222222-2222-4222-8222-222222222222",
      jp_price_usd: 120,
      jp_source: "snkrdunk",
      jp_listing_count: 2,
      jp_price_as_of: "2026-08-26T00:00:00Z",
      us_ask_price_usd: 210,
      us_ask_source: "tcgplayer",
      us_ask_listing_count: 3,
      us_ask_price_as_of: "2026-08-26T00:00:00Z",
      realized_price_usd: 190,
      realized_sources: ["130point/pwcc", "cardladder/ebay"],
      realized_sample_count: 3,
      realized_window_start: "2026-05-28T00:00:00Z",
      realized_latest_sold_at: "2026-08-24T00:00:00Z",
      realized_completeness: "complete",
      decision_price_usd: 190,
      profit_price_basis: "realized_comp_cap",
      liquidity_penalty_ratio: 0.12,
      net_exit_usd: 160,
      net_profit_usd: 40,
      roi_ratio: 1 / 3,
      profit_denominator_usd: 120,
      completeness: "complete",
      profitable: true,
      computed_at: "2026-08-26T00:00:00Z",
    },
    prices_computed_at: "2026-08-26T00:00:00Z",
    candidate_updated_at: null,
    ...overrides,
  };
}

describe("EnglishCounterpartPanel", () => {
  it("shows exact printing identity, raw and exact-PSA economics, penalty, and evidence", () => {
    render(<EnglishCounterpartPanel row={mappedRow()} />);

    expect(screen.getByText("counterpart.exact")).toBeTruthy();
    expect(screen.getByText("SVP · 101 · unlimited · holo")).toBeTruthy();
    expect(screen.getByText("counterpart.rawTier")).toBeTruthy();
    expect(screen.getByText("counterpart.exactPsa")).toBeTruthy();
    expect(screen.getAllByText("counterpart.currentAsk")).toHaveLength(2);
    expect(screen.getAllByText("counterpart.realizedSoldComps")).toHaveLength(2);
    expect(screen.getAllByText(/counterpart.profitDecision/)).toHaveLength(2);
    expect(screen.getAllByText(/counterpart.basisRealizedCap/)).toHaveLength(2);
    expect(screen.getAllByText(/130point\/.*cardladder\//)).toHaveLength(2);
    expect(screen.getByText("$32.00 · 40.0%")).toBeTruthy();
    expect(screen.getByText("$40.00 · 33.3%")).toBeTruthy();
    expect(screen.getAllByText(/counterpart.liquidityPenalty/)).toHaveLength(2);
    expect(screen.getAllByText(/counterpart.denominator/)).toHaveLength(2);
    expect(screen.getAllByText(/counterpart.completeness/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("link", { name: /counterpart.evidence/ }).getAttribute("href"))
      .toBe("https://example.test/manifest");
  });

  it("renders missing US data as unknown instead of unprofitable", () => {
    const row = mappedRow({
      completeness: "missing_us_price",
      best_net_profit_usd: null,
      best_roi_ratio: null,
      profit_denominator_usd: null,
      complete_rows: 0,
      best_raw: {
        ...mappedRow().best_raw!,
        us_ask_price_usd: null,
        us_ask_source: null,
        us_ask_listing_count: 0,
        us_ask_price_as_of: null,
        net_exit_usd: null,
        net_profit_usd: null,
        roi_ratio: null,
        profit_denominator_usd: null,
        completeness: "missing_us_price",
        profitable: null,
      },
      best_psa: null,
    });
    render(<EnglishCounterpartPanel row={row} />);

    expect(screen.getByText("counterpart.unknownReason")).toBeTruthy();
    expect(screen.getByRole("group", { name: "counterpart.jpPrice" }).textContent)
      .toContain("$80.00 · snkrdunk");
    expect(screen.queryByText(/unprofitable/i)).toBeNull();
    expect(screen.getByText("counterpart.psaUnknown")).toBeTruthy();
  });

  it("shows an incomplete realized sample separately from the current ask and keeps profit unknown", () => {
    const row = mappedRow({
      completeness: "insufficient_realized_comps",
      best_net_profit_usd: null,
      best_roi_ratio: null,
      profit_denominator_usd: null,
      complete_rows: 0,
      best_raw: {
        ...mappedRow().best_raw!,
        realized_price_usd: 125,
        realized_sources: ["130point/ebay"],
        realized_sample_count: 1,
        realized_completeness: "insufficient_realized_comps",
        decision_price_usd: 125,
        profit_price_basis: "current_ask_fallback",
        liquidity_penalty_ratio: 0.32,
        net_exit_usd: null,
        net_profit_usd: null,
        roi_ratio: null,
        profit_denominator_usd: null,
        completeness: "insufficient_realized_comps",
        profitable: null,
      },
      best_psa: null,
    });
    render(<EnglishCounterpartPanel row={row} />);

    expect(screen.getByRole("group", { name: "counterpart.currentAsk" }).textContent)
      .toContain("$150.00 · tcgplayer");
    expect(screen.getByRole("group", { name: "counterpart.realizedSoldComps" }).textContent)
      .toContain("$125.00 · counterpart.soldCompCount · 130point/ebay");
    expect(screen.getAllByText(/counterpart.basisAskFallback/)).toHaveLength(1);
    expect(screen.queryByText(/unprofitable/i)).toBeNull();
  });

  it("keeps ambiguity visible without displaying a guessed English identity", () => {
    render(<EnglishCounterpartPanel row={mappedRow({
      counterpart_status: "review",
      english_card_uid: null,
      english_card_id: null,
      english_regional_name: null,
      english_name: null,
      english_set_code: null,
      english_card_number: null,
      review_candidate_count: 2,
      completeness: "missing_mapping",
      best_raw: null,
      best_psa: null,
    })} />);

    expect(screen.getByText("counterpart.review")).toBeTruthy();
    expect(screen.getByText("counterpart.reviewCount")).toBeTruthy();
    expect(screen.queryByText("Pikachu")).toBeNull();
  });

  it("does not turn a read failure into an identity conclusion", () => {
    render(<EnglishCounterpartPanel error={new Error("view unavailable")} />);
    expect(screen.getByText("counterpart.unavailable")).toBeTruthy();
    expect(screen.getByText("counterpart.unavailableHelp")).toBeTruthy();
  });
});

describe("counterpart PostgREST contracts", () => {
  it("pages a card-id read past a silent PostgREST cap", async () => {
    const all = [mappedRow(), mappedRow({ card_id: 43 }), mappedRow({ card_id: 44 })];
    let requested: Array<string | number> = [];
    const client = {
      from: (table: string) => {
        expect(table).toBe("pokemon_english_counterpart_card_v");
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.in = (_column: string, ids: Array<string | number>) => {
          requested = ids;
          return builder;
        };
        builder.order = () => builder;
        builder.range = (from: number) => Promise.resolve({
          data: all.filter((row) => requested.map(Number).includes(row.card_id)).slice(from, from + 2),
          error: null,
        });
        return builder;
      },
    };

    const rows = await fetchEnglishCounterparts(
      client as unknown as ReturnType<typeof createClient>,
      [42, 43, 44],
    );
    expect(rows.map((row) => row.card_id)).toEqual([42, 43, 44]);
  });

  it("sends evidence, optimistic version, and exact printing ID to the review RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { decision: "exact" }, error: null });
    await reviewEnglishCounterpart(
      { rpc } as unknown as ReturnType<typeof createClient>,
      {
        candidateUid: "33333333-3333-4333-8333-333333333333",
        expectedVersion: 7,
        decision: "exact",
        englishCardId: 84,
        evidenceUrl: " https://example.test/release ",
        decisionNote: " Same exact illustrated printing. ",
      },
    );

    expect(rpc).toHaveBeenCalledWith("review_pokemon_english_counterpart", {
      p_candidate_uid: "33333333-3333-4333-8333-333333333333",
      p_decision: "exact",
      p_english_card_id: 84,
      p_expected_version: 7,
      p_evidence_url: "https://example.test/release",
      p_decision_note: "Same exact illustrated printing.",
    });
  });
});

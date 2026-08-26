"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  EnglishCounterpartPanel,
  type EnglishCounterpartCardRow,
} from "@/app/dashboard/english-counterpart";
import {
  EnglishCounterpartCandidateCard,
  type EnglishCounterpartReviewRow,
} from "@/app/dashboard/EnglishCounterpartReviewView";

type FixtureState = "mapped" | "unknown" | "review";

const mapped: EnglishCounterpartCardRow = {
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
  english_foil_treatment: "other",
  confidence: 1,
  identity_basis: "operator_reference",
  evidence: { source: "official release checklist" },
  provenance: "operator_review",
  review_posture: "operator_confirmed",
  decision_note: "Official checklist establishes the exact printing.",
  evidence_url: "https://example.test/releases/svp-101",
  mapping_version: 3,
  reviewed_at: "2026-08-26T12:20:00.123456Z",
  reviewed_by: "catalog-reviewer",
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
    jp_price_as_of: "2026-08-26T12:00:00Z",
    us_ask_price_usd: 150,
    us_ask_source: "tcgplayer",
    us_ask_listing_count: 5,
    us_ask_price_as_of: "2026-08-26T12:00:00Z",
    realized_price_usd: 130,
    realized_sources: ["130point/ebay", "cardladder/ebay"],
    realized_sample_count: 4,
    realized_window_start: "2026-05-28T12:00:00Z",
    realized_latest_sold_at: "2026-08-25T12:00:00Z",
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
    computed_at: "2026-08-26T12:30:00Z",
  },
  best_psa: {
    comparison_kind: "psa",
    raw_tier: 0,
    psa_grade: 10,
    english_card_uid: "22222222-2222-4222-8222-222222222222",
    jp_price_usd: 120,
    jp_source: "snkrdunk",
    jp_listing_count: 2,
    jp_price_as_of: "2026-08-26T12:00:00Z",
    us_ask_price_usd: 210,
    us_ask_source: "tcgplayer",
    us_ask_listing_count: 3,
    us_ask_price_as_of: "2026-08-26T12:00:00Z",
    realized_price_usd: 190,
    realized_sources: ["130point/pwcc", "cardladder/ebay"],
    realized_sample_count: 3,
    realized_window_start: "2026-05-28T12:00:00Z",
    realized_latest_sold_at: "2026-08-24T12:00:00Z",
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
    computed_at: "2026-08-26T12:30:00Z",
  },
  prices_computed_at: "2026-08-26T12:30:00Z",
  candidate_updated_at: "2026-08-26T12:20:00Z",
};

const unknown: EnglishCounterpartCardRow = {
  ...mapped,
  card_id: 43,
  card_uid: "33333333-3333-4333-8333-333333333333",
  gate_status: "refresh_required",
  completeness: "insufficient_realized_comps",
  best_net_profit_usd: null,
  best_roi_ratio: null,
  profit_denominator_usd: null,
  comparison_rows: 2,
  complete_rows: 0,
  coverage_ratio: 0,
  best_raw: {
    ...mapped.best_raw!,
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
};

const review: EnglishCounterpartReviewRow = {
  candidate_uid: "44444444-4444-4444-8444-444444444444",
  review_version: 4,
  status: "review",
  identity_basis: "name_only",
  confidence: 0.55,
  evidence: {
    normalized_name: "pikachu",
    collision_count: 2,
    exact_identity: false,
  },
  provenance: "shared_pokemon_matcher",
  failure_code: null,
  first_seen_at: "2026-08-26T12:00:00Z",
  last_seen_at: "2026-08-26T12:10:00Z",
  japanese_card_id: 44,
  japanese_card_uid: "55555555-5555-4555-8555-555555555555",
  japanese_name: "ピカチュウ",
  japanese_english_name: "Pikachu",
  japanese_set_code: "SV-P",
  japanese_card_number: "101/SV-P",
  japanese_misc_info: "Japan-only illustration",
  japanese_image_url: null,
  japan_exclusive_artwork: true,
  japan_exclusive_stamps: false,
  proposed_english_card_id: 84,
  proposed_english_card_uid: "22222222-2222-4222-8222-222222222222",
  proposed_english_name: "Pikachu",
  proposed_english_set_code: "SVP",
  proposed_english_card_number: "101",
  proposed_english_misc_info: "Cosmos Holo",
  proposed_english_image_url: null,
  gate_status: "resolution_required",
  completeness: "missing_mapping",
  best_net_profit_usd: null,
  best_roi_ratio: null,
  profit_denominator_usd: null,
};

export function EnglishCounterpartFixture() {
  const [state, setState] = useState<FixtureState>("mapped");
  return (
    <main className="min-h-dvh min-w-0 overflow-x-hidden bg-background p-3 text-foreground sm:p-6">
      <div className="mx-auto min-w-0 max-w-5xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">English counterpart operator fixture</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Controlled evidence for exact mapping, unknown price completeness, and ambiguous review. No database or external source is contacted.
          </p>
        </div>
        <div role="group" aria-label="Fixture state" className="flex min-w-0 flex-wrap gap-2">
          {(["mapped", "unknown", "review"] as const).map((value) => (
            <Button
              key={value}
              data-testid={`fixture-state-${value}`}
              variant={state === value ? "default" : "outline"}
              className="min-h-11"
              aria-pressed={state === value}
              onClick={() => setState(value)}
            >
              {value === "mapped" ? "Mapped" : value === "unknown" ? "Unknown price" : "Ambiguous review"}
            </Button>
          ))}
        </div>
        <section data-testid={`fixture-panel-${state}`} aria-label={`${state} counterpart state`} className="min-w-0">
          {state === "mapped" && <EnglishCounterpartPanel row={mapped} />}
          {state === "unknown" && <EnglishCounterpartPanel row={unknown} />}
          {state === "review" && (
            <EnglishCounterpartCandidateCard row={review} onSaved={async () => undefined} />
          )}
        </section>
      </div>
    </main>
  );
}

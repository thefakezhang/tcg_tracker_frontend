"use client";

import { useEffect, useState } from "react";

import MercariLeadsView, {
  type MercariLead,
  type MercariLeadFilters,
  type MercariLeadsPage,
} from "@/app/dashboard/MercariLeadsView";
import {
  LANGUAGE_LABELS,
  useLanguage,
  type Language,
} from "@/app/dashboard/LanguageContext";

// Shapes taken from the leads measured on cloud 2026-11-16: a trusted play,
// a play on a name-only title, and a raw deal whose floor does not pay for
// grading. Images are left out so the fixture makes no outside request.
const BASE: MercariLead = {
  external_item_id: "m10425422029",
  source_item_type: "mercari",
  canonical_url: "https://jp.mercari.com/item/m10425422029",
  sanitized_title: "ギャラドス☆ δ-デルタ種 008/052 ホロンの研究塔",
  ask_jpy: 109000,
  shipping_payer: "seller",
  buyer_pays_shipping: false,
  shipping_added_jpy: 0,
  seller_condition_id: "6",
  source_status: "ON_SALE",
  source_created_at: "2026-11-15T22:00:00+00:00",
  first_seen_at: "2026-11-15T22:10:00+00:00",
  observed_at: "2026-11-16T06:40:00+00:00",
  listing_age_hours: 9.2,
  observed_age_hours: 0.5,
  holder_hint: "holder_unknown",
  title_psa_grade: null,
  card_resolution: "uid",
  regional_name: "ギャラドス☆Δ-デルタ種",
  english_name: "Gyarados Star δ",
  set_code: "P7",
  set_name: "Holon Research Tower",
  card_number: "008/052",
  misc_info: "UNKNOWN",
  edition: "unknown",
  foil_treatment: "holo",
  image_url: null,
  match_tier: "setless_number",
  source_kind: "lead_scan",
  title_card_in_photo_scope: true,
  lane: "vintage_raw",
  value_usd: 1050,
  value_condition: "damaged_p25",
  nm_value_usd: 1480,
  value_psa_grade: 0,
  value_basis: "ebay_rule_v0",
  value_as_of: "2026-11-12",
  value_sample_count: 9,
  value_window_days: 180,
  unpriced_reason: null,
  landed_ask_usd: 682.1,
  selling_cost_usd: 168.2,
  net_value_usd: 881.8,
  multiple: 1.293,
  multiple_withheld_reason: null,
  other_listings: 0,
  photo_check_state: "confirmed",
  photo_check_priority: null,
  photo_source_card_uid: "c0000000-0000-4000-8000-000000000008",
  photo_card_uid: "c0000000-0000-4000-8000-000000000008",
  photo_regional_name: "ギャラドス☆Δ-デルタ種",
  photo_english_name: "Gyarados Star δ",
  photo_set_code: "P7",
  photo_card_number: "008/052",
  photo_image_url: null,
  photo_psa_grade: null,
  photo_checked_at: "2026-11-16T05:00:00+00:00",
  latest_lead_action: null,
  latest_lead_action_reason: null,
  latest_lead_action_at: null,
  dismissed: false,
  photo_check_requested: false,
  photo_checks_paused: false,
  listing_format: "fixed_price",
  auction_bid_count: null,
  auction_ends_at: null,
  auction_last_seen_at: null,
  auction_max_bid_jpy: null,
  auction_bid_within_max: null,
  auction_ended: false,
  current_card_uid: "c0000000-0000-4000-8000-000000000008",
  value_age_days: 4,
  value_refreshed_at: "2026-11-16T11:20:00+00:00",
  screen_result: null,
  screen_evidence_usd: null,
  screen_evidence_source: null,
  screen_evidence_as_of: null,
  screen_multiplier: 2,
  slab_floor_usd: 1401,
  slab_floor_median_usd: 1720,
  slab_floor_sales: 47,
  slab_floor_grades: [1, 2, 3, 4, 5, 6],
  slab_floor_as_of: "2026-11-14",
  slab_grading_cost_usd: 21.9,
  slab_grading_days: 45,
  slab_selling_cost_usd: 230.19,
  slab_net_value_usd: 1148.91,
  slab_play_profit_usd: 466.81,
  slab_play_multiple: 1.684,
  slab_play_state: "play",
  group: { rows: 1, listings: 1, askMin: 109000, askMax: 109000, memberIds: ["m10425422029"] },
};

const UNVERIFIED: MercariLead = {
  ...BASE,
  external_item_id: "m68586542292",
  canonical_url: "https://jp.mercari.com/item/m68586542292",
  sanitized_title: "ポケモンカード 旧裏 なみのりピカチュウ",
  ask_jpy: 4000,
  seller_condition_id: "3",
  regional_name: "なみのりピカチュウ",
  english_name: "Surfing Pikachu",
  set_code: "OLD-UPC",
  set_name: "Old back promos",
  card_number: null,
  match_tier: "set_name",
  photo_check_state: "unchecked",
  photo_source_card_uid: null,
  photo_card_uid: null,
  photo_regional_name: null,
  photo_english_name: null,
  photo_set_code: null,
  photo_card_number: null,
  photo_checked_at: null,
  current_card_uid: "c0000000-0000-4000-8000-000000000009",
  landed_ask_usd: 25.03,
  value_usd: 210,
  nm_value_usd: 349,
  selling_cost_usd: 37,
  net_value_usd: 173,
  multiple: 6.912,
  slab_floor_usd: 574,
  slab_floor_median_usd: 800,
  slab_floor_sales: 30,
  slab_floor_grades: [1, 2, 3, 4, 5, 6],
  slab_selling_cost_usd: 93.66,
  slab_net_value_usd: 458.44,
  slab_play_profit_usd: 433.41,
  slab_play_multiple: 18.316,
  slab_play_state: "unverified",
  group: { rows: 4, listings: 4, askMin: 4000, askMax: 19000, memberIds: ["m68586542292", "m79011294601", "m32515374287", "m19402124811"] },
};

const LOSS: MercariLead = {
  ...BASE,
  external_item_id: "m40000000004",
  canonical_url: "https://jp.mercari.com/item/m40000000004",
  sanitized_title: "ポケモンカード ピカチュウ 001/078 SV",
  ask_jpy: 1500,
  seller_condition_id: "1",
  regional_name: "ピカチュウ",
  english_name: "Pikachu",
  set_code: "SV1S",
  set_name: "Scarlet ex",
  card_number: "001/078",
  lane: "modern_raw",
  value_usd: 42,
  value_condition: "nm",
  nm_value_usd: 42,
  landed_ask_usd: 9.39,
  selling_cost_usd: 13.71,
  net_value_usd: 28.29,
  multiple: 3.013,
  photo_check_state: "unchecked",
  photo_source_card_uid: null,
  photo_card_uid: null,
  photo_regional_name: null,
  photo_english_name: null,
  photo_set_code: null,
  photo_card_number: null,
  photo_checked_at: null,
  current_card_uid: "c0000000-0000-4000-8000-000000000010",
  slab_floor_usd: 30,
  slab_floor_median_usd: 32,
  slab_floor_sales: 6,
  slab_floor_grades: [2, 3, 5],
  slab_selling_cost_usd: 11.79,
  slab_net_value_usd: -3.69,
  slab_play_profit_usd: -13.08,
  slab_play_multiple: null,
  slab_play_state: null,
  group: { rows: 1, listings: 1, askMin: 1500, askMax: 1500, memberIds: ["m40000000004"] },
};

async function loader(filters: MercariLeadFilters): Promise<MercariLeadsPage> {
  const leads = filters.lane === "slab_play"
    ? [BASE, ...(filters.includeUnverified ? [UNVERIFIED] : [])]
    : filters.lane === "modern_raw" ? [LOSS] : [];
  return {
    leads: leads.filter((lead) => filters.conditions.length === 0 || filters.conditions.includes(lead.seller_condition_id)),
    nextCursor: null,
  };
}

async function groupLoader(): Promise<MercariLead[]> {
  return [];
}

async function actor(): Promise<void> {}

export function MercariSlabPlaysFixture() {
  const { language, setLanguage } = useLanguage();
  // The dashboard mounts the leads tab on the client only, and the tab reads
  // its lane from the URL as it mounts, so the fixture does the same rather
  // than server-render a lane the client then replaces.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl p-4 sm:p-8" data-testid="mercari-slab-plays-fixture">
      <header className="mb-6 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Controlled browser fixture</p>
          <h1 className="break-words text-2xl font-semibold sm:text-3xl">Mercari slab plays</h1>
        </div>
        <select
          aria-label="Language"
          className="min-h-11 rounded-md border bg-background px-3 text-sm sm:min-h-0 sm:py-1"
          value={language}
          onChange={(event) => setLanguage(event.target.value as Language)}
        >
          {(Object.keys(LANGUAGE_LABELS) as Language[]).map((code) => (
            <option key={code} value={code}>{LANGUAGE_LABELS[code]}</option>
          ))}
        </select>
      </header>
      {mounted && <MercariLeadsView loader={loader} actor={actor} groupLoader={groupLoader} />}
    </main>
  );
}

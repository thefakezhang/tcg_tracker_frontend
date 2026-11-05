// Documents shaped like the backend's twitter_buyback_sources and
// twitter_buyback_buylist answers (migration 000628), for the Buybacks tests.
// The clock is fixed: NOW is 2026-11-05 21:00 UTC (06:00 JST on 11-06).

export const NOW = Date.parse("2026-11-05T21:00:00Z");

const hoursAgo = (hours: number) => new Date(NOW - hours * 3600_000).toISOString();

export function sourceDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "pdg",
    accounts: ["PDGcollectors", "PDGcollectors_2"],
    latest_tweet: {
      tweet_id: "2118233672491073776",
      tweet_url: "https://twitter.com/PDGcollectors/status/2118233672491073776",
      account: "PDGcollectors",
      tweeted_at: "2026-11-05T06:47:17+00:00",
      read_at: "2026-11-05T10:38:06+00:00",
    },
    freshness: "fresh",
    tweets_24h: 6,
    tweets_72h: 13,
    latest_sheet: { cells: 13, auto_approved: 11, approved: 2, pending: 0, rejected: 0, expired: 0, misclassified: 0 },
    buylist: { cards: 415, live_cards: 415, live_bids: 371 },
    polling: [
      { account: "PDGcollectors", status: "active", last_polled_at: hoursAgo(4), next_poll_at: hoursAgo(-1), consecutive_failures: 0 },
      { account: "PDGcollectors_2", status: "active", last_polled_at: hoursAgo(5), next_poll_at: hoursAgo(-1), consecutive_failures: 0 },
    ],
    auto_accept: {
      configured: true,
      enabled: true,
      fingerprint_current: true,
      stale_fingerprint: false,
      used_today: 310,
      daily_cap: 2000,
      per_run_cap: 2000,
    },
    ...overrides,
  };
}

export const LAURIER = sourceDoc({
  source: "laurier",
  accounts: ["laurier_akiba", "laurier_akiba2"],
  latest_tweet: {
    tweet_id: "2118222000000000000",
    tweet_url: "https://twitter.com/laurier_akiba/status/2118222000000000000",
    account: "laurier_akiba",
    tweeted_at: "2026-11-04T20:00:00+00:00",
    read_at: null,
  },
  freshness: "aging",
  tweets_24h: 0,
  tweets_72h: 80,
  latest_sheet: { cells: 5, auto_approved: 0, approved: 0, pending: 4, rejected: 1, expired: 0, misclassified: 0 },
  buylist: { cards: 975, live_cards: 975, live_bids: 67 },
  polling: [
    { account: "laurier_akiba", status: "active", last_polled_at: hoursAgo(2), next_poll_at: hoursAgo(-2), consecutive_failures: 0 },
    { account: "laurier_akiba2", status: "paused", last_polled_at: hoursAgo(200), next_poll_at: hoursAgo(-2), consecutive_failures: 5 },
  ],
  auto_accept: {
    configured: true,
    enabled: true,
    fingerprint_current: false,
    stale_fingerprint: true,
    used_today: 10,
    daily_cap: 2000,
    per_run_cap: 2000,
  },
});

export const CLOVER = sourceDoc({
  source: "clover_base",
  accounts: ["CloveBase"],
  latest_tweet: {
    tweet_id: "2084169643925901455",
    tweet_url: "https://twitter.com/CloveBase/status/2084169643925901455",
    account: "CloveBase",
    tweeted_at: "2026-08-03T06:48:59+00:00",
    read_at: "2026-08-06T08:17:15+00:00",
  },
  freshness: "expired",
  tweets_24h: 0,
  tweets_72h: 0,
  latest_sheet: { cells: 12, auto_approved: 0, approved: 0, pending: 1, rejected: 0, expired: 11, misclassified: 0 },
  buylist: { cards: 383, live_cards: 0, live_bids: 0 },
  polling: [],
  auto_accept: {
    configured: false,
    enabled: false,
    fingerprint_current: null,
    stale_fingerprint: false,
    used_today: 0,
    daily_cap: null,
    per_run_cap: null,
  },
});

export function overviewDoc(sources: Record<string, unknown>[] = [sourceDoc(), LAURIER, CLOVER]): Record<string, unknown> {
  return {
    generated_at: "2026-11-05T21:00:00+00:00",
    fresh_hours: 24,
    expiry_hours: 72,
    cap_day_started_at: "2026-11-05T00:00:00+00:00",
    auto_accept: { global_enabled: true, global_daily_cap: 50000, global_used_today: 826 },
    sources,
  };
}

const SHEET = "https://pub-test.r2.dev/image-buylist/source/" + "b".repeat(64) + ".jpg";

export function rowDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const card = (overrides.card ?? {}) as Record<string, unknown>;
  return {
    grade: "raw",
    status: "auto_approved",
    verified: true,
    price_jpy: 90000,
    read_price_jpy: 90000,
    quoted_at: "2026-11-05T02:48:32+00:00",
    first_quoted_at: "2026-11-05T02:45:34+00:00",
    freshness: "fresh",
    tweets: [
      { tweet_id: "2118173590722052528", tweet_url: "https://twitter.com/PDGcollectors_2/status/2118173590722052528", account: "PDGcollectors_2", tweeted_at: "2026-11-05T02:48:32+00:00" },
      { tweet_id: "2118172843347505186", tweet_url: "https://twitter.com/PDGcollectors/status/2118172843347505186", account: "PDGcollectors", tweeted_at: "2026-11-05T02:45:34+00:00" },
    ],
    sheet: {
      image_url: SHEET,
      width: 1536,
      height: 2048,
      geometry: { card: { x0: 947, y0: 374, x1: 1411, y1: 981 }, price: { x0: 931, y0: 1052, x1: 1435, y1: 1173 } },
    },
    ...overrides,
    card: {
      card_id: 794930,
      name: "ひかるミュウ",
      english_name: "Shining Mew",
      set_code: "OLD-UPC",
      set_name: "Unnumbered Promotional cards (Old Series)",
      set_english_name: null,
      card_number: "旧裏",
      edition: "unknown",
      foil_treatment: "normal",
      misc_info: "",
      ...card,
    },
  };
}

export const ROWS = [
  rowDoc(),
  rowDoc({
    card: { card_id: 799208, name: "サナ", english_name: "Serena", set_code: "SV-P", set_name: "Scarlet & Violet Promos", card_number: "001", misc_info: "UNKNOWN" },
    grade: "psa_10",
    status: "approved",
    price_jpy: 477000,
    read_price_jpy: 1680000,
    quoted_at: "2026-11-05T03:50:54+00:00",
    first_quoted_at: "2026-11-05T03:50:54+00:00",
    tweets: [{ tweet_id: "2118189284796858378", tweet_url: "https://twitter.com/PDGcollectors/status/2118189284796858378", account: "PDGcollectors", tweeted_at: "2026-11-05T03:50:54+00:00" }],
  }),
  rowDoc({
    card: { card_id: 800001, name: "リザードン", english_name: "Charizard", set_code: "SV2a", set_name: "Pokemon Card 151", card_number: "006" },
    status: "pending",
    verified: false,
    price_jpy: 1200,
    read_price_jpy: 1200,
    quoted_at: "2026-11-04T12:00:00+00:00",
    first_quoted_at: "2026-11-04T12:00:00+00:00",
    freshness: "aging",
    tweets: [{ tweet_id: "2117854090470551635", tweet_url: "https://twitter.com/PDGcollectors/status/2117854090470551635", account: "PDGcollectors", tweeted_at: "2026-11-04T12:00:00+00:00" }],
    sheet: null,
  }),
  rowDoc({
    card: { card_id: 800002, name: "ピカチュウ", english_name: null, set_code: "SV2a", set_name: "Pokemon Card 151", card_number: "025", foil_treatment: "mirror" },
    status: "expired",
    verified: false,
    price_jpy: 300,
    read_price_jpy: 300,
    quoted_at: "2026-11-03T09:00:00+00:00",
    first_quoted_at: "2026-11-03T09:00:00+00:00",
    freshness: "aging",
    tweets: [{ tweet_id: "2117460692894982339", tweet_url: "https://twitter.com/PDGcollectors/status/2117460692894982339", account: "PDGcollectors", tweeted_at: "2026-11-03T09:00:00+00:00" }],
  }),
];

export function buylistDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "pdg",
    known: true,
    generated_at: "2026-11-05T21:00:00+00:00",
    fresh_hours: 24,
    expiry_hours: 72,
    latest_tweet_at: "2026-11-05T06:47:17+00:00",
    window_started_at: "2026-11-02T06:47:17+00:00",
    rows: ROWS,
    ...overrides,
  };
}

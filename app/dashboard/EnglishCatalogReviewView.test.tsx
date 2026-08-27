// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { createClient } from "@/lib/supabase/client";
import EnglishCatalogReviewView, {
  fetchEnglishCatalogCandidates,
  fetchEnglishCatalogRuns,
  type EnglishCatalogCandidateRow,
  type EnglishCatalogImportRun,
} from "./EnglishCatalogReviewView";

const mocks = vi.hoisted(() => ({
  data: undefined as { candidates: EnglishCatalogCandidateRow[]; runs: EnglishCatalogImportRun[] } | undefined,
  rpc: vi.fn(),
  retry: vi.fn(),
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("./use-query", () => ({
  useSupabaseQuery: () => ({
    data: mocks.data,
    error: null,
    isLoading: false,
    isValidating: false,
    retry: mocks.retry,
  }),
  QueryError: () => null,
}));

function candidate(overrides: Partial<EnglishCatalogCandidateRow> = {}): EnglishCatalogCandidateRow {
  return {
    candidate_key: "tcgplayer:3:100:11",
    tcgplayer_group_id: 100,
    tcgplayer_product_id: 11,
    tcgplayer_group_name: "Base Set",
    set_code: "BS",
    raw_collector_number: "14/102",
    card_number: "14/102",
    regional_name: "Raichu",
    clean_name: "Raichu",
    rarity: "Rare Holo",
    image_url: null,
    outcome: "review_required",
    reason: "same_number_products_ambiguous",
    evidence: {
      matcher: "shared_pokemon_identity_v1",
      snapshot_sha256: "a".repeat(64),
      crosswalk_sha256: "b".repeat(64),
      competing_product_ids: [11, 12],
    },
    evidence_sha256: "c".repeat(64),
    imported_card_uid: null,
    imported_card_id: null,
    review_version: 3,
    first_seen_at: "2026-08-26T00:00:00Z",
    last_seen_at: "2026-08-26T00:00:00Z",
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    review_evidence_url: null,
    ...overrides,
  };
}

function run(): EnglishCatalogImportRun {
  return {
    run_uid: "11111111-1111-4111-8111-111111111111",
    snapshot_sha256: "a".repeat(64),
    crosswalk_sha256: "b".repeat(64),
    actor: "service_role",
    completed_at: "2026-08-26T12:00:00Z",
    report: {
      snapshot_groups: 200,
      snapshot_products: 18000,
      reviewed_groups: 150,
      unmapped_groups: 50,
      auto_import_products: 14000,
      review_products: 500,
      no_product_groups: 4,
      external_requests_performed: 0,
      estimated_feed_requests: 201,
      snapshot_bytes: 9000000,
      crosswalk_bytes: 100000,
      estimated_definition_rows: 14000,
      estimated_tcgplayer_identifier_rows: 14000,
      estimated_durable_candidate_rows: 14504,
      estimated_durable_event_rows: 14505,
    },
  };
}

afterEach(() => {
  cleanup();
  mocks.data = undefined;
  mocks.rpc.mockReset();
  mocks.retry.mockReset();
});

describe("EnglishCatalogReviewView", () => {
  it("keeps auto, ambiguous, and no-product coverage visibly separate", () => {
    mocks.data = {
      candidates: [
        candidate(),
        candidate({
          candidate_key: "tcgplayer:3:200:no-product",
          tcgplayer_group_id: 200,
          tcgplayer_product_id: null,
          tcgplayer_group_name: "Missing Set",
          set_code: "MISS",
          raw_collector_number: null,
          card_number: null,
          regional_name: null,
          outcome: "no_product",
          reason: "reviewed_group_missing_from_snapshot",
        }),
        candidate({
          candidate_key: "tcgplayer:3:100:20",
          tcgplayer_product_id: 20,
          regional_name: "Pikachu",
          card_number: "58/102",
          outcome: "imported",
          imported_card_id: 900,
        }),
      ],
      runs: [run()],
    };
    render(<EnglishCatalogReviewView />);

    expect(screen.getByTestId("english-catalog-run-summary").textContent).toContain("14000 / 500 / 4");
    expect(screen.getByTestId("english-catalog-run-summary").textContent).toContain("0 englishCatalog.requestsRun");
    expect(screen.getByText("englishCatalog.outcome.review_required")).toBeTruthy();
    expect(screen.getByText("englishCatalog.outcome.no_product")).toBeTruthy();
    expect(screen.getByText("englishCatalog.noProductHelp")).toBeTruthy();
    expect(screen.queryByText("englishCatalog.outcome.imported")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "englishCatalog.filter.imported" }));
    expect(screen.getByText("englishCatalog.outcome.imported")).toBeTruthy();
    expect(screen.getByText("900")).toBeTruthy();
  });

  it("requires evidence and calls the versioned catalog review RPC", async () => {
    mocks.data = { candidates: [candidate()], runs: [run()] };
    mocks.rpc.mockResolvedValue({ data: { outcome: "imported" }, error: null });
    mocks.retry.mockResolvedValue(undefined);
    render(<EnglishCatalogReviewView />);

    const confirm = screen.getByRole("button", { name: "englishCatalog.confirmImport" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("counterpart.evidenceUrl"), {
      target: { value: "https://example.com/base-set/raichu" },
    });
    fireEvent.change(screen.getByLabelText("counterpart.decisionNote"), {
      target: { value: "Exact Base Set 14/102 product, image, and rarity confirmed." },
    });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "review_pokemon_english_catalog_candidate",
      {
        p_candidate_key: "tcgplayer:3:100:11",
        p_decision: "confirm_import",
        p_expected_version: 3,
        p_evidence_url: "https://example.com/base-set/raichu",
        p_note: "Exact Base Set 14/102 product, image, and rarity confirmed.",
      },
    ));
  });

  it("labels missing run data as unknown instead of zero coverage", () => {
    mocks.data = { candidates: [], runs: [] };
    render(<EnglishCatalogReviewView />);
    expect(screen.getByText("englishCatalog.noImportReport")).toBeTruthy();
    expect(screen.getByText("englishCatalog.empty")).toBeTruthy();
  });
});

describe("English catalog PostgREST pagination", () => {
  it("reads every candidate and import run past a server page cap", async () => {
    const candidates = [
      candidate(),
      candidate({ candidate_key: "tcgplayer:3:100:12", tcgplayer_product_id: 12 }),
      candidate({ candidate_key: "tcgplayer:3:100:13", tcgplayer_product_id: 13 }),
    ];
    const runs = [
      run(),
      { ...run(), run_uid: "22222222-2222-4222-8222-222222222222" },
      { ...run(), run_uid: "33333333-3333-4333-8333-333333333333" },
    ];
    const client = {
      from: (table: string) => {
        const source = table === "pokemon_english_catalog_review_v" ? candidates : runs;
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.order = () => builder;
        builder.range = (from: number) => Promise.resolve({
          data: source.slice(from, from + 2),
          error: null,
        });
        return builder;
      },
    };
    const supabase = client as unknown as ReturnType<typeof createClient>;
    expect((await fetchEnglishCatalogCandidates(supabase)).map((row) => row.candidate_key))
      .toEqual(candidates.map((row) => row.candidate_key));
    expect((await fetchEnglishCatalogRuns(supabase)).map((row) => row.run_uid))
      .toEqual(runs.map((row) => row.run_uid));
  });
});

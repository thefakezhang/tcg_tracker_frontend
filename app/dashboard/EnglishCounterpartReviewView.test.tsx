// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { createClient } from "@/lib/supabase/client";
import EnglishCounterpartReviewView, {
  fetchEnglishCounterpartReviewRows,
  type EnglishCounterpartReviewRow,
} from "./EnglishCounterpartReviewView";

const mocks = vi.hoisted(() => ({
  rows: [] as EnglishCounterpartReviewRow[],
  rpc: vi.fn(),
  retry: vi.fn(),
}));

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

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("./use-query", () => ({
  useSupabaseQuery: () => ({
    data: mocks.rows,
    error: null,
    isLoading: false,
    isValidating: false,
    retry: mocks.retry,
  }),
  QueryError: () => null,
}));

afterEach(() => {
  cleanup();
  mocks.rows = [];
  mocks.rpc.mockReset();
  mocks.retry.mockReset();
});

function candidate(overrides: Partial<EnglishCounterpartReviewRow> = {}): EnglishCounterpartReviewRow {
  return {
    candidate_uid: "33333333-3333-4333-8333-333333333333",
    review_version: 4,
    status: "review",
    identity_basis: "name_only",
    confidence: 0.55,
    evidence: { normalized_name: "pikachu", collision_count: 2 },
    provenance: "shared_pokemon_matcher",
    failure_code: null,
    first_seen_at: "2026-08-26T00:00:00Z",
    last_seen_at: "2026-08-26T00:00:00Z",
    japanese_card_id: 42,
    japanese_card_uid: "11111111-1111-4111-8111-111111111111",
    japanese_name: "ピカチュウ",
    japanese_english_name: "Pikachu",
    japanese_set_code: "SV-P",
    japanese_card_number: "101/SV-P",
    japanese_misc_info: "Campaign stamp",
    japanese_image_url: null,
    japan_exclusive_artwork: false,
    japan_exclusive_stamps: true,
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
    ...overrides,
  };
}

describe("EnglishCounterpartReviewView", () => {
  it("keeps a name-only candidate in review and submits an evidence-backed exact decision", async () => {
    mocks.rows = [candidate()];
    mocks.rpc.mockResolvedValue({ data: { decision: "exact" }, error: null });
    mocks.retry.mockResolvedValue(undefined);

    const { container } = render(<EnglishCounterpartReviewView />);
    expect(screen.getByText("name only")).toBeTruthy();
    expect(screen.getByText("counterpart.stampOnlyNote")).toBeTruthy();
    expect(screen.getByText("counterpart.unknownReason")).toBeTruthy();
    expect(container.querySelector("main")?.className).toContain("overflow-x-hidden");

    const exact = screen.getByRole("button", { name: "counterpart.confirmExact" }) as HTMLButtonElement;
    expect(exact.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("counterpart.evidenceUrl"), {
      target: { value: "https://example.test/printing" },
    });
    fireEvent.change(screen.getByLabelText("counterpart.decisionNote"), {
      target: { value: "Release checklist confirms the same illustrated printing." },
    });
    expect(exact.disabled).toBe(false);
    fireEvent.click(exact);

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "review_pokemon_english_counterpart",
      {
        p_candidate_uid: "33333333-3333-4333-8333-333333333333",
        p_decision: "exact",
        p_english_card_id: 84,
        p_expected_version: 4,
        p_evidence_url: "https://example.test/printing",
        p_decision_note: "Release checklist confirms the same illustrated printing.",
      },
    ));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });

  it("warns on Japanese-exclusive artwork and permits an evidence-backed no-counterpart decision", async () => {
    mocks.rows = [candidate({
      candidate_uid: "44444444-4444-4444-8444-444444444444",
      proposed_english_card_id: null,
      proposed_english_card_uid: null,
      proposed_english_name: null,
      proposed_english_set_code: null,
      proposed_english_card_number: null,
      proposed_english_misc_info: null,
      japan_exclusive_artwork: true,
      japan_exclusive_stamps: false,
    })];
    mocks.rpc.mockResolvedValue({ data: { decision: "no_counterpart" }, error: null });
    mocks.retry.mockResolvedValue(undefined);
    render(<EnglishCounterpartReviewView />);

    expect(screen.getByText("counterpart.exclusiveArtworkWarning")).toBeTruthy();
    expect(screen.getByText("counterpart.noProposal")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("counterpart.evidenceUrl"), {
      target: { value: "https://example.test/japan-exclusive" },
    });
    fireEvent.change(screen.getByLabelText("counterpart.decisionNote"), {
      target: { value: "Official release list has no English-art counterpart." },
    });
    fireEvent.click(screen.getByRole("button", { name: "counterpart.confirmNoCounterpart" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "review_pokemon_english_counterpart",
      expect.objectContaining({
        p_decision: "no_counterpart",
        p_english_card_id: null,
      }),
    ));
  });

  it("keeps failed resolution visible and provides a versioned retry", async () => {
    mocks.rows = [candidate({ status: "failed", failure_code: "ambiguous_exact_identity" })];
    mocks.rpc.mockResolvedValue({ data: { decision: "retry" }, error: null });
    mocks.retry.mockResolvedValue(undefined);
    render(<EnglishCounterpartReviewView />);

    expect(screen.getByText("ambiguous_exact_identity")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "counterpart.retryCandidate" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "review_pokemon_english_counterpart",
      expect.objectContaining({
        p_decision: "retry",
        p_expected_version: 4,
        p_evidence_url: null,
        p_decision_note: null,
      }),
    ));
  });
});

describe("counterpart review pagination", () => {
  it("reads every candidate when PostgREST silently caps each page", async () => {
    const rows = [
      candidate(),
      candidate({ candidate_uid: "44444444-4444-4444-8444-444444444444" }),
      candidate({ candidate_uid: "55555555-5555-4555-8555-555555555555" }),
    ];
    const client = {
      from: (table: string) => {
        expect(table).toBe("pokemon_english_counterpart_review_v");
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.in = () => builder;
        builder.order = () => builder;
        builder.range = (from: number) => Promise.resolve({
          data: rows.slice(from, from + 2),
          error: null,
        });
        return builder;
      },
    };

    const result = await fetchEnglishCounterpartReviewRows(
      client as unknown as ReturnType<typeof createClient>,
    );
    expect(result.map((row) => row.candidate_uid)).toEqual(rows.map((row) => row.candidate_uid));
  });
});

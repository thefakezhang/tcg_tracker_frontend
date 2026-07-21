// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SourceHealthView from "./SourceHealthView";
import MatchReviewView from "./MatchReviewView";
import {
  MATCH_REVIEW_SENTINEL,
  ReviewQueueNavigationProvider,
  useReviewQueueNavigation,
} from "./ReviewQueueNavigationContext";

const mocks = vi.hoisted(() => ({
  setActiveTripId: vi.fn(),
  setActiveBuylistId: vi.fn(),
  queryKeys: [] as unknown[][],
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      key === "health.reviewSource" ? `Review ${params?.source} queue` : key,
  }),
}));

vi.mock("./TripContext", () => ({
  useTrips: () => ({ setActiveTripId: mocks.setActiveTripId }),
}));

vi.mock("./BuyListContext", () => ({
  useBuyList: () => ({ setActiveBuylistId: mocks.setActiveBuylistId }),
}));

vi.mock("./SourceRunsPanel", () => ({ SourceRunsPanel: () => null }));
vi.mock("./DuplicateConflictsPanel", () => ({ DuplicateConflictsPanel: () => null }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const query = {
      select: () => query,
      order: () => query,
      limit: async () => ({
        data: [{
          run_date: "2026-07-20",
          source: "big_tcg",
          rows_written: 100,
          match_rate: 0.95,
          unmatched_queue_depth: 7,
          drift_count: 0,
          guard_trips: 0,
          refresh_failures: 4,
          freshness_p50_hours: 2,
          table_bytes: 1000,
          notes: {},
        }],
        error: null,
      }),
    };
    const calibrationQuery = {
      select: () => calibrationQuery,
      order: () => calibrationQuery,
      limit: async () => ({
        data: [{
          run_at: "2026-07-20T23:07:00Z",
          model_version: "s2-v2",
          sample_count: 0,
          contained_count: 0,
          coverage_rate: 0,
          mean_signed_error_pct: 0,
          recommended_percentile: null,
          report: { realized_sales: 406, sales_with_comp_key: 0 },
        }],
        error: null,
      }),
    };
    return { from: (table: string) => table === "calibration_runs" ? calibrationQuery : query };
  },
}));

vi.mock("./use-query", () => ({
  useSupabaseQuery: (key: unknown[]) => {
    mocks.queryKeys.push(key);
    return {
      data: { candidates: [], items: new Map(), total: 0 },
      error: null,
      isLoading: false,
      retry: vi.fn(),
    };
  },
  QueryError: () => null,
}));

function Harness() {
  const { target } = useReviewQueueNavigation();
  return (
    <>
      <SourceHealthView />
      {target && <MatchReviewView initialGame={target.game} initialSource={target.source} />}
    </>
  );
}

afterEach(() => {
  cleanup();
  mocks.setActiveTripId.mockReset();
  mocks.setActiveBuylistId.mockReset();
  mocks.queryKeys.length = 0;
});

describe("D4 source-health drill-down", () => {
  it("shows a watch state instead of a recommendation when history has no comp overlap", async () => {
    render(
      <ReviewQueueNavigationProvider>
        <Harness />
      </ReviewQueueNavigationProvider>,
    );

    expect(await screen.findByText("health.calibrationWatch")).toBeTruthy();
    expect(screen.queryByText("P50")).toBeNull();
  });

  it("takes a deliberately failed source to the matching filtered Pokémon queue", async () => {
    render(
      <ReviewQueueNavigationProvider>
        <Harness />
      </ReviewQueueNavigationProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Review big_tcg queue" }));

    expect(mocks.setActiveBuylistId).toHaveBeenCalledWith(null);
    expect(mocks.setActiveTripId).toHaveBeenCalledWith(MATCH_REVIEW_SENTINEL);
    const source = await screen.findByRole("combobox", { name: "review.sourceFilter" }) as HTMLSelectElement;
    expect(source.value).toBe("big_tcg");
    await waitFor(() => {
      expect(mocks.queryKeys.at(-1)).toEqual(["match-review", "pokemon", "generated", "big_tcg", "500"]);
    });
  });
});

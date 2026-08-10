// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import ImageAutoAcceptView from "./ImageAutoAcceptView";

const fixture = vi.hoisted(() => ({
  status: {
    control: { global_enabled: false, daily_cap: 25, reason: "stopped", updated_at: "2026-08-10" },
    sources: [{
      source: "alice", kind: "singles", fingerprint: "a".repeat(64),
      sampled: 400, reviewed: 381, successes: 381, failures: 0, excluded: 0,
      precision: 1, wilson_lower_95: 0.99002, reviews_remaining: 0,
      calibration_ready: true, canary_passed: true, eligible_revisions: 900, total_revisions: 1200,
      configured: true, enabled: true, identity_threshold: 0.99, per_run_cap: 5, daily_cap: 25,
    }],
    recent_runs: [],
  },
  sample: {
    sample_uid: "sample", sample_rank: 12, source_author_handle: "alice",
    candidate_kind: "singles", classifier_fingerprint: "a".repeat(64),
    candidate_id: 9, candidate_status: "pending",
    source_image_url: "https://images.test/source.jpg", source_tweet_url: "https://x.test/post",
    source_image_width: 1000, source_image_height: 500,
    frozen_effective_geometry: {
      card: { x0: 10, y0: 10, x1: 210, y1: 290 },
      price: { x0: 220, y0: 10, x1: 420, y1: 90 },
    },
    frozen_target_id: 42, frozen_grade_or_condition: "raw", frozen_price_jpy: 12000,
    frozen_identity_confidence: 0.99,
    price_evidence: { method: "currency_marker", verified: true },
    matched_name: "Pikachu", matched_meta: "SV · 001", matched_image_url: "https://images.test/card.jpg",
    current_label_uid: null,
  },
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("./use-query", () => ({
  useSupabaseQuery: (key: unknown) => ({
    data: Array.isArray(key) ? fixture.sample : fixture.status,
    error: undefined,
    isLoading: false,
    retry: vi.fn(),
  }),
  QueryError: () => null,
}));

afterEach(cleanup);

describe("image auto-accept operator board", () => {
  it("keeps calibration evidence and all actions touch-sized on a wrapping layout", async () => {
    const { container } = render(
      <LanguageProvider><ImageAutoAcceptView /></LanguageProvider>,
    );

    expect(await screen.findByText("Pikachu")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Detected item" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Detected price" })).toBeTruthy();
    for (const name of [
      "Enable automation", "Disable source", "Run capped canary",
      "Correct latest label",
      "Everything is correct", "Wrong price", "Wrong item", "Bad crop",
      "Number is not a price", "Cannot tell",
    ]) {
      expect(screen.getByRole("button", { name }).className).toContain("min-h-11");
    }
    expect(container.firstElementChild?.className).toContain("min-w-0");
    expect(screen.getByText("Source readiness").parentElement?.nextElementSibling?.className).toContain("grid");
    expect(screen.getByText("Is the complete proposed listing correct?").nextElementSibling?.className).toContain("grid-cols-1");
  });

  it("keeps global activation disabled until the exact source canary passes", () => {
    fixture.status.sources[0].canary_passed = false;
    try {
      render(<LanguageProvider><ImageAutoAcceptView /></LanguageProvider>);

      expect(screen.getByRole("button", { name: "Enable automation" }).hasAttribute("disabled")).toBe(true);
      expect(screen.getByText("Required")).toBeTruthy();
    } finally {
      fixture.status.sources[0].canary_passed = true;
    }
  });
});

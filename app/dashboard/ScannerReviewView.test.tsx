import { describe, expect, it } from "vitest";

import {
  canDecide,
  parkExplanation,
  rankedCandidates,
  type ScannerCapture,
} from "./ScannerReviewView";

const capture = (overrides: Partial<ScannerCapture> = {}): ScannerCapture => ({
  capture_id: "c1",
  ordinal: 1,
  front_object_key: "owner/aaa.jpg",
  back_object_key: "owner/bbb.jpg",
  candidates: [],
  proposed_card_uid: null,
  proposed_score: null,
  top_margin: null,
  park_reason: null,
  park_detail: null,
  decision: null,
  decided_card_uid: null,
  decided_condition_id: null,
  ...overrides,
});

describe("canDecide", () => {
  it("requires a condition, not just a card", () => {
    // The rule the whole screen rests on. Condition cannot be recovered from a
    // scan and decides which copies a listing covers, so a card alone is not
    // enough to commit.
    expect(canDecide("card-uid", null)).toBe(false);
  });

  it("requires a card, not just a condition", () => {
    expect(canDecide(null, 1)).toBe(false);
  });

  it("allows a decision once both are chosen", () => {
    expect(canDecide("card-uid", 1)).toBe(true);
  });

  it("treats an unchosen condition as unchosen even at id zero", () => {
    // A falsy id must not read as "chosen". Condition ids start at 1, so this
    // guards a select that returned an empty value rather than a real grade.
    expect(canDecide("card-uid", 0)).toBe(false);
  });
});

describe("rankedCandidates", () => {
  it("puts the strongest proposal first", () => {
    const ranked = rankedCandidates(
      capture({
        candidates: [
          { card_uid: "weak", score: 0.41 },
          { card_uid: "strong", score: 0.93 },
          { card_uid: "middling", score: 0.7 },
        ],
      }),
    );
    expect(ranked.map((c) => c.card_uid)).toEqual([
      "strong",
      "middling",
      "weak",
    ]);
  });

  it("keeps weak candidates rather than hiding them", () => {
    // A low score is a reason not to decide automatically, never a reason to
    // hide a card from someone who can recognise it on sight.
    const ranked = rankedCandidates(
      capture({ candidates: [{ card_uid: "faint", score: 0.11 }] }),
    );
    expect(ranked).toHaveLength(1);
  });

  it("does not mutate the capture it was given", () => {
    const original = capture({
      candidates: [
        { card_uid: "a", score: 0.1 },
        { card_uid: "b", score: 0.9 },
      ],
    });
    rankedCandidates(original);
    expect(original.candidates[0].card_uid).toBe("a");
  });

  it("survives a capture with no candidates", () => {
    expect(rankedCandidates(capture({ candidates: undefined as never }))).toEqual(
      [],
    );
  });
});

describe("parkExplanation", () => {
  const t = ((key: string) => key) as never;

  it("explains each park reason in its own terms", () => {
    // An enum shown to a reviewer says nothing about what to do next.
    expect(parkExplanation(capture({ park_reason: "no_candidates" }), t)).toBe(
      "scanner.parkNoCandidates",
    );
    expect(parkExplanation(capture({ park_reason: "below_min_score" }), t)).toBe(
      "scanner.parkWeak",
    );
    expect(parkExplanation(capture({ park_reason: "ambiguous" }), t)).toBe(
      "scanner.parkAmbiguous",
    );
    expect(
      parkExplanation(capture({ park_reason: "inventory_exhausted" }), t),
    ).toBe("scanner.parkExhausted");
  });

  it("falls back rather than rendering an unknown reason raw", () => {
    expect(parkExplanation(capture({ park_reason: "something_new" }), t)).toBe(
      "scanner.parkUnknown",
    );
    expect(parkExplanation(capture({ park_reason: null }), t)).toBe(
      "scanner.parkUnknown",
    );
  });
});

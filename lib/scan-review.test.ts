// Guards for the two things on the scan review screen that can be wrong while
// looking right: which band a capture lands in, and whether a proposal is still
// available once earlier decisions in the same batch have taken copies.
//
// The second is the interesting one. Quantity is a batch-level constraint, so
// confirming capture 3 can consume the last copy capture 47 was proposed. A
// screen that computes the remainder once and never again shows capture 47 as a
// comfortable high-confidence proposal that cannot actually be fulfilled.
import { describe, it, expect } from "vitest";
import {
  type ScanCapture,
  bandOf,
  batchProgress,
  claimKey,
  countClaims,
  flattenBands,
  groupByBand,
  isBatchComplete,
  isProposalContested,
  parseCandidates,
  remainingFor,
} from "./scan-review";

function capture(over: Partial<ScanCapture> = {}): ScanCapture {
  return {
    captureId: over.captureId ?? "c1",
    ordinal: over.ordinal ?? 1,
    frontObjectKey: over.frontObjectKey ?? "owner/aa.jpg",
    backObjectKey: over.backObjectKey ?? "owner/bb.jpg",
    mimeType: over.mimeType ?? "image/jpeg",
    candidates: over.candidates ?? [],
    proposedCardUid: over.proposedCardUid ?? null,
    proposedScore: over.proposedScore ?? null,
    topMargin: over.topMargin ?? null,
    parkReason: over.parkReason ?? null,
    parkDetail: over.parkDetail ?? null,
    decision: over.decision ?? null,
    decidedCardUid: over.decidedCardUid ?? null,
    decidedConditionId: over.decidedConditionId ?? null,
  };
}

describe("parseCandidates", () => {
  it("drops entries with no usable card identity", () => {
    const parsed = parseCandidates([
      { card_uid: "a", score: 0.4 },
      { card_uid: "", score: 0.9 },
      { score: 0.9 },
      null,
      "nonsense",
    ]);
    expect(parsed.map((c) => c.cardUid)).toEqual(["a"]);
  });

  it("re-sorts strongest first rather than trusting the stored order", () => {
    const parsed = parseCandidates([
      { card_uid: "weak", score: 0.2 },
      { card_uid: "strong", score: 0.97 },
      { card_uid: "mid", score: 0.5 },
    ]);
    expect(parsed.map((c) => c.cardUid)).toEqual(["strong", "mid", "weak"]);
  });

  it("treats a missing or non-finite score as zero, not as a high match", () => {
    const parsed = parseCandidates([{ card_uid: "a" }, { card_uid: "b", score: Number.NaN }]);
    expect(parsed.every((c) => c.score === 0)).toBe(true);
  });

  it("survives a non-array column", () => {
    expect(parseCandidates(null)).toEqual([]);
    expect(parseCandidates({})).toEqual([]);
  });
});

describe("bandOf", () => {
  it("puts a decided capture in the decided band whatever its score was", () => {
    const c = capture({ proposedScore: 0.99, proposedCardUid: "x", decision: "corrected", decidedCardUid: "y", decidedConditionId: 1 });
    expect(bandOf(c)).toBe("decided");
  });

  it("walks the confidence thresholds", () => {
    expect(bandOf(capture({ proposedCardUid: "x", proposedScore: 0.96 }))).toBe("high");
    expect(bandOf(capture({ proposedCardUid: "x", proposedScore: 0.95 }))).toBe("high");
    expect(bandOf(capture({ proposedCardUid: "x", proposedScore: 0.94 }))).toBe("medium");
    expect(bandOf(capture({ proposedCardUid: "x", proposedScore: 0.80 }))).toBe("medium");
    expect(bandOf(capture({ proposedCardUid: "x", proposedScore: 0.79 }))).toBe("low");
    expect(bandOf(capture({ proposedCardUid: "x", proposedScore: 0.45 }))).toBe("low");
  });

  it("parks anything with a park reason, a weak score, or no proposal at all", () => {
    expect(bandOf(capture({ proposedCardUid: "x", proposedScore: 0.44 }))).toBe("parked");
    expect(bandOf(capture({ parkReason: "no_candidates" }))).toBe("parked");
    expect(bandOf(capture({ proposedCardUid: "x", proposedScore: 0.99, parkReason: "inventory_exhausted" }))).toBe("parked");
    expect(bandOf(capture({ proposedCardUid: null, proposedScore: null }))).toBe("parked");
  });
});

describe("groupByBand", () => {
  it("orders every band by scan position, because that is the order of the box", () => {
    const grouped = groupByBand([
      capture({ captureId: "c9", ordinal: 9, proposedCardUid: "x", proposedScore: 0.99 }),
      capture({ captureId: "c2", ordinal: 2, proposedCardUid: "x", proposedScore: 0.99 }),
      capture({ captureId: "c5", ordinal: 5, proposedCardUid: "x", proposedScore: 0.99 }),
    ]);
    expect(grouped.high.map((c) => c.ordinal)).toEqual([2, 5, 9]);
  });

  it("flattens safe first and doubtful last", () => {
    const grouped = groupByBand([
      capture({ captureId: "parked", ordinal: 1, parkReason: "no_candidates" }),
      capture({ captureId: "high", ordinal: 2, proposedCardUid: "x", proposedScore: 0.99 }),
      capture({ captureId: "decided", ordinal: 3, decision: "confirmed", decidedCardUid: "x", decidedConditionId: 1 }),
    ]);
    expect(flattenBands(grouped).map((c) => c.captureId)).toEqual(["decided", "high", "parked"]);
  });
});

describe("claims and the batch-level quantity constraint", () => {
  it("counts one claim per decided capture in a listing group", () => {
    const claims = countClaims([
      capture({ captureId: "a", decision: "confirmed", decidedCardUid: "card", decidedConditionId: 1 }),
      capture({ captureId: "b", decision: "corrected", decidedCardUid: "card", decidedConditionId: 1 }),
      capture({ captureId: "c", decision: "confirmed", decidedCardUid: "card", decidedConditionId: 2 }),
      capture({ captureId: "d" }),
    ]);
    expect(claims.get(claimKey("card", 1))).toBe(2);
    expect(claims.get(claimKey("card", 2))).toBe(1);
  });

  it("separates the same card in different conditions", () => {
    const claims = countClaims([
      capture({ captureId: "a", decision: "confirmed", decidedCardUid: "card", decidedConditionId: 1 }),
    ]);
    expect(claims.get(claimKey("card", 2))).toBeUndefined();
  });

  it("re-derives rather than decrements, so an undo restores the count exactly", () => {
    const decided = [
      capture({ captureId: "a", decision: "confirmed", decidedCardUid: "card", decidedConditionId: 1 }),
      capture({ captureId: "b", decision: "confirmed", decidedCardUid: "card", decidedConditionId: 1 }),
    ];
    const afterUndo = [decided[0], capture({ captureId: "b" })];
    expect(countClaims(decided).get(claimKey("card", 1))).toBe(2);
    expect(countClaims(afterUndo).get(claimKey("card", 1))).toBe(1);
  });

  it("reports unknown remainder as null, never as zero", () => {
    // Zero would render as "exhausted" and block a decision we have no
    // evidence against. Not knowing is not the same as none left.
    expect(remainingFor("card", 1, new Map(), new Map())).toBeNull();
  });

  it("subtracts this batch's own claims from the reported quantity", () => {
    const availability = new Map([[claimKey("card", 1), 2]]);
    const claims = new Map([[claimKey("card", 1), 1]]);
    expect(remainingFor("card", 1, availability, claims)).toBe(1);
  });

  it("marks a proposal contested once the batch has spent the last copy", () => {
    const availability = new Map([[claimKey("card", 1), 1]]);
    const captures = [
      capture({ captureId: "first", ordinal: 1, decision: "confirmed", decidedCardUid: "card", decidedConditionId: 1 }),
      capture({ captureId: "later", ordinal: 47, proposedCardUid: "card", proposedScore: 0.99 }),
    ];
    const claims = countClaims(captures);
    expect(isProposalContested(captures[1], 1, availability, claims)).toBe(true);
  });

  it("leaves a proposal alone while copies remain", () => {
    const availability = new Map([[claimKey("card", 1), 3]]);
    const captures = [
      capture({ captureId: "first", ordinal: 1, decision: "confirmed", decidedCardUid: "card", decidedConditionId: 1 }),
      capture({ captureId: "later", ordinal: 47, proposedCardUid: "card", proposedScore: 0.99 }),
    ];
    expect(isProposalContested(captures[1], 1, availability, countClaims(captures))).toBe(false);
  });

  it("never calls an already-decided capture contested", () => {
    const availability = new Map([[claimKey("card", 1), 0]]);
    const decided = capture({ decision: "confirmed", decidedCardUid: "card", decidedConditionId: 1 });
    expect(isProposalContested(decided, 1, availability, countClaims([decided]))).toBe(false);
  });
});

describe("batchProgress", () => {
  it("tracks corrections apart from confirmations, since drift shows up there first", () => {
    const progress = batchProgress([
      capture({ captureId: "a", decision: "confirmed", decidedCardUid: "x", decidedConditionId: 1 }),
      capture({ captureId: "b", decision: "corrected", decidedCardUid: "y", decidedConditionId: 1 }),
      capture({ captureId: "c", decision: "corrected", decidedCardUid: "z", decidedConditionId: 1 }),
      capture({ captureId: "d", parkReason: "ambiguous" }),
    ]);
    expect(progress).toMatchObject({
      total: 4, decided: 3, confirmed: 1, corrected: 2, parked: 1, remaining: 1,
    });
    expect(progress.correctionRate).toBeCloseTo(2 / 3);
  });

  it("has no correction rate before the first decision", () => {
    expect(batchProgress([capture()]).correctionRate).toBeNull();
  });

  it("is complete only when every capture ended with a card", () => {
    const decided = capture({ decision: "confirmed", decidedCardUid: "x", decidedConditionId: 1 });
    expect(isBatchComplete([decided])).toBe(true);
    expect(isBatchComplete([decided, capture({ captureId: "open" })])).toBe(false);
    expect(isBatchComplete([])).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  exitEvidenceDetail,
  exitEvidenceMarkerKey,
  exitIsMeasured,
  isExitEvidence,
  MEASURED_EXIT_EVIDENCE,
} from "./exit-evidence";

describe("exitIsMeasured", () => {
  it("accepts a committed bid and a measured sale", () => {
    expect(exitIsMeasured("bid")).toBe(true);
    expect(exitIsMeasured("sale_measured")).toBe(true);
  });

  // The whole point of the column: an unmeasured sale is still the best figure
  // available for that card, but it is not grounds for a decision.
  it("rejects an unmeasured sale, an estimate and an unclassified row", () => {
    expect(exitIsMeasured("sale_unmeasured")).toBe(false);
    expect(exitIsMeasured("estimate")).toBe(false);
    expect(exitIsMeasured("unclassified")).toBe(false);
  });

  // Fails CLOSED. A null means aggregate-prices has not run since the column
  // was added, and a figure whose provenance was never computed must not be
  // presented as one that was.
  it("treats null and undefined as unmeasured", () => {
    expect(exitIsMeasured(null)).toBe(false);
    expect(exitIsMeasured(undefined)).toBe(false);
  });

  it("MEASURED_EXIT_EVIDENCE agrees with exitIsMeasured", () => {
    for (const value of MEASURED_EXIT_EVIDENCE) {
      expect(exitIsMeasured(value)).toBe(true);
    }
  });
});

describe("isExitEvidence", () => {
  it("guards the enum", () => {
    expect(isExitEvidence("sale_measured")).toBe(true);
    expect(isExitEvidence("sold")).toBe(false);
    expect(isExitEvidence(null)).toBe(false);
    expect(isExitEvidence(7)).toBe(false);
  });
});

describe("exitEvidenceMarkerKey", () => {
  // Only the unmeasured case is marked. A badge on 243,002 of 321,281 rows
  // saying "this one is fine" trains the eye to ignore badges.
  it("marks only an unmeasured sale", () => {
    expect(exitEvidenceMarkerKey("sale_unmeasured")).toBe("exitEvidence.unmeasured");
    expect(exitEvidenceMarkerKey("bid")).toBeNull();
    expect(exitEvidenceMarkerKey("sale_measured")).toBeNull();
    expect(exitEvidenceMarkerKey("estimate")).toBeNull();
    expect(exitEvidenceMarkerKey(null)).toBeNull();
  });
});

describe("exitEvidenceDetail", () => {
  it("names the last sale when there was one", () => {
    expect(exitEvidenceDetail("sale_unmeasured", "2026-10-09", 2)).toEqual({
      key: "exitEvidence.unmeasured.lastSold",
      params: { date: "2026-10-09", qty: 2 },
    });
  });

  // A missing date is a fact - nothing sold in the window - not an absence to
  // paper over.
  it("says nothing sold when there is no date", () => {
    expect(exitEvidenceDetail("sale_unmeasured", null, null)).toEqual({
      key: "exitEvidence.unmeasured.noSale",
    });
  });

  it("reports a zero quantity rather than dropping the date", () => {
    expect(exitEvidenceDetail("sale_unmeasured", "2026-10-01", null)).toEqual({
      key: "exitEvidence.unmeasured.lastSold",
      params: { date: "2026-10-01", qty: 0 },
    });
  });

  it("has nothing to add for a measured exit", () => {
    expect(exitEvidenceDetail("sale_measured", "2026-10-09", 40)).toBeNull();
    expect(exitEvidenceDetail("bid", null, null)).toBeNull();
  });
});

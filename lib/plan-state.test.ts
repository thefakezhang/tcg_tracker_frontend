import { describe, it, expect } from "vitest";
import { planState, planStateLabel } from "./plan-state";

describe("planState", () => {
  it("splits `ordered` into awaiting and buying", () => {
    // This is the whole point: the operator saw four plans all labelled
    // "ordered" and could not tell which one the buyer was working.
    expect(planState({ status: "ordered", recordedCount: 0 })).toBe("awaiting");
    expect(planState({ status: "ordered", recordedCount: 3 })).toBe("buying");
  });

  it("passes operator-set statuses through", () => {
    for (const s of ["draft", "ready", "reconciled", "cancelled"]) {
      expect(planState({ status: s })).toBe(s);
    }
  });

  it("treats a missing count as not started rather than guessing", () => {
    expect(planState({ status: "ordered", recordedCount: null })).toBe("awaiting");
    expect(planState({ status: "ordered" })).toBe("awaiting");
  });

  it("does not let an unknown status masquerade as a known one", () => {
    expect(planState({ status: "something_new" })).toBe("draft");
  });

  it("labels every state", () => {
    const seen = new Set<string>();
    for (const s of ["draft", "ready", "awaiting", "buying", "reconciled", "cancelled"] as const) {
      const label = planStateLabel(s);
      expect(label.length).toBeGreaterThan(0);
      seen.add(label);
    }
    expect(seen.size).toBe(6); // no two states share a label
  });
});

import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./dates";

describe("formatDate", () => {
  it("renders a DATE column string as a local date, never the previous UTC day", () => {
    // Regression guard for the classic new Date("YYYY-MM-DD") = UTC-midnight bug.
    expect(formatDate("2026-08-16", "en")).toBe("Aug 16, 2026");
    expect(formatDate("2026-08-16", "ja")).toBe("2026年8月16日");
  });
  it("accepts timestamps and Date objects", () => {
    const d = new Date(2026, 7, 16, 13, 5);
    expect(formatDate(d, "en")).toBe("Aug 16, 2026");
    expect(formatDate(d.toISOString(), "en")).toBe(formatDate(d, "en"));
  });
  it("is empty for null, empty and garbage", () => {
    expect(formatDate(null, "en")).toBe("");
    expect(formatDate("", "en")).toBe("");
    expect(formatDate("not a date", "en")).toBe("");
  });
});

describe("formatDateTime", () => {
  it("adds a short local time", () => {
    const d = new Date(2026, 7, 16, 13, 5);
    expect(formatDateTime(d, "en")).toMatch(/^Aug 16, 2026, 01:05 PM$/);
  });
});

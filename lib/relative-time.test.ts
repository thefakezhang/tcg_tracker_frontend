import { describe, expect, it } from "vitest";

import { relativeTime } from "./relative-time";

const NOW = Date.parse("2026-10-24T12:00:00+09:00");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("relativeTime", () => {
  it("picks the largest whole unit and uses the language's own words", () => {
    expect(relativeTime(ago(20 * 1000), NOW, "en-US")).toBe("now");
    expect(relativeTime(ago(30 * MINUTE), NOW, "en-US")).toBe("30 minutes ago");
    expect(relativeTime(ago(3 * HOUR - 500), NOW, "en-US")).toBe("3 hours ago");
    expect(relativeTime(ago(26 * HOUR), NOW, "en-US")).toBe("yesterday");
    expect(relativeTime(ago(3 * DAY), NOW, "en-US")).toBe("3 days ago");
    expect(relativeTime(ago(45 * DAY), NOW, "en-US")).toBe("2 months ago");
    expect(relativeTime(ago(400 * DAY), NOW, "en-US")).toBe("last year");
    expect(relativeTime(ago(3 * HOUR), NOW, "ja-JP")).toBe("3 時間前");
  });

  it("is null for an unreadable time", () => {
    expect(relativeTime("yesterday-ish", NOW, "en-US")).toBeNull();
  });
});

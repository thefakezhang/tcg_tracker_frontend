// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LanguageProvider } from "./LanguageContext";
import {
  parseRetiredSellCoverage,
  RetiredSellCoverageNotice,
} from "./SourceHealthView";

const validNotes = {
  collection_coverage: {
    sell: {
      status: "retired",
      reason: "storefront_access_gate_http_401_since_2026_08_11",
      last_good_at: "2026-08-10T14:30:00Z",
    },
  },
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("retired Sell source-health coverage", () => {
  it("accepts only the documented structured reason and timestamp", () => {
    expect(parseRetiredSellCoverage(validNotes)).toEqual({
      status: "retired",
      reason: "storefront_access_gate_http_401_since_2026_08_11",
      lastGoodAt: "2026-08-10T14:30:00Z",
    });
    expect(parseRetiredSellCoverage({
      collection_coverage: {
        sell: { ...validNotes.collection_coverage.sell, reason: "unknown_reason" },
      },
    })).toBeNull();
    expect(parseRetiredSellCoverage({
      collection_coverage: {
        sell: { ...validNotes.collection_coverage.sell, last_good_at: "not-a-date" },
      },
    })).toBeNull();
    expect(parseRetiredSellCoverage({
      collection_coverage: {
        sell: { ...validNotes.collection_coverage.sell, last_good_at: "2026-08-10" },
      },
    })).toBeNull();
    expect(parseRetiredSellCoverage({ collection_coverage: [] })).toBeNull();
  });

  it("renders the operator reason and historical timestamp in English", () => {
    render(
      <LanguageProvider defaultLanguage="en">
        <RetiredSellCoverageNotice notes={validNotes} />
      </LanguageProvider>,
    );

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("Sell retired")).toBeTruthy();
    expect(screen.getByText("The storefront access gate has returned HTTP 401 since Aug 11, 2026.")).toBeTruthy();
    expect(screen.getByText(/^Last good Sell:/).textContent).toContain("Aug 10, 2026");
  });

  it("renders the same operator evidence in Japanese", () => {
    render(
      <LanguageProvider defaultLanguage="ja">
        <RetiredSellCoverageNotice notes={validNotes} />
      </LanguageProvider>,
    );

    expect(screen.getByText("販売価格の収集を廃止")).toBeTruthy();
    expect(screen.getByText("ストアフロントのアクセスゲートは2026年8月11日以降HTTP 401を返しています。")).toBeTruthy();
    expect(screen.getByText(/^販売価格の最終正常更新:/).textContent).toContain("2026年8月10日");
  });

  it("leaves ordinary and malformed source rows unchanged", () => {
    const { rerender } = render(
      <LanguageProvider defaultLanguage="en">
        <RetiredSellCoverageNotice notes={{ listing_sides: { sell: { rows: 10 } } }} />
      </LanguageProvider>,
    );
    expect(screen.queryByRole("status")).toBeNull();

    rerender(
      <LanguageProvider defaultLanguage="en">
        <RetiredSellCoverageNotice notes={{
          collection_coverage: { sell: { status: "retired", reason: 401 } },
        }} />
      </LanguageProvider>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import SealedCurationView from "./SealedCurationView";

const mocks = vi.hoisted(() => ({
  queryKeys: [] as unknown[][],
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("./use-query", () => ({
  QueryError: () => null,
  useSupabaseQuery: (key: unknown[]) => {
    mocks.queryKeys.push(key);
    return {
      data: {
        rows: [],
        stats: { high_water: 0, total: 0, matched: 0, band_counts: {} },
        loadedAll: true,
      },
      error: undefined,
      isLoading: false,
      retry: vi.fn(),
    };
  },
}));

afterEach(() => {
  cleanup();
  mocks.queryKeys.length = 0;
  mocks.rpc.mockReset();
});

describe("sealed curation queue", () => {
  it("opens on pending because recognition writes new candidates there", () => {
    render(
      <LanguageProvider>
        <SealedCurationView />
      </LanguageProvider>,
    );

    expect(screen.getByRole("tab", { name: "Pending" }).hasAttribute("data-active")).toBe(true);
    expect(mocks.queryKeys.some((key) => key[0] === "sealed_curation" && key[1] === "pending")).toBe(true);
    expect(mocks.queryKeys.some((key) => key[0] === "sealed_curation" && key[1] === "needs_review")).toBe(false);
  });
});

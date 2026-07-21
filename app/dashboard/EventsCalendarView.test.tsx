// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EventsCalendarView from "./EventsCalendarView";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  retryEvents: vi.fn(),
  retryChanges: vi.fn(),
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("./LanguageContext", () => ({ useLanguage: () => ({ language: "en" }) }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      update: (payload: unknown) => {
        mocks.update(payload);
        return { eq: async (column: string, value: number) => { mocks.eq(column, value); return { error: null }; } };
      },
    }),
  }),
}));

vi.mock("./use-query", () => ({
  useSupabaseQuery: (key: string) => key === "market-events" ? {
    data: [{
      event_id: 8,
      starts_on: "2026-07-31",
      ends_on: null,
      kind: "set_release",
      scope: "set",
      scope_ref: "M6",
      card_ids: null,
      title: "Official M6 release",
      note: "",
      source_url: "https://www.pokemon-card.com/ex/m6/",
      confidence: "rumored",
      source_key: "fixture:m6",
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    }],
    error: null,
    isLoading: false,
    retry: mocks.retryEvents,
  } : {
    data: [{
      cohort: "set:SV2A",
      detected_on: "2026-07-15",
      direction: "down",
      magnitude: 18.5,
      model_version: "fixture-v1",
      event_id: null,
      event_title: null,
      event_kind: null,
      event_starts_on: null,
      event_ends_on: null,
      event_confidence: null,
      unexplained: true,
    }],
    error: null,
    isLoading: false,
    retry: mocks.retryChanges,
  },
  QueryError: () => null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventsCalendarView", () => {
  it("confirms a rumored feeder row and turns an unexplained break into a prefilled entry", async () => {
    render(<EventsCalendarView />);

    fireEvent.click(screen.getByRole("button", { name: "events.confirm" }));
    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ confidence: "confirmed" }));
      expect(mocks.eq).toHaveBeenCalledWith("event_id", 8);
    });

    fireEvent.click(screen.getByRole("button", { name: /events.explainBreak/ }));
    const starts = screen.getByLabelText("events.field.starts") as HTMLInputElement;
    const scope = screen.getByLabelText("events.field.scope") as HTMLSelectElement;
    const scopeRef = screen.getByLabelText("events.field.scopeRef") as HTMLInputElement;
    expect(starts.value).toBe("2026-07-15");
    expect(scope.value).toBe("set");
    expect(scopeRef.value).toBe("SV2A");
  }, 10_000);
});

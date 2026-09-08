// @vitest-environment jsdom
//
// The buying agent could not read the outcome list he was choosing from.
//
// The select is bg-transparent so the closed control reads as a grid cell, but
// the OPTION POPUP is drawn by the browser: with no color-scheme declared it
// painted a light list, while the option text inherited the page's near-white.
// White on white, 1.04:1, on the one control he touches for every single row.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

import BuyerOrderView from "./BuyerOrderView";

afterEach(cleanup);

const plan = {
  plan_id: 7, name: "trip", status: "ordered",
  line_count: 1, recorded_count: 0, finalized: false, handed_back: false,
};
const line = {
  plan_line_id: 1, source: "snkrdunk", source_listing_url: null,
  planned_quantity: 1, unit_price_orig: 1000, currency: "JPY",
  source_observed_at: "2026-09-06T00:00:00Z",
  card_name: "テストカード", card_english_name: "Test", set_code: "TST",
  card_number: "001/001", image_url: null,
  want_id: null, want_max: null, want_filled: null, want_ceiling: null,
  outcome: "pending", purchased_quantity: 0, unit_price_jpy: null,
  condition_seen: null, note: null,
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [plan], error: null });
    if (fn === "buyer_plan_lines") return Promise.resolve({ data: [line], error: null });
    return Promise.resolve({ data: [], error: null });
  });
});

describe("the outcome dropdown is readable", () => {
  it("paints its own options rather than trusting the browser's popup", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("snkrdunk");
    const select = document.querySelector<HTMLSelectElement>('[data-cell="1:outcome"]')!;
    for (const option of Array.from(select.options)) {
      expect(
        option.className,
        `option "${option.textContent}" has no background of its own, so it falls back to whatever the browser paints`,
      ).toMatch(/bg-popover/);
      expect(option.className).toMatch(/text-popover-foreground/);
    }
  });

  it("keeps the closed control transparent, so it still reads as a grid cell", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("snkrdunk");
    const select = document.querySelector<HTMLSelectElement>('[data-cell="1:outcome"]')!;
    expect(select.className).toMatch(/bg-transparent/);
  });
});

describe("native controls follow the theme", () => {
  // The systemic half. Without color-scheme the browser draws every widget it
  // owns in light mode - popups, scrollbars, carets, date pickers - under a
  // stylesheet that assumes dark.
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  it("declares a light scheme on the root", () => {
    expect(css).toMatch(/:root\s*\{[^}]*?color-scheme:\s*light/);
  });

  it("declares a dark scheme with the dark palette", () => {
    expect(css).toMatch(/\.dark\s*\{[^}]*?color-scheme:\s*dark/);
  });
});

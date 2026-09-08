// @vitest-environment jsdom
//
// The agent's screen with the REAL dictionary, not a translator stubbed to echo
// its keys. Every other buyer test mocks useTranslation, which is what let a
// missing LanguageProvider ship green once: the tests never rendered a real
// translation, so nothing noticed the context was absent.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

import { LanguageProvider } from "./LanguageContext";
import BuyerOrderView from "./BuyerOrderView";

afterEach(cleanup);

const plan = {
  plan_id: 7, name: "8月の遠征", status: "ordered",
  line_count: 1, recorded_count: 0, finalized: false,
};
const line = {
  plan_line_id: 1, source: "snkrdunk", source_listing_url: "https://snkrdunk.test/1",
  planned_quantity: 1, unit_price_orig: 30000, currency: "JPY",
  source_observed_at: "2026-09-06T00:00:00Z",
  card_name: "リザードン", card_english_name: "Charizard",
  set_code: "SV-P", card_number: "001/001", image_url: null,
  want_id: null, want_max: null, want_filled: null, want_ceiling: null,
  outcome: "purchased", purchased_quantity: 1, unit_price_jpy: 30000,
  condition_seen: null, note: null,
};
const totals = [{
  source: "snkrdunk", total_lines: 1, recorded_lines: 1, purchased_lines: 1,
  cards_bought: 1, card_value_jpy: 30000, shipping_jpy: 900,
  other_costs_jpy: 220, spent_total_jpy: 32120, agent_payout_jpy: 1000,
}];

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [plan], error: null });
    if (fn === "buyer_plan_lines") return Promise.resolve({ data: [line], error: null });
    if (fn === "buyer_source_totals") return Promise.resolve({ data: totals, error: null });
    if (fn === "buyer_source_costs") return Promise.resolve({
      data: [{ source: "snkrdunk", kind: "shipping", amount_jpy: 900, note: null },
             { source: "snkrdunk", kind: "payment_fee", amount_jpy: 220, note: null }],
      error: null,
    });
    return Promise.resolve({ data: [], error: null });
  });
});

const renderJa = () =>
  render(
    <LanguageProvider defaultLanguage="ja">
      <BuyerOrderView />
    </LanguageProvider>,
  );

describe("the agent's screen in Japanese", () => {
  it("renders Japanese, not translation keys", async () => {
    renderJa();
    await screen.findByText("snkrdunk");
    const text = document.body.textContent ?? "";
    // A missing or wrong key renders as "buyer.something" in the page.
    const leaked = text.match(/\b(buyer|common|purchasePlanner)\.[a-zA-Z.]+/g);
    expect(leaked, `untranslated keys on screen: ${leaked?.join(", ")}`).toBeNull();

    // And no hardcoded English sentence either. "price may be stale" shipped
    // as a bare literal and rendered untranslated on his Japanese screen; a key
    // check alone cannot see that, because there was no key.
    const stripped = text
      .replace(/snkrdunk|Charizard|SV-P/g, "")   // proper nouns stay as they are
      .replace(/[^\x00-\x7F]/g, "");            // drop everything non-ASCII
    const english = stripped.match(/[a-z]{3,}\s+[a-z]{2,}\s+[a-z]{2,}/g);
    expect(english, `hardcoded English on the Japanese screen: ${english?.join(" / ")}`).toBeNull();
  });

  it("shows him his money in Japanese and in yen", async () => {
    renderJa();
    await waitFor(() => expect(screen.getByText("この店での支出")).toBeTruthy());
    expect(screen.getByText("あなたの報酬")).toBeTruthy();
    // The plan-wide total says the same thing for a single-shop list, so both
    // the shop line and the total carry these figures.
    expect(screen.getByText("支出合計")).toBeTruthy();
    expect(screen.getAllByText("¥32,120").length).toBe(2);
    expect(screen.getAllByText("¥1,000").length).toBe(2);
    // Each cost he entered is named and carries its own figure, rather than
    // one lump he cannot take apart.
    expect(screen.getByRole("button", { name: /送料 ¥900/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /決済手数料 ¥220/ })).toBeTruthy();
    // And his fee is itemised: what the rows earned, and what the 3% came to.
    // Twice over on a single-shop list: once for the shop, once for the plan.
    expect(screen.getAllByText(/1行 ¥100/).length).toBe(2);
    expect(screen.getAllByText(/3% ¥900/).length).toBe(2);
  });

  it("puts no US dollar figure anywhere on his screen", async () => {
    renderJa();
    await screen.findByText("snkrdunk");
    const text = document.body.textContent ?? "";
    expect(text.match(/\$\s?[\d,]/g)).toBeNull();
    expect(text).not.toMatch(/\bUSD\b/);
  });
});

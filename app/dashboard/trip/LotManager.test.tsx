// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../LanguageContext";
import LotManager from "./LotManager";
import { fetchRoiLines } from "../theoretical-roi";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient("http://127.0.0.1:54321", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (...args) => mocks.fetch(...args) },
  });
  return { createClient: () => client };
});
vi.mock("../LotPickerContext", () => ({ useLotPicker: () => ({ refresh: mocks.refresh }) }));
vi.mock("./LotReceipts", () => ({ default: () => null }));
vi.mock("@/lib/use-fx-rate", () => ({ useFxRate: () => ({ rateFor: () => null }), fmtRate: String }));

const lots = [2, 1].map((id) => ({
  lot_id: id, leg: "import", acquired_at: "2026-01-01", shop_label: `Lot ${id === 1 ? "A" : "B"}`,
  orig_currency: "USD", total_cost_orig: id * 100, total_cost_usd: id * 100,
  fx_rate_used: 1, lines_imported: true,
}));
const line = (id: number) => ({
  line_id: id * 100, card_id: id * 100, condition_id: 1, psa_grade: 0, quantity: 2,
  price_override_usd: 10, direct_purchase_cost_usd: 20, acquisition_cost_alloc_usd: 0,
  allocated_cost_usd: 20, qty_remaining: 1,
});
const roi = (id: number) => ({
  line_key: `pokemon:${id * 100}`, lot_line_id: id * 100, lot_id: id, trip_id: 7,
  game: "pokemon", leg: "import", qty_on_hand: 1, priced: true, on_hand_cost_usd: 20,
  exit_net_usd: id * 1111, exit_unit_usd: id * 1111, theoretical_roi_pct: 10, net_pct: 1,
});
const cost = (id: number) => ({
  cost_id: id * 100, category: "shipping", custom_type: null, amount_orig: id * 11,
  amount_usd: id * 11, orig_currency: "USD", fx_rate_used: 1, note: `Cost ${id === 1 ? "A" : "B"}`,
});
const requests: { table: string; lotId: number | null; signal?: AbortSignal; offset: number; method: string }[] = [];
type HeldRead = { table: string; lotId: number | null; method: string; taken: boolean; promise: Promise<Response>; reply: (rows: unknown, status?: number) => void };
const held: HeldRead[] = [];
const response = (rows: unknown, status = 200) => new Response(JSON.stringify(rows), {
  status, headers: { "Content-Type": "application/json" },
});
function hold(table: string, lotId: number | null, method = "GET") {
  let resolve!: (value: Response) => void;
  const read: HeldRead = {
    table, lotId, method, taken: false, promise: new Promise((done) => { resolve = done; }),
    reply: (rows, status) => resolve(response(rows, status)),
  };
  held.push(read);
  return read;
}
function rowsFor(table: string, lotId: number | null, url: URL): unknown[] {
  if (table === "acquisition_lots") return lots;
  if (table === "conditions") return [{ condition_id: 1, code: "NM", display_name: "Near Mint" }];
  if (table === "pokemon_card_definitions") {
    const ids = url.searchParams.get("card_id") ?? "";
    return [1, 2, 9].filter((id) => ids.includes(String(id * 100))).map((id) => ({
      card_id: id * 100, regional_name: id === 9 ? "Obsolete card" : `Card ${id === 1 ? "A" : "B"}`,
      english_name: null, set_code: "TEST", card_number: String(id), image_url: null,
    }));
  }
  if (lotId == null) return [];
  if (table === "pokemon_lot_lines") return [line(lotId)];
  if (table === "inventory_theoretical_roi_v") return [roi(lotId)];
  if (table === "inventory_economics_v") return [{
    line_key: `pokemon:${lotId * 100}`, lot_line_id: lotId * 100, qty_sold: 1,
    lifecycle_status: "partially_sold", gross_usd: lotId * 3333, profit_usd: 10,
  }];
  if (table === "acquisition_costs") return [cost(lotId)];
  return [];
}

beforeEach(() => {
  requests.length = 0; held.length = 0;
  lots.sort((a, b) => b.lot_id - a.lot_id).forEach((lot) => { lot.lines_imported = true; });
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  mocks.fetch.mockReset().mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(input);
    const table = url.pathname.split("/").at(-1)!;
    const filter = url.searchParams.get("lot_id");
    const lotId = filter ? Number(filter.replace("eq.", "")) : null;
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const method = init?.method ?? "GET";
    requests.push({ table, lotId, signal: init?.signal ?? undefined, offset, method });
    const pending = held.find((read) => !read.taken && read.table === table && read.lotId === lotId && read.method === method && offset === 0);
    if (pending) {
      pending.taken = true;
      // Deliberately ignore abort: stale-result fencing must work even when a
      // transport has already delivered its response or cannot cancel it.
      return pending.promise;
    }
    return Promise.resolve(response(offset > 0 ? [] : rowsFor(table, lotId, url)));
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount() { return render(<LanguageProvider><LotManager tripId={7} leg="import" /></LanguageProvider>); }
async function selectLot(name: "A" | "B") {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^Lot ${name} USD`) }));
}
async function waitForB() {
  await screen.findByText("Card B");
  await screen.findByText("Cost B");
  await waitFor(() => expect(document.body.textContent).toContain("$2,222.00"));
}

describe("LotManager selection lifecycle", () => {
  it.each([
    ["pokemon_lot_lines", [line(9)]],
    ["inventory_theoretical_roi_v", [roi(1)]],
    ["inventory_economics_v", [{ line_key: "pokemon:100", qty_sold: 1, gross_usd: 3333, profit_usd: 10 }]],
    ["acquisition_costs", [cost(1)]],
  ])("does not publish an old %s response under the newly selected lot", async (table, rows) => {
    const old = hold(table as string, 1);
    mount();
    await waitFor(() => expect(old.taken).toBe(true));
    await selectLot("B");
    await waitForB();
    const oldReadCount = requests.filter((r) => r.lotId === 1).length;
    await act(async () => { old.reply(rows as unknown[]); });
    expect(requests.filter((r) => r.lotId === 1)).toHaveLength(oldReadCount);
    await waitFor(() => {
      expect(screen.queryByText("Obsolete card")).toBeNull();
      expect(screen.queryByText("Cost A")).toBeNull();
      expect(document.body.textContent).not.toContain("$1,111.00");
      expect(document.body.textContent).toContain("$6,666.00");
      expect(screen.queryByText("Card B")).not.toBeNull();
    });
    expect(requests.find((r) => r.table === table && r.lotId === 1)?.signal?.aborted).toBe(true);
  });

  it("distinguishes the first and second visit when selection goes A to B to A", async () => {
    const old = hold("pokemon_lot_lines", 1);
    mount();
    await waitFor(() => expect(old.taken).toBe(true));
    await selectLot("B");
    await waitForB();
    await selectLot("A");
    await screen.findByText("Card A");
    await act(async () => { old.reply([line(9)]); });
    expect(screen.queryByText("Obsolete card")).toBeNull();
    expect(screen.queryByText("Card A")).not.toBeNull();
  });

  it("aborts on close and does not start downstream work after a late response", async () => {
    const old = hold("pokemon_lot_lines", 1);
    const view = mount();
    await waitFor(() => expect(old.taken).toBe(true));
    view.unmount();
    const count = requests.length;
    await act(async () => { old.reply([line(1)]); });
    expect(requests).toHaveLength(count);
    expect(requests.find((r) => r.table === "pokemon_lot_lines" && r.lotId === 1)?.signal?.aborted).toBe(true);
  });

  it("clears the previous snapshot while the newly selected lot is loading", async () => {
    mount();
    await screen.findByText("Card A");
    const next = hold("pokemon_lot_lines", 2);
    await selectLot("B");
    await waitFor(() => expect(next.taken).toBe(true));
    expect(screen.queryByText("Card A")).toBeNull();
    expect(document.body.textContent).not.toContain("$1,111.00");
    expect(screen.queryByRole("status")).not.toBeNull();
    await act(async () => { next.reply([line(2)]); });
    await waitForB();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the current read failure inline and retries without an unhandled rejection", async () => {
    const failed = hold("pokemon_lot_lines", 1);
    mount();
    await waitFor(() => expect(failed.taken).toBe(true));
    await act(async () => { failed.reply({ message: "Current lot unavailable" }, 500); });
    expect((await screen.findByRole("alert")).textContent).toContain("Current lot unavailable");
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Card A");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([false, true])("does not publish or refetch an old cost mutation after switching lots (error=%s)", async (fails) => {
    lots.find((lot) => lot.lot_id === 1)!.lines_imported = false;
    mount();
    const note = await screen.findByDisplayValue("Cost A");
    const write = hold("acquisition_costs", null, "PATCH");
    fireEvent.blur(note, { target: { value: "Updated A" } });
    await waitFor(() => expect(write.taken).toBe(true));
    await selectLot("B");
    await waitForB();
    const oldReadCount = requests.filter((r) => r.lotId === 1).length;
    await act(async () => { write.reply(fails ? { message: "Old lot write error" } : null, fails ? 500 : 200); });
    expect(requests.filter((r) => r.lotId === 1)).toHaveLength(oldReadCount);
    expect(screen.queryByText("Cost A")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the current cost-only refresh cheap and preserves editable input values", async () => {
    lots.find((lot) => lot.lot_id === 1)!.lines_imported = false;
    mount();
    const note = await screen.findByDisplayValue("Cost A");
    await screen.findByText("Card A");
    const write = hold("acquisition_costs", null, "PATCH");
    const refresh = hold("acquisition_costs", 1);
    const lineReadCount = requests.filter((r) => r.table === "pokemon_lot_lines").length;
    fireEvent.change(note, { target: { value: "My edit" } });
    fireEvent.blur(note);
    await waitFor(() => expect(write.taken).toBe(true));
    await act(async () => { write.reply(null); });
    await waitFor(() => expect(refresh.taken).toBe(true));
    await act(async () => { refresh.reply([{ ...cost(1), amount_usd: 44 }]); });
    await waitFor(() => expect(document.body.textContent).toContain("$44.00"));
    expect(requests.filter((r) => r.table === "pokemon_lot_lines")).toHaveLength(lineReadCount);
    expect((note as HTMLInputElement).value).toBe("My edit");
  });


  it("does not let an obsolete error finish the current lot's loading state", async () => {
    const old = hold("pokemon_lot_lines", 1);
    mount();
    await waitFor(() => expect(old.taken).toBe(true));
    const current = hold("pokemon_lot_lines", 2);
    await selectLot("B");
    await waitFor(() => expect(current.taken).toBe(true));
    await act(async () => { old.reply({ message: "Obsolete read failure" }, 500); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).not.toBeNull();
    await act(async () => { current.reply([line(2)]); });
    await waitForB();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps only the latest same-lot cost refresh", async () => {
    lots.find((lot) => lot.lot_id === 1)!.lines_imported = false;
    mount();
    const note = await screen.findByDisplayValue("Cost A");
    await screen.findByText("Card A");
    const old = hold("acquisition_costs", 1);
    fireEvent.blur(note);
    await waitFor(() => expect(old.taken).toBe(true));
    fireEvent.blur(note);
    await waitFor(() => expect(requests.filter((r) => r.table === "acquisition_costs" && r.lotId === 1)).toHaveLength(3));
    await act(async () => { old.reply([{ ...cost(1), amount_usd: 9999 }]); });
    expect(document.body.textContent).not.toContain("$9,999.00");
    expect(requests.filter((r) => r.table === "acquisition_costs" && r.lotId === 1)[1].signal?.aborted).toBe(true);
  });

  it("does not revive a mutation callback from the first visit after A to B to A", async () => {
    lots.find((lot) => lot.lot_id === 1)!.lines_imported = false;
    mount();
    const note = await screen.findByDisplayValue("Cost A");
    const write = hold("acquisition_costs", null, "PATCH");
    fireEvent.blur(note);
    await waitFor(() => expect(write.taken).toBe(true));
    await selectLot("B");
    await waitForB();
    await selectLot("A");
    await screen.findByText("Card A");
    const readCount = requests.filter((r) => r.lotId === 1).length;
    await act(async () => { write.reply({ message: "First-visit mutation failed" }, 500); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(requests.filter((r) => r.lotId === 1)).toHaveLength(readCount);
  });

  it.each([false, true])("preserves add-cost payloads and resets only the originating selection's fields (switch=%s)", async (switchLot) => {
    lots.sort((a, b) => a.lot_id - b.lot_id).forEach((lot) => { lot.lines_imported = false; });
    mount();
    await screen.findByText("Card A");
    const write = hold("acquisition_costs", null, "POST");
    fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: "9" } });
    fireEvent.change(screen.getAllByPlaceholderText("Note").at(-1)!, { target: { value: "First A note" } });
    fireEvent.click(screen.getByRole("button", { name: "Add cost" }));
    await waitFor(() => expect(write.taken).toBe(true));
    const sent = mocks.fetch.mock.calls.find(([, init]) => init?.method === "POST")![1];
    expect(JSON.parse(sent.body)).toEqual({
      lot_id: 1, category: "shipping", custom_type: null, amount_orig: 9,
      orig_currency: "USD", fx_rate_used: 1, note: "First A note",
    });
    if (switchLot) {
      await selectLot("B");
      await screen.findByText("Card B");
      fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: "23" } });
      fireEvent.change(screen.getAllByPlaceholderText("Note").at(-1)!, { target: { value: "Current B note" } });
    }
    await act(async () => { write.reply(null); });
    expect((screen.getByPlaceholderText("Amount") as HTMLInputElement).value).toBe(switchLot ? "23" : "");
    expect((screen.getAllByPlaceholderText("Note").at(-1) as HTMLInputElement).value).toBe(switchLot ? "Current B note" : "");
  });

});

describe("optional ROI read cancellation", () => {
  it("does not start a request for an already aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchRoiLines({ lotId: 1 }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toHaveLength(0);
  });

  it("stops before the next page even if transport ignores abort", async () => {
    const pending = hold("inventory_theoretical_roi_v", 1);
    const controller = new AbortController();
    const read = fetchRoiLines({ lotId: 1 }, controller.signal);
    const rejected = expect(read).rejects.toMatchObject({ name: "AbortError" });
    await waitFor(() => expect(pending.taken).toBe(true));
    controller.abort();
    pending.reply([roi(1)]);
    await rejected;
    expect(requests).toHaveLength(1);
    expect(requests[0].signal).toBe(controller.signal);
  });
});

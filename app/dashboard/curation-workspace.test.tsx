// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { LanguageProvider } from "./LanguageContext";
import CurationView from "./CurationView";
import SealedCurationView from "./SealedCurationView";
import type { ImageGeometry } from "@/lib/image-curation-geometry";

type Row = Record<string, unknown>;
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks }));
// Exercise the queue's real correction payload; geometry interaction itself has
// its own component tests, so provide one deterministic crop edit here.
vi.mock("./ImageGeometryEditor", () => ({
  ImageGeometryEditor: ({ geometry, onChange }: { geometry: ImageGeometry; onChange: (value: ImageGeometry) => void }) =>
    <button onClick={() => onChange({ ...geometry, card: { ...geometry.card, x1: 25 } })}>Edit crop fixture</button>,
}));

const scenarios = [
  {
    kind: "singles", View: CurationView, initialStatus: "needs_review", activeTab: "Needs review",
    candidates: "pokemon_image_buylist_candidates", catalog: "pokemon_card_definitions", id: "card_id",
    candidateId: "candidate_card_id", condition: "card_grading", conditionLabel: "Grading", defaultCondition: "raw", editedCondition: "psa_10",
    matchParameter: "p_card_id", conditionParameter: "p_card_grading", searchLabel: "Change matched card",
    promote: "promote_image_buylist_candidate", correct: "correct_and_promote_image_buylist_candidate",
    reject: "reject_image_buylist_candidate", defer: "mark_image_buylist_candidate_needs_review",
    undo: "compensate_image_curation_decision", batch: "batch_accept_image_buylist_candidates",
  },
  {
    kind: "sealed", View: SealedCurationView, initialStatus: "pending", activeTab: "Pending",
    candidates: "pokemon_sealed_image_buylist_candidates", catalog: "pokemon_sealed_products", id: "product_id",
    candidateId: "candidate_product_id", condition: "sealed_condition", conditionLabel: "Condition", defaultCondition: "standard", editedCondition: "no_shrink",
    matchParameter: "p_product_id", conditionParameter: "p_sealed_condition", searchLabel: "Change matched product",
    promote: "promote_sealed_image_buylist_candidate", correct: "correct_and_promote_sealed_image_buylist_candidate",
    reject: "reject_sealed_image_buylist_candidate", defer: "mark_sealed_image_buylist_candidate_needs_review",
    undo: "compensate_sealed_image_curation_decision", batch: "batch_accept_sealed_image_buylist_candidates",
  },
] as const;

const queries: { table: string; columns: string; filters: [string, string, unknown][] }[] = [];
let tables: Record<string, Row[]>;
let undoOutcome = "completed";

class Query {
  record: (typeof queries)[number];
  ceiling = Infinity;
  constructor(readonly table: string) {
    if (!(table in tables)) throw new Error(`Unexpected table ${table}`);
    this.record = { table, columns: "", filters: [] };
    queries.push(this.record);
  }
  select(columns: string) { this.record.columns = columns; return this; }
  eq(field: string, value: unknown) { this.record.filters.push(["eq", field, value]); return this; }
  lte(field: string, value: number) { this.record.filters.push(["lte", field, value]); return this; }
  lt(field: string, value: number) { this.record.filters.push(["lt", field, value]); return this; }
  in(field: string, value: number[]) { this.record.filters.push(["in", field, value]); return this; }
  or(value: string) { this.record.filters.push(["or", "", value]); return this; }
  order() { return this; }
  limit(value: number) { this.ceiling = value; return this; }
  then(resolve: (value: { data: Row[]; error: null }) => unknown) {
    const data = tables[this.table].filter((row) => this.record.filters.every(([op, field, value]) => {
      if (op === "eq") return row[field] === value;
      if (op === "lte") return Number(row[field]) <= Number(value);
      if (op === "lt") return Number(row[field]) < Number(value);
      if (op === "in") return (value as unknown[]).includes(row[field]);
      return true;
    })).slice(0, this.ceiling);
    return Promise.resolve({ data, error: null }).then(resolve);
  }
}

beforeEach(() => {
  tables = {};
  queries.length = 0;
  undoOutcome = "completed";
  mocks.from.mockImplementation((table: string) => new Query(table));
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "image_curation_queue_stats") return { data: {
      high_water: 1234, total: 400, matched: 350, band_counts: {},
    }, error: null };
    if (name.startsWith("batch_accept_")) return { data: {
      mode: "snapshot_savepoint", request_id: "fixture",
      summary: { eligible: 2, processed: 2, succeeded: 1, failed: 1, truncated: false },
      results: [{ candidate_id: 30, success: true }, { candidate_id: 29, success: false, error_code: "conflict", error_message: "Needs review" }],
    }, error: null };
    return { data: { outcome: undoOutcome }, error: null };
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.rpc.mockReset();
  mocks.from.mockReset();
});

describe.each(scenarios)("$kind curation contract", (scenario) => {
  async function open() {
    const candidate = (id: number, status: string, matchedId: number, buyer: string): Row => ({
      candidate_id: id, status, [scenario.candidateId]: matchedId, [scenario.condition]: scenario.defaultCondition,
      source_author_handle: buyer, confidence: 0.99, ocr_price_jpy: 1200, curator_notes: null,
      source_image_url: "https://example.test/sheet.png", source_image_width: 100, source_image_height: 100,
      source_grid_bbox: { card: { x0: 0, y0: 0, x1: 20, y1: 30 }, price: null },
      price_evidence: { verified: true, method: "currency_marker", ocr_confidence: 0.99, banner: null },
      variant_attrs: { cell_label: "Printed language marker" },
    });
    tables[scenario.candidates] = [
      candidate(30, scenario.initialStatus, 7, "buyer_a"),
      candidate(29, scenario.initialStatus, 8, "buyer_b"),
      candidate(28, "auto_approved", 10, "buyer_a"),
    ];
    if (scenario.initialStatus !== "pending") tables[scenario.candidates].push(candidate(27, "pending", 7, "buyer_a"));
    tables[scenario.catalog] = [7, 8, 9, 10].map((id) => ({
      [scenario.id]: id, name: `JP ${id}`, regional_name: `JP ${id}`,
      english_name: id === 9 ? "Replacement" : id === 10 ? "Promoted" : `Match ${id}`,
      set_code: "S1", card_number: "001", edition: "first", foil_treatment: "mirror", misc_info: "UNKNOWN",
      product_type: "box", variant_edition: "1ed", image_url: null,
    }));
    tables.pokemon_external_identifiers = [];
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <LanguageProvider><scenario.View /></LanguageProvider>
    </SWRConfig>);
    await screen.findByText("Match 7");
  }

  it("reads the correct queue and catalog, preserving initial status and variant evidence", async () => {
    await open();
    expect(screen.getByRole("tab", { name: scenario.activeTab }).hasAttribute("data-active")).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("image_curation_queue_stats", {
      p_kind: scenario.kind, p_status: scenario.initialStatus, p_buyer: null,
    });
    const read = queries.find((query) => query.table === scenario.candidates)!;
    expect(read.columns).toContain(scenario.condition);
    expect(read.filters).toContainEqual(["lte", "candidate_id", 1234]);
    expect(queries.find((query) => query.table === scenario.catalog)?.filters).toContainEqual(["in", scenario.id, [7, 8]]);
    if (scenario.kind === "singles") {
      expect(screen.getAllByText("S1 001 · ミラー,1ED")).toHaveLength(2);
      expect(screen.getAllByText("Printed language marker")).toHaveLength(2);
    } else {
      expect(screen.getAllByText("S1 box · 1ed")).toHaveLength(2);
      expect(screen.queryByText("Printed language marker")).toBeNull();
    }
  });

  it("routes keyboard approve, reject, defer and undo to this kind and ignores typing", async () => {
    await open();
    fireEvent.keyDown(screen.getAllByLabelText("Notes")[0], { key: "y" });
    expect(mocks.rpc).not.toHaveBeenCalledWith(scenario.promote, expect.anything());
    fireEvent.keyDown(window, { key: "y" });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(scenario.promote, {
      p_candidate_id: 30, [scenario.matchParameter]: null, [scenario.conditionParameter]: null,
      p_price_jpy: null, p_curator_notes: null,
    }));
    await screen.findByRole("button", { name: "Undo last (Match 7)" });
    fireEvent.keyDown(window, { key: "u" });
    await screen.findByText("Reversed - listing and feedback rolled back");
    expect(mocks.rpc).toHaveBeenCalledWith(scenario.undo, { p_candidate_id: 30, p_request_id: expect.any(String) });
    fireEvent.keyDown(window, { key: "n" });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(scenario.reject, { p_candidate_id: 30, p_curator_notes: null }));
    fireEvent.click(screen.getByRole("tab", { name: "Pending" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("image_curation_queue_stats", {
      p_kind: scenario.kind, p_status: "pending", p_buyer: null,
    }));
    fireEvent.keyDown(window, { key: "d" });
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(scenario.defer, {
      p_candidate_id: scenario.kind === "singles" ? 27 : 30, p_curator_notes: null,
    }));
  });

  it("keeps whole-snapshot batch scope, buyer selection and per-row failure feedback", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "buyer_a · 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Accept price-verified (1 shown)" }));
    await screen.findByText("Completed 1 of 2; 1 failed.");
    expect(mocks.rpc).toHaveBeenCalledWith(scenario.batch, {
      p_snapshot_high_water: 1234, p_request_id: expect.any(String), p_status: scenario.initialStatus,
      p_buyer: "buyer_a", p_bands: null, p_max: 5000,
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve price-verified (1 shown)" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(scenario.batch, expect.objectContaining({ p_bands: ["high"] })));
  });

  it("preserves game-specific search, override condition, notes and geometry-correction arguments", async () => {
    await open();
    const card = within(screen.getByText("Match 7").closest("[data-candidate-idx]") as HTMLElement);
    fireEvent.click(card.getByRole("button", { name: "Correct false match" }));
    fireEvent.change(card.getByLabelText(scenario.searchLabel), { target: { value: "Replacement" } });
    fireEvent.click(await card.findByRole("button", { name: /^Replacement ·/ }));
    fireEvent.change(card.getByLabelText(scenario.conditionLabel), { target: { value: scenario.editedCondition } });
    fireEvent.change(card.getByLabelText("Price (¥)"), { target: { value: "2300" } });
    fireEvent.change(card.getByLabelText("Notes"), { target: { value: "  reviewed crop  " } });
    fireEvent.click(card.getByRole("button", { name: "Edit crop fixture" }));
    fireEvent.click(card.getByRole("button", { name: "Approve with fixes" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(scenario.correct, {
      p_candidate_id: 30, [scenario.matchParameter]: 9, [scenario.conditionParameter]: scenario.editedCondition,
      p_price_jpy: 2300, p_curator_notes: "reviewed crop",
      p_effective_geometry: { card: { x0: 0, y0: 0, x1: 25, y1: 30 }, price: null },
      p_natural_width: 100, p_natural_height: 100,
    }));
    if (scenario.kind === "singles") expect(queries.some((query) => query.table === "pokemon_external_identifiers")).toBe(true);
    else expect(queries.some((query) => query.table === "pokemon_external_identifiers")).toBe(false);
  });

  it("makes auto-approved rows reversal-only and reports compensation conflicts", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: "Auto-approved" }));
    await screen.findByText("Promoted");
    expect(screen.queryByRole("button", { name: "Mark correct" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept price-verified/ })).toBeNull();
    fireEvent.keyDown(window, { key: "y" });
    expect(mocks.rpc).not.toHaveBeenCalledWith(scenario.promote, expect.anything());
    undoOutcome = "conflicted";
    fireEvent.click(screen.getByRole("button", { name: "Reverse" }));
    await screen.findByText("Not reversed: a later change already moved this listing");
    expect(mocks.rpc).toHaveBeenCalledWith(scenario.undo, { p_candidate_id: 28, p_request_id: expect.any(String) });
  });
});

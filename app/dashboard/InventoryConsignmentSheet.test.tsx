// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import InventoryConsignmentSheet, { type ConsignmentRoiLine } from "./InventoryConsignmentSheet";

afterEach(cleanup);

function line(patch: Partial<ConsignmentRoiLine> = {}): ConsignmentRoiLine {
  return {
    line_key: "pokemon:1",
    lot_line_id: 1,
    lot_id: 42,
    trip_id: 7,
    leg: "import",
    game: "pokemon",
    item_type: "single",
    card_id: 5,
    product_id: null,
    condition_id: 2,
    psa_grade: null,
    sealed_condition: null,
    variant_edition: null,
    qty_on_hand: 5,
    on_hand_cost_usd: 75,
    exit_unit_usd: null,
    net_pct: null,
    exit_net_usd: null,
    theoretical_profit_usd: null,
    theoretical_roi_pct: null,
    days_held: null,
    annualized_roi_pct: null,
    below_cost: null,
    age_bucket: null,
    priced: false,
    consigned_qty: 2,
    consignee: null,
    consignment_sold_at: null,
    consignment_sale_usd: null,
    consignment_fee_usd: null,
    shop_label: "Tokyo Cards",
    acquired_at: "2026-08-01",
    ...patch,
  };
}

function renderSheet(onSave = vi.fn().mockResolvedValue(undefined)) {
  const inventoryLine = line();
  const onRecordSale = vi.fn().mockResolvedValue(undefined);
  const onClear = vi.fn().mockResolvedValue(undefined);
  render(
    <LanguageProvider>
      <InventoryConsignmentSheet
        open
        onOpenChange={vi.fn()}
        itemLabel="Charizard"
        itemMeta="SV3 134/108"
        owned={5}
        consigned={2}
        available={3}
        lines={[inventoryLine]}
        onSave={onSave}
        onRecordSale={onRecordSale}
        onClear={onClear}
      />
    </LanguageProvider>,
  );
  return { onSave, onRecordSale, onClear, inventoryLine };
}

describe("InventoryConsignmentSheet", () => {
  it("shows the holding and source-lot counts", () => {
    renderSheet();

    expect(screen.getByLabelText("Inventory summary").textContent).toContain("Owned5");
    expect(screen.getByLabelText("Inventory summary").textContent).toContain("Consigned2");
    expect(screen.getByLabelText("Inventory summary").textContent).toContain("Available3");
    expect(screen.getByLabelText("Lot #42 · line #1").textContent).toContain("Tokyo Cards");
    expect(screen.getByLabelText("Lot #42 · line #1").textContent).toContain("2026-08-01");
    expect(screen.getByLabelText("Lot #42 · line #1").textContent).toContain("Owned: 5");
    expect(screen.getByLabelText("Lot #42 · line #1").textContent).toContain("Consigned: 2");
    expect(screen.getByLabelText("Lot #42 · line #1").textContent).toContain("Available: 3");
  });

  it("blocks a quantity outside the on-hand range", () => {
    const { onSave } = renderSheet();
    fireEvent.change(screen.getByLabelText("On consignment for lot #42, line #1"), { target: { value: "6" } });

    expect(screen.getByText("Enter a whole number from 0 to 5.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves a valid integer with the original line", async () => {
    const { onSave, inventoryLine } = renderSheet();
    fireEvent.change(screen.getByLabelText("On consignment for lot #42, line #1"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(inventoryLine, 4, ""));
  });

  it("renders structured mutation errors as readable text", async () => {
    const onSave = vi.fn().mockRejectedValue({ code: "23514", message: "Quantity no longer available", details: "remaining=1" });
    renderSheet(onSave);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toContain("[23514] Quantity no longer available - remaining=1");
    expect(screen.getByRole("alert").textContent).not.toContain("[object Object]");
  });

  it("uses touch-sized controls on phones", () => {
    renderSheet();
    expect(screen.getByLabelText("On consignment for lot #42, line #1").className).toContain("min-h-11");
    expect(screen.getByRole("button", { name: "Save" }).className).toContain("min-h-11");
  });
});

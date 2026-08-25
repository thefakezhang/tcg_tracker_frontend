// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CriteriaAdd } from "./CustomersView";

const mocks = vi.hoisted(() => ({ insert: vi.fn(), onAdded: vi.fn() }));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "customer_wish_criteria") {
        return { insert: mocks.insert };
      }
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order"]) {
        builder[method] = vi.fn(() => builder);
      }
      builder.then = (resolve: (value: { data: unknown[] }) => unknown) =>
        Promise.resolve({ data: [] }).then(resolve);
      return builder;
    },
  }),
}));

afterEach(cleanup);
beforeEach(() => {
  mocks.insert.mockReset();
  mocks.onAdded.mockReset();
});

describe("customer Japanese exclusivity criterion", () => {
  it("offers every typed mode and persists stamps without a retired boolean", async () => {
    mocks.insert.mockResolvedValue({ error: null });
    render(<CriteriaAdd customerId={17} onAdded={mocks.onAdded} />);

    fireEvent.click(screen.getByRole("button", { name: "customers.criteriaAdd" }));
    const dialog = await screen.findByRole("dialog", { name: "customers.criteriaAdd" });
    expect(dialog.className).toContain("max-h-[calc(100dvh-2rem)]");
    expect(dialog.className).toContain("overflow-hidden");
    expect(screen.getByTestId("criteria-dialog-scroll-area").className).toContain("overflow-y-auto");
    expect(screen.getByTestId("criteria-dialog-footer").className).toContain("shrink-0");
    const select = await screen.findByLabelText("customers.japanExclusivity.label");
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      "", "artwork", "stamps", "either", "both",
    ]);
    expect(select.className).toContain("h-11");
    expect(screen.getByText("customers.japanExclusivity.hint")).toBeTruthy();

    fireEvent.change(select, { target: { value: "stamps" } });
    const cancel = screen.getByRole("button", { name: "common.cancel" });
    const save = screen.getByRole("button", { name: "common.save" });
    expect(cancel.className).toContain("min-h-11");
    expect(save.className).toContain("min-h-11");
    fireEvent.click(save);

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      customer_id: 17,
      japan_exclusivity_mode: "stamps",
    })));
    expect(mocks.insert).not.toHaveBeenCalledWith(expect.objectContaining({ is_japan_exclusive: expect.anything() }));
  });
});

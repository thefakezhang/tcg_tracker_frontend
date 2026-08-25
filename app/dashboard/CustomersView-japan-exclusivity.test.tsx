// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CriteriaAdd } from "./CustomersView";

const mocks = vi.hoisted(() => ({ insert: vi.fn(), onAdded: vi.fn() }));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.detail ? `${key}: ${String(params.detail)}` : key,
    language: "en",
  }),
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

  it("keeps rejected entries available and succeeds on retry", async () => {
    mocks.insert
      .mockResolvedValueOnce({
        error: {
          code: "23514",
          message: "criterion was rejected",
          hint: "Review the entered range",
        },
      })
      .mockResolvedValueOnce({ error: null });
    render(<CriteriaAdd customerId={17} onAdded={mocks.onAdded} />);

    fireEvent.click(screen.getByRole("button", { name: "customers.criteriaAdd" }));
    const dialog = await screen.findByRole("dialog", { name: "customers.criteriaAdd" });
    const label = screen.getByPlaceholderText("customers.criteriaLabelPlaceholder");
    const mode = await screen.findByLabelText("customers.japanExclusivity.label");
    fireEvent.change(label, { target: { value: "Prize cards" } });
    fireEvent.change(mode, { target: { value: "both" } });

    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("customers.criteriaSaveFailed");
    expect(alert.textContent).toContain("[23514] criterion was rejected - Review the entered range");
    expect(screen.getByRole("dialog", { name: "customers.criteriaAdd" })).toBe(dialog);
    expect(label).toHaveProperty("value", "Prize cards");
    expect(mode).toHaveProperty("value", "both");
    expect(mocks.onAdded).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "customers.criteriaAdd" })).toBeNull());
    expect(mocks.insert).toHaveBeenCalledTimes(2);
    expect(mocks.insert).toHaveBeenLastCalledWith(expect.objectContaining({
      customer_id: 17,
      label: "Prize cards",
      japan_exclusivity_mode: "both",
    }));
    expect(mocks.onAdded).toHaveBeenCalledTimes(1);
  });
});

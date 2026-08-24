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
  it("offers every typed mode and persists stamps without promoting the legacy boolean", async () => {
    mocks.insert.mockResolvedValue({ error: null });
    render(<CriteriaAdd customerId={17} onAdded={mocks.onAdded} />);

    fireEvent.click(screen.getByRole("button", { name: "customers.criteriaAdd" }));
    const select = await screen.findByLabelText("customers.japanExclusivity.label");
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      "", "artwork", "stamps", "either", "both", "legacy",
    ]);
    expect(select.className).toContain("h-11");
    expect(screen.getByText("customers.japanExclusivity.hint")).toBeTruthy();

    fireEvent.change(select, { target: { value: "stamps" } });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      customer_id: 17,
      japan_exclusivity_mode: "stamps",
      is_japan_exclusive: null,
    })));
  });

  it("writes the legacy compatibility boolean only for explicit legacy mode", async () => {
    mocks.insert.mockResolvedValue({ error: null });
    render(<CriteriaAdd customerId={23} onAdded={mocks.onAdded} />);
    fireEvent.click(screen.getByRole("button", { name: "customers.criteriaAdd" }));
    fireEvent.change(await screen.findByLabelText("customers.japanExclusivity.label"), {
      target: { value: "legacy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      customer_id: 23,
      japan_exclusivity_mode: "legacy",
      is_japan_exclusive: true,
    })));
  });
});

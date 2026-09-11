// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = [
  {
    key: "41:shrink:1ed",
    card: {
      card_id: "41",
      card_uid: "sealed-41-a",
      regional_name: "アルファボックス",
      english_name: "Alpha Box",
      set_code: "TST",
      card_number: null,
      misc_info: null,
      image_url: null,
    },
    prices: { highestBuy: null, lowestSell: null },
    roi: 0.2,
    productType: "booster_box",
    sealedCondition: "shrink",
    variantEdition: "1ed",
    language: "jp",
  },
  {
    key: "41:no_shrink:unlimited",
    card: {
      card_id: "41",
      card_uid: "sealed-41-b",
      regional_name: "アルファボックス",
      english_name: "Alpha Box",
      set_code: "TST",
      card_number: null,
      misc_info: null,
      image_url: null,
    },
    prices: { highestBuy: null, lowestSell: null },
    roi: 0.1,
    productType: "booster_box",
    sealedCondition: "no_shrink",
    variantEdition: "unlimited",
    language: "jp",
  },
];

let readinessState: "ready" | "unavailable" | "error" = "ready";
const retryReadiness = vi.fn();

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "cardBrowser.selectedCount") return `${params?.count} selected`;
      if (key === "cardBrowser.selectCard") return `Select ${params?.name}`;
      return key;
    },
  }),
}));
vi.mock("./LanguageContext", () => ({ useLanguage: () => ({ language: "en" }) }));
vi.mock("./HeaderContext", () => ({ useHeader: () => ({ setHeaderActions: vi.fn() }) }));
vi.mock("./use-sealed-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-sealed-data")>();
  return {
    ...actual,
    useSealedData: () => ({
      data: rows,
      loading: false,
      error: null,
      totalCount: 100,
      refresh: vi.fn(),
      refetch: vi.fn(),
    }),
  };
});
vi.mock("./owned-inventory", () => ({
  ownedInventoryKey: () => "key",
  useOwnedInventoryCounts: () => new Map(),
}));
vi.mock("./OwnedCountLine", () => ({ OwnedCountLine: () => null }));
vi.mock("./columns", () => ({
  createSealedColumns: () => [],
  createSelectColumn: () => ({}),
  PriceCell: () => null,
}));
vi.mock("./SealedDetailModal", () => ({
  default: ({ card, open }: { card: { key: string } | null; open: boolean }) =>
    open && card ? <div data-testid="sealed-detail">detail {card.key}</div> : null,
}));
vi.mock("./sealed-planning-readiness", () => ({
  useSealedPlanningReadiness: () => ({
    state: readinessState,
    error: readinessState === "error" ? new Error("offline") : undefined,
    retry: retryReadiness,
  }),
  SealedPlanningReadinessNotice: ({ state, retry, id }: { state: string; retry: () => void; id: string }) =>
    state === "ready" ? null : (
      <div id={id} role={state === "error" ? "alert" : "status"}>
        sealed planning {state}
        {state === "error" && <button type="button" onClick={retry}>Retry readiness</button>}
      </div>
    ),
}));
vi.mock("./AddToPlanAction", () => ({
  AddToPlanAction: ({ sealedProducts, disabled, disabledDescriptionId }: {
    sealedProducts: unknown[];
    disabled: boolean;
    disabledDescriptionId?: string;
  }) => (
    <div>
      <output data-testid="sealed-plan-items">{JSON.stringify(sealedProducts)}</output>
      <button type="button" disabled={disabled} aria-describedby={disabledDescriptionId}>Add to plan</button>
    </div>
  ),
}));
vi.mock("./data-table", () => ({
  DataTable: (props: {
    data: typeof rows;
    viewMode: "list" | "grid";
    getRowId: (row: (typeof rows)[number]) => string;
    rowSelection: Record<string, boolean>;
    onRowSelectionChange: (selection: Record<string, boolean>) => void;
    onRowClick: (row: (typeof rows)[number]) => void;
    renderGridItem: (
      row: (typeof rows)[number],
      selection: { selected: boolean; toggle: (value?: boolean) => void },
    ) => React.ReactNode;
    serverPagination: { onPageChange: (page: number) => void };
  }) => (
    <div>
      <div data-testid="view-mode">{props.viewMode}</div>
      {props.viewMode === "list"
        ? props.data.map((row) => {
            const id = props.getRowId(row);
            return (
              <div key={id}>
                <button
                  type="button"
                  aria-label={`Select list ${id}`}
                  onClick={() => props.onRowSelectionChange({
                    ...props.rowSelection,
                    [id]: !props.rowSelection[id],
                  })}
                >select</button>
                <button type="button" aria-label={`Open list ${id}`} onClick={() => props.onRowClick(row)}>open</button>
              </div>
            );
          })
        : props.data.map((row) => {
            const id = props.getRowId(row);
            return <div key={id}>{props.renderGridItem(row, {
              selected: !!props.rowSelection[id],
              toggle: (value) => props.onRowSelectionChange({
                ...props.rowSelection,
                [id]: value ?? !props.rowSelection[id],
              }),
            })}</div>;
          })}
      <button type="button" onClick={() => props.serverPagination.onPageChange(1)}>next fixture page</button>
    </div>
  ),
}));

import SealedBrowser from "./SealedBrowser";

afterEach(cleanup);

beforeEach(() => {
  readinessState = "ready";
  retryReadiness.mockReset();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});

describe("sealed browser purchase-plan selection", () => {
  it("gives the icon-only refresh action a localized accessible name", () => {
    render(<SealedBrowser />);

    expect(screen.getByRole("button", { name: "refresh.confirm" })).toBeTruthy();
  });

  it("keeps two exact variants of one product as separate selected items", async () => {
    render(<SealedBrowser />);
    fireEvent.click(screen.getByRole("button", { name: "Select list 41:shrink:1ed" }));
    fireEvent.click(screen.getByRole("button", { name: "Select list 41:no_shrink:unlimited" }));

    expect(await screen.findByText("2 selected")).toBeTruthy();
    const selected = JSON.parse(screen.getByTestId("sealed-plan-items").textContent ?? "[]");
    expect(selected).toEqual([
      { id: 41, name: "Alpha Box", sealedCondition: "shrink", variantEdition: "1ed" },
      { id: 41, name: "Alpha Box", sealedCondition: "no_shrink", variantEdition: "unlimited" },
    ]);
  });

  it("selects in grid mode without opening detail, while the tile remains keyboard-openable", async () => {
    render(<SealedBrowser />);
    fireEvent.click(screen.getByRole("tab", { name: "cardBrowser.grid" }));
    await waitFor(() => expect(screen.getByTestId("view-mode").textContent).toBe("grid"));

    fireEvent.click(screen.getAllByRole("checkbox", { name: "Select Alpha Box" })[0]);
    expect(await screen.findByText("1 selected")).toBeTruthy();
    expect(screen.queryByTestId("sealed-detail")).toBeNull();

    const tiles = screen.getAllByRole("button", { name: "Alpha Box" });
    fireEvent.keyDown(tiles[0], { key: "Enter" });
    expect((await screen.findByTestId("sealed-detail")).textContent).toContain("41:shrink:1ed");
  });

  it("clears selection when a filter or page changes", async () => {
    render(<SealedBrowser />);
    const selectFirst = () => screen.getByRole("button", { name: "Select list 41:shrink:1ed" });

    fireEvent.click(selectFirst());
    expect(await screen.findByText("1 selected")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("cardBrowser.namePlaceholder"), { target: { value: "alpha" } });
    await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());

    fireEvent.click(selectFirst());
    fireEvent.click(screen.getByText("next fixture page"));
    await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());

  });

  it("keeps browsing available but disables planning when the schema is missing", async () => {
    readinessState = "unavailable";
    render(<SealedBrowser />);

    expect(screen.getByRole("button", { name: "Open list 41:shrink:1ed" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("sealed planning unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Select list 41:shrink:1ed" }));

    const add = await screen.findByRole("button", { name: "Add to plan" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(add.getAttribute("aria-describedby")).toBe("sealed-planning-readiness");
  });

  it("surfaces readiness failures with retry while keeping planning disabled", async () => {
    readinessState = "error";
    render(<SealedBrowser />);
    fireEvent.click(screen.getByRole("button", { name: "Select list 41:shrink:1ed" }));

    expect((await screen.findByRole("button", { name: "Add to plan" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry readiness" }));
    expect(retryReadiness).toHaveBeenCalledOnce();
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "./data-table";

vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

interface ResultRow {
  id: string;
  name: string;
}

const columns: ColumnDef<ResultRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => row.original.name,
  },
];

afterEach(cleanup);

describe("DataTable actionable rows", () => {
  it("keeps pointer activation and adds focus, Enter, and Space activation", () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={[{ id: "1", name: "Iono" }]}
        sorting={[]}
        onSortingChange={vi.fn()}
        onRowClick={onRowClick}
        getRowAriaLabel={(row) => `Open ${row.name} details`}
      />,
    );

    const result = screen.getByRole("button", { name: "Open Iono details" });
    expect(result.getAttribute("tabindex")).toBe("0");

    fireEvent.click(result);
    fireEvent.keyDown(result, { key: "Enter" });
    fireEvent.keyDown(result, { key: " " });

    expect(onRowClick).toHaveBeenCalledTimes(3);
    expect(onRowClick).toHaveBeenNthCalledWith(1, { id: "1", name: "Iono" });
    expect(onRowClick).toHaveBeenNthCalledWith(2, { id: "1", name: "Iono" });
    expect(onRowClick).toHaveBeenNthCalledWith(3, { id: "1", name: "Iono" });
  });

  it("does not turn a nested control key press into row activation", () => {
    const onRowClick = vi.fn();
    const interactiveColumns: ColumnDef<ResultRow>[] = [
      {
        id: "action",
        header: "Action",
        cell: () => <button type="button">Watch</button>,
      },
    ];
    render(
      <DataTable
        columns={interactiveColumns}
        data={[{ id: "1", name: "Iono" }]}
        sorting={[]}
        onSortingChange={vi.fn()}
        onRowClick={onRowClick}
        getRowAriaLabel={(row) => `Open ${row.name} details`}
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Watch" }), { key: "Enter" });

    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe("DataTable grid selection", () => {
  // Grid mode used to receive only the row data, so a tile could not be
  // selected at all and every selection-driven action was list-only.
  function renderGrid(selection: Record<string, boolean>, onChange = vi.fn()) {
    render(
      <DataTable
        columns={columns}
        data={[
          { id: "1", name: "Iono" },
          { id: "2", name: "Bede" },
        ]}
        sorting={[]}
        onSortingChange={vi.fn()}
        viewMode="grid"
        getRowId={(row) => row.id}
        rowSelection={selection}
        onRowSelectionChange={onChange}
        renderGridItem={(row, sel) => (
          <div>
            <span>{row.name}</span>
            {sel && (
              <input
                type="checkbox"
                aria-label={`Select ${row.name}`}
                checked={sel.selected}
                onChange={(e) => sel.toggle(e.target.checked)}
              />
            )}
          </div>
        )}
      />,
    );
    return onChange;
  }

  it("gives every grid tile a working selection handle", () => {
    const onChange = renderGrid({});

    const box = screen.getByRole("checkbox", { name: "Select Bede" });
    expect((box as HTMLInputElement).checked).toBe(false);

    fireEvent.click(box);

    expect(onChange).toHaveBeenCalledWith({ "2": true });
  });

  it("reflects the selection the caller holds", () => {
    renderGrid({ "1": true });

    expect((screen.getByRole("checkbox", { name: "Select Iono" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Select Bede" }) as HTMLInputElement).checked).toBe(false);
  });

  it("offers the same select-all the table header has", () => {
    const onChange = renderGrid({});

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows on this page" }));

    expect(onChange).toHaveBeenCalledWith({ "1": true, "2": true });
  });

  it("shows select-all as indeterminate on a partial selection", () => {
    renderGrid({ "1": true });

    const all = screen.getByRole("checkbox", { name: "Select all rows on this page" }) as HTMLInputElement;
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(true);
  });

  it("omits selection entirely when the caller opts out", () => {
    render(
      <DataTable
        columns={columns}
        data={[{ id: "1", name: "Iono" }]}
        sorting={[]}
        onSortingChange={vi.fn()}
        viewMode="grid"
        renderGridItem={(row, sel) => <div>{row.name}{sel ? " selectable" : ""}</div>}
      />,
    );

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Iono")).toBeTruthy();
  });
});

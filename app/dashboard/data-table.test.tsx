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

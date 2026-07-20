"use client";

import React from "react";
import {
  ColumnDef,
  RowSelectionState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";

interface ServerPagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  columnVisibility?: VisibilityState;
  loading?: boolean;
  onRowClick?: (row: TData) => void;
  viewMode?: "list" | "grid";
  renderGridItem?: (row: TData) => React.ReactNode;
  serverPagination?: ServerPagination;
  // Optional row selection. Views that pass none behave exactly as before -
  // selection is off unless a caller opts in by supplying the handler.
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  getRowId?: (row: TData, index: number) => string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  loading,
  sorting,
  onSortingChange,
  columnVisibility,
  onRowClick,
  viewMode = "list",
  renderGridItem,
  serverPagination,
  rowSelection,
  onRowSelectionChange,
  getRowId,
}: DataTableProps<TData, TValue>) {
  const { t } = useTranslation();
  const table = useReactTable({
    data,
    columns,
    getRowId,
    enableRowSelection: !!onRowSelectionChange,
    onRowSelectionChange: onRowSelectionChange
      ? (updater) => {
          const next =
            typeof updater === "function" ? updater(rowSelection ?? {}) : updater;
          onRowSelectionChange(next);
        }
      : undefined,
    state: {
      sorting,
      columnVisibility,
      ...(rowSelection ? { rowSelection } : {}),
    },
    onSortingChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(sorting) : updater;
      onSortingChange(next);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualSorting: !!serverPagination,
    manualPagination: !!serverPagination,
  });

  const sp = serverPagination;

  return (
    <div>
      {viewMode === "grid" && renderGridItem ? (
        loading && table.getRowModel().rows.length === 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
                <Skeleton className="aspect-[2/3] w-full" />
                <div className="space-y-2 p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : table.getRowModel().rows.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {table.getRowModel().rows.map((row) => (
              <div key={row.id}>{renderGridItem(row.original)}</div>
            ))}
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            {t("dataTable.noResults")}
          </div>
        )
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta as
                      | { className?: string }
                      | undefined;
                    return (
                      <TableHead
                        key={header.id}
                        className={meta?.className}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading && table.getRowModel().rows.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {columns.map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={onRowClick ? "cursor-pointer" : undefined}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    {t("dataTable.noResults")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {sp && (
        <div className="flex items-center justify-between py-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t("dataTable.rowsPerPage")}</span>
            <select
              className="h-8 rounded-md border bg-background px-2 text-sm"
              value={sp.pageSize}
              onChange={(e) => sp.onPageSizeChange(Number(e.target.value))}
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t("dataTable.pageOf", { current: sp.page + 1, total: sp.totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sp.onPageChange(sp.page - 1)}
              disabled={sp.page <= 0}
            >
              {t("dataTable.previous")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sp.onPageChange(sp.page + 1)}
              disabled={sp.page >= sp.totalPages - 1}
            >
              {t("dataTable.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

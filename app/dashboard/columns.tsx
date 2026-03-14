"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { type CardRowData, type PriceSummary } from "./use-card-data";

function formatPriceWithDiff(
  primary: { price: number; symbol: string } | null,
  secondary: { price: number; symbol: string } | null
): string {
  if (!primary) return "\u2014";
  const base = `${primary.symbol}${primary.price}`;
  if (!secondary) return base;
  const diff = Math.abs(secondary.price - primary.price);
  const rounded = Math.round(diff * 100) / 100;
  return `${base} (${primary.symbol}${rounded})`;
}

function formatRoi(roi: number | null): string {
  if (roi === null) return "\u2014";
  return `${Math.round(roi * 100) / 100}%`;
}

function SortableHeader({
  column,
  label,
}: {
  column: { getIsSorted: () => false | "asc" | "desc"; toggleSorting: (desc?: boolean) => void };
  label: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      className="flex items-center gap-1 hover:text-foreground"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="h-4 w-4" />
      ) : sorted === "desc" ? (
        <ArrowDown className="h-4 w-4" />
      ) : (
        <ArrowUpDown className="h-4 w-4" />
      )}
    </button>
  );
}

function nullsLastNumber(
  rowA: { getValue: (id: string) => unknown },
  rowB: { getValue: (id: string) => unknown },
  columnId: string
): number {
  const a = rowA.getValue(columnId) as number | null;
  const b = rowB.getValue(columnId) as number | null;
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

export const columns: ColumnDef<CardRowData>[] = [
  {
    id: "regional_name",
    accessorFn: (row) => row.card.regional_name,
    header: ({ column }) => <SortableHeader column={column} label="Name" />,
    cell: ({ row }) => {
      const card = row.original.card;
      return (
        <>
          {card.regional_name}
          {card.misc_info ? ` (${card.misc_info})` : ""}
        </>
      );
    },
    size: 400,
    meta: { className: "w-[40%]" },
  },
  {
    id: "card_number",
    accessorFn: (row) => row.card.card_number,
    header: ({ column }) => (
      <SortableHeader column={column} label="Card Number" />
    ),
    cell: ({ getValue }) => (getValue() as string | null) ?? "\u2014",
  },
  {
    id: "set_code",
    accessorFn: (row) => row.card.set_code,
    header: ({ column }) => (
      <SortableHeader column={column} label="Set Code" />
    ),
  },
  {
    id: "psa_grade",
    accessorFn: (row) => row.psaGrade ?? null,
    header: ({ column }) => <SortableHeader column={column} label="PSA" />,
  },
  {
    id: "lowestBuy",
    accessorFn: (row) => row.prices.lowestBuy?.normalizedPrice ?? null,
    header: ({ column }) => (
      <SortableHeader column={column} label="Lowest Buy" />
    ),
    cell: ({ row }) => {
      const p = row.original.prices;
      return formatPriceWithDiff(p.lowestBuy, p.secondLowestBuy);
    },
    sortingFn: nullsLastNumber,
  },
  {
    id: "highestSell",
    accessorFn: (row) => row.prices.highestSell?.normalizedPrice ?? null,
    header: ({ column }) => (
      <SortableHeader column={column} label="Highest Sell" />
    ),
    cell: ({ row }) => {
      const p = row.original.prices;
      return formatPriceWithDiff(p.highestSell, p.secondHighestSell);
    },
    sortingFn: nullsLastNumber,
  },
  {
    id: "roi",
    accessorFn: (row) => row.roi,
    header: ({ column }) => <SortableHeader column={column} label="ROI" />,
    cell: ({ getValue }) => formatRoi(getValue() as number | null),
    sortingFn: nullsLastNumber,
  },
];

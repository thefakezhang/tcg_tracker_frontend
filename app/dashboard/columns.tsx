"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ArrowUp, ArrowDown } from "lucide-react";
import { type CardRowData, type PriceSummary } from "./use-card-data";

function formatPrice(entry: { price: number; symbol: string } | null): string {
  if (!entry) return "\u2014";
  return `${entry.symbol}${entry.price}`;
}

function PriceCell({
  primary,
  secondary,
}: {
  primary: { price: number; symbol: string } | null;
  secondary: { price: number; symbol: string } | null;
}) {
  return (
    <div>
      <div>{formatPrice(primary)}</div>
      {secondary && (
        <div className="text-xs text-muted-foreground">{formatPrice(secondary)}</div>
      )}
    </div>
  );
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
      className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="h-4 w-4" />
      ) : sorted === "desc" ? (
        <ArrowDown className="h-4 w-4" />
      ) : null}
    </button>
  );
}

function nullsLastNumber(
  rowA: { getValue: (id: string) => unknown },
  rowB: { getValue: (id: string) => unknown },
  columnId: string
): number {
  const a = rowA.getValue(columnId) as number | undefined;
  const b = rowB.getValue(columnId) as number | undefined;
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

type TranslateFn = (key: import("@/lib/i18n").TranslationKey) => string;

export function createColumns(t: TranslateFn): ColumnDef<CardRowData>[] {
  return [
    {
      id: "regional_name",
      accessorFn: (row) => row.card.regional_name,
      header: ({ column }) => <SortableHeader column={column} label={t("column.name")} />,
      cell: ({ row }) => {
        const card = row.original.card;
        const misc = card.misc_info && card.misc_info !== "UNKNOWN" ? card.misc_info : null;
        return (
          <div>
            <div>{card.regional_name}</div>
            {misc && <div className="text-xs text-muted-foreground">{misc}</div>}
          </div>
        );
      },
      size: 400,
      meta: { className: "w-[40%]" },
    },
    {
      id: "card_number",
      accessorFn: (row) => row.card.card_number,
      header: ({ column }) => (
        <SortableHeader column={column} label={t("column.cardNumber")} />
      ),
      cell: ({ getValue }) => (getValue() as string | null) ?? "\u2014",
    },
    {
      id: "set_code",
      accessorFn: (row) => row.card.set_code,
      header: ({ column }) => (
        <SortableHeader column={column} label={t("column.setCode")} />
      ),
    },
    {
      id: "psa_grade",
      accessorFn: (row) => row.psaGrade ?? null,
      header: ({ column }) => <SortableHeader column={column} label={t("column.psa")} />,
    },
    {
      id: "lowestBuy",
      accessorFn: (row) => row.prices.lowestBuy?.normalizedPrice ?? undefined,
      header: ({ column }) => (
        <SortableHeader column={column} label={t("column.lowestBuy")} />
      ),
      cell: ({ row }) => {
        const p = row.original.prices;
        return <PriceCell primary={p.lowestBuy} secondary={p.secondLowestBuy} />;
      },
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
    },
    {
      id: "highestSell",
      accessorFn: (row) => row.prices.highestSell?.normalizedPrice ?? undefined,
      header: ({ column }) => (
        <SortableHeader column={column} label={t("column.highestSell")} />
      ),
      cell: ({ row }) => {
        const p = row.original.prices;
        return <PriceCell primary={p.highestSell} secondary={p.secondHighestSell} />;
      },
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
    },
    {
      id: "roi",
      accessorFn: (row) => row.roi ?? undefined,
      header: ({ column }) => <SortableHeader column={column} label={t("column.roi")} />,
      cell: ({ getValue }) => formatRoi((getValue() as number | undefined) ?? null),
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
    },
  ];
}

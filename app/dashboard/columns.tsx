"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { type CardRowData, type PriceEntry } from "./use-card-data";
import { useCurrency } from "./CurrencyContext";

export function PriceCell({ entry, align = "left", badgeVariant = "secondary" }: { entry: PriceEntry | null; align?: "left" | "right"; badgeVariant?: "secondary" | "outline" }) {
  const { displayCurrency, convertPrice } = useCurrency();
  if (!entry) return <span>{"\u2014"}</span>;

  let symbol = entry.symbol;
  let price = entry.price;
  if (displayCurrency !== "none") {
    const converted = convertPrice(entry.price, entry.currencyCode);
    symbol = converted.symbol;
    price = converted.price;
  }

  return (
    <div>
      <div>{symbol}{price}</div>
      {entry.locationName && (
        <div className={`flex items-center gap-1 text-xs text-muted-foreground ${align === "right" ? "justify-end" : ""}`}>
          <span>{entry.locationName}</span>
          {entry.marketRegion && (
            <Badge variant={badgeVariant} className="h-auto px-1 py-px text-[10px]">
              {entry.marketRegion}
            </Badge>
          )}
        </div>
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

export function createColumns(t: TranslateFn, showSecond = false): ColumnDef<CardRowData>[] {
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
      accessorFn: (row) => {
        const v = row.card.card_number;
        return v && v !== "UNKNOWN" ? v : null;
      },
      header: ({ column }) => (
        <SortableHeader column={column} label={t("column.cardNumber")} />
      ),
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        return v && v !== "UNKNOWN" ? v : "\u2014";
      },
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
      id: "highestBuy",
      accessorFn: (row) => {
        const p = showSecond ? row.prices.secondHighestBuy : row.prices.highestBuy;
        return p?.normalizedPrice ?? undefined;
      },
      header: ({ column }) => (
        <SortableHeader column={column} label={t("column.highestBuy")} />
      ),
      cell: ({ row }) => {
        const p = showSecond ? row.original.prices.secondHighestBuy : row.original.prices.highestBuy;
        return <PriceCell entry={p} />;
      },
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
    },
    {
      id: "lowestSell",
      accessorFn: (row) => {
        const p = showSecond ? row.prices.secondLowestSell : row.prices.lowestSell;
        return p?.normalizedPrice ?? undefined;
      },
      header: ({ column }) => (
        <SortableHeader column={column} label={t("column.lowestSell")} />
      ),
      cell: ({ row }) => {
        const p = showSecond ? row.original.prices.secondLowestSell : row.original.prices.lowestSell;
        return <PriceCell entry={p} />;
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

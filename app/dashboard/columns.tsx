"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { type CardRowData, type PriceEntry, getCardDisplayName } from "./use-card-data";
import { conditionLabel, editionLabel, productTypeLabel } from "./use-sealed-data";
import { useCurrency } from "./CurrencyContext";
import { type Language } from "./LanguageContext";
import { useExitBasis } from "./ExitBasisContext";
import { exitValue } from "./grade-signals";
import { useTranslation } from "@/lib/i18n";

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
          <span className="truncate">{entry.locationName}</span>
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

export function ConservativeExitCell({ row }: { row: CardRowData }) {
  const { t } = useTranslation();
  const { exitPercentile } = useExitBasis();
  const signal = row.signal;
  const value = exitValue(signal, exitPercentile);
  if (!signal || value == null) return <span className="text-muted-foreground">-</span>;
  const flags = [
    signal.flags.thin_evidence ? t("evidence.thinShort") : null,
    signal.flags.cohort_derived ? t("evidence.cohortShort") : null,
    signal.flags.inversion_derived ? t("evidence.inversionShort") : null,
  ].filter(Boolean);
  return (
    <div className="min-w-28">
      <div className="font-medium tabular-nums">¥{Math.round(value).toLocaleString()}</div>
      <div className="text-[10px] text-muted-foreground">
        P{exitPercentile} · {t("evidence.compCountShort", { recent: signal.compCountRecent ?? 0, lifetime: signal.compCountLifetime ?? 0 })}
      </div>
      <div className="text-[10px] capitalize text-muted-foreground">
        {signal.tier?.replaceAll("_", " ") ?? t("evidence.unknownSource")}{flags.length ? ` · ${flags.join(", ")}` : ""}
      </div>
    </div>
  );
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

/**
 * Checkbox column for multi-select (redesign R6). Views opt in by prepending it
 * to their column list; views that don't are unaffected.
 * Clicks are stopped from bubbling so ticking a row never opens the detail modal.
 */
export const selectColumn: ColumnDef<CardRowData> = {
  id: "select",
  enableSorting: false,
  size: 32,
  header: ({ table }) => (
    <input
      type="checkbox"
      aria-label="Select all rows on this page"
      className="size-3.5 cursor-pointer align-middle"
      checked={table.getIsAllPageRowsSelected()}
      ref={(el) => {
        if (el) {
          el.indeterminate =
            table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected();
        }
      }}
      onChange={(e) => table.toggleAllPageRowsSelected(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
    />
  ),
  cell: ({ row }) => (
    <input
      type="checkbox"
      aria-label="Select row"
      className="size-3.5 cursor-pointer align-middle"
      checked={row.getIsSelected()}
      onChange={(e) => row.toggleSelected(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
    />
  ),
};

export function createColumns(t: TranslateFn, language: Language = "en"): ColumnDef<CardRowData>[] {
  return [
    {
      id: "regional_name",
      accessorFn: (row) => getCardDisplayName(row.card, language),
      header: ({ column }) => <SortableHeader column={column} label={t("column.name")} />,
      cell: ({ row }) => {
        const card = row.original.card;
        const misc = card.misc_info && card.misc_info !== "UNKNOWN" ? card.misc_info : null;
        return (
          <div>
            <div>{getCardDisplayName(card, language)}</div>
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
      id: "rarity",
      accessorFn: (row) => row.card.rarity ?? null,
      header: () => t("column.rarity"),
      cell: ({ getValue }) => (getValue() as string | null) ?? "—",
    },
    {
      id: "psa_grade",
      accessorFn: (row) => row.psaGrade ?? null,
      header: ({ column }) => <SortableHeader column={column} label={t("column.psa")} />,
    },
    {
      id: "lowestSell",
      accessorFn: (row) => row.prices.lowestSell?.normalizedPrice ?? undefined,
      header: ({ column }) => (
        <SortableHeader column={column} label={t("column.lowestSell")} />
      ),
      cell: ({ row }) => <PriceCell entry={row.original.prices.lowestSell} />,
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
    },
    {
      id: "highestBuy",
      accessorFn: (row) => row.prices.highestBuy?.normalizedPrice ?? undefined,
      header: ({ column }) => (
        <SortableHeader column={column} label={t("column.highestBuy")} />
      ),
      cell: ({ row }) => <PriceCell entry={row.original.prices.highestBuy} />,
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
    {
      id: "conservativeExit",
      accessorFn: (row) => row.signal?.bandP25 ?? undefined,
      header: ({ column }) => <SortableHeader column={column} label={t("column.conservativeExit")} />,
      cell: ({ row }) => <ConservativeExitCell row={row.original} />,
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
    },
  ];
}

// Foil display for MTG: STANDARD prints show Foil/Non-foil (from is_foil); any
// special foil treatment shows its raw foil_type value (e.g. サージ, エッチング).
function mtgFoilLabel(card: CardRowData["card"], t: TranslateFn): string {
  const ft = card.foil_type;
  if (!ft) return "—";
  if (ft === "STANDARD") return card.is_foil ? t("foil.foil") : t("foil.nonFoil");
  return ft;
}

// MTG-specific browse columns: Name, Set, Card Number, Foil Type, Language, then
// the price columns. No PSA column (MTG cards aren't PSA-graded).
export function createMtgColumns(
  t: TranslateFn,
  language: Language = "en",
): ColumnDef<CardRowData>[] {
  return [
    {
      id: "regional_name",
      accessorFn: (row) => getCardDisplayName(row.card, language),
      header: ({ column }) => <SortableHeader column={column} label={t("column.name")} />,
      cell: ({ row }) => {
        const card = row.original.card;
        const misc = card.misc_info && card.misc_info !== "UNKNOWN" ? card.misc_info : null;
        return (
          <div>
            <div>{getCardDisplayName(card, language)}</div>
            {misc && <div className="text-xs text-muted-foreground">{misc}</div>}
          </div>
        );
      },
      size: 400,
      meta: { className: "w-[40%]" },
    },
    {
      id: "set_code",
      accessorFn: (row) => row.card.set_code,
      header: ({ column }) => <SortableHeader column={column} label={t("column.setCode")} />,
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
        return v && v !== "UNKNOWN" ? v : "—";
      },
    },
    {
      id: "foil_type",
      accessorFn: (row) => row.card.foil_type ?? null,
      header: ({ column }) => <SortableHeader column={column} label={t("column.foilType")} />,
      cell: ({ row }) => mtgFoilLabel(row.original.card, t),
    },
    {
      id: "language",
      accessorFn: (row) => row.card.language ?? null,
      header: ({ column }) => <SortableHeader column={column} label={t("column.language")} />,
      cell: ({ getValue }) => (getValue() as string | null) ?? "—",
    },
    {
      id: "lowestSell",
      accessorFn: (row) => row.prices.lowestSell?.normalizedPrice ?? undefined,
      header: ({ column }) => (
        <SortableHeader column={column} label={t("column.lowestSell")} />
      ),
      cell: ({ row }) => <PriceCell entry={row.original.prices.lowestSell} />,
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
    },
    {
      id: "highestBuy",
      accessorFn: (row) => row.prices.highestBuy?.normalizedPrice ?? undefined,
      header: ({ column }) => (
        <SortableHeader column={column} label={t("column.highestBuy")} />
      ),
      cell: ({ row }) => <PriceCell entry={row.original.prices.highestBuy} />,
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

export function TargetPriceCell({ value }: { value: number | null }) {
  const { displayCurrency, convertPrice } = useCurrency();
  if (value == null) return <span>{"\u2014"}</span>;
  if (displayCurrency !== "none") {
    const converted = convertPrice(value, "USD");
    return <span>{converted.symbol}{converted.price}</span>;
  }
  return <span>${value.toFixed(2)}</span>;
}

type SealedExtras = {
  productType?: string;
  sealedCondition?: string;
  variantEdition?: string;
};

export function createSealedColumns(
  t: TranslateFn,
  language: Language = "en"
): ColumnDef<CardRowData>[] {
  return [
    {
      id: "regional_name",
      accessorFn: (row) => getCardDisplayName(row.card, language),
      header: ({ column }) => <SortableHeader column={column} label={t("column.name")} />,
      cell: ({ row }) => {
        const card = row.original.card;
        const misc = card.misc_info && card.misc_info !== "UNKNOWN" ? card.misc_info : null;
        return (
          <div>
            <div>{getCardDisplayName(card, language)}</div>
            {misc && <div className="text-xs text-muted-foreground">{misc}</div>}
          </div>
        );
      },
      size: 400,
      meta: { className: "w-[40%]" },
    },
    {
      id: "productType",
      accessorFn: (row) => (row as CardRowData & SealedExtras).productType ?? null,
      header: ({ column }) => <SortableHeader column={column} label={t("column.productType")} />,
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        return v ? productTypeLabel(t, v) : "—";
      },
    },
    {
      id: "edition",
      accessorFn: (row) => (row as CardRowData & SealedExtras).variantEdition ?? null,
      header: ({ column }) => <SortableHeader column={column} label={t("column.edition")} />,
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        return v ? editionLabel(t, v) : "—";
      },
    },
    {
      id: "condition",
      accessorFn: (row) => (row as CardRowData & SealedExtras).sealedCondition ?? null,
      header: ({ column }) => <SortableHeader column={column} label={t("column.condition")} />,
      cell: ({ getValue }) => {
        const v = getValue() as string | null;
        return v ? conditionLabel(t, v) : "—";
      },
    },
    {
      id: "set_code",
      accessorFn: (row) => {
        const v = row.card.set_code;
        return v && v !== "UNKNOWN" ? v : null;
      },
      header: ({ column }) => <SortableHeader column={column} label={t("column.setCode")} />,
      cell: ({ getValue }) => (getValue() as string | null) ?? "—",
    },
    {
      id: "lowestSell",
      accessorFn: (row) => row.prices.lowestSell?.normalizedPrice ?? undefined,
      header: ({ column }) => <SortableHeader column={column} label={t("column.lowestSell")} />,
      cell: ({ row }) => <PriceCell entry={row.original.prices.lowestSell} />,
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
    },
    {
      id: "highestBuy",
      accessorFn: (row) => row.prices.highestBuy?.normalizedPrice ?? undefined,
      header: ({ column }) => <SortableHeader column={column} label={t("column.highestBuy")} />,
      cell: ({ row }) => <PriceCell entry={row.original.prices.highestBuy} />,
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

export function createBuylistColumns(t: TranslateFn, language: Language = "en"): ColumnDef<CardRowData>[] {
  return [
    ...createColumns(t, language),
    {
      id: "targetPrice",
      accessorFn: (row) => (row as CardRowData & { targetPriceUsd?: number | null }).targetPriceUsd ?? undefined,
      header: ({ column }) => <SortableHeader column={column} label={t("column.targetPrice")} />,
      cell: ({ getValue }) => <TargetPriceCell value={(getValue() as number | undefined) ?? null} />,
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
    },
  ];
}

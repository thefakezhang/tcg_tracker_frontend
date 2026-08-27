"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { type CardRowData, type PriceEntry, getCardDisplayName } from "./use-card-data";
import { conditionLabel, editionLabel, productTypeLabel } from "./use-sealed-data";
import { useCurrency } from "./CurrencyContext";
import { type Language } from "./LanguageContext";
import { useExitBasis } from "./ExitBasisContext";
import { exitValue, slabConfidenceRank, slabConfidenceClasses } from "./grade-signals";
import { useTranslation } from "@/lib/i18n";
import { DecisionActions } from "./DecisionActions";
import { OwnedCountLine, ObservedLine } from "./OwnedCountLine";
import { UidChip } from "./UidChip";
import { MarketEvidenceBadge } from "./MarketEvidenceCallout";
import type { MarketEvidence } from "./market-evidence";
import { JapanExclusiveEvidence } from "./JapanExclusiveEvidence";
import {
  EnglishCounterpartPanel,
  isJapanesePokemonCard,
  type EnglishCounterpartCardRow,
} from "./english-counterpart";

import { formatJpy, formatRoi, formatUsd, formatUsdCompact } from "@/lib/money";
import { priceKindMarkerKey, priceKindTitleKey } from "@/lib/price-kind";
import { laneLabel } from "@/lib/lane";

export function PriceCell({ entry, align = "left", badgeVariant = "secondary" }: { entry: PriceEntry | null; align?: "left" | "right"; badgeVariant?: "secondary" | "outline" }) {
  const { displayCurrency, convertPrice } = useCurrency();
  const { t } = useTranslation();
  if (!entry) return <span>{"\u2014"}</span>;

  let symbol = entry.symbol;
  let price = entry.price;
  if (displayCurrency !== "none") {
    const converted = convertPrice(entry.price, entry.currencyCode);
    symbol = converted.symbol;
    price = converted.price;
  }

  // One word beside the number says what it is - a sale, a shop's offer, or
  // an estimate - so the operator never mistakes a guess for evidence. An ask
  // carries no marker (lib/price-kind.ts).
  const kindKey = priceKindMarkerKey(entry.kind);
  const kindTitle = priceKindTitleKey(entry.kind);

  return (
    <div>
      <div className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        <span>{symbol}{price}</span>
        {kindKey && (
          <Badge
            variant="outline"
            className="h-auto px-1 py-px text-[10px] font-normal"
            title={kindTitle ? t(kindTitle) : undefined}
          >
            {t(kindKey)}
          </Badge>
        )}
      </div>
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


// The ROI and, under it, the lane it was scored on (entry region -> exit
// region). aggregate-prices scores both directions per card and keeps the
// better one, so a row's direction is data: JP→NA is the import trade, NA→JP
// the export trade. No lane means the row has no cross-region pair and the
// two prices are informational.
export function RoiCell({ row }: { row: CardRowData }) {
  const lane = row.roi == null
    ? null
    : laneLabel(row.prices.lowestSell?.marketRegion, row.prices.highestBuy?.marketRegion);
  return (
    <div>
      <div>{formatRoi(row.roi ?? null)}</div>
      {lane && <div className="text-[10px] text-muted-foreground">{lane}</div>}
    </div>
  );
}

// Null-tolerant wrappers over the shared formatters: the browse tables show
// "-" for a value the pipeline has not produced.
function usd(value: number | null | undefined): string {
  return value == null ? "-" : formatUsd(value);
}

function jpy(value: number | null | undefined): string {
  return value == null ? "-" : formatJpy(value);
}

function signedPercent(value: number | null | undefined): string {
  return value == null ? "-" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
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
      <div className="font-medium tabular-nums">{jpy(value)}</div>
      <div className="text-[10px] text-muted-foreground">
        P{exitPercentile} · {t("evidence.compCountShort", { recent: signal.compCountRecent ?? 0, lifetime: signal.compCountLifetime ?? 0 })}
      </div>
      <div className="text-[10px] capitalize text-muted-foreground">
        {signal.tier?.replaceAll("_", " ") ?? t("evidence.unknownSource")}{flags.length ? ` · ${flags.join(", ")}` : ""}
      </div>
    </div>
  );
}

// #3 buy-confidence: the quick read (color-coded grade) plus the reasons behind
// it (volatility / trend / evidence / pop) so the operator sees why in one line.
export function SlabConfidenceCell({ row }: { row: CardRowData }) {
  const { t } = useTranslation();
  const signal = row.signal;
  const level = signal?.slabConfidence ?? null;
  if (!signal || !level) return <span className="text-muted-foreground">-</span>;
  const label = level === "high" ? t("evidence.confHigh") : level === "medium" ? t("evidence.confMedium") : t("evidence.confLow");
  const reasons = [
    signal.flags.high_volatility ? t("evidence.volatileShort") : null,
    signal.flags.downtrend ? t("evidence.downtrendShort") : null,
    signal.flags.thin_evidence ? t("evidence.thinShort") : null,
    signal.flags.high_pop_supply ? t("evidence.deepPopShort") : null,
  ].filter(Boolean);
  return (
    <div className="min-w-24">
      <Badge variant="outline" className={slabConfidenceClasses(level)}>{label}</Badge>
      {signal.recentVolatility != null && (
        <div className="mt-0.5 text-[10px] text-muted-foreground">{t("evidence.recentVolatility")}: {Math.round(signal.recentVolatility * 100)}%</div>
      )}
      {reasons.length > 0 && <div className="text-[10px] text-muted-foreground">{reasons.join(", ")}</div>}
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
      className="flex min-h-11 items-center gap-1 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground sm:min-h-0"
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

// Durable-identity column (H3): the Card Index uid convention in the browser.
// One definition shared by all three column sets; sealed rows alias their
// product_uid into card.card_uid the same way product_id rides card_id.
function uidColumn(t: TranslateFn): ColumnDef<CardRowData> {
  return {
    id: "uid",
    enableSorting: false,
    accessorFn: (row) => row.card.card_uid ?? null,
    header: () => t("column.uid"),
    cell: ({ row }) => <UidChip uid={row.original.card.card_uid} />,
    meta: { className: "hidden xl:table-cell" },
  };
}

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
      className="size-6 cursor-pointer align-middle sm:size-4"
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
      className="size-6 cursor-pointer align-middle sm:size-4"
      checked={row.getIsSelected()}
      onChange={(e) => row.toggleSelected(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
    />
  ),
};

export function createColumns(
  t: TranslateFn,
  language: Language = "en",
  availableOnly = false,
  tcgMarket?: Map<number, number>,
  marketEvidence?: Map<number, MarketEvidence>,
  englishCounterparts?: Map<number, EnglishCounterpartCardRow>,
  englishCounterpartsLoading = false,
  englishCounterpartsError?: unknown,
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
          <div className="min-w-0 whitespace-normal">
            <div>{getCardDisplayName(card, language)}</div>
            {misc && <div className="text-xs text-muted-foreground">{misc}</div>}
            <JapanExclusiveEvidence card={card} compact />
            {isJapanesePokemonCard(card) && (
              <EnglishCounterpartPanel
                row={englishCounterparts?.get(Number(card.card_id))}
                compact
                loading={englishCounterpartsLoading}
                error={englishCounterpartsError}
              />
            )}
            <OwnedCountLine owned={row.original.ownedQty} incoming={row.original.incomingQty} avgCost={row.original.ownedAvgCostUsd} totalCost={row.original.ownedCostBasisUsd} consigned={row.original.ownedConsigned} availableOnly={availableOnly} />
            <ObservedLine observed={row.original.observed} />
          </div>
        );
      },
      size: 400,
      meta: { className: "max-w-64 whitespace-normal" },
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
      meta: { className: "hidden xl:table-cell" },
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
      meta: { className: "hidden 2xl:table-cell" },
    },
    uidColumn(t),
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
      cell: ({ row }) => <RoiCell row={row.original} />,
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
      meta: { className: "hidden xl:table-cell" },
    },
    {
      // #2: per-card tcgplayer market value from the pokemon_tcgplayer_market
      // view (looked up in CardBrowser and passed in via the map).
      id: "tcg_market",
      accessorFn: (row) => tcgMarket?.get(Number(row.card.card_id)) ?? undefined,
      header: ({ column }) => <SortableHeader column={column} label={t("cardBrowser.tcgMarket")} />,
      cell: ({ getValue, row }) => {
        const v = getValue() as number | undefined;
        const evidence = Number(row.original.psaGrade ?? 0) === 0
          ? marketEvidence?.get(Number(row.original.card.card_id))
          : undefined;
        return (
          <div className="space-y-1">
            <div>{v == null ? "\u2014" : formatUsdCompact(v)}</div>
            <MarketEvidenceBadge evidence={evidence} />
          </div>
        );
      },
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
      meta: { className: "hidden lg:table-cell" },
    },
    {
      id: "conservativeExit",
      accessorFn: (row) => row.signal?.bandP25 ?? undefined,
      header: ({ column }) => <SortableHeader column={column} label={t("column.conservativeExit")} />,
      cell: ({ row }) => <ConservativeExitCell row={row.original} />,
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
    },
    {
      // #3: composite buy-confidence grade (recent-sales volatility + trend +
      // evidence depth). Sorts by rank so "high" leads a descending sort.
      id: "buyConfidence",
      accessorFn: (row) => slabConfidenceRank(row.signal?.slabConfidence) ?? undefined,
      header: ({ column }) => <SortableHeader column={column} label={t("column.buyConfidence")} />,
      cell: ({ row }) => <SlabConfidenceCell row={row.original} />,
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
      meta: { className: "hidden lg:table-cell" },
    },
    {
      id: "dealNet",
      accessorFn: (row) => row.deal?.netPnlUsd ?? undefined,
      header: ({ column }) => <SortableHeader column={column} label={t("column.dealNet")} />,
      cell: ({ row }) => <span className={`font-medium tabular-nums ${(row.original.deal?.netPnlUsd ?? 0) < 0 ? "text-destructive" : ""}`}>{usd(row.original.deal?.netPnlUsd)}</span>,
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
      meta: { className: "hidden xl:table-cell" },
    },
    {
      id: "rawToGrade",
      accessorFn: (row) => row.rawToGradeNetUsd ?? row.rawToGradeEvUsd ?? undefined,
      header: ({ column }) => <SortableHeader column={column} label={t("column.rawToGrade")} />,
      cell: ({ row }) => {
        const net = row.original.rawToGradeNetUsd;
        const value = net ?? row.original.rawToGradeEvUsd;
        return value == null ? <span className="text-muted-foreground">-</span> : (
          <div><div className="font-medium tabular-nums">{usd(value)}</div><div className="text-[10px] text-muted-foreground">{net == null ? t("economics.evBeforeEntry") : t("economics.evAfterEntry")}</div></div>
        );
      },
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
      meta: { className: "hidden 2xl:table-cell" },
    },
    {
      id: "relativeValue",
      accessorFn: (row) => row.dealRelativeValuePct ?? undefined,
      header: ({ column }) => <SortableHeader column={column} label={t("column.relativeValue")} />,
      cell: ({ row }) => <span className="tabular-nums">{signedPercent(row.original.dealRelativeValuePct)}</span>,
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
      meta: { className: "hidden 2xl:table-cell" },
    },
    {
      id: "decision",
      enableSorting: false,
      header: () => t("decision.title"),
      cell: ({ row }) => <DecisionActions row={row.original} compact />,
      meta: { className: "sticky right-0 z-10 bg-background shadow-[-8px_0_12px_-12px_rgba(0,0,0,0.45)]" },
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
  availableOnly = false,
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
            <OwnedCountLine owned={row.original.ownedQty} incoming={row.original.incomingQty} avgCost={row.original.ownedAvgCostUsd} totalCost={row.original.ownedCostBasisUsd} consigned={row.original.ownedConsigned} availableOnly={availableOnly} />
            <ObservedLine observed={row.original.observed} />
          </div>
        );
      },
      size: 400,
      meta: { className: "max-w-64 whitespace-normal" },
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
      meta: { className: "hidden lg:table-cell" },
      accessorFn: (row) => row.card.foil_type ?? null,
      header: ({ column }) => <SortableHeader column={column} label={t("column.foilType")} />,
      cell: ({ row }) => mtgFoilLabel(row.original.card, t),
    },
    {
      id: "language",
      meta: { className: "hidden xl:table-cell" },
      accessorFn: (row) => row.card.language ?? null,
      header: ({ column }) => <SortableHeader column={column} label={t("column.language")} />,
      cell: ({ getValue }) => (getValue() as string | null) ?? "—",
    },
    uidColumn(t),
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
      cell: ({ row }) => <RoiCell row={row.original} />,
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
  return <span>{formatUsd(value)}</span>;
}

type SealedExtras = {
  productType?: string;
  sealedCondition?: string;
  variantEdition?: string;
};

export function createSealedColumns(
  t: TranslateFn,
  language: Language = "en",
  availableOnly = false,
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
            <OwnedCountLine owned={row.original.ownedQty} incoming={row.original.incomingQty} avgCost={row.original.ownedAvgCostUsd} totalCost={row.original.ownedCostBasisUsd} consigned={row.original.ownedConsigned} availableOnly={availableOnly} />
            <ObservedLine observed={row.original.observed} />
          </div>
        );
      },
      size: 400,
      meta: { className: "max-w-64 whitespace-normal" },
    },
    {
      id: "productType",
      meta: { className: "hidden xl:table-cell" },
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
      meta: { className: "hidden lg:table-cell" },
      accessorFn: (row) => {
        const v = row.card.set_code;
        return v && v !== "UNKNOWN" ? v : null;
      },
      header: ({ column }) => <SortableHeader column={column} label={t("column.setCode")} />,
      cell: ({ getValue }) => (getValue() as string | null) ?? "—",
    },
    uidColumn(t),
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
      cell: ({ row }) => <RoiCell row={row.original} />,
      sortUndefined: "last",
      sortingFn: nullsLastNumber,
    },
  ];
}

// Columns the buy list can never fill: BuyListView builds rows without signal /
// deal / observation / owned data, so these render a permanent "-" block (and
// a Decision control acting on a null snapshot). Dropped rather than shown
// empty.
const BUYLIST_UNFILLABLE = new Set([
  "psa_grade", "conservativeExit", "dealNet", "rawToGrade", "relativeValue", "decision",
]);

export function createBuylistColumns(t: TranslateFn, language: Language = "en"): ColumnDef<CardRowData>[] {
  return [
    ...createColumns(t, language).filter((c) => !BUYLIST_UNFILLABLE.has(c.id ?? "")),
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

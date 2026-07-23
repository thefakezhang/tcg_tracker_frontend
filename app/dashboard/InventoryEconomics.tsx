"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { formatUsd } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  inventoryEconomicsTotals,
  type InventoryEconomicsRow,
} from "./inventory-economics";

const STATUS_FILTERS = ["all", "unsold", "partial", "sold"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function money(value: number): string {
  return formatUsd(Number(value));
}

function itemAxes(row: InventoryEconomicsRow): string {
  if (row.item_type === "sealed") {
    return `${row.sealed_condition}/${row.variant_edition}`;
  }
  return row.psa_grade ? `PSA ${row.psa_grade}` : "Raw";
}

function statusKey(
  status: InventoryEconomicsRow["lifecycle_status"],
): TranslationKey {
  return `inventoryEconomics.status.${status}` as TranslationKey;
}

export default function InventoryEconomics({
  tripId,
}: {
  tripId?: number;
}) {
  const { t, language } = useTranslation();
  const [rows, setRows] = useState<InventoryEconomicsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] =
    useState<InventoryEconomicsRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    let query = supabase
      .from("inventory_economics_v")
      .select(
        "line_key, lot_line_id, lot_id, trip_id, trip_name, leg, acquired_at, finalized_at, game, item_type, card_id, product_id, condition_id, psa_grade, sealed_condition, variant_edition, name, english_name, set_code, card_number, image_url, quantity, qty_remaining, qty_sold, lifecycle_status, direct_purchase_cost_usd, acquisition_cost_alloc_usd, landed_cost_usd, on_hand_cost_usd, gross_usd, sale_expenses_usd, net_proceeds_usd, cogs_usd, profit_usd, allocation_snapshot, finalization_snapshot, sale_activity",
      )
      .order("acquired_at", { ascending: false })
      .order("line_key")
      .limit(1000);
    if (tripId != null) query = query.eq("trip_id", tripId);
    const { data, error: queryError } = await query;
    if (queryError) {
      setRows([]);
      setError(queryError.message);
    } else {
      setRows((data as InventoryEconomicsRow[] | null) ?? []);
    }
    setLoading(false);
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(language);
    return rows.filter((row) => {
      if (status !== "all" && row.lifecycle_status !== status) return false;
      if (!needle) return true;
      return [
        row.name,
        row.english_name,
        row.set_code,
        row.card_number,
        row.trip_name,
      ].some((value) =>
        value?.toLocaleLowerCase(language).includes(needle)
      );
    });
  }, [language, rows, search, status]);
  const totals = useMemo(
    () => inventoryEconomicsTotals(filtered),
    [filtered],
  );

  const summary = [
    ["inventoryEconomics.direct", totals.directPurchaseUsd],
    ["inventoryEconomics.acquisition", totals.acquisitionCostsUsd],
    ["inventoryEconomics.landed", totals.landedCostUsd],
    ["inventoryEconomics.onHand", totals.onHandCostUsd],
    ["inventoryEconomics.netProceeds", totals.netProceedsUsd],
    ["inventoryEconomics.profit", totals.realizedProfitUsd],
  ] as const;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">
          {t("inventoryEconomics.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("inventoryEconomics.help")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {summary.map(([key, value]) => (
          <Card key={key} size="sm">
            <CardContent className="p-3">
              <div className="text-[11px] text-muted-foreground">
                {t(key)}
              </div>
              <div className="font-semibold tabular-nums">{money(value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("inventoryEconomics.search")}
          className="min-h-11 sm:min-h-9 sm:max-w-sm"
        />
        <div className="flex gap-1 overflow-x-auto">
          {STATUS_FILTERS.map((value) => (
            <Button
              key={value}
              variant={status === value ? "default" : "outline"}
              size="sm"
              className="min-h-11 shrink-0 sm:min-h-9"
              onClick={() => setStatus(value)}
            >
              {t(
                value === "all"
                  ? "inventoryEconomics.status.all"
                  : statusKey(value),
              )}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive">
          {t("cardBrowser.error", { message: error })}
        </p>
      )}

      <div className="hidden overflow-x-auto rounded-md border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("trips.item")}</TableHead>
              <TableHead>{t("inventoryEconomics.status")}</TableHead>
              <TableHead className="text-right">
                {t("inventoryEconomics.direct")}
              </TableHead>
              <TableHead className="text-right">
                {t("inventoryEconomics.acquisition")}
              </TableHead>
              <TableHead className="text-right">
                {t("inventoryEconomics.landed")}
              </TableHead>
              <TableHead className="text-right">
                {t("inventoryEconomics.netProceeds")}
              </TableHead>
              <TableHead className="text-right">
                {t("inventoryEconomics.profit")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => (
              <TableRow
                key={row.line_key}
                className="cursor-pointer"
                onClick={() => setSelected(row)}
              >
                <TableCell>
                  <div className="font-medium">
                    {language === "en" && row.english_name
                      ? row.english_name
                      : row.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[row.set_code, row.card_number, itemAxes(row)]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </TableCell>
                <TableCell>{t(statusKey(row.lifecycle_status))}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(row.direct_purchase_cost_usd)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(row.acquisition_cost_alloc_usd)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(row.landed_cost_usd)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(row.net_proceeds_usd)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${
                    Number(row.profit_usd) < 0 ? "text-destructive" : ""
                  }`}
                >
                  {money(row.profit_usd)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2 md:hidden">
        {filtered.map((row) => (
          <button
            key={row.line_key}
            onClick={() => setSelected(row)}
            className="flex min-h-11 w-full items-center gap-3 rounded-md border p-2 text-left"
          >
            {row.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.image_url}
                alt=""
                className="h-14 w-10 shrink-0 rounded object-cover"
              />
            ) : (
              <span className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-muted">
                <ImageOff className="size-4 text-muted-foreground" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {language === "en" && row.english_name
                  ? row.english_name
                  : row.name}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t(statusKey(row.lifecycle_status))}
                {" · "}
                {row.qty_remaining}/{row.quantity} {t("inventoryEconomics.onHandQty")}
              </span>
            </span>
            <span className="shrink-0 text-right text-xs tabular-nums">
              <span className="block">{money(row.landed_cost_usd)}</span>
              <span className={Number(row.profit_usd) < 0 ? "text-destructive" : "text-muted-foreground"}>
                {money(row.profit_usd)}
              </span>
            </span>
          </button>
        ))}
      </div>

      {!loading && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("inventoryEconomics.empty")}
        </p>
      )}
      {loading && (
        <p className="text-sm text-muted-foreground">
          {t("common.loading")}
        </p>
      )}

      <Sheet
        open={selected != null}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <SheetContent className="data-[side=right]:w-full data-[side=right]:max-w-none data-[side=right]:sm:w-[36rem] data-[side=right]:sm:max-w-[36rem]">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {language === "en" && selected.english_name
                    ? selected.english_name
                    : selected.name}
                </SheetTitle>
                <SheetDescription>
                  {[
                    selected.set_code,
                    selected.card_number,
                    itemAxes(selected),
                    selected.trip_name,
                  ].filter(Boolean).join(" · ")}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-6">
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("inventoryEconomics.lifecycle")}
                  </h3>
                  <div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm">
                    <div>{t("inventoryEconomics.status")}</div>
                    <div className="text-right">
                      {t(statusKey(selected.lifecycle_status))}
                    </div>
                    <div>{t("inventoryEconomics.purchasedQty")}</div>
                    <div className="text-right">{selected.quantity}</div>
                    <div>{t("inventoryEconomics.soldQty")}</div>
                    <div className="text-right">{selected.qty_sold}</div>
                    <div>{t("inventoryEconomics.onHand")}</div>
                    <div className="text-right">{selected.qty_remaining}</div>
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("inventoryEconomics.basis")}
                  </h3>
                  <div className="space-y-1 rounded-md border p-3 text-sm">
                    <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-2">
                      <span aria-hidden="true" />
                      <span>{t("inventoryEconomics.direct")}</span>
                      <span className="tabular-nums">
                        {money(selected.direct_purchase_cost_usd)}
                      </span>
                      <span aria-hidden="true">+</span>
                      <span>{t("inventoryEconomics.acquisition")}</span>
                      <span className="tabular-nums">
                        {money(selected.acquisition_cost_alloc_usd)}
                      </span>
                      <span aria-hidden="true">=</span>
                      <span className="font-semibold">
                        {t("inventoryEconomics.landed")}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {money(selected.landed_cost_usd)}
                      </span>
                    </div>
                    <div className="mt-2 flex justify-between border-t pt-2 text-muted-foreground">
                      <span>{t("inventoryEconomics.onHandCost")}</span>
                      <span className="tabular-nums">
                        {money(selected.on_hand_cost_usd)}
                      </span>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("inventoryEconomics.realized")}
                  </h3>
                  <div className="space-y-1 rounded-md border p-3 text-sm">
                    <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-2">
                      <span aria-hidden="true" />
                      <span>{t("inventoryEconomics.gross")}</span>
                      <span className="tabular-nums">
                        {money(selected.gross_usd)}
                      </span>
                      <span aria-hidden="true">-</span>
                      <span>{t("inventoryEconomics.saleExpenses")}</span>
                      <span className="tabular-nums">
                        {money(selected.sale_expenses_usd)}
                      </span>
                      <span aria-hidden="true">=</span>
                      <span className="font-semibold">
                        {t("inventoryEconomics.netProceeds")}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {money(selected.net_proceeds_usd)}
                      </span>
                      <span aria-hidden="true">-</span>
                      <span>{t("inventoryEconomics.cogs")}</span>
                      <span className="tabular-nums">
                        {money(selected.cogs_usd)}
                      </span>
                      <span aria-hidden="true">=</span>
                      <span className="font-semibold">
                        {t("inventoryEconomics.profit")}
                      </span>
                      <span className={`font-semibold tabular-nums ${
                        Number(selected.profit_usd) < 0
                          ? "text-destructive"
                          : ""
                      }`}>
                        {money(selected.profit_usd)}
                      </span>
                    </div>
                    {selected.sale_activity.some(
                      (activity) => activity.sale_group != null,
                    ) && (
                      <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                        {t("inventoryEconomics.allocatedEstimate")}
                      </p>
                    )}
                  </div>
                </section>

                {selected.sale_activity.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("inventoryEconomics.saleActivity")}
                    </h3>
                    <div className="space-y-2">
                      {selected.sale_activity.map((activity, index) => (
                        <div
                          key={`${activity.sale_id}-${index}`}
                          className="rounded-md border p-3 text-xs"
                        >
                          <div className="flex justify-between">
                            <span>{activity.sold_at} · ×{activity.quantity}</span>
                            <span className="tabular-nums">
                              {money(activity.profit_usd)}
                            </span>
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            {t("inventoryEconomics.gross")} {money(activity.gross_usd)}
                            {" · "}
                            {t("inventoryEconomics.saleExpenses")} {money(activity.expenses_usd)}
                            {" · "}
                            {t("inventoryEconomics.cogs")} {money(activity.cogs_usd)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

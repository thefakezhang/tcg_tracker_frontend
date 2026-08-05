"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { formatMutationError } from "@/lib/mutation-error";
import { formatUsd } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { RoiLine } from "./theoretical-roi";

/** A source-lot row shares the authoritative inventory ROI read-model shape. */
export type ConsignmentRoiLine = RoiLine;

export interface InventoryConsignmentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemLabel: string;
  itemMeta?: string | null;
  owned: number;
  consigned: number;
  available: number;
  lines: readonly ConsignmentRoiLine[];
  onSave: (line: ConsignmentRoiLine, integerQty: number) => Promise<void>;
}

function lineId(line: ConsignmentRoiLine): string {
  return line.line_key || `${line.game}:${line.lot_line_id}`;
}

function initialQuantity(line: ConsignmentRoiLine): string {
  return String(Math.max(0, Math.min(line.qty_on_hand, Math.floor(Number(line.consigned_qty) || 0))));
}

function parseQuantity(value: string, maximum: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > maximum) return null;
  return quantity;
}

export default function InventoryConsignmentSheet({
  open,
  onOpenChange,
  itemLabel,
  itemMeta,
  owned,
  consigned,
  available,
  lines,
  onSave,
}: InventoryConsignmentSheetProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialValues = useMemo(
    () => Object.fromEntries(lines.map((line) => [lineId(line), initialQuantity(line)])),
    [lines],
  );

  useEffect(() => {
    if (open) {
      setValues(initialValues);
      setError(null);
    }
  }, [initialValues, open]);

  const save = async (line: ConsignmentRoiLine) => {
    const id = lineId(line);
    const quantity = parseQuantity(values[id] ?? initialQuantity(line), line.qty_on_hand);
    if (quantity == null) return;
    setSaving(id);
    setError(null);
    try {
      await onSave(line, quantity);
    } catch (reason) {
      setError(formatMutationError(reason));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="data-[side=right]:w-full data-[side=right]:max-w-none sm:data-[side=right]:w-[36rem] sm:data-[side=right]:max-w-[36rem]">
        <SheetHeader>
          <SheetTitle>{t("inventory.manageConsignment")}</SheetTitle>
          <SheetDescription>
            <span className="block font-medium text-foreground">{itemLabel}</span>
            {itemMeta && <span className="block">{itemMeta}</span>}
            <span className="mt-2 block">{t("inventory.consignmentHelp")}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="grid grid-cols-3 gap-2 px-4" aria-label={t("inventory.summary")}>
          {[
            [t("inventory.ownedQty"), owned],
            [t("inventory.consigned"), consigned],
            [t("inventory.available"), available],
          ].map(([label, count]) => (
            <div key={String(label)} className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="font-semibold tabular-nums">{count}</div>
            </div>
          ))}
        </div>

        {error && <p role="alert" className="mx-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{t("cardBrowser.error", { message: error })}</p>}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("inventory.sourceLots")}
          </h3>
          {lines.map((line) => {
            const id = lineId(line);
            const value = values[id] ?? initialQuantity(line);
            const quantity = parseQuantity(value, line.qty_on_hand);
            const invalid = quantity == null;
            const lineConsigned = Math.max(0, Math.min(line.qty_on_hand, Math.floor(Number(line.consigned_qty) || 0)));
            const lineAvailable = Math.max(0, line.qty_on_hand - lineConsigned);
            return (
              <section key={id} className="rounded-lg border p-3" aria-label={t("inventory.sourceLine", { lot: line.lot_id, line: line.lot_line_id })}>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <div><span className="text-muted-foreground">{t("trips.lotShop")}: </span>{line.shop_label || "-"}</div>
                  <div><span className="text-muted-foreground">{t("trips.lotDate")}: </span>{line.acquired_at || "-"}</div>
                  <div><span className="text-muted-foreground">{t("inventory.lot")}: </span>#{line.lot_id}</div>
                  <div><span className="text-muted-foreground">{t("trips.colTrip")}: </span>{line.trip_id == null ? "-" : t("inventory.tripNumber", { id: line.trip_id })}</div>
                  <div><span className="text-muted-foreground">{t("inventory.leg")}: </span>{line.leg ? t(line.leg === "export" ? "trips.legExport" : "trips.legImport") : "-"}</div>
                  <div><span className="text-muted-foreground">{t("inventory.unitCost")}: </span>{formatUsd(Number(line.on_hand_cost_usd ?? 0) / Math.max(1, line.qty_on_hand))}</div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <span>{t("inventory.ownedQty")}: <strong className="tabular-nums">{line.qty_on_hand}</strong></span>
                  <span>{t("inventory.consigned")}: <strong className="tabular-nums">{lineConsigned}</strong></span>
                  <span>{t("inventory.available")}: <strong className="tabular-nums">{lineAvailable}</strong></span>
                </div>

                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="flex-1 text-sm font-medium">
                    {t("inventory.consignQty")}
                    <Input
                      aria-label={t("inventory.consignQtyForSourceLine", { lot: line.lot_id, line: line.lot_line_id })}
                      className="mt-1 min-h-11 sm:min-h-9"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={line.qty_on_hand}
                      step={1}
                      value={value}
                      aria-invalid={invalid || undefined}
                      onChange={(event) => setValues((current) => ({ ...current, [id]: event.target.value }))}
                    />
                  </label>
                  <Button className="min-h-11 sm:min-h-9" disabled={invalid || saving === id} onClick={() => void save(line)}>
                    {saving === id ? t("common.saving") : t("common.save")}
                  </Button>
                </div>
                {invalid && <p className="mt-1 text-xs text-destructive">{t("inventory.consignmentRange", { max: line.qty_on_hand })}</p>}
              </section>
            );
          })}
          {lines.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("inventory.noSourceLots")}</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

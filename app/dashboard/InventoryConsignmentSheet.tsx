"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { formatMutationError } from "@/lib/mutation-error";
import { formatUsd } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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

export interface RecordSaleInput {
  saleUsd: number;
  feeUsd: number;
  soldAt: string; // YYYY-MM-DD
}

export interface InventoryConsignmentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemLabel: string;
  itemMeta?: string | null;
  owned: number;
  consigned: number;
  available: number;
  lines: readonly ConsignmentRoiLine[];
  /** Set the consigned quantity and consignee. Empty consignee = qty-only. */
  onSave: (line: ConsignmentRoiLine, integerQty: number, consignee: string) => Promise<void>;
  /** Record the consignor's sale. Requires a consignee already saved. */
  onRecordSale: (line: ConsignmentRoiLine, input: RecordSaleInput) => Promise<void>;
  /** Clear an unsold consignment or reverse and clear a booked sale. */
  onClear: (line: ConsignmentRoiLine) => Promise<void>;
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

function parseMoney(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
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
  onRecordSale,
  onClear,
}: InventoryConsignmentSheetProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [consignees, setConsignees] = useState<Record<string, string>>({});
  const [saleForm, setSaleForm] = useState<Record<string, { usd: string; fee: string; at: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialValues = useMemo(
    () => Object.fromEntries(lines.map((line) => [lineId(line), initialQuantity(line)])),
    [lines],
  );
  const initialConsignees = useMemo(
    () => Object.fromEntries(lines.map((line) => [lineId(line), line.consignee ?? ""])),
    [lines],
  );

  useEffect(() => {
    if (open) {
      setValues(initialValues);
      setConsignees(initialConsignees);
      setSaleForm({});
      setError(null);
    }
  }, [initialValues, initialConsignees, open]);

  const runMutation = async (id: string, mutate: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await mutate();
    } catch (reason) {
      setError(formatMutationError(reason));
    } finally {
      setBusy(null);
    }
  };

  const saveConsignment = (line: ConsignmentRoiLine) => {
    const id = lineId(line);
    const quantity = parseQuantity(values[id] ?? initialQuantity(line), line.qty_on_hand);
    if (quantity == null) return;
    void runMutation(id, () => onSave(line, quantity, (consignees[id] ?? "").trim()));
  };

  const recordSale = (line: ConsignmentRoiLine) => {
    const id = lineId(line);
    const form = saleForm[id] ?? { usd: "", fee: "0", at: today() };
    const saleUsd = parseMoney(form.usd);
    const feeUsd = parseMoney(form.fee || "0");
    if (saleUsd == null || feeUsd == null || !form.at) return;
    void runMutation(id, () => onRecordSale(line, { saleUsd, feeUsd, soldAt: form.at }));
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
            const savedConsignee = (line.consignee ?? "").trim();
            const sold = line.consignment_sold_at != null;
            const form = saleForm[id] ?? { usd: "", fee: "0", at: today() };
            const saleValid = parseMoney(form.usd) != null && parseMoney(form.fee || "0") != null && !!form.at;
            const net = line.consignment_sale_usd == null ? null : line.consignment_sale_usd - (line.consignment_fee_usd ?? 0);
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
                  <label className="w-24 text-sm font-medium">
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
                  <label className="flex-1 text-sm font-medium">
                    {t("inventory.consignee")}
                    <Input
                      aria-label={t("inventory.consigneeForSourceLine", { lot: line.lot_id, line: line.lot_line_id })}
                      className="mt-1 min-h-11 sm:min-h-9"
                      placeholder={t("inventory.consigneePlaceholder")}
                      value={consignees[id] ?? ""}
                      onChange={(event) => setConsignees((current) => ({ ...current, [id]: event.target.value }))}
                    />
                  </label>
                  <Button className="min-h-11 sm:min-h-9" disabled={invalid || busy === id} onClick={() => saveConsignment(line)}>
                    {busy === id ? t("common.saving") : t("common.save")}
                  </Button>
                </div>
                {invalid && <p className="mt-1 text-xs text-destructive">{t("inventory.consignmentRange", { max: line.qty_on_hand })}</p>}

                {/* Sale tracking - only meaningful once the line has a consignee. */}
                <div className="mt-3 border-t pt-3">
                  {savedConsignee === "" ? (
                    <p className="text-xs text-muted-foreground">{t("inventory.saleNeedsConsignee")}</p>
                  ) : sold ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">{t("inventory.soldTo", { who: savedConsignee })}</span>
                        <span className="ml-2 text-muted-foreground">
                          {line.consignment_sold_at?.slice(0, 10)} · {t("inventory.saleGross")} {formatUsd(line.consignment_sale_usd ?? 0)}
                          {(line.consignment_fee_usd ?? 0) > 0 && <> · {t("inventory.saleFee")} {formatUsd(line.consignment_fee_usd ?? 0)}</>}
                          {net != null && <> · {t("inventory.saleNet")} <strong>{formatUsd(net)}</strong></>}
                        </span>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={<Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={busy === id} />}
                        >
                          {t("inventory.undoConsignmentSale")}
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("inventory.undoConsignmentSale")}</AlertDialogTitle>
                            <AlertDialogDescription>{t("inventory.undoConsignmentSaleConfirm")}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                            <AlertDialogAction disabled={busy === id} onClick={() => void runMutation(id, () => onClear(line))}>
                              {t("inventory.undoConsignmentSale")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("inventory.recordSaleFor", { who: savedConsignee })}</div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <label className="flex-1 text-sm">
                          {t("inventory.saleGrossTotal")}
                          <Input className="mt-1 min-h-11 sm:min-h-9" inputMode="decimal" placeholder="0.00"
                            value={form.usd}
                            onChange={(e) => setSaleForm((c) => ({ ...c, [id]: { ...form, usd: e.target.value } }))} />
                        </label>
                        <label className="w-24 text-sm">
                          {t("inventory.saleFee")}
                          <Input className="mt-1 min-h-11 sm:min-h-9" inputMode="decimal" placeholder="0.00"
                            value={form.fee}
                            onChange={(e) => setSaleForm((c) => ({ ...c, [id]: { ...form, fee: e.target.value } }))} />
                        </label>
                        <label className="w-40 text-sm">
                          {t("inventory.saleDate")}
                          <Input className="mt-1 min-h-11 sm:min-h-9" type="date"
                            value={form.at}
                            onChange={(e) => setSaleForm((c) => ({ ...c, [id]: { ...form, at: e.target.value } }))} />
                        </label>
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={<Button className="min-h-11 sm:min-h-9" disabled={!saleValid || busy === id} />}
                          >
                            {t("inventory.recordSaleCopies", { n: lineConsigned })}
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("inventory.recordSale")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("inventory.recordSaleConfirm", { n: lineConsigned, who: savedConsignee })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                              <AlertDialogAction disabled={busy === id} onClick={() => recordSale(line)}>
                                {t("inventory.recordSaleCopies", { n: lineConsigned })}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                      <Button variant="ghost" size="sm" className="min-h-11 px-2 text-muted-foreground sm:min-h-8" disabled={busy === id} onClick={() => void runMutation(id, () => onClear(line))}>
                        {t("inventory.clearConsignment")}
                      </Button>
                    </div>
                  )}
                </div>
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

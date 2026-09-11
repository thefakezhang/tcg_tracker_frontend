"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { formatMutationError } from "@/lib/mutation-error";
import { conditionLabel, editionLabel } from "./use-sealed-data";
import { useTrips } from "./TripContext";

export type PlanCard = { id: number; name: string };
export type PlanSealedProduct = {
  id: number;
  name: string;
  sealedCondition: string;
  variantEdition: string;
};

type PlanOption = {
  plan_id: number;
  name: string;
  status: string;
  trip_id: number | null;
};
type AddResult = {
  card_id?: number | null;
  product_id?: number | null;
  sealed_condition?: string | null;
  variant_edition?: string | null;
  added: boolean;
  source: string | null;
  asking_price: number | null;
  // A null count means the shop does not publish depth. It never means zero.
  available_quantity: number | null;
  reason: string | null;
};
type Wanted = { quantity: string; ceiling: string };
type PlanItem = {
  key: string;
  id: number;
  name: string;
  sealedCondition: string | null;
  variantEdition: string | null;
};

const MAX_ITEMS = 100;
const MAX_QUANTITY = 1000;
const MAX_CEILING_JPY = 1_000_000_000;

export function sealedPlanItemKey(item: Pick<PlanSealedProduct, "id" | "sealedCondition" | "variantEdition">) {
  return `sealed:${item.id}:${item.sealedCondition}:${item.variantEdition}`;
}

function cardPlanItemKey(id: number) {
  return `card:${id}`;
}

function resultKey(result: AddResult) {
  return result.product_id != null
    ? sealedPlanItemKey({
        id: Number(result.product_id),
        sealedCondition: result.sealed_condition ?? "",
        variantEdition: result.variant_edition ?? "",
      })
    : cardPlanItemKey(Number(result.card_id));
}

function isOnPlan(result: AddResult) {
  return result.added || result.reason === "already on this plan";
}

function parseWanted(row: Wanted): { quantity: number; ceiling: number | null } | null {
  const quantity = Number(row.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return null;
  if (row.ceiling.trim() === "") return { quantity, ceiling: null };
  const ceiling = Number(row.ceiling);
  if (!Number.isFinite(ceiling) || ceiling < 0 || ceiling > MAX_CEILING_JPY) return null;
  return { quantity, ceiling };
}

const REASON_KEYS: Record<string, TranslationKey> = {
  "already on this plan": "bulkPlan.reasonAlready",
  "sealed product not found": "bulkPlan.reasonMissingProduct",
  "no eligible JPY listing on file": "bulkPlan.reasonNoListing",
  "no eligible JPY listing at or below the ceiling": "bulkPlan.reasonAboveCeiling",
};

export function AddToPlanAction({
  cards,
  sealedProducts,
  onAdded,
  disabled = false,
  disabledDescriptionId,
}: {
  cards?: PlanCard[];
  sealedProducts?: PlanSealedProduct[];
  onAdded?: () => void;
  disabled?: boolean;
  disabledDescriptionId?: string;
}) {
  const { t } = useTranslation();
  const { activeTripId } = useTrips();
  const isSealed = sealedProducts !== undefined;
  const items = useMemo<PlanItem[]>(
    () => isSealed
      ? (sealedProducts ?? []).map((item) => ({
          key: sealedPlanItemKey(item),
          id: item.id,
          name: item.name,
          sealedCondition: item.sealedCondition,
          variantEdition: item.variantEdition,
        }))
      : (cards ?? []).map((item) => ({
          key: cardPlanItemKey(item.id),
          id: item.id,
          name: item.name,
          sealedCondition: null,
          variantEdition: null,
        })),
    [cards, isSealed, sealedProducts],
  );
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [wanted, setWanted] = useState<Record<string, Wanted>>({});
  const [bulkQuantity, setBulkQuantity] = useState("1");
  const [bulkCeiling, setBulkCeiling] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AddResult[] | null>(null);

  const itemLabel = useCallback((item: PlanItem) => {
    if (!item.sealedCondition || !item.variantEdition) return item.name;
    return `${item.name} · ${editionLabel(t, item.variantEdition)} · ${conditionLabel(t, item.sealedCondition)}`;
  }, [t]);
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);
  const resultByKey = useMemo(
    () => new Map((results ?? []).map((result) => [resultKey(result), result])),
    [results],
  );

  const load = useCallback(async () => {
    const { data, error: loadError } = await createClient()
      .from("purchase_plans")
      .select("plan_id,name,status,trip_id")
      .in("status", ["draft", "ready"])
      .order("plan_id", { ascending: false });
    if (loadError) {
      setError(formatMutationError(loadError));
      return;
    }
    const rows = (data ?? []) as PlanOption[];
    setPlans(rows);
    setPlanId(
      rows.find((plan) => plan.trip_id === activeTripId)?.plan_id
        ?? rows[0]?.plan_id
        ?? null,
    );
  }, [activeTripId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    setWanted(Object.fromEntries(items.map((item) => [item.key, { quantity: "1", ceiling: "" }])));
    setBulkQuantity("1");
    setBulkCeiling("");
  }, [items, open]);

  function setRow(key: string, patch: Partial<Wanted>) {
    setWanted((current) => ({
      ...current,
      [key]: { ...(current[key] ?? { quantity: "1", ceiling: "" }), ...patch },
    }));
  }

  function applyToAll() {
    setWanted(Object.fromEntries(items.map((item) => [
      item.key,
      { quantity: bulkQuantity, ceiling: bulkCeiling },
    ])));
  }

  const invalidItem = items.find((item) =>
    parseWanted(wanted[item.key] ?? { quantity: "1", ceiling: "" }) === null);
  const validationError = invalidItem
    ? t("bulkPlan.invalidValues", { name: itemLabel(invalidItem) })
    : items.length > MAX_ITEMS
      ? t("bulkPlan.tooMany", { count: MAX_ITEMS })
      : null;

  async function submit(keys: string[]) {
    if (disabled || planId == null || validationError) return;
    const submitted = items.filter((item) => keys.includes(item.key));
    if (!submitted.length) return;
    const rpcItems = submitted.map((item) => {
      const parsed = parseWanted(wanted[item.key] ?? { quantity: "1", ceiling: "" });
      if (!parsed) throw new Error("validated plan item became invalid");
      return isSealed
        ? {
            product_id: item.id,
            sealed_condition: item.sealedCondition,
            variant_edition: item.variantEdition,
            quantity: parsed.quantity,
            ceiling_jpy: parsed.ceiling,
          }
        : {
            card_id: item.id,
            quantity: parsed.quantity,
            ceiling_jpy: parsed.ceiling,
          };
    });

    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await createClient().rpc(
      isSealed ? "add_sealed_to_purchase_plan" : "add_cards_to_purchase_plan",
      { p_plan_id: planId, p_items: rpcItems },
    );
    setBusy(false);
    if (rpcError) {
      setError(formatMutationError(rpcError));
      return;
    }

    const returned = (data ?? []) as AddResult[];
    setResults((current) => {
      const merged = new Map((current ?? []).map((result) => [resultKey(result), result]));
      for (const result of returned) merged.set(resultKey(result), result);
      return items.flatMap((item) => {
        const result = merged.get(item.key);
        return result ? [result] : [];
      });
    });
    if (returned.some(isOnPlan)) onAdded?.();
  }

  if (!items.length) return null;

  const successful = (results ?? []).filter(isOnPlan);
  const skipped = (results ?? []).filter((result) => !isOnPlan(result));
  const retryKeys = results === null
    ? []
    : items
        .filter((item) => {
          const result = resultByKey.get(item.key);
          return !result || !isOnPlan(result);
        })
        .map((item) => item.key);
  const short = successful.filter((result) => {
    if (!result.added || result.available_quantity == null) return false;
    const parsed = parseWanted(wanted[resultKey(result)] ?? { quantity: "1", ceiling: "" });
    return parsed != null && result.available_quantity < parsed.quantity;
  });
  const totalCopies = items.reduce((sum, item) => {
    const parsed = parseWanted(wanted[item.key] ?? { quantity: "1", ceiling: "" });
    return sum + (parsed?.quantity ?? 0);
  }, 0);
  const reasonText = (reason: string | null) => {
    if (!reason) return t("bulkPlan.reasonUnknown");
    const key = REASON_KEYS[reason];
    return key ? t(key) : reason;
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-11 sm:h-8"
        disabled={disabled}
        aria-describedby={disabled ? disabledDescriptionId : undefined}
        onClick={() => {
          setResults(null);
          setError(null);
          setOpen(true);
        }}
      >
        {t("bulkPlan.open")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setResults(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="pr-10 sm:pr-0">
              {t(
                isSealed
                  ? items.length === 1 ? "bulkPlan.titleSealedOne" : "bulkPlan.titleSealed"
                  : items.length === 1 ? "bulkPlan.titleCard" : "bulkPlan.titleCards",
                { count: items.length },
              )}
            </DialogTitle>
            <DialogDescription>
              {t(isSealed ? "bulkPlan.descriptionSealed" : "bulkPlan.descriptionCards")}
            </DialogDescription>
          </DialogHeader>

          {results === null ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="add-to-plan-plan">{t("bulkPlan.plan")}</Label>
                <select
                  id="add-to-plan-plan"
                  className="border-input bg-background h-11 w-full rounded-md border px-2 text-sm sm:h-9"
                  value={planId ?? ""}
                  onChange={(event) => setPlanId(event.target.value ? Number(event.target.value) : null)}
                >
                  {plans.length === 0 && <option value="">{t("bulkPlan.noPlans")}</option>}
                  {plans.map((plan) => (
                    <option key={plan.plan_id} value={plan.plan_id}>
                      {plan.name} [{t(`purchasePlanner.status.${plan.status}` as never)}]
                    </option>
                  ))}
                </select>
              </div>

              {items.length > 1 && (
                <div className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                  <div className="space-y-1">
                    <Label htmlFor="add-to-plan-bulk-qty" className="text-xs">
                      {t("bulkPlan.copies")}
                    </Label>
                    <Input
                      id="add-to-plan-bulk-qty"
                      type="number"
                      min="1"
                      max={MAX_QUANTITY}
                      step="1"
                      className="h-11 w-24 sm:h-8 sm:w-20"
                      value={bulkQuantity}
                      onChange={(event) => setBulkQuantity(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="add-to-plan-bulk-ceiling" className="text-xs">
                      {t("bulkPlan.maxYen")}
                    </Label>
                    <Input
                      id="add-to-plan-bulk-ceiling"
                      type="number"
                      min="0"
                      max={MAX_CEILING_JPY}
                      className="h-11 w-28 sm:h-8 sm:w-24"
                      placeholder={t("bulkPlan.noLimit")}
                      value={bulkCeiling}
                      onChange={(event) => setBulkCeiling(event.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-11 sm:h-8"
                    onClick={applyToAll}
                  >
                    {t("bulkPlan.applyAll")}
                  </Button>
                </div>
              )}

              <div className="overflow-hidden rounded-md border">
                <div className="text-muted-foreground hidden grid-cols-[minmax(0,1fr)_5rem_6rem] gap-2 border-b px-3 py-1.5 text-xs sm:grid">
                  <span>{t("bulkPlan.item")}</span>
                  <span>{t("bulkPlan.copies")}</span>
                  <span>{t("bulkPlan.maxYen")}</span>
                </div>
                <ul className="max-h-72 overflow-y-auto">
                  {items.map((item) => {
                    const label = itemLabel(item);
                    return (
                      <li
                        key={item.key}
                        className="grid grid-cols-2 items-end gap-2 border-b px-3 py-2 last:border-0 sm:grid-cols-[minmax(0,1fr)_5rem_6rem] sm:items-center sm:py-1.5"
                      >
                        <span className="col-span-2 break-words text-sm sm:col-span-1 sm:truncate" title={label}>{label}</span>
                        <div className="flex min-w-0 flex-col items-stretch gap-1 sm:block">
                          <span className="text-muted-foreground text-xs sm:sr-only">{t("bulkPlan.copies")}</span>
                          <Input
                            type="number"
                            min="1"
                            max={MAX_QUANTITY}
                            step="1"
                            className="h-11 w-full sm:h-8"
                            aria-label={t("bulkPlan.copiesOf", { name: label })}
                            value={wanted[item.key]?.quantity ?? "1"}
                            onChange={(event) => setRow(item.key, { quantity: event.target.value })}
                          />
                        </div>
                        <div className="flex min-w-0 flex-col items-stretch gap-1 sm:block">
                          <span className="text-muted-foreground text-xs sm:sr-only">{t("bulkPlan.maxYen")}</span>
                          <Input
                            type="number"
                            min="0"
                            max={MAX_CEILING_JPY}
                            className="h-11 w-full sm:h-8"
                            placeholder={t("bulkPlan.none")}
                            aria-label={t("bulkPlan.maxFor", { name: label })}
                            value={wanted[item.key]?.ceiling ?? ""}
                            onChange={(event) => setRow(item.key, { ceiling: event.target.value })}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              {validationError && <p role="alert" className="text-sm text-destructive">{validationError}</p>}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
          ) : (
            <div className="space-y-3 text-sm" aria-live="polite">
              <p className="font-medium">
                {t("bulkPlan.onPlanSummary", { done: successful.length, total: items.length })}
              </p>
              {successful.length > 0 && (
                <div className="rounded-md border">
                  <div className="text-muted-foreground border-b px-3 py-1.5 text-xs">
                    {t("bulkPlan.onPlan")}
                  </div>
                  <ul className="max-h-48 overflow-y-auto">
                    {successful.map((result) => {
                      const item = byKey.get(resultKey(result));
                      const detail = result.added
                        ? [
                            result.source,
                            result.asking_price == null
                              ? null
                              : `¥${Math.round(Number(result.asking_price)).toLocaleString()}`,
                          ].filter(Boolean).join(" · ")
                        : reasonText(result.reason);
                      return (
                        <li key={resultKey(result)} className="border-b px-3 py-1.5 text-xs last:border-0">
                          <span className="font-medium">{item ? itemLabel(item) : resultKey(result)}</span>
                          {detail && <span className="text-muted-foreground"> · {detail}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {short.length > 0 && (
                <div className="border-destructive/40 rounded-md border">
                  <div className="text-muted-foreground border-b px-3 py-1.5 text-xs">
                    {t("bulkPlan.shortfall")}
                  </div>
                  <ul className="max-h-40 overflow-y-auto">
                    {short.map((result) => {
                      const key = resultKey(result);
                      const item = byKey.get(key);
                      const parsed = parseWanted(wanted[key] ?? { quantity: "1", ceiling: "" });
                      return (
                        <li key={key} className="border-b px-3 py-1.5 text-xs last:border-0">
                          {t("bulkPlan.shortfallDetail", {
                            name: item ? itemLabel(item) : key,
                            source: result.source ?? t("bulkPlan.unknownSource"),
                            available: result.available_quantity ?? 0,
                            wanted: parsed?.quantity ?? 0,
                          })}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {skipped.length > 0 && (
                <div className="rounded-md border">
                  <div className="text-muted-foreground border-b px-3 py-1.5 text-xs">
                    {t("bulkPlan.notAdded")}
                  </div>
                  <ul className="max-h-56 overflow-y-auto">
                    {skipped.map((result) => {
                      const item = byKey.get(resultKey(result));
                      return (
                        <li key={resultKey(result)} className="border-b px-3 py-1.5 text-xs last:border-0">
                          {item ? itemLabel(item) : resultKey(result)} · {reasonText(result.reason)}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
          )}

          <DialogFooter>
            <Button className="h-11 sm:h-9" variant="outline" onClick={() => setOpen(false)}>
              {results === null ? t("common.cancel") : t("common.close")}
            </Button>
            {results === null ? (
              <Button
                className="h-11 sm:h-9"
                onClick={() => void submit(items.map((item) => item.key))}
                disabled={disabled || busy || planId == null || validationError != null}
              >
                {busy
                  ? t("bulkPlan.adding")
                  : totalCopies === 1
                    ? t("bulkPlan.addCopy")
                    : t("bulkPlan.addCopies", { count: totalCopies })}
              </Button>
            ) : retryKeys.length > 0 ? (
              <Button
                className="h-11 sm:h-9"
                onClick={() => void submit(retryKeys)}
                disabled={disabled || busy}
              >
                {busy ? t("bulkPlan.adding") : t("bulkPlan.retry", { count: retryKeys.length })}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

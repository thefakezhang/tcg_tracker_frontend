"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatJpy } from "@/lib/money";
import { formatMutationError } from "@/lib/mutation-error";
import { isBuyerFloatOutcomeUnknown } from "@/lib/buyer-float-pending";
import {
  RECONCILIATION_COMPONENTS,
  clearPendingPurchaseReconciliation,
  createPendingPurchaseReconciliation,
  writePendingPurchaseReconciliation,
  type PendingPurchaseReconciliation,
  type PurchaseReconciliationPayload,
  type ReconciliationComponent,
  type SourceFunding,
} from "@/lib/purchase-reconciliation-pending";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import type { PurchasePlan } from "@/lib/purchase-planning";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectClass =
  "min-h-12 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring sm:min-h-9";

export type ReconciliationSourceFacts = {
  source: string;
  purchased_lines: number;
  card_jpy: number;
  handling_jpy: number;
  line_fee_jpy: number;
  buyer_handling_jpy: number;
  shipping_jpy: number;
  payment_fee_jpy: number;
  customs_jpy: number;
  other_jpy: number;
  total_jpy: number;
};

type Trip = { trip_id: number; name: string };
type FundingDraft = Record<string, Record<ReconciliationComponent, string>>;

const COMPONENT_LABELS: Record<ReconciliationComponent, TranslationKey> = {
  card_jpy: "purchasePlanner.reconcile.component.card",
  buyer_handling_jpy: "purchasePlanner.reconcile.component.handling",
  shipping_jpy: "purchasePlanner.reconcile.component.shipping",
  payment_fee_jpy: "purchasePlanner.reconcile.component.payment",
  customs_jpy: "purchasePlanner.reconcile.component.customs",
  other_jpy: "purchasePlanner.reconcile.component.other",
};

function numberInput(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptySourceFunding(): Record<ReconciliationComponent, string> {
  return Object.fromEntries(
    RECONCILIATION_COMPONENTS.map((component) => [component, "0"]),
  ) as Record<ReconciliationComponent, string>;
}

function zeroFunding(facts: ReconciliationSourceFacts[]): FundingDraft {
  return Object.fromEntries(facts.map((fact) => [
    fact.source,
    emptySourceFunding(),
  ]));
}

function restoredFunding(request: PendingPurchaseReconciliation): FundingDraft {
  return Object.fromEntries(Object.entries(request.payload.p_float_funding_jpy).map(
    ([source, values]) => [
      source,
      Object.fromEntries(RECONCILIATION_COMPONENTS.map((component) => [
        component, String(values[component]),
      ])) as Record<ReconciliationComponent, string>,
    ],
  ));
}

function numericFunding(
  facts: ReconciliationSourceFacts[],
  draft: FundingDraft,
): Record<string, SourceFunding> | null {
  const result: Record<string, SourceFunding> = {};
  for (const fact of facts) {
    const source = draft[fact.source];
    if (!source) return null;
    const values = {} as SourceFunding;
    for (const component of RECONCILIATION_COMPONENTS) {
      const amount = numberInput(source[component]);
      if (amount == null || amount < 0) return null;
      values[component] = amount;
    }
    result[fact.source] = values;
  }
  return result;
}

function numericShipping(
  facts: ReconciliationSourceFacts[],
  draft: Record<string, string>,
): Record<string, number> | null {
  const result: Record<string, number> = {};
  for (const fact of facts) {
    const amount = numberInput(draft[fact.source] ?? "");
    if (amount == null || amount < 0) return null;
    result[fact.source] = amount;
  }
  return result;
}

function withShipping(
  facts: ReconciliationSourceFacts[],
  shipping: Record<string, number>,
): ReconciliationSourceFacts[] {
  return facts.map((fact) => ({
    ...fact,
    shipping_jpy: shipping[fact.source],
    total_jpy: Number(fact.total_jpy) - Number(fact.shipping_jpy)
      + shipping[fact.source],
  }));
}

function factsFingerprint(facts: ReconciliationSourceFacts[]): string {
  return JSON.stringify(facts.map((fact) => ({
    ...fact,
    source: fact.source.trim().toLowerCase(),
  })).sort((a, b) => a.source.localeCompare(b.source)));
}

async function loadFacts(
  planId: number,
  shipping: Record<string, number>,
): Promise<ReconciliationSourceFacts[]> {
  const { data, error } = await createClient().rpc("buyer_float_effective_source_facts", {
    p_plan_id: planId,
    p_shipping_override: shipping,
  });
  if (error) throw error;
  return ((data ?? []) as ReconciliationSourceFacts[]).map((fact) => ({
    ...fact,
    purchased_lines: Number(fact.purchased_lines),
    card_jpy: Number(fact.card_jpy),
    handling_jpy: Number(fact.handling_jpy),
    line_fee_jpy: Number(fact.line_fee_jpy),
    buyer_handling_jpy: Number(fact.buyer_handling_jpy),
    shipping_jpy: Number(fact.shipping_jpy),
    payment_fee_jpy: Number(fact.payment_fee_jpy),
    customs_jpy: Number(fact.customs_jpy),
    other_jpy: Number(fact.other_jpy),
    total_jpy: Number(fact.total_jpy),
  }));
}

export default function PurchaseReconciliationPanel({
  plan,
  trips,
  ownerId,
  pending,
  onPendingChange,
  onChanged,
}: {
  plan: PurchasePlan;
  trips: Trip[];
  ownerId: string;
  pending: PendingPurchaseReconciliation | null;
  onPendingChange: (pending: PendingPurchaseReconciliation | null) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const exactPending = pending?.payload.p_plan_id === plan.plan_id ? pending : null;
  const [facts, setFacts] = useState<ReconciliationSourceFacts[]>([]);
  const [availableJpy, setAvailableJpy] = useState(0);
  const [tripId, setTripId] = useState<number | null>(plan.trip_id);
  const [fxRate, setFxRate] = useState("");
  const [shipping, setShipping] = useState<Record<string, string>>({});
  const [funding, setFunding] = useState<FundingDraft>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const restore = async () => {
      setLoading(true);
      setLoadFailed(false);
      setError(null);
      setFacts([]);
      setAvailableJpy(0);
      if (exactPending) {
        setTripId(exactPending.payload.p_trip_id);
        setFxRate(String(exactPending.payload.p_fx_rate));
        setShipping(Object.fromEntries(Object.entries(
          exactPending.payload.p_shipping_jpy,
        ).map(([source, amount]) => [source, String(amount)])));
        setFunding(restoredFunding(exactPending));
      } else {
        setTripId(plan.trip_id);
        setFxRate("");
        setShipping({});
        setFunding({});
      }
      try {
        const shippingPayload = exactPending?.payload.p_shipping_jpy ?? {};
        const client = createClient();
        const [factRows, pool] = await Promise.all([
          loadFacts(plan.plan_id, shippingPayload),
          plan.assigned_buyer_email
            ? client.from("buyer_float_carrying_pool_v")
              .select("available_jpy")
              .eq("buyer_email", plan.assigned_buyer_email)
              .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (pool.error) throw pool.error;
        if (!live) return;
        setFacts(factRows);
        setAvailableJpy(Number(pool.data?.available_jpy ?? 0));
        if (!exactPending) {
          setShipping(Object.fromEntries(factRows.map((fact) => [
            fact.source, String(fact.shipping_jpy),
          ])));
          setFunding(zeroFunding(factRows));
        }
      } catch (loadError) {
        if (live) {
          setLoadFailed(true);
          setError(t("purchasePlanner.reconcile.loadError", {
            error: formatMutationError(loadError),
          }));
        }
      } finally {
        if (live) setLoading(false);
      }
    };
    void restore();
    return () => { live = false; };
  }, [exactPending, plan.assigned_buyer_email, plan.plan_id, plan.trip_id, t]);

  const numeric = useMemo(() => numericFunding(facts, funding), [facts, funding]);
  const shippingNumeric = useMemo(
    () => numericShipping(facts, shipping),
    [facts, shipping],
  );
  const displayFacts = useMemo(
    () => shippingNumeric ? withShipping(facts, shippingNumeric) : facts,
    [facts, shippingNumeric],
  );
  const floatTotal = useMemo(() => numeric == null ? 0 : Object.values(numeric)
    .flatMap((source) => RECONCILIATION_COMPONENTS.map((component) => source[component]))
    .reduce((sum, amount) => sum + amount, 0), [numeric]);
  const totalFacts = displayFacts.reduce((sum, fact) => sum + fact.total_jpy, 0);
  const exceedsCeiling = numeric == null || displayFacts.some((fact) =>
    RECONCILIATION_COMPONENTS.some((component) =>
      numeric[fact.source][component] > Number(fact[component])));
  const valid = exactPending != null || (
    !loading
    && !loadFailed
    && plan.assigned_buyer_email != null
    && tripId != null
    && (numberInput(fxRate) ?? 0) > 0
    && shippingNumeric != null
    && numeric != null
    && !exceedsCeiling
    && floatTotal <= availableJpy
    && facts.length > 0
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    setConfirmation(null);
    let request = exactPending;
    try {
      if (!request) {
        if (tripId == null || shippingNumeric == null || numeric == null) {
          throw new Error(t("purchasePlanner.reconcile.invalidInputs"));
        }
        const rate = numberInput(fxRate);
        if (rate == null || rate <= 0 || exceedsCeiling || floatTotal > availableJpy) {
          throw new Error(t("purchasePlanner.reconcile.invalidInputs"));
        }
        const authoritative = await loadFacts(plan.plan_id, shippingNumeric);
        if (factsFingerprint(authoritative) !== factsFingerprint(displayFacts)) {
          setFacts(authoritative);
          setShipping(Object.fromEntries(authoritative.map((fact) => [
            fact.source, String(fact.shipping_jpy),
          ])));
          setFunding(zeroFunding(authoritative));
          throw new Error(t("purchasePlanner.reconcile.factsChanged"));
        }
        const payload: PurchaseReconciliationPayload = {
          p_plan_id: plan.plan_id,
          p_trip_id: tripId,
          p_fx_rate: rate,
          p_shipping_jpy: shippingNumeric,
          p_float_funding_jpy: numeric,
        };
        request = createPendingPurchaseReconciliation(ownerId, payload);
        try {
          writePendingPurchaseReconciliation(request);
          onPendingChange(request);
        } catch (storageError) {
          throw new Error(t("purchasePlanner.reconcile.pendingWriteError", {
            error: formatMutationError(storageError),
          }));
        }
      }

      const { error: mutationError } = await createClient().rpc("reconcile_purchase_plan", {
        p_request_id: request.requestId,
        ...request.payload,
      });
      if (mutationError) {
        if (isBuyerFloatOutcomeUnknown(mutationError)) {
          setError(t("purchasePlanner.reconcile.outcomeUnknown", {
            error: formatMutationError(mutationError),
          }));
        } else {
          clearPendingPurchaseReconciliation(ownerId);
          onPendingChange(null);
          setError(t("purchasePlanner.reconcile.mutationError", {
            error: formatMutationError(mutationError),
          }));
        }
        return;
      }
      clearPendingPurchaseReconciliation(ownerId);
      onPendingChange(null);
      setConfirmation(t("purchasePlanner.reconcile.confirmation", { name: plan.name }));
      onChanged();
    } catch (mutationError) {
      setError(formatMutationError(mutationError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("purchasePlanner.reconcile.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("purchasePlanner.reconcile.intro")}
        </p>
        {!plan.assigned_buyer_email ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {t("purchasePlanner.reconcile.buyerRequired")}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="reconcile-buyer">{t("purchasePlanner.reconcile.buyer")}</Label>
            <Input
              id="reconcile-buyer"
              className="min-h-12 sm:min-h-9"
              value={plan.assigned_buyer_email ?? ""}
              disabled
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reconcile-trip">{t("purchasePlanner.reconcile.trip")}</Label>
            <select
              id="reconcile-trip"
              className={selectClass}
              value={tripId ?? ""}
              onChange={(event) => setTripId(event.target.value ? Number(event.target.value) : null)}
              disabled={exactPending != null || busy}
            >
              <option value="">{t("purchasePlanner.reconcile.selectTrip")}</option>
              {trips.map((trip) => (
                <option key={trip.trip_id} value={trip.trip_id}>{trip.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="reconcile-rate">{t("purchasePlanner.reconcile.rate")}</Label>
            <Input
              id="reconcile-rate"
              className="min-h-12 sm:min-h-9"
              inputMode="decimal"
              value={fxRate}
              onChange={(event) => setFxRate(event.target.value)}
              disabled={exactPending != null || busy}
            />
          </div>
          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <p className="text-muted-foreground">{t("purchasePlanner.reconcile.availableFloat")}</p>
            <p className="text-lg font-semibold tabular-nums">{formatJpy(availableJpy)}</p>
          </div>
        </div>

        {loading ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p> : null}
        {!loading && facts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("purchasePlanner.reconcile.noSources")}</p>
        ) : null}
        <div className="space-y-3">
          {displayFacts.map((fact) => {
            const allocated = numeric?.[fact.source];
            const sourceFloat = allocated == null ? 0 : RECONCILIATION_COMPONENTS.reduce(
              (sum, component) => sum + allocated[component], 0,
            );
            return (
              <section key={fact.source} className="space-y-3 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-medium">{fact.source}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t("purchasePlanner.reconcile.purchasedLines", { count: fact.purchased_lines })}
                    </p>
                  </div>
                  <div className="text-right text-sm tabular-nums">
                    <p>{t("purchasePlanner.reconcile.floatFunded", { amount: formatJpy(sourceFloat) })}</p>
                    <p className="text-muted-foreground">
                      {t("purchasePlanner.reconcile.businessCash", {
                        amount: formatJpy(fact.total_jpy - sourceFloat),
                      })}
                    </p>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`reconcile-shipping-${fact.source}`}>
                    {t("purchasePlanner.reconcile.shippingOverride")}
                  </Label>
                  <Input
                    id={`reconcile-shipping-${fact.source}`}
                    className="min-h-12 sm:min-h-9"
                    inputMode="numeric"
                    value={shipping[fact.source] ?? ""}
                    onChange={(event) => setShipping((current) => ({
                      ...current,
                      [fact.source]: event.target.value,
                    }))}
                    disabled={exactPending != null || busy}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {RECONCILIATION_COMPONENTS.map((component) => (
                    <div className="space-y-1" key={component}>
                      <Label htmlFor={`reconcile-${fact.source}-${component}`}>
                        {t(COMPONENT_LABELS[component])} ({t("purchasePlanner.reconcile.max", {
                          amount: formatJpy(Number(fact[component])),
                        })})
                      </Label>
                      <Input
                        id={`reconcile-${fact.source}-${component}`}
                        className="min-h-12 sm:min-h-9"
                        inputMode="numeric"
                        value={funding[fact.source]?.[component] ?? "0"}
                        onChange={(event) => setFunding((current) => ({
                          ...current,
                          [fact.source]: {
                            ...current[fact.source],
                            [component]: event.target.value,
                          },
                        }))}
                        disabled={exactPending != null || busy}
                        aria-invalid={allocated != null
                          && allocated[component] > Number(fact[component])}
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/20 p-3 text-sm tabular-nums">
          <span>{t("purchasePlanner.reconcile.overallFloat", { amount: formatJpy(floatTotal) })}</span>
          <span>{t("purchasePlanner.reconcile.overallBusiness", {
            amount: formatJpy(totalFacts - floatTotal),
          })}</span>
          <Button
            className="min-h-12 sm:ml-auto"
            disabled={!valid || busy}
            onClick={() => void submit()}
          >
            {busy
              ? t("purchasePlanner.reconcile.saving")
              : exactPending
                ? t("purchasePlanner.reconcile.retry")
                : t("purchasePlanner.reconcile.submit")}
          </Button>
        </div>
        {!exactPending && exceedsCeiling ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {t("purchasePlanner.reconcile.componentExceeded")}
          </p>
        ) : null}
        {!exactPending && floatTotal > availableJpy ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {t("purchasePlanner.reconcile.floatExceeded")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {confirmation ? <p className="text-sm text-emerald-600">{confirmation}</p> : null}
      </CardContent>
    </Card>
  );
}

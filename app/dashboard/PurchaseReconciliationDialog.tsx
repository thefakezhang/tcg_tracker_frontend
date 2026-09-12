"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { formatMutationError } from "@/lib/mutation-error";
import { classifyQueryError, QueryError } from "./use-query";
import { formatUsd } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface SourceInput {
  source: string;
  purchased_on: string;
  jpy_per_usd: string;
  rate_reference: string;
  receipt_total_jpy: string;
}
interface ReviewLine {
  plan_line_id: number;
  item_name: string;
  source: string | null;
  game: string;
  standing: boolean;
  outcome: string | null;
  purchased_quantity: number | null;
  unit_price_orig?: number | null;
  source_observed_at?: string | null;
  unit_price_jpy: number | null;
  condition_id: number | null;
  condition_seen: string | null;
  delivery_status?: string | null;
  sealed_condition?: string | null;
  variant_edition?: string | null;
  psa_grade?: number | null;
  note: string | null;
}
interface ReviewSource {
  source: string;
  card_value_jpy: number;
  handling_jpy: number;
  line_fee_jpy: number;
  shipping_jpy: number;
  other_costs_jpy: number;
  direct_total_usd: number | null;
  expense_total_usd: number | null;
}
interface InventoryReview {
  finalized: boolean;
  inventory_finalized?: boolean;
  review_digest?: string;
  can_finalize?: boolean;
  plan: { plan_id: number; name: string };
  lines?: ReviewLine[];
  sources?: ReviewSource[];
  conditions?: Record<string, number>;
  condition_options?: { condition_id: number; standard: string; code: string }[];
  costs?: { cost_id: number; source: string; kind: string; amount_jpy: number; note: string | null }[];
  receipts?: { receipt_id: number; source: string; storage_path: string; original_name: string | null }[];
  blockers?: string[];
  warnings?: string[];
  policy?: { policy_key: string; reconciliation_date: string };
  lots?: { lot_id: number; source: string; acquired_at: string; landed_cost_usd: number | null }[];
}

function withStatus(failure: unknown, status?: number) {
  if (!failure || typeof failure !== "object") return failure;
  const record = failure as Record<string, unknown>;
  return { ...record, message: record.message ?? formatMutationError(failure), status: status ?? record.status ?? record.statusCode };
}

const selectClass = "min-h-11 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
const yen = (value: number) => `¥${Number(value).toLocaleString()}`;
const issueKeys: Record<string, TranslationKey> = {
  plan_not_ordered: "reconciliation.planNotOrdered",
  buyer_not_finished: "reconciliation.buyerNotFinished",
  open_lines: "reconciliation.openLines",
  unsupported_purchase: "reconciliation.unsupportedPurchase",
  condition_review_required: "reconciliation.conditionRequired",
  purchase_inputs_required: "reconciliation.inputsRequired",
  cost_without_purchase: "reconciliation.costWithoutPurchase",
  receipt_total_mismatch: "reconciliation.receiptMismatch",
  receipt_total_unchecked: "reconciliation.receiptUnchecked",
  receipt_missing: "reconciliation.receiptMissing",
  price_above_order: "reconciliation.priceAboveOrder",
};

// A review is valid only for the exact inputs that produced its server digest.
// Editing clears it immediately; failed finalization also requires a fresh read.
export function PurchaseReconciliationDialog({ planId, open, onOpenChange, onFinalized }: {
  planId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFinalized: () => void;
}) {
  const { t } = useTranslation();
  const [review, setReview] = useState<InventoryReview | null>(null);
  const [inputs, setInputs] = useState<SourceInput[]>([]);
  const [conditions, setConditions] = useState<Record<string, number>>({});
  const [confirmedDigest, setConfirmedDigest] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [recoveryNeeded, setRecoveryNeeded] = useState(false);
  const errorKind = classifyQueryError(error);
  const accessBlocked = errorKind === "session-expired" || errorKind === "forbidden";
  const [loadAttempt, setLoadAttempt] = useState(0);
  const sequence = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    const request = ++sequence.current;
    setReview(null); setInputs([]); setConditions({}); setConfirmedDigest(null); setAcknowledged(false); setError(null); setRecoveryNeeded(false);
    inFlight.current = false;
    if (!open) { setBusy(false); return; }
    setBusy(true);
    void (async () => {
      try {
        const { data, error: failure, status } = await createClient().rpc("review_purchase_plan_inventory", { p_plan_id: planId });
        if (sequence.current !== request) return;
        if (failure) throw withStatus(failure, status);
        const next = data as InventoryReview;
        setReview(next);
        setInputs((next.sources ?? []).map(({ source }) => ({ source, purchased_on: "", jpy_per_usd: "", rate_reference: "", receipt_total_jpy: "" })));
      } catch (failure) {
        if (sequence.current === request) setError(withStatus(failure));
      } finally {
        if (sequence.current === request) setBusy(false);
      }
    })();
    return () => { sequence.current += 1; };
  }, [open, planId, loadAttempt]);

  function invalidate() { setConfirmedDigest(null); setAcknowledged(false); setError(null); setRecoveryNeeded(false); }
  function changeSource(index: number, key: keyof Omit<SourceInput, "source">, value: string) {
    invalidate();
    setInputs((rows) => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  }
  function sourceArgs() {
    return inputs.map((row) => ({ ...row, jpy_per_usd: Number(row.jpy_per_usd),
      receipt_total_jpy: row.receipt_total_jpy.trim() === "" ? null : Number(row.receipt_total_jpy) }));
  }
  const inputsValid = inputs.every((row) => row.purchased_on && row.jpy_per_usd.trim() && Number.isFinite(Number(row.jpy_per_usd)) && Number(row.jpy_per_usd) > 0
    && row.rate_reference.trim().length >= 3 && (row.receipt_total_jpy.trim() === "" || (Number.isFinite(Number(row.receipt_total_jpy)) && Number(row.receipt_total_jpy) >= 0)));

  async function refreshReview() {
    if (accessBlocked || inFlight.current || !inputsValid) return;
    inFlight.current = true; setBusy(true); invalidate();
    const request = sequence.current;
    try {
      const { data, error: failure, status } = await createClient().rpc("review_purchase_plan_inventory", {
        p_plan_id: planId, p_sources: sourceArgs(), p_conditions: conditions,
      });
      if (request !== sequence.current) return;
      if (failure) throw withStatus(failure, status);
      const next = data as InventoryReview;
      setReview(next);
      setConfirmedDigest(next.can_finalize ? next.review_digest ?? null : null);
      if (next.finalized) onFinalized();
    } catch (failure) {
      if (request === sequence.current) setError(withStatus(failure));
    } finally {
      if (request === sequence.current) { inFlight.current = false; setBusy(false); }
    }
  }
  async function finalize() {
    if (accessBlocked || inFlight.current || !confirmedDigest || ((review?.warnings?.length ?? 0) > 0 && !acknowledged)) return;
    inFlight.current = true; setBusy(true); setError(null);
    const request = sequence.current;
    try {
      const { data, error: failure, status } = await createClient().rpc("reconcile_purchase_plan_inventory", {
        p_plan_id: planId, p_review_digest: confirmedDigest, p_sources: sourceArgs(), p_conditions: conditions,
        p_acknowledge_warnings: acknowledged,
      });
      if (request !== sequence.current) return;
      if (failure) throw withStatus(failure, status);
      const next = data as InventoryReview;
      if (!next.finalized) throw new Error(t("reconciliation.unconfirmed"));
      setReview(next); setConfirmedDigest(null); onFinalized();
    } catch (failure) {
      if (request === sequence.current) {
        setConfirmedDigest(null); setAcknowledged(false);
        setError(withStatus(failure)); setRecoveryNeeded(true);
      }
    } finally {
      if (request === sequence.current) { inFlight.current = false; setBusy(false); }
    }
  }
  async function downloadReceipt(path: string, name: string | null) {
    setError(null);
    try {
      const { data, error: failure } = await createClient().storage.from("lot-receipts").download(path);
      if (failure) throw withStatus(failure);
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url; link.download = name || "receipt"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (failure) { setError(withStatus(failure)); }
  }
  function outcomeText(line: ReviewLine) {
    const keys: Record<string, TranslationKey> = {
      pending: "buyer.outcomePending", purchased: "buyer.outcomeBought", sold_out: "buyer.outcomeSoldOut",
      not_found: "buyer.outcomeNotFound", price_changed_purchased: "buyer.outcomePriceChangedBought",
      price_changed_declined: "buyer.outcomePriceChangedDeclined", declined: "buyer.outcomeDeclined",
    };
    return t(keys[line.outcome ?? "pending"] ?? "reconciliation.noInventory");
  }
  function issueText(issue: string) {
    const [code, source] = issue.split(":");
    return `${t(issueKeys[code] ?? "reconciliation.unknownBlocker")}${source ? ` (${source})` : ""}`;
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" showCloseButton={!busy}>
      <DialogHeader>
        <DialogTitle>{t("reconciliation.title")}</DialogTitle>
        <DialogDescription>{review?.plan.name} {t("reconciliation.description")}</DialogDescription>
      </DialogHeader>
      {busy && <p role="status">{t("common.loading")}</p>}
      {!!error && (accessBlocked
        ? <QueryError error={error} onRetry={() => setLoadAttempt((n) => n + 1)} />
        : <p role="alert" className="break-words text-sm text-destructive">{formatMutationError(error)}</p>)}
      {recoveryNeeded && <p className="text-sm">{t("reconciliation.retryHelp")}</p>}
      {!review && !busy && !accessBlocked && <Button className="min-h-11" onClick={() => setLoadAttempt((n) => n + 1)}>{t("common.retry")}</Button>}
      {review?.finalized ? <section className="space-y-3" aria-label={t("reconciliation.result")}>
        <p role="status" className="font-medium">{t(review.inventory_finalized ? "reconciliation.success" : "reconciliation.legacyDrafts")}</p>
        {(review.lots ?? []).map((lot) => <div key={lot.lot_id} className="flex flex-wrap justify-between gap-2 rounded border p-3">
          <span>{lot.source} · {lot.acquired_at.slice(0, 10)}</span>
          <span>{t("reconciliation.lot", { id: lot.lot_id })} · {lot.landed_cost_usd == null ? t("reconciliation.notFinalized") : formatUsd(lot.landed_cost_usd)}</span>
        </div>)}
      </section> : review && <fieldset disabled={busy || accessBlocked} className="min-w-0 space-y-4">
        <legend className="sr-only">{t("reconciliation.inputs")}</legend>
        <p className="text-sm text-muted-foreground">{t("reconciliation.fxHelp")}</p>
        {(review.lines ?? []).some((line) => !line.standing) && <section className="space-y-2 rounded border p-3" aria-label={t("reconciliation.excludedResults")}>
          <h3 className="font-medium">{t("reconciliation.excludedResults")}</h3>
          {(review.lines ?? []).filter((line) => !line.standing).map((line) => <div className="break-words text-sm" key={line.plan_line_id}>
            <p>{line.item_name} · {line.source} · {outcomeText(line)}</p>
            {line.note && <p className="text-muted-foreground">{line.note}</p>}
          </div>)}
        </section>}
        {(review.sources ?? []).map((source, index) => <section key={source.source} className="min-w-0 space-y-3 rounded-lg border p-3" aria-label={source.source}>
          <h3 className="font-semibold">{source.source}</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt>{t("reconciliation.cards")}</dt><dd className="text-right tabular-nums">{yen(source.card_value_jpy)}</dd>
            <dt>{t("reconciliation.shipping")}</dt><dd className="text-right tabular-nums">{yen(source.shipping_jpy)}</dd>
            <dt>{t("reconciliation.otherCosts")}</dt><dd className="text-right tabular-nums">{yen(source.other_costs_jpy)}</dd>
            <dt>{t("reconciliation.agentFees")}</dt><dd className="text-right tabular-nums">{yen(Number(source.handling_jpy) + Number(source.line_fee_jpy))}</dd>
          </dl>
          {(review.costs ?? []).filter((cost) => cost.source === source.source).map((cost) => <p className="break-words text-xs text-muted-foreground" key={cost.cost_id}>{t(({ shipping: "buyer.costShipping", payment_fee: "buyer.costPaymentFee", customs: "buyer.costCustoms", other: "buyer.costOther" } as Record<string, TranslationKey>)[cost.kind] ?? "buyer.costOther")}: {yen(cost.amount_jpy)}{cost.note ? ` · ${cost.note}` : ""}</p>)}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {(["purchased_on", "jpy_per_usd", "rate_reference", "receipt_total_jpy"] as const).map((key) => {
              const id = `reconcile-${source.source}-${key}`;
              const label = { purchased_on: "reconciliation.purchaseDate", jpy_per_usd: "reconciliation.fxRate", rate_reference: "reconciliation.fxReference", receipt_total_jpy: "reconciliation.receiptTotal" } as const;
              return <div key={key} className="min-w-0 space-y-1"><Label htmlFor={id}>{t(label[key])}</Label>
                <Input id={id} className="min-h-11 min-w-0" type={key === "purchased_on" ? "date" : "text"} inputMode={key === "jpy_per_usd" || key === "receipt_total_jpy" ? "decimal" : undefined}
                  maxLength={key === "rate_reference" ? 500 : undefined} value={inputs[index]?.[key] ?? ""} onChange={(event) => changeSource(index, key, event.target.value)} />
              </div>;
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t("reconciliation.receiptHelp")}</p>
          {(review.receipts ?? []).filter((receipt) => receipt.source === source.source).map((receipt) => <Button key={receipt.receipt_id} variant="outline" className="min-h-11 max-w-full whitespace-normal break-all" onClick={() => void downloadReceipt(receipt.storage_path, receipt.original_name)}>{t("reconciliation.receipt")} · {receipt.original_name}</Button>)}
          {(review.lines ?? []).filter((line) => line.source?.trim().toLowerCase() === source.source).map((line) => <div key={line.plan_line_id} className="min-w-0 space-y-1 border-t pt-3 text-sm">
            <p className="break-words font-medium">{line.item_name}</p>
            {line.unit_price_orig != null && <p className="text-xs text-muted-foreground">{t("reconciliation.plannedPrice", { amount: yen(line.unit_price_orig), date: line.source_observed_at?.slice(0, 10) ?? t("reconciliation.dateUnknown") })}</p>}
            <p>{line.standing ? `${line.purchased_quantity} × ${yen(line.unit_price_jpy ?? 0)}` : t("reconciliation.noInventory")}{line.condition_seen ? ` · ${line.condition_seen}` : ""}</p>
            {line.note && <p className="break-words text-muted-foreground">{line.note}</p>}
            {line.game === "pokemon_sealed" && <p>{line.sealed_condition} · {line.variant_edition}</p>}
            {!!line.psa_grade && <p>PSA {line.psa_grade}</p>}
            {line.standing && line.game === "pokemon" && <><Label htmlFor={`reconcile-condition-${line.plan_line_id}`}>{t("reconciliation.condition")}</Label>
              <select id={`reconcile-condition-${line.plan_line_id}`} className={selectClass} value={conditions[String(line.plan_line_id)] ?? ""} onChange={(event) => {
                invalidate(); setConditions((current) => { const next = { ...current }; if (event.target.value) next[String(line.plan_line_id)] = Number(event.target.value); else delete next[String(line.plan_line_id)]; return next; });
              }}>
                <option value="">{t(line.condition_id && !line.condition_seen ? "reconciliation.plannedCondition" : "reconciliation.chooseCondition")}</option>
                {(review.condition_options ?? []).map((condition) => <option key={condition.condition_id} value={condition.condition_id}>{condition.standard} · {condition.code}</option>)}
              </select></>}
          </div>)}
          {confirmedDigest && source.direct_total_usd != null && source.expense_total_usd != null && <p className="font-semibold">{t("reconciliation.landed")}: {formatUsd(Number(source.direct_total_usd) + Number(source.expense_total_usd))}</p>}
        </section>)}
        {!(review.sources?.length) && <p>{t("reconciliation.noPurchases")}</p>}
        <ul className="space-y-1 text-sm">{(review.blockers ?? []).map((issue) => <li key={issue} className="text-destructive">{issueText(issue)}</li>)}</ul>
        <ul className="space-y-1 text-sm">{(review.warnings ?? []).map((issue) => <li key={issue} className="text-amber-700 dark:text-amber-400">{issueText(issue)}</li>)}</ul>
        {review.policy && <p className="text-xs text-muted-foreground">{t("reconciliation.policy", { policy: review.policy.policy_key, date: review.policy.reconciliation_date })}</p>}
        {confirmedDigest && <>
          <p className="text-sm">{t("reconciliation.finalizeHelp")}</p>
          {!!review.warnings?.length && <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" className="size-5 shrink-0" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />{t("reconciliation.acknowledge")}</label>}
        </>}
      </fieldset>}
      <DialogFooter className="gap-2">
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
        {review && !review.finalized && <>
          <Button variant="outline" className="min-h-11" disabled={busy || accessBlocked || !inputsValid} onClick={() => void refreshReview()}>{t("reconciliation.reviewCosts")}</Button>
          <Button className="min-h-11" disabled={busy || accessBlocked || !confirmedDigest || (!!review.warnings?.length && !acknowledged)} onClick={() => void finalize()}>{t("reconciliation.finalize")}</Button>
        </>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

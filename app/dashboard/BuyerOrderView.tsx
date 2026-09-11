"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/dates";
import { formatMutationError } from "@/lib/mutation-error";
import { readSheetRows, toSheetRows, type SheetUpdate } from "@/lib/buyer-sheet";
import {
  useBuyerResultAutosave,
  type BuyerResultField,
  type BuyerSaveState,
} from "@/lib/buyer-result-autosave";
import {
  BUYER_CONDITIONS,
  BUYER_GRID_COLUMNS,
  isPurchaseOutcome,
  planBuyerGridPaste,
  prepareBuyerResult,
  type BuyerGridColumn,
} from "@/lib/buyer-result-grid";
import { planState, planStateKey } from "@/lib/plan-state";
import { useTranslation } from "@/lib/i18n";
import en from "@/lib/i18n/en";
import ja from "@/lib/i18n/ja";
import { conditionLabel, editionLabel } from "./use-sealed-data";
import { handlingRatePercent } from "./purchase-fee-policy";

// The buying agent's whole screen: the plans assigned to him, and a grid for
// recording what he actually bought.
//
// He works at a computer, source by source, and he is used to Excel. So the
// grid is keyboard-first - arrows and Enter move, typing edits in place, and
// values save as he leaves a cell. Anything that would make an Excel user
// reach for the mouse is a bug.
//
// Everything here goes through three database functions scoped to plans that
// name him (buyer_assigned_plans, buyer_plan_lines, buyer_record_result). The
// UI is not the boundary: the database refuses anything else, so this file can
// stay simple.

type Plan = {
  plan_id: number;
  name: string;
  status: string;
  line_count: number;
  recorded_count: number;
  finalized: boolean;
  handed_back: boolean;
};

type Line = {
  plan_line_id: number;
  source: string;
  source_listing_url: string | null;
  planned_quantity: number;
  unit_price_orig: number | null;
  currency: string | null;
  source_observed_at: string | null;
  card_name: string | null;
  card_english_name: string | null;
  set_code: string | null;
  card_number: string | null;
  image_url: string | null;
  want_id: number | null;
  want_max: number | null;
  want_filled: number | null;
  want_ceiling: number | null;
  outcome: string;
  purchased_quantity: number;
  unit_price_jpy: number | null;
  condition_seen: string | null;
  note: string | null;
  delivery_status: string | null;
  delivery_status_at: string | null;
  delivery_flow: string | null;
  game?: string;
  product_id?: number | null;
  sealed_condition?: string | null;
  variant_edition?: string | null;
};

// Mirrors delivery_status_options() in the database, which is the authority.
// Kept here only so the screen offers what will be accepted.
//
// Any of them can be set at any time. This used to offer only the step that
// naturally follows the current one, and nothing at all from 'arrived' or
// 'cancelled' - so a mis-tap was permanent and on those two the control
// vanished. He is reporting where a card is, not walking a state machine, and
// a person reporting has to be able to correct himself.
const DELIVERY_FLOWS: Record<string, string[]> = {
  curated: ["ordered", "sent_to_curation", "curating", "curation_failed",
            "sent_to_buyer", "arrived", "cancelled"],
  direct: ["ordered", "sent_to_buyer", "arrived", "cancelled"],
};

const deliveryOptions = (flow: string | null) =>
  DELIVERY_FLOWS[flow ?? "direct"] ?? DELIVERY_FLOWS.direct;

const DELIVERY_LABEL: Record<string, string> = {
  ordered: "buyer.delivOrdered",
  sent_to_curation: "buyer.delivSentToCuration",
  curating: "buyer.delivCurating",
  curation_failed: "buyer.delivCurationFailed",
  sent_to_buyer: "buyer.delivSentToBuyer",
  arrived: "buyer.delivArrived",
  cancelled: "buyer.delivCancelled",
};

// Mirrors purchase_outcome_is_buy() in the database. Two outcomes mean he
// bought the card: a plain purchase, and one where the price had moved and he
// bought it anyway.
export const isBuy = isPurchaseOutcome;

const OUTCOMES = [
  { value: "pending", key: "buyer.outcomePending" },
  { value: "purchased", key: "buyer.outcomeBought" },
  { value: "sold_out", key: "buyer.outcomeSoldOut" },
  { value: "not_found", key: "buyer.outcomeNotFound" },
  { value: "price_changed_bought", key: "buyer.outcomePriceChangedBought" },
  { value: "price_changed", key: "buyer.outcomePriceChangedDeclined" },
  { value: "declined", key: "buyer.outcomeDeclined" },
] as const;

// The columns a keyboard user moves through. Outcome first, because it is the
// answer to "did you get it" and decides whether the rest applies.
const COLUMNS = BUYER_GRID_COLUMNS;
type Column = BuyerGridColumn;

const PASTE_ERROR_KEY = {
  frozen: "buyer.paste.frozen",
  "outside-grid": "buyer.paste.outsideGrid",
  "not-rectangle": "buyer.paste.notRectangle",
  "invalid-outcome": "buyer.paste.invalidOutcome",
  "invalid-number": "buyer.paste.invalidNumber",
  "invalid-condition": "buyer.paste.invalidCondition",
  "incomplete-purchase": "buyer.paste.incompletePurchase",
} as const;

type PlanResource<Row> = { planId: number; rows: Row[] };

export default function BuyerOrderView() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [activePlan, setActivePlan] = useState<number | null>(null);
  const activePlanRef = useRef(activePlan);
  activePlanRef.current = activePlan;
  const [error, setError] = useState<string | null>(null);
  const [receiptResult, setReceiptResult] = useState<PlanResource<Receipt> | null>(null);
  const [upstreamChanged, setUpstreamChanged] = useState(false);
  const [totalsResult, setTotalsResult] = useState<PlanResource<SourceTotals> | null>(null);
  const [costResult, setCostResult] = useState<PlanResource<ShopCost> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [switchingPlan, setSwitchingPlan] = useState(false);
  const [loadingPlanId, setLoadingPlanId] = useState<number | null>(null);
  const receipts = receiptResult?.planId === activePlan ? receiptResult.rows : [];
  const totals = totalsResult?.planId === activePlan ? totalsResult.rows : [];
  const costs = costResult?.planId === activePlan ? costResult.rows : [];

  const loadPlans = useCallback(async () => {
    setError(null);
    let response: { data: unknown; error: { message?: string } | null };
    try {
      response = await createClient().rpc("buyer_assigned_plans");
    } catch (caught) {
      setError(formatMutationError(caught));
      return;
    }
    if (response.error) { setError(formatMutationError(response.error)); return; }
    const { data } = response;
    const rows = (data ?? []) as Plan[];
    setPlans(rows);
    setActivePlan((current) =>
      current ?? rows.find((r) => !r.finalized)?.plan_id ?? rows[0]?.plan_id ?? null);
  }, []);

  const totalsLoadToken = useRef(0);
  const loadTotals = useCallback(async (planId: number) => {
    const token = ++totalsLoadToken.current;
    const { data } = await createClient().rpc("buyer_source_totals", { p_plan_id: planId });
    if (token !== totalsLoadToken.current || activePlanRef.current !== planId) return;
    setTotalsResult({ planId, rows: (data ?? []) as SourceTotals[] });
  }, []);

  // He tabs through a shelf of rows in a few seconds. Refetching the totals on
  // every one of those would be a round trip per keystroke-commit, so coalesce:
  // the figures are a running tally, and a tally is allowed to land last.
  const totalsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleTotals = useCallback((planId: number) => {
    if (totalsTimer.current) clearTimeout(totalsTimer.current);
    totalsTimer.current = setTimeout(() => {
      totalsTimer.current = null;
      if (activePlanRef.current === planId) void loadTotals(planId);
    }, 600);
  }, [loadTotals]);
  useEffect(() => {
    if (!totalsTimer.current) return;
    clearTimeout(totalsTimer.current);
    totalsTimer.current = null;
  }, [activePlan]);
  useEffect(() => () => { if (totalsTimer.current) clearTimeout(totalsTimer.current); }, []);

  const persistResult = useCallback(async (next: Line) => {
    if (isBuy(next.outcome) && (next.purchased_quantity <= 0 || next.unit_price_jpy == null)) {
      return { ok: false as const, message: t("buyer.needQtyAndPrice"), terminal: false };
    }
    let rpcError: { message?: string } | null = null;
    try {
      ({ error: rpcError } = await createClient().rpc("buyer_record_result", {
        p_plan_line_id: next.plan_line_id,
        p_outcome: next.outcome,
        p_purchased_quantity: isBuy(next.outcome) ? next.purchased_quantity : 0,
        p_unit_price_jpy: isBuy(next.outcome) ? next.unit_price_jpy : null,
        p_condition_seen: next.condition_seen,
        p_note: next.note,
      }));
    } catch (caught) {
      return {
        ok: false as const,
        message: formatMutationError(caught),
        terminal: false,
      };
    }
    if (rpcError) {
      const raw = formatMutationError(rpcError);
      return {
        ok: false as const,
        message: raw.includes("purchase_complete") ? t("buyer.needQtyAndPrice") : raw,
        terminal: /finalized|handed back|no assigned plan line|not assigned/i.test(raw),
      };
    }
    if (activePlan != null) scheduleTotals(activePlan);
    return { ok: true as const };
  }, [activePlan, scheduleTotals, t]);

  const {
    rows: lines,
    states: saveStates,
    replaceRows,
    queue: queueResult,
    flush: flushResult,
    flushAll: flushAllResults,
    retry: retryResult,
    revert: revertResult,
    currentRow,
    confirmedRow,
  } = useBuyerResultAutosave<Line>({ persist: persistResult });

  const lineLoadToken = useRef(0);
  const loadLines = useCallback(async (planId: number) => {
    const token = ++lineLoadToken.current;
    setLoadingPlanId(planId);
    const { data, error: rpcError } = await createClient().rpc("buyer_plan_lines", { p_plan_id: planId });
    if (token !== lineLoadToken.current) return;
    setLoadingPlanId(null);
    if (rpcError) { setError(formatMutationError(rpcError)); return; }
    replaceRows((data ?? []) as Line[]);
  }, [replaceRows]);

  const [handBackBusy, setHandBackBusy] = useState(false);

  const handBack = useCallback(async (p: Plan) => {
    const open = p.line_count - p.recorded_count;
    // Confirm only when he is leaving work behind. A shut shop is a real
    // reason to finish early, so this asks rather than refuses.
    if (open > 0 && !window.confirm(t("buyer.confirmHandBack", { open: String(open) }))) return;
    if (!(await flushAllResults())) {
      setError(t("buyer.resolveSaveBeforeLeaving"));
      return;
    }
    setHandBackBusy(true);
    const { error } = await createClient().rpc("buyer_hand_back_plan", { p_plan_id: p.plan_id });
    setHandBackBusy(false);
    if (error) { setError(formatMutationError(error)); return; }
    setError(null);
    void loadPlans();
  }, [flushAllResults, loadPlans, t]);

  const reopen = useCallback(async (p: Plan) => {
    setHandBackBusy(true);
    const { error } = await createClient().rpc("buyer_reopen_plan", { p_plan_id: p.plan_id });
    setHandBackBusy(false);
    if (error) { setError(formatMutationError(error)); return; }
    setError(null);
    void loadPlans();
  }, [loadPlans]);

  const setDelivery = useCallback(async (line: Line, status: string) => {
    const { error } = await createClient().rpc("buyer_set_delivery_status", {
      p_plan_id: activePlan, p_source: line.source, p_status: status,
      p_plan_line_id: line.plan_line_id,
    });
    if (error) { setError(formatMutationError(error)); return; }
    setError(null);
    if (activePlan != null) void loadLines(activePlan);
  }, [activePlan, loadLines]);

  const costsLoadToken = useRef(0);
  const loadCosts = useCallback(async (planId: number) => {
    const token = ++costsLoadToken.current;
    const { data } = await createClient().rpc("buyer_source_costs", { p_plan_id: planId });
    if (token !== costsLoadToken.current || activePlanRef.current !== planId) return;
    setCostResult({ planId, rows: (data ?? []) as ShopCost[] });
  }, []);

  const receiptsLoadToken = useRef(0);
  const loadReceipts = useCallback(async (planId: number) => {
    const token = ++receiptsLoadToken.current;
    const { data } = await createClient().rpc("buyer_source_receipts", { p_plan_id: planId });
    if (token !== receiptsLoadToken.current || activePlanRef.current !== planId) return;
    setReceiptResult({ planId, rows: (data ?? []) as Receipt[] });
  }, []);

  useEffect(() => { void loadPlans(); }, [loadPlans]);
  useEffect(() => {
    if (activePlan == null) return;
    void loadLines(activePlan);
    void loadReceipts(activePlan);
    void loadTotals(activePlan);
    void loadCosts(activePlan);
  }, [activePlan, loadLines, loadReceipts, loadTotals, loadCosts]);

  // Watch for the operator changing the list under him.
  //
  // This screen used to load once and never look again, so a line added,
  // repriced or removed after he opened it never reached him - and he is
  // ordering from what is on the screen.
  //
  // It deliberately does NOT refresh the grid by itself. He may be part-way
  // through typing a price, and replacing the rows underneath a half-finished
  // edit is its own way of losing his work. It tells him, and he chooses.
  useEffect(() => {
    if (activePlan == null || upstreamChanged) return;
    let live = true;
    const signature = (rows: Line[]) =>
      rows.map((r) => [r.plan_line_id, r.planned_quantity, r.unit_price_orig,
                       r.source, r.source_listing_url, r.want_max, r.game,
                       r.product_id, r.sealed_condition, r.variant_edition].join(":"))
        .sort()
        .join("|");
    const check = async () => {
      const { data, error } = await createClient().rpc("buyer_plan_lines", { p_plan_id: activePlan });
      if (!live || error || !data) return;
      const current = lines;
      if (current && signature(data as Line[]) !== signature(current)) setUpstreamChanged(true);
    };
    const timer = setInterval(() => void check(), 30_000);
    // Coming back to the tab is the moment he is most likely to be looking.
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => { live = false; clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [activePlan, lines, upstreamChanged]);

  const plan = plans?.find((p) => p.plan_id === activePlan) ?? null;
  // Two different freezes.
  //
  // Handing the list back freezes what he RECORDED, so "finished" means
  // something. It must not freeze where the cards are: the parcels ship days
  // or weeks later, and he is the one who watches them.
  const readOnly = (plan?.finalized ?? false) || (plan?.handed_back ?? false);
  // Only closing the trip stops the delivery, by which point it has landed in
  // the books.
  const deliveryLocked = plan?.finalized ?? false;

  // Open lists only. A finalized one is the operator's now, and leaving it in
  // the picker makes finished work look like work outstanding - but the one he
  // is currently looking at stays, so selecting it does not make it vanish.
  // What the list would cost if he bought everything on it, at the prices the
  // operator recorded. He is walking a shop deciding what to skip, and the
  // only figures on screen were what he had ALREADY spent - so he could not
  // see how far through the money he was.
  const askingByShop = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines ?? []) {
      m.set(l.source, (m.get(l.source) ?? 0)
        + Number(l.unit_price_orig ?? 0) * Number(l.planned_quantity ?? 0));
    }
    return m;
  }, [lines]);
  const askingTotal = useMemo(
    () => [...askingByShop.values()].reduce((n, v) => n + v, 0), [askingByShop]);

  const pickable = useMemo(
    () => (plans ?? []).filter((p) => !p.finalized || p.plan_id === activePlan),
    [plans, activePlan],
  );

  // Grouped by source because he checks out one shop at a time; each source
  // becomes its own acquisition lot when the operator reconciles.
  // Sorting is off until he asks for it, and a third click puts it back: the
  // operator's order is itself information (they built the list in that order),
  // so it has to be reachable again rather than lost on the first click.
  const [sort, setSort] = useState<{ column: SortColumn; dir: 1 | -1 } | null>(null);
  const toggleSort = useCallback((column: SortColumn) => {
    setSort((current) =>
      current?.column !== column ? { column, dir: 1 }
      : current.dir === 1 ? { column, dir: -1 }
      : null);
  }, []);

  const bySource = useMemo(() => {
    const groups = new Map<string, Line[]>();
    for (const line of lines ?? []) {
      const key = line.source ?? "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(line);
    }
    if (sort) {
      for (const rows of groups.values()) rows.sort(compareBy(sort.column, sort.dir));
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [lines, sort]);

  // Flattened from the sorted groups, so ctrl-arrow navigation moves in the
  // order he is actually looking at rather than the order the data arrived.
  const ordered = useMemo(() => bySource.flatMap(([, rows]) => rows), [bySource]);

  const purchaseDefaults = useCallback((line: Line) => {
    const remaining = line.want_max != null
      ? Math.max(0, line.want_max - (line.want_filled ?? 0) + (line.purchased_quantity ?? 0))
      : line.planned_quantity;
    return {
      plannedQuantity: line.want_max != null
        ? Math.min(line.planned_quantity, remaining)
        : Math.max(1, line.planned_quantity),
      askingPriceJpy: line.currency === "JPY" && line.unit_price_orig != null
        ? Math.round(line.unit_price_orig)
        : null,
    };
  }, []);

  const editResult = useCallback((
    line: Line,
    patch: Partial<Line>,
    fields: BuyerResultField[],
  ) => {
    const prior = currentRow(line.plan_line_id) ?? line;
    const defaults = purchaseDefaults(prior);
    if (
      typeof patch.outcome === "string"
      && isBuy(patch.outcome)
      && !isBuy(prior.outcome)
      && defaults.plannedQuantity === 0
    ) {
      setError(t("buyer.wantAlreadyFilled"));
      return;
    }
    const next = prepareBuyerResult(prior, patch, defaults);
    queueResult(prior, next, fields);
    setError(null);
  }, [currentRow, purchaseDefaults, queueResult, t]);

  const outcomeAliases = useMemo(() => {
    const aliases = new Map<string, string>();
    for (const outcome of OUTCOMES) {
      aliases.set(outcome.value.toLocaleLowerCase(), outcome.value);
      aliases.set(t(outcome.key).trim().toLocaleLowerCase(), outcome.value);
      aliases.set(en[outcome.key].trim().toLocaleLowerCase(), outcome.value);
      aliases.set(ja[outcome.key].trim().toLocaleLowerCase(), outcome.value);
    }
    aliases.set("", "pending");
    aliases.set("-", "pending");
    aliases.set("—", "pending");
    return aliases;
  }, [t]);

  const pasteResult = useCallback((
    line: Line,
    column: Column,
    event: React.ClipboardEvent<HTMLElement>,
  ) => {
    const text = event.clipboardData.getData("text/plain");
    if (!/[\t\r\n]/.test(text)) return;
    event.preventDefault();
    const planned = planBuyerGridPaste({
      rows: ordered,
      startLineId: line.plan_line_id,
      startColumn: column,
      text,
      frozen: readOnly,
      outcomeAliases,
      defaultsForRow: purchaseDefaults,
    });
    if (!planned.ok) {
      setError(t(PASTE_ERROR_KEY[planned.reason]));
      return;
    }
    for (const edit of planned.edits) {
      queueResult(edit.prior, edit.next, edit.fields);
    }
    setError(null);
  }, [ordered, outcomeAliases, purchaseDefaults, queueResult, readOnly, t]);

  const switchPlan = useCallback(async (next: number) => {
    if (next === activePlan || switchingPlan) return;
    setSwitchingPlan(true);
    const saved = await flushAllResults();
    if (saved) {
      lineLoadToken.current += 1;
      replaceRows([]);
      setLoadingPlanId(next);
      setError(null);
      setNotice(null);
      setUpstreamChanged(false);
      setActivePlan(next);
    } else {
      setError(t("buyer.resolveSaveBeforeLeaving"));
    }
    setSwitchingPlan(false);
  }, [activePlan, flushAllResults, replaceRows, switchingPlan, t]);

  if (plans === null && error) {
    return (
      <section
        role="alert"
        className="mx-auto my-12 max-w-md rounded-lg border border-destructive/50 p-6 text-center"
      >
        <h2 className="font-semibold">{t("buyer.loadPlansFailed")}</h2>
        <p className="mt-2 break-words text-sm text-destructive">{error}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("buyer.loadPlansFailedHelp")}</p>
        <button
          type="button"
          className="mt-4 min-h-11 rounded border px-4 font-medium hover:bg-accent"
          onClick={() => void loadPlans()}
        >
          {t("common.retry")}
        </button>
      </section>
    );
  }

  if (plans === null) {
    return (
      <div role="status" className="p-8 text-center text-sm text-muted-foreground">
        {t("buyer.loading")}
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <section
        data-testid="buyer-empty-state"
        className="mx-auto my-12 max-w-md rounded-lg border border-dashed p-6 text-center"
      >
        <h2 className="font-semibold">{t("buyer.noAssignedPlans")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("buyer.noAssignedPlansHelp")}
        </p>
      </section>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 p-3 sm:p-4">
      {pickable.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="buyer-plan" className="text-sm text-muted-foreground">
            {t("buyer.purchaseList")}
          </label>
          <select
            id="buyer-plan"
            className="min-h-11 min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm sm:min-h-0 sm:flex-none"
            value={activePlan ?? ""}
            disabled={switchingPlan}
            onChange={(e) => void switchPlan(Number(e.target.value))}
          >
            {pickable.map((p) => (
              <option key={p.plan_id} value={p.plan_id}>
                {p.name} ({p.recorded_count}/{p.line_count})
                {p.handed_back ? ` - ${t("buyer.handedBack")}` : ""}
              </option>
            ))}
          </select>
          {switchingPlan && (
            <span role="status" className="text-xs text-muted-foreground">
              {t("buyer.savingBeforeSwitch")}
            </span>
          )}
        </div>
      )}

      {plan && (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h2 className="min-w-0 break-words text-lg font-semibold">{plan.name}</h2>
          <span className="text-sm text-muted-foreground">
            {t("buyer.recordedOf", { done: String(plan.recorded_count), total: String(plan.line_count) })}
          </span>
          <span className="rounded bg-muted px-2 py-0.5 text-xs">
            {t(planStateKey(planState({ status: plan.status, recordedCount: plan.recorded_count })))}
          </span>
          {plan.finalized ? (
            <span className="rounded bg-muted px-2 py-0.5 text-xs">
              {t("buyer.closed")}
            </span>
          ) : plan.handed_back ? (
            <span className="rounded bg-muted px-2 py-0.5 text-xs">
              {t("buyer.handedBack")}
            </span>
          ) : (
            // Without this the grid reads as a report. It is a worksheet, and
            // he needs to know his edits are landing as he makes them.
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-500">
              {t("buyer.openForEditing")}
            </span>
          )}

          {/* He had no way to say he was finished. The operator's only signal
              was the counter above, which cannot tell finished from stopped
              for lunch. Handing back freezes his own entries and nothing
              else, and it is his to undo until the operator closes it. */}
          <PlanTotals totals={totals} asking={askingTotal} />

          {/* A file he can take away and bring back. Thirty-odd lines across
              several shops is work he would rather do in a spreadsheet, and
              the file is also what he sends back if the app is ever down. */}
          <SheetExchange
            planId={plan.plan_id}
            planName={plan.name}
            lines={lines ?? []}
            readOnly={readOnly}
            onApplied={() => {
              void loadLines(plan.plan_id);
              void loadPlans();
              void loadTotals(plan.plan_id);
            }}
            onError={setError}
          />

          {!plan.finalized && (
            <HandBack
              plan={plan}
              busy={handBackBusy}
              onHandBack={() => void handBack(plan)}
              onReopen={() => void reopen(plan)}
            />
          )}
        </div>
      )}

      {loadingPlanId === activePlan && (
        <div role="status" className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("buyer.loadingLines")}
        </div>
      )}

      {loadingPlanId !== activePlan && plan && lines?.length === 0 && (
        <section data-testid="buyer-plan-empty-state" className="rounded border border-dashed p-6 text-center">
          <h3 className="font-medium">{t("buyer.planHasNoLines")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("buyer.planHasNoLinesHelp")}</p>
        </section>
      )}

      {upstreamChanged && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-amber-500 bg-amber-500/10 px-3 py-2 text-sm">
          <span className="flex-1">{t("buyer.listChanged")}</span>
          <button
            type="button"
            className="min-h-11 rounded border border-amber-600 px-3 font-medium text-amber-700 dark:text-amber-300 sm:min-h-0 sm:px-2 sm:py-0.5"
            onClick={() => {
              setUpstreamChanged(false);
              if (activePlan != null) { void loadLines(activePlan); void loadReceipts(activePlan); }
              void loadPlans();
            }}
          >
            {t("buyer.reloadList")}
          </button>
        </div>
      )}
      {notice && (
        <div className="rounded border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded border border-destructive/50 bg-destructive/10 p-2 text-sm">
          {error}
        </div>
      )}

      {bySource.map(([source, rows]) => (
        <section key={source} className="min-w-0 overflow-hidden rounded border">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
            <h3 className="font-medium">{source}</h3>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:gap-3">
              <span className="text-xs text-muted-foreground">
                {t("buyer.boughtOfLines", { bought: String(rows.filter((r) => isBuy(r.outcome)).length), lines: String(rows.length) })}
              </span>
              <ShopTotals totals={totals.find((x) => x.source === source)} asking={askingByShop.get(source) ?? 0} />
              <DeliveryBulk
                planId={activePlan!}
                source={source}
                rows={rows}
                readOnly={deliveryLocked}
                onMoved={(n) => {
                  setError(null);
                  if (activePlan != null) void loadLines(activePlan);
                  setNotice(t("buyer.delivBulkDone", { n: String(n) }));
                }}
                onError={setError}
              />
              <ShopCosts
                planId={activePlan!}
                source={source}
                costs={costs.filter((c) => c.source === source)}
                readOnly={readOnly}
                onSaved={() => {
                  if (activePlan == null) return;
                  void loadTotals(activePlan);
                  void loadCosts(activePlan);
                }}
                onError={setError}
              />
              <SourceReceipts
                planId={activePlan!}
                source={source}
                receipts={receipts.filter((r) => r.source === source)}
                readOnly={readOnly}
                onUploaded={() => activePlan != null && void loadReceipts(activePlan)}
                onError={setError}
              />
            </div>
          </header>
          <table className="block w-full text-sm md:table md:table-fixed">
            <caption className="sr-only">{t("buyer.resultsForShop", { shop: source })}</caption>
            <thead className="hidden text-xs text-muted-foreground md:table-header-group">
              <tr>
                {/* Position down the shop, so he can say where he is. */}
                <th className="w-8 px-2 py-1 text-right font-normal">#</th>
                <th className="px-3 py-1 text-left font-normal">{t("buyer.colCard")}</th>
                <th className="px-3 py-1 text-right font-normal">{t("buyer.colWant")}</th>
                <SortableHeader
                  label={t("buyer.colAsking")} column="asking" align="right"
                  sort={sort} onToggle={toggleSort}
                />
                <SortableHeader
                  label={t("buyer.colResult")} column="result"
                  sort={sort} onToggle={toggleSort}
                />
                <th className="px-3 py-1 text-right font-normal">{t("buyer.colQty")}</th>
                <th className="px-3 py-1 text-right font-normal">{t("buyer.colPaid")}</th>
                <th className="px-3 py-1 text-right font-normal">{t("buyer.colSubtotal")}</th>
                <th className="px-3 py-1 text-left font-normal">{t("buyer.colCondition")}</th>
                <th className="px-3 py-1 text-left font-normal">{t("buyer.colDelivery")}</th>
                <th className="px-3 py-1 text-left font-normal">{t("buyer.colNote")}</th>
                <th className="px-3 py-1 text-left font-normal">{t("buyer.colSave")}</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group">
              {rows.map((line, i) => (
                <Row
                  key={line.plan_line_id}
                  line={line}
                  confirmedLine={confirmedRow(line.plan_line_id) ?? line}
                  position={i + 1}
                  readOnly={readOnly}
                  deliveryLocked={deliveryLocked}
                  saveState={saveStates[line.plan_line_id]}
                  onEdit={editResult}
                  onFlush={() => void flushResult(line.plan_line_id)}
                  onPaste={pasteResult}
                  onRetry={() => retryResult(line.plan_line_id)}
                  onCancel={() => revertResult(line.plan_line_id)}
                  onMove={(direction, column) => moveFocus(ordered, line, direction, column)}
                  onDeliver={setDelivery}
                />
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

// Focus moves by (row, column) rather than DOM order, so Enter goes DOWN the
// column the way it does in a spreadsheet instead of jumping to the next cell.
type GridDirection = "up" | "down" | "left" | "right";

function focusGridCell(lineId: number, column: Column): boolean {
  const element = document.querySelector<HTMLElement>(`[data-cell="${lineId}:${column}"]`);
  if (!element || element.matches(":disabled")) return false;
  element.focus();
  if (element instanceof HTMLInputElement) element.select();
  return true;
}

function moveFocus(ordered: Line[], from: Line, direction: GridDirection, column: Column) {
  const rowIndex = ordered.findIndex((line) => line.plan_line_id === from.plan_line_id);
  const columnIndex = COLUMNS.indexOf(column);
  if (rowIndex < 0 || columnIndex < 0) return;

  if (direction === "up" || direction === "down") {
    const step = direction === "up" ? -1 : 1;
    for (let row = rowIndex + step; row >= 0 && row < ordered.length; row += step) {
      if (focusGridCell(ordered[row].plan_line_id, column)) return;
    }
    return;
  }

  const step = direction === "left" ? -1 : 1;
  const total = ordered.length * COLUMNS.length;
  for (
    let index = rowIndex * COLUMNS.length + columnIndex + step;
    index >= 0 && index < total;
    index += step
  ) {
    const targetRow = Math.floor(index / COLUMNS.length);
    const targetColumn = COLUMNS[index % COLUMNS.length];
    if (focusGridCell(ordered[targetRow].plan_line_id, targetColumn)) return;
  }
}

function Row({
  line, confirmedLine, position, readOnly, deliveryLocked, saveState, onEdit,
  onFlush, onPaste, onRetry, onCancel, onMove, onDeliver,
}: {
  line: Line;
  confirmedLine: Line;
  position: number;
  deliveryLocked: boolean;
  onDeliver: (line: Line, status: string) => void;
  readOnly: boolean;
  saveState?: BuyerSaveState;
  onEdit: (line: Line, patch: Partial<Line>, fields: BuyerResultField[]) => void;
  onFlush: () => void;
  onPaste: (line: Line, column: Column, event: React.ClipboardEvent<HTMLElement>) => void;
  onRetry: () => void;
  onCancel: () => void;
  onMove: (direction: GridDirection, column: Column) => void;
}) {
  const { t, language } = useTranslation();
  const purchased = isBuy(line.outcome);
  const stale = line.source_observed_at
    ? Date.now() - new Date(line.source_observed_at).getTime() > 36 * 3600 * 1000
    : false;
  const observedAt = formatDateTime(line.source_observed_at, language);

  return (
    <tr className="grid grid-cols-2 gap-x-3 gap-y-2 border-t p-3 align-middle md:table-row md:p-0">
      {/* Where he is down the shop. Deliberately the DISPLAYED position rather
          than a stable id: it is a counter for keeping his place while working
          down the list, so it has to read 1, 2, 3 whatever the sort. */}
      <td className="hidden w-8 px-2 py-1 text-right text-xs tabular-nums text-muted-foreground md:table-cell">
        {position}
      </td>
      <td className="col-span-2 p-0 md:table-cell md:px-3 md:py-1">
        {/* He is buying a specific card from a Japanese shop page. Without the
            name and the picture the grid is a list of anonymous rows and he
            cannot confirm he is buying the right thing. */}
        <div className="flex items-center gap-2">
          {line.image_url && (
            // Width is reserved, not measured. With w-auto the browser cannot
            // size the box until the file arrives, so each thumbnail landing
            // reflowed its row - and with loading="lazy" they land as he
            // scrolls, which means the list moves under his thumb while he is
            // typing a price into it. 9/12 is close enough to a card's 2.5:3.5.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={line.image_url} alt="" className="h-12 w-9 rounded-sm border object-contain" loading="lazy" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs tabular-nums text-muted-foreground md:hidden">#{position}</span>
              <span className="truncate font-medium">{line.card_name ?? t("buyer.unknownCard")}</span>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {[line.set_code, line.card_number].filter(Boolean).join(" · ")}
              {line.card_english_name ? ` · ${line.card_english_name}` : ""}
            </div>
            {line.game === "pokemon_sealed" && line.sealed_condition && line.variant_edition && (
              <div className="truncate text-xs font-medium">
                {editionLabel(t, line.variant_edition)} · {conditionLabel(t, line.sealed_condition)}
              </div>
            )}
            <div className="text-xs">
              {line.source_listing_url ? (
                <a href={line.source_listing_url} target="_blank" rel="noreferrer"
                   className="underline underline-offset-2 hover:text-primary">
                  {t("buyer.openListing")}
                </a>
              ) : (
                <span className="text-muted-foreground">{t("buyer.noLink")}</span>
              )}
              {stale && (
                <span role="note" className="ml-2 inline-flex flex-wrap gap-x-1 text-muted-foreground">
                  <span>{t("buyer.priceMayBeStale")}</span>
                  <span>{t("buyer.priceObservedAt", { time: observedAt })}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="min-w-0 py-1 tabular-nums md:table-cell md:px-3 md:text-right">
        <MobileLabel>{t("buyer.colWant")}</MobileLabel>
        {line.want_max != null ? (
          // The cap belongs to the CARD, not this listing: he fills it from
          // wherever the stock turns out to be, so he needs the running total.
          <span className="inline-block">
            {line.want_filled ?? 0}/{line.want_max}
            {line.want_ceiling != null && (
              <span className="block text-xs text-muted-foreground">
                max ¥{Math.round(line.want_ceiling).toLocaleString()}
              </span>
            )}
            <span role="note" className="block text-[11px] leading-tight text-muted-foreground">
              {t("buyer.wantAcrossSources")}
            </span>
          </span>
        ) : (
          line.planned_quantity
        )}
      </td>
      <td className="min-w-0 py-1 tabular-nums text-muted-foreground md:table-cell md:px-3 md:text-right">
        <MobileLabel>{t("buyer.colAsking")}</MobileLabel>
        {line.unit_price_orig != null ? Math.round(line.unit_price_orig).toLocaleString() : "—"}
      </td>
      <td className="col-span-2 min-w-0 py-1 md:table-cell md:px-3">
        <MobileLabel>{t("buyer.colResult")}</MobileLabel>
        <select
          data-cell={`${line.plan_line_id}:outcome`}
          aria-label={t("buyer.colResult")}
          disabled={readOnly}
          value={line.outcome}
          onChange={(e) => onEdit(line, { outcome: e.target.value }, ["outcome"])}
          onBlur={onFlush}
          onPaste={(e) => onPaste(line, "outcome", e)}
          onKeyDown={(e) => handleNav(e, (direction) => {
            e.currentTarget.blur();
            onMove(direction, "outcome");
          }, () => {
            onCancel();
            e.currentTarget.blur();
          })}
          // Transparent so the closed control reads as a grid cell, but the
          // OPTIONS carry explicit colours: the popup is drawn by the browser,
          // and it was painting a light list under text that inherited the
          // page's white. color-scheme in globals.css is the systemic half of
          // this; these two classes are the belt.
          className="min-h-[45px] w-full rounded border bg-transparent px-2 text-foreground md:min-h-0 md:max-w-[11rem] md:border-0 md:px-0"
        >
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value} className="bg-popover text-popover-foreground">
              {o.value === "pending" ? "—" : t(o.key)}
            </option>
          ))}
        </select>
      </td>
      <NumberCell
        line={line} column="qty" readOnly={readOnly || !purchased}
        value={purchased ? line.purchased_quantity : null}
        confirmedValue={isBuy(confirmedLine.outcome) ? confirmedLine.purchased_quantity : null}
        label={t("buyer.colQty")}
        onEdit={(v) => onEdit(line, { purchased_quantity: v ?? 0 }, ["purchased_quantity"])}
        onFlush={onFlush}
        onPaste={(e) => onPaste(line, "qty", e)}
        onCancel={onCancel}
        onMove={onMove}
      />
      <NumberCell
        line={line} column="price" readOnly={readOnly || !purchased}
        value={purchased ? line.unit_price_jpy : null}
        confirmedValue={isBuy(confirmedLine.outcome) ? confirmedLine.unit_price_jpy : null}
        label={t("buyer.colPaid")}
        onEdit={(v) => onEdit(line, { unit_price_jpy: v }, ["unit_price_jpy"])}
        onFlush={onFlush}
        onPaste={(e) => onPaste(line, "price", e)}
        onCancel={onCancel}
        onMove={onMove}
        groupThousands
      />
      {/* unit x qty, spelled out. The prices on this screen are per copy, and
          the total he is judged against is the product - leaving the reader to
          do that multiplication is how a 3-copy line gets read as a 1-copy
          one. */}
      <SubtotalCell line={line} purchased={purchased} label={t("buyer.colSubtotal")} />
      <ConditionCell
        line={line}
        value={line.condition_seen}
        confirmedValue={confirmedLine.condition_seen}
        readOnly={readOnly || !purchased}
        label={t("buyer.colCondition")}
        onEdit={(value) => onEdit(line, { condition_seen: value }, ["condition_seen"])}
        onFlush={onFlush}
        onPaste={(e) => onPaste(line, "condition", e)}
        onCancel={onCancel}
        onMove={onMove}
      />
      <DeliveryCell line={line} purchased={purchased} readOnly={deliveryLocked} onMoveTo={onDeliver} />
      <TextCell
        line={line} column="note" readOnly={readOnly}
        value={line.note}
        confirmedValue={confirmedLine.note}
        label={t("buyer.colNote")}
        onEdit={(v) => onEdit(line, { note: v }, ["note"])}
        onFlush={onFlush}
        onPaste={(e) => onPaste(line, "note", e)}
        onCancel={onCancel}
        onMove={onMove}
      />
      <SaveIndicator state={saveState} onRetry={onRetry} />
    </tr>
  );
}

// Enter and the arrow keys walk the column; Escape abandons the edit. Without
// this the grid is a form, and an Excel user has to mouse between every cell.
function handleNav(
  e: React.KeyboardEvent,
  move: (direction: GridDirection) => void,
  onEscape?: () => void,
) {
  if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); move("down"); }
  else if (e.key === "ArrowUp") { e.preventDefault(); move("up"); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); move("left"); }
  else if (e.key === "ArrowRight") { e.preventDefault(); move("right"); }
  else if (e.key === "Tab") { e.preventDefault(); move(e.shiftKey ? "left" : "right"); }
  else if (e.key === "Escape" && onEscape) { e.preventDefault(); onEscape(); }
}

function MobileLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium text-muted-foreground md:hidden">
      {children}
    </span>
  );
}

function NumberCell({
  line, column, value, confirmedValue, label, readOnly, onEdit, onFlush,
  onPaste, onCancel, onMove, groupThousands,
}: {
  line: Line;
  column: Column;
  value: number | null;
  confirmedValue: number | null;
  label: string;
  readOnly: boolean;
  onEdit: (value: number | null) => void;
  onFlush: () => void;
  onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  onCancel: () => void;
  onMove: (direction: GridDirection, column: Column) => void;
  // Prices are grouped while idle so they line up with the asking price beside
  // them; the raw digits come back the moment the cell is focused, because
  // separators in a field you are typing into fight the caret.
  groupThousands?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const display = (next: number | null) =>
    next == null ? "" : groupThousands && !focused ? next.toLocaleString() : String(next);
  const [draft, setDraft] = useState<string>(display(value));
  useEffect(() => {
    setDraft(display(value));
  }, [focused, groupThousands, value]);

  return (
    <td className="min-w-0 py-1 md:table-cell md:px-3 md:text-right">
      <MobileLabel>{label}</MobileLabel>
      <input
        data-cell={`${line.plan_line_id}:${column}`}
        aria-label={label}
        disabled={readOnly}
        inputMode="numeric"
        value={draft}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, "");
          setDraft(next);
          onEdit(next === "" ? null : Number(next));
        }}
        onFocus={(event) => { setFocused(true); event.currentTarget.select(); }}
        onBlur={() => {
          setFocused(false);
          onFlush();
        }}
        onPaste={onPaste}
        onKeyDown={(event) =>
          handleNav(event, (direction) => {
            event.currentTarget.blur();
            onMove(direction, column);
          }, () => {
            setDraft(confirmedValue == null ? "" : String(confirmedValue));
            onCancel();
            event.currentTarget.blur();
          })
        }
        className="min-h-[45px] w-full min-w-0 rounded border bg-transparent px-2 text-right tabular-nums disabled:text-foreground disabled:opacity-100 md:min-h-0 md:w-24 md:border-0 md:px-0"
      />
    </td>
  );
}

function ConditionCell({
  line, value, confirmedValue, label, readOnly, onEdit, onFlush, onPaste,
  onCancel, onMove,
}: {
  line: Line;
  value: string | null;
  confirmedValue: string | null;
  label: string;
  readOnly: boolean;
  onEdit: (value: string | null) => void;
  onFlush: () => void;
  onPaste: (event: React.ClipboardEvent<HTMLSelectElement>) => void;
  onCancel: () => void;
  onMove: (direction: GridDirection, column: Column) => void;
}) {
  const legacyValue = value && !BUYER_CONDITIONS.includes(value as (typeof BUYER_CONDITIONS)[number])
    ? value
    : null;
  return (
    <td className="min-w-0 py-1 md:table-cell md:px-3">
      <MobileLabel>{label}</MobileLabel>
      <select
        data-cell={`${line.plan_line_id}:condition`}
        aria-label={label}
        disabled={readOnly}
        value={value ?? ""}
        onChange={(event) => onEdit(event.target.value || null)}
        onBlur={onFlush}
        onPaste={onPaste}
        onKeyDown={(event) => handleNav(event, (direction) => {
          event.currentTarget.blur();
          onMove(direction, "condition");
        }, () => {
          onEdit(confirmedValue);
          onCancel();
          event.currentTarget.blur();
        })}
        className="min-h-[45px] w-full rounded border bg-transparent px-2 disabled:text-foreground disabled:opacity-100 md:min-h-0 md:border-0 md:px-0"
      >
        <option value="" className="bg-popover text-popover-foreground">-</option>
        {legacyValue && (
          <option value={legacyValue} className="bg-popover text-popover-foreground">{legacyValue}</option>
        )}
        {BUYER_CONDITIONS.map((condition) => (
          <option key={condition} value={condition} className="bg-popover text-popover-foreground">
            {condition}
          </option>
        ))}
      </select>
    </td>
  );
}

function TextCell({
  line, column, value, confirmedValue, label, readOnly, onEdit, onFlush,
  onPaste, onCancel, onMove,
}: {
  line: Line;
  column: Column;
  value: string | null;
  confirmedValue: string | null;
  label: string;
  readOnly: boolean;
  onEdit: (value: string | null) => void;
  onFlush: () => void;
  onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
  onCancel: () => void;
  onMove: (direction: GridDirection, column: Column) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  return (
    <td className="col-span-2 min-w-0 py-1 md:table-cell md:px-3">
      <MobileLabel>{label}</MobileLabel>
      <input
        data-cell={`${line.plan_line_id}:${column}`}
        aria-label={label}
        disabled={readOnly}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onEdit(event.target.value || null);
        }}
        onBlur={onFlush}
        onPaste={onPaste}
        onKeyDown={(event) =>
          handleNav(event, (direction) => {
            event.currentTarget.blur();
            onMove(direction, column);
          }, () => {
            setDraft(confirmedValue ?? "");
            onCancel();
            event.currentTarget.blur();
          })
        }
        className="min-h-[45px] w-full min-w-0 rounded border bg-transparent px-2 disabled:text-foreground disabled:opacity-100 md:min-h-0 md:border-0 md:px-0"
      />
    </td>
  );
}

function SaveIndicator({ state, onRetry }: { state?: BuyerSaveState; onRetry: () => void }) {
  const { t } = useTranslation();
  const current = state ?? { phase: "saved" as const };
  if (current.phase === "error") {
    return (
      <td className="col-span-2 min-w-0 py-1 md:table-cell md:px-3">
        <div role="alert" className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-destructive">
          <span className="break-words">{current.message ?? t("buyer.saveFailed")}</span>
          {current.retryable && (
            <button
              type="button"
              className="min-h-11 rounded border border-destructive/50 px-3 font-medium md:min-h-0 md:px-2 md:py-1"
              onClick={onRetry}
            >
              {t("buyer.retrySave")}
            </button>
          )}
        </div>
      </td>
    );
  }
  const label = current.phase === "pending"
    ? t("buyer.savePending")
    : current.phase === "saving"
      ? t("buyer.saving")
      : t("buyer.saved");
  return (
    <td className="col-span-2 min-w-0 py-1 text-xs text-muted-foreground md:table-cell md:px-3">
      <span role="status" aria-live="polite">{label}</span>
    </td>
  );
}


type SourceTotals = {
  source: string;
  total_lines: number;
  recorded_lines: number;
  // Lines whose purchase still stands. A cancelled card is refunded, so it
  // counts for nothing here - not as a card, not as spend, not as fee.
  purchased_lines: number;
  cards_bought: number;
  card_value_jpy: number;
  projected_handling_jpy?: number | string | null;
  projected_line_fee_jpy?: number | string | null;
  shipping_jpy: number;
  other_costs_jpy: number;
  spent_total_jpy: number;
  agent_payout_jpy: number;
  fee_policy_key?: string | null;
  fee_policy_effective_from?: string | null;
  fee_handling_rate?: number | string | null;
  fee_per_line_jpy?: number | string | null;
  fee_date?: string | null;
  fee_policy_provenance?: string | null;
};

type Receipt = {
  receipt_id: number;
  source: string;
  storage_path: string;
  original_name: string | null;
  uploaded_at: string;
};

// One checkout per shop means one receipt per shop, uploaded when he finishes
// that source rather than at the end of the trip.
//
// The receipt is what the operator reconciles the entered prices against: it
// is evidence, checked against data, which catches a mistyped price far more
// reliably than anyone re-reading the grid. So it belongs beside the source,
// while he still has it open.
function SourceReceipts({
  planId, source, receipts, readOnly, onUploaded, onError,
}: {
  planId: number;
  source: string;
  receipts: Receipt[];
  readOnly: boolean;
  onUploaded: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const inputId = `receipt-${planId}-${source}`;

  async function upload(file: File) {
    setBusy(true);
    const supabase = createClient();
    // Path is prefixed per plan and source so the storage policy can scope the
    // buyer to his own uploads without trusting the filename.
    const safe = file.name.replace(/[^\w.\-]/g, "_");
    const path = `plan-receipts/${planId}/${source}/${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from("lot-receipts").upload(path, file);
    if (upErr) { setBusy(false); onError(upErr.message); return; }
    const { error: recErr } = await supabase.rpc("buyer_record_source_receipt", {
      p_plan_id: planId, p_source: source, p_storage_path: path, p_original_name: file.name,
    });
    setBusy(false);
    if (recErr) { onError(recErr.message); return; }
    onUploaded();
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      {receipts.length > 0 && (
        <span className="text-muted-foreground">
          {t("buyer.receiptCount", { count: String(receipts.length) })}
        </span>
      )}
      {!readOnly && (
        <>
          <label
            htmlFor={inputId}
            className="flex min-h-11 cursor-pointer items-center rounded border px-3 hover:bg-accent sm:min-h-0 sm:px-2 sm:py-0.5"
          >
            {busy ? t("buyer.uploading") : receipts.length ? t("buyer.addReceipt") : t("buyer.uploadReceipt")}
          </label>
          <input
            id={inputId}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </>
      )}
    </div>
  );
}

const yen = (v: number | null | undefined) => "¥" + Math.round(Number(v ?? 0)).toLocaleString();

const finiteNumber = (value: number | string | null | undefined): number | null => {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// What this shop has cost him and what it has earned him, beside the shop it
// belongs to - he checks out one at a time, so a plan-wide figure would be the
// wrong grain.
function ShopTotals({ totals, asking }: { totals?: SourceTotals; asking: number }) {
  const { t } = useTranslation();
  if (!totals) return null;
  // The two halves come directly from the server allocation. Recalculating
  // them here would repeat the pre-460 per-source rounding bug and would make
  // a later effective policy display the wrong breakdown.
  const lineFee = finiteNumber(totals.projected_line_fee_jpy);
  const handling = finiteNumber(totals.projected_handling_jpy);
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="text-muted-foreground">
        {t("buyer.spentHere")}{" "}
        <b className="font-semibold tabular-nums text-foreground">{yen(totals.spent_total_jpy)}</b>
        {asking > 0 && <span className="tabular-nums text-muted-foreground"> / {yen(asking)}</span>}
      </span>
      <span className="text-muted-foreground">
        {t("buyer.yourFee")}{" "}
        <b className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
          {yen(totals.agent_payout_jpy)}
        </b>{" "}
        {lineFee != null && handling != null && (
          <span className="tabular-nums">
            ({t("buyer.feePerRow", { n: String(totals.purchased_lines ?? 0), amount: yen(lineFee) })}
            {" + "}
            {t("buyer.feeCommission", { amount: yen(handling) })})
          </span>
        )}
      </span>
    </span>
  );
}

// Shipping and the rest, entered by the person who actually paid them rather
// than messaged to the operator to retype. One figure per kind: entering it again corrects it,
// because he is reading one receipt.
function ShopCosts({
  planId, source, costs, readOnly, onSaved, onError,
}: {
  planId: number;
  source: string;
  costs: ShopCost[];
  readOnly: boolean;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const byKind = new Map(costs.map((c) => [c.kind, Number(c.amount_jpy)]));
  const kindLabel = (kind: string) =>
    t(COST_KINDS.find((k) => k.value === kind)?.key ?? "buyer.costOther");

  function open(kind: string) {
    setEditing(kind);
    const existing = byKind.get(kind);
    setAmount(existing == null ? "" : String(Math.round(existing)));
  }

  async function save(kind: string) {
    const value = parseTypedJpy(amount);
    if (value == null) return;
    setBusy(true);
    const { error } = await createClient().rpc("buyer_record_source_cost", {
      p_plan_id: planId, p_source: source, p_kind: kind, p_amount_jpy: value, p_note: null,
    });
    setBusy(false);
    if (error) { onError(formatMutationError(error)); return; }
    setAmount(""); setEditing(null); onSaved();
  }

  // Each kind is its own line, named, with its own figure. It used to be a
  // single button reading "shipping and fees" followed by one total, which
  // said neither what the number was made of nor that he was the one who put
  // it there - and offered him one box no matter how many receipts he had.
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {COST_KINDS.map(({ value, key }) => {
        const recorded = byKind.get(value);
        if (recorded == null && (readOnly || editing !== value)) {
          return readOnly ? null : (
            <button
              key={value}
              type="button"
              className="min-h-11 rounded border border-dashed px-3 text-muted-foreground hover:bg-accent sm:min-h-0 sm:px-2 sm:py-0.5"
              onClick={() => open(value)}
            >
              + {t(key)}
            </button>
          );
        }
        if (editing === value) {
          return (
            <span key={value} className="flex items-center gap-1">
              <span className="text-muted-foreground">{t(key)}</span>
              <input
                autoFocus
                inputMode="numeric"
                aria-label={t(key)}
                className="min-h-11 w-24 rounded border bg-background px-2 text-right sm:min-h-0 sm:w-20 sm:px-1 sm:py-0.5"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save(value);
                  if (e.key === "Escape") { setEditing(null); setAmount(""); }
                }}
              />
              <button
                type="button"
                className="min-h-11 rounded border px-3 disabled:opacity-50 sm:min-h-0 sm:px-2 sm:py-0.5"
                disabled={busy || parseTypedJpy(amount) == null}
                onClick={() => void save(value)}
              >
                {t("buyer.saveCost")}
              </button>
            </span>
          );
        }
        return readOnly ? (
          <span key={value} className="rounded border px-2 py-0.5 text-muted-foreground">
            {t(key)} <b className="tabular-nums text-foreground">{yen(recorded)}</b>
          </span>
        ) : (
          <button
            key={value}
            type="button"
            className="min-h-11 rounded border px-3 hover:bg-accent sm:min-h-0 sm:px-2 sm:py-0.5"
            onClick={() => open(value)}
          >
            {t(key)} <b className="tabular-nums text-foreground">{yen(recorded)}</b>
          </button>
        );
      })}
    </span>
  );
}

// He types a price the way it is written on the receipt. Number() gives NaN for
// every one of those, and a NaN reaches the database as null - the same way the
// operator's hand-entered prices were being lost.
export function parseTypedJpy(text: string): number | null {
  if (text.includes("-")) return null;
  const cleaned = text.replace(/[,\s]/g, "").replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Finished, or not yet. Two words and one button, because it is the last thing
// he does and it should not need explaining.
function HandBack({
  plan, busy, onHandBack, onReopen,
}: {
  plan: Plan;
  busy: boolean;
  onHandBack: () => void;
  onReopen: () => void;
}) {
  const { t } = useTranslation();
  return plan.handed_back ? (
    <button
      type="button"
      className="min-h-11 rounded border px-3 text-xs hover:bg-accent disabled:opacity-50 sm:min-h-0 sm:px-2 sm:py-0.5"
      disabled={busy}
      onClick={onReopen}
    >
      {t("buyer.reopenList")}
    </button>
  ) : (
    <button
      type="button"
      // Not bg-primary: this theme's --primary and --destructive are six
      // degrees apart in hue and both read as red, so the most consequential
      // POSITIVE action on his screen looked exactly like a delete button.
      // Solid emerald, where the badge beside it is a translucent tint, so the
      // control and the state stay tellable apart.
      className="min-h-11 rounded bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 sm:min-h-0 sm:px-2 sm:py-0.5"
      disabled={busy}
      onClick={onHandBack}
    >
      {t("buyer.handBackList")}
    </button>
  );
}

// What this line actually costs: the unit price he typed, times the copies he
// bought. Read-only on purpose - it is arithmetic, not another thing to enter.
function SubtotalCell({
  line, purchased, label,
}: {
  line: Line;
  purchased: boolean;
  label: string;
}) {
  const qty = Number(line.purchased_quantity ?? 0);
  const unit = Number(line.unit_price_jpy ?? 0);
  if (!purchased || qty <= 0 || unit <= 0) {
    return (
      <td className="min-w-0 py-1 text-muted-foreground md:table-cell md:px-3 md:text-right">
        <MobileLabel>{label}</MobileLabel>
        -
      </td>
    );
  }
  return (
    <td className="min-w-0 py-1 tabular-nums md:table-cell md:px-3 md:text-right" title={`${unit.toLocaleString()} x ${qty}`}>
      <MobileLabel>{label}</MobileLabel>
      {(unit * qty).toLocaleString()}
    </td>
  );
}

type ShopCost = { source: string; kind: string; amount_jpy: number; note: string | null };

// Customs is deliberately not here. He orders from Japanese shops to a
// Japanese address, so nothing crosses a border on his leg of the trip and
// there is no duty to pay; offering the field only invited a wrong entry.
// Nothing has ever been recorded against it. The database still permits the
// value, so re-adding it is one line here.
const COST_KINDS = [
  { value: "shipping", key: "buyer.costShipping" },
  { value: "payment_fee", key: "buyer.costPaymentFee" },
  { value: "other", key: "buyer.costOther" },
] as const;

// The whole list, once, at the top.
//
// Every figure was per shop, and the first shop on a list is often one he has
// not reached - so the first money on screen read zero with the real number
// further down, which is a total of nothing. He spends against one budget
// across every shop, and this is that number, over what the list would cost if
// he filled all of it.
function PlanTotals({ totals, asking }: { totals: SourceTotals[]; asking: number }) {
  const { t } = useTranslation();
  if (totals.length === 0) return null;
  const sum = (pick: (x: SourceTotals) => number | null | undefined) =>
    totals.reduce((n, x) => n + Number(pick(x) ?? 0), 0);
  const spent = sum((x) => x.spent_total_jpy);
  const fee = sum((x) => x.agent_payout_jpy);
  const hasBreakdown = totals.every((row) =>
    finiteNumber(row.projected_line_fee_jpy) != null
    && finiteNumber(row.projected_handling_jpy) != null);
  const lineFee = hasBreakdown
    ? sum((x) => finiteNumber(x.projected_line_fee_jpy))
    : null;
  const handling = hasBreakdown
    ? sum((x) => finiteNumber(x.projected_handling_jpy))
    : null;
  const policy = totals[0];
  const policyRate = finiteNumber(policy.fee_handling_rate);
  const policyLineFee = finiteNumber(policy.fee_per_line_jpy);
  const policySummary = policy.fee_policy_provenance === "legacy_recorded_costs"
    ? t("buyer.feePolicyLegacy")
    : policy.fee_policy_key && policy.fee_policy_effective_from
      && policyRate != null && policyLineFee != null
      ? t("buyer.feePolicy", {
          rate: handlingRatePercent(policyRate),
          amount: Math.round(policyLineFee).toLocaleString(),
          date: policy.fee_policy_effective_from,
        })
      : t("buyer.feePolicyUnavailable");
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-muted-foreground">
        {t("buyer.spentTotal")}{" "}
        <b className="font-semibold tabular-nums text-foreground">{yen(spent)}</b>
        {asking > 0 && <span className="tabular-nums"> / {yen(asking)}</span>}
      </span>
      <span className="text-muted-foreground">
        {t("buyer.feeTotal")}{" "}
        <b className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{yen(fee)}</b>{" "}
        {lineFee != null && handling != null && (
          <span className="text-xs tabular-nums">
            ({t("buyer.feePerRow", { n: String(sum((x) => x.purchased_lines)), amount: yen(lineFee) })}
            {" + "}{t("buyer.feeCommission", { amount: yen(handling) })})
          </span>
        )}
      </span>
      <span className="basis-full text-xs text-muted-foreground" data-fee-policy-provenance={policy.fee_policy_provenance ?? "unavailable"}>
        {policySummary}
      </span>
    </span>
  );
}

// Taking the list away, and bringing it back.
//
// Both libraries load only when he presses a button: together they are the
// biggest thing on this page, and most of the time he touches neither.
function SheetExchange({
  planId, planName, lines, readOnly, onApplied, onError,
}: {
  planId: number;
  planName: string;
  lines: Line[];
  readOnly: boolean;
  onApplied: () => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<"" | "down" | "up">("");

  const label = (outcome: string) => {
    const found = OUTCOMES.find((o) => o.value === outcome);
    return found && found.value !== "pending" ? t(found.key) : "";
  };
  // He may type the Japanese label, the English one, or the raw value.
  const resolveOutcome = (text: string): string | null => {
    const v = text.trim();
    if (v === "" || v === "—" || v === "-") return "pending";
    const byValue = OUTCOMES.find((o) => o.value === v);
    if (byValue) return byValue.value;
    const byLabel = OUTCOMES.find((o) => t(o.key) === v);
    return byLabel ? byLabel.value : null;
  };

  async function download() {
    setBusy("down");
    try {
      const writeXlsx = (await import("write-excel-file/browser")).default;
      const rows = toSheetRows(planId, lines, label);
      const headers = [
        t("buyer.colSheetId"), t("buyer.colShop"), t("buyer.colCard"),
        t("buyer.colSet"), t("buyer.colNumber"), t("buyer.colWant"),
        t("buyer.colAsking"), t("buyer.colResult"), t("buyer.colQty"),
        t("buyer.colPaid"), t("buyer.colNote"), t("buyer.colListing"),
        t("buyer.colSealedCondition"), t("buyer.colEdition"),
      ];
      const txt = (v: string) => ({ value: v, type: String as StringConstructor });
      const num = (v: number | null) =>
        v == null ? null : { value: v, type: Number as NumberConstructor };
      // Built as sheet data rather than through the object schema, so the
      // header row and the cell types are exactly what we say: the numeric
      // columns land as numbers, and he can total them in the sheet itself.
      const data = [
        headers.map((h) => ({ value: h, type: String as StringConstructor, fontWeight: "bold" as const })),
        ...rows.map((r) => [
          txt(r.id), txt(r.shop), txt(r.card), txt(r.set), txt(r.number),
          num(r.want), num(r.asking), txt(r.outcome), num(r.qty), num(r.unit_paid),
          txt(r.note), txt(r.listing), txt(r.condition), txt(r.edition),
        ]),
      ];
      const safe = planName.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "list";
      // The browser build hands back a writer rather than saving by itself.
      await writeXlsx(data, {
        columns: [16, 14, 26, 10, 12, 8, 12, 20, 8, 14, 30, 40, 14, 14].map((width) => ({ width })),
      }).toFile(`${safe}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy("");
    }
  }

  async function upload(file: File) {
    setBusy("up");
    try {
      const readXlsx = (await import("read-excel-file/browser")).default;
      const grid = (await readXlsx(file)) as unknown as unknown[][];
      if (grid.length < 2) { onError(t("buyer.sheetEmpty")); return; }
      // Read by POSITION, not by header text: his Excel may be in either
      // language, and he may have renamed the headers himself. The identity
      // column is what actually matters.
      const keys = ["id","shop","card","set","number","want","asking","outcome","qty","unit_paid","note","listing","condition","edition"];
      const rows = grid.slice(1).map((r) =>
        Object.fromEntries(keys.map((k, i) => [k, r[i]])) as Record<string, unknown>);

      const { updates, problems } = readSheetRows(planId, rows, lines, resolveOutcome);
      const refused = await applyUpdates(updates);
      onApplied();

      const notes = [t("buyer.sheetApplied", { n: String(updates.length - refused.length) })];
      for (const p of problems.slice(0, 5)) {
        notes.push(`${t("buyer.sheetRow", { row: String(p.row) })} ${p.reason}`);
      }
      if (problems.length > 5) notes.push(t("buyer.sheetMore", { n: String(problems.length - 5) }));
      notes.push(...refused);
      onError(problems.length || refused.length ? notes.join(" / ") : null);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy("");
    }
  }

  // One call per changed row, so one bad row cannot discard the rest of his
  // afternoon, and the database's own refusal is what he reads.
  async function applyUpdates(updates: SheetUpdate[]): Promise<string[]> {
    const supabase = createClient();
    const refused: string[] = [];
    for (const u of updates) {
      const { error } = await supabase.rpc("buyer_record_result", {
        p_plan_line_id: u.plan_line_id,
        p_outcome: u.outcome,
        p_purchased_quantity: u.purchased_quantity,
        p_unit_price_jpy: u.unit_price_jpy,
        p_condition_seen: null,
        p_note: u.note,
      });
      if (error) refused.push(`#${u.plan_line_id}: ${formatMutationError(error)}`);
    }
    return refused;
  }

  const inputId = `sheet-${planId}`;
  return (
    <span className="flex items-center gap-2 text-xs">
      <button
        type="button"
        className="min-h-11 rounded border px-3 hover:bg-accent disabled:opacity-50 sm:min-h-0 sm:px-2 sm:py-0.5"
        disabled={busy !== "" || lines.length === 0}
        onClick={() => void download()}
      >
        {busy === "down" ? t("buyer.working") : t("buyer.downloadSheet")}
      </button>
      {!readOnly && (
        <>
          <label
            htmlFor={inputId}
            className={`flex min-h-11 cursor-pointer items-center rounded border px-3 hover:bg-accent sm:min-h-0 sm:px-2 sm:py-0.5 ${busy ? "opacity-50" : ""}`}
          >
            {busy === "up" ? t("buyer.working") : t("buyer.uploadSheet")}
          </label>
          <input
            id={inputId}
            type="file"
            accept=".xlsx"
            className="hidden"
            disabled={busy !== ""}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </>
      )}
    </span>
  );
}

type SortColumn = "asking" | "result";

// Outcomes sort in the order he meets them, not alphabetically on a raw value
// he never sees: unfilled lines first, because those are the work left.
const OUTCOME_ORDER = new Map<string, number>(OUTCOMES.map((o, i) => [o.value, i]));

function compareBy(column: SortColumn, dir: 1 | -1) {
  return (a: Line, b: Line) => {
    let d = 0;
    if (column === "asking") {
      d = Number(a.unit_price_orig ?? 0) - Number(b.unit_price_orig ?? 0);
    } else {
      d = (OUTCOME_ORDER.get(a.outcome) ?? 99) - (OUTCOME_ORDER.get(b.outcome) ?? 99);
    }
    // Ties keep the operator's order, so a re-sort never reshuffles equals.
    return d !== 0 ? d * dir : a.plan_line_id - b.plan_line_id;
  };
}

// A sortable column header. The arrows are the affordance: a column that can
// be reordered has to look like one before he thinks to try it.
function SortableHeader({
  label, column, sort, onToggle, align = "left",
}: {
  label: string;
  column: SortColumn;
  sort: { column: SortColumn; dir: 1 | -1 } | null;
  onToggle: (column: SortColumn) => void;
  align?: "left" | "right";
}) {
  const active = sort?.column === column;
  return (
    <th
      className={`px-3 py-1 font-normal ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onToggle(column)}
        className={`inline-flex items-center gap-1 rounded px-1 hover:bg-accent ${
          active ? "text-foreground" : ""
        }`}
      >
        {label}
        <span aria-hidden className={active ? "" : "opacity-40"}>
          {active ? (sort!.dir === 1 ? "\u2191" : "\u2193") : "\u21c5"}
        </span>
      </button>
    </th>
  );
}

// Where this card is, and the one or two places it can go next.
//
// Locked until he has bought it: a card he did not buy has nowhere to be, and
// the database refuses a status on one. The options come from the same rule
// the database enforces, so the screen cannot offer a move that will be
// refused - including the two ways out of a failed authentication, which are
// transitions of this field rather than a second column.
function DeliveryCell({
  line, purchased, readOnly, onMoveTo,
}: {
  line: Line;
  purchased: boolean;
  readOnly: boolean;
  onMoveTo: (line: Line, status: string) => void;
}) {
  const { t } = useTranslation();
  if (!purchased) {
    return (
      <td className="col-span-2 min-w-0 py-1 text-muted-foreground md:table-cell md:px-3">
        <MobileLabel>{t("buyer.colDelivery")}</MobileLabel>
        {t("buyer.delivNotBought")}
      </td>
    );
  }
  const current = line.delivery_status;
  const flagged = current === "curation_failed";

  if (readOnly) {
    return (
      <td className={`col-span-2 min-w-0 py-1 md:table-cell md:px-3 ${flagged ? "font-medium text-amber-600 dark:text-amber-400" : ""}`}>
        <MobileLabel>{t("buyer.colDelivery")}</MobileLabel>
        {current ? t(DELIVERY_LABEL[current] as never) : "—"}
      </td>
    );
  }

  // The status itself IS the control, showing where the card is and letting him
  // say otherwise. A separate "next step" picker beside a label is what made
  // the last recorded answer unchangeable.
  return (
    <td className="col-span-2 min-w-0 py-1 md:table-cell md:px-3">
      <MobileLabel>{t("buyer.colDelivery")}</MobileLabel>
      <select
        aria-label={t("buyer.colDelivery")}
        className={`min-h-11 w-full rounded border bg-transparent px-2 text-xs md:min-h-0 md:max-w-[11rem] md:px-1 ${
          flagged ? "border-amber-600 font-medium text-amber-600 dark:text-amber-400" : "text-foreground"
        }`}
        value={current ?? ""}
        title={line.delivery_status_at ? new Date(line.delivery_status_at).toLocaleString() : ""}
        onChange={(e) => onMoveTo(line, e.target.value)}
      >
        <option value="" disabled className="bg-popover text-popover-foreground">—</option>
        {deliveryOptions(line.delivery_flow).map((status) => (
          <option key={status} value={status} className="bg-popover text-popover-foreground">
            {t(DELIVERY_LABEL[status] as never)}
          </option>
        ))}
      </select>
    </td>
  );
}

// The whole shop, in one move.
//
// He orders a shop in one basket and it arrives as one parcel, so this is the
// normal case rather than a shortcut. Rows that cannot make the move are
// skipped by the database, and it reports how many actually went.
function DeliveryBulk({
  planId, source, rows, readOnly, onMoved, onError,
}: {
  planId: number;
  source: string;
  rows: Line[];
  readOnly: boolean;
  onMoved: (n: number) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const bought = rows.filter((r) => isBuy(r.outcome));
  if (readOnly || bought.length === 0) return null;

  // Every status this shop's route allows, so one control covers a parcel
  // whose rows are not all on the same step - and can put the whole shop back
  // if he moved it by mistake.
  const options = deliveryOptions(bought[0].delivery_flow);

  async function moveAll(status: string) {
    setBusy(true);
    const { data, error } = await createClient().rpc("buyer_set_delivery_status", {
      p_plan_id: planId, p_source: source, p_status: status, p_plan_line_id: null,
    });
    setBusy(false);
    if (error) { onError(formatMutationError(error)); return; }
    onMoved(Number(data ?? 0));
  }

  return (
    <select
      aria-label={t("buyer.delivBulk")}
      disabled={busy}
      className="min-h-11 rounded border bg-background px-2 text-xs sm:min-h-0 sm:py-0.5"
      value=""
      onChange={(e) => { if (e.target.value) void moveAll(e.target.value); }}
    >
      <option value="">{t("buyer.delivBulk")}</option>
      {options.map((status) => (
        <option key={status} value={status}>{t(DELIVERY_LABEL[status] as never)}</option>
      ))}
    </select>
  );
}

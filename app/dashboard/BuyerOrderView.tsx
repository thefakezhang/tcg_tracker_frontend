"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMutationError } from "@/lib/mutation-error";
import { readSheetRows, toSheetRows, type SheetUpdate } from "@/lib/buyer-sheet";
import { planState, planStateKey } from "@/lib/plan-state";
import { useTranslation } from "@/lib/i18n";

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
};

// Mirrors delivery_status_next() in the database, which is the authority. Kept
// here only so the screen can offer the steps that exist rather than letting
// him pick one and be refused.
const DELIVERY_NEXT: Record<string, (flow: string) => string[]> = {
  "": (flow) => ["ordered"],
  ordered: (flow) => (flow === "curated" ? ["sent_to_curation", "cancelled"] : ["sent_to_buyer", "cancelled"]),
  sent_to_curation: () => ["curating", "cancelled"],
  curating: () => ["sent_to_buyer", "curation_failed"],
  // The decision, when the authenticator says the card is not what was listed.
  curation_failed: () => ["cancelled", "sent_to_buyer"],
  sent_to_buyer: () => ["arrived"],
  arrived: () => [],
  cancelled: () => [],
};

const deliveryNext = (flow: string | null, current: string | null) =>
  (DELIVERY_NEXT[current ?? ""] ?? (() => []))(flow ?? "direct");

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
export const isBuy = (outcome: string) =>
  outcome === "purchased" || outcome === "price_changed_bought";

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
const COLUMNS = ["outcome", "qty", "price", "condition", "note"] as const;
type Column = (typeof COLUMNS)[number];

export default function BuyerOrderView() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [activePlan, setActivePlan] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [upstreamChanged, setUpstreamChanged] = useState(false);
  const [totals, setTotals] = useState<SourceTotals[]>([]);
  const [costs, setCosts] = useState<ShopCost[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    const { data, error } = await createClient().rpc("buyer_assigned_plans");
    if (error) { setError(formatMutationError(error)); return; }
    const rows = (data ?? []) as Plan[];
    setPlans(rows);
    setActivePlan((current) =>
      current ?? rows.find((r) => !r.finalized)?.plan_id ?? rows[0]?.plan_id ?? null);
  }, []);

  const loadLines = useCallback(async (planId: number) => {
    const { data, error } = await createClient().rpc("buyer_plan_lines", { p_plan_id: planId });
    if (error) { setError(formatMutationError(error)); return; }
    setLines((data ?? []) as Line[]);
  }, []);

  const loadTotals = useCallback(async (planId: number) => {
    const { data } = await createClient().rpc("buyer_source_totals", { p_plan_id: planId });
    setTotals((data ?? []) as SourceTotals[]);
  }, []);

  // He tabs through a shelf of rows in a few seconds. Refetching the totals on
  // every one of those would be a round trip per keystroke-commit, so coalesce:
  // the figures are a running tally, and a tally is allowed to land last.
  const totalsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleTotals = useCallback((planId: number) => {
    if (totalsTimer.current) clearTimeout(totalsTimer.current);
    totalsTimer.current = setTimeout(() => void loadTotals(planId), 600);
  }, [loadTotals]);
  useEffect(() => () => { if (totalsTimer.current) clearTimeout(totalsTimer.current); }, []);

  const [handBackBusy, setHandBackBusy] = useState(false);

  const handBack = useCallback(async (p: Plan) => {
    const open = p.line_count - p.recorded_count;
    // Confirm only when he is leaving work behind. A shut shop is a real
    // reason to finish early, so this asks rather than refuses.
    if (open > 0 && !window.confirm(t("buyer.confirmHandBack", { open: String(open) }))) return;
    setHandBackBusy(true);
    const { error } = await createClient().rpc("buyer_hand_back_plan", { p_plan_id: p.plan_id });
    setHandBackBusy(false);
    if (error) { setError(formatMutationError(error)); return; }
    setError(null);
    void loadPlans();
  }, [loadPlans, t]);

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

  const loadCosts = useCallback(async (planId: number) => {
    const { data } = await createClient().rpc("buyer_source_costs", { p_plan_id: planId });
    setCosts((data ?? []) as ShopCost[]);
  }, []);

  const loadReceipts = useCallback(async (planId: number) => {
    const { data } = await createClient().rpc("buyer_source_receipts", { p_plan_id: planId });
    setReceipts((data ?? []) as Receipt[]);
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
  // standing in a shop buying from what is on the screen.
  //
  // It deliberately does NOT refresh the grid by itself. He may be part-way
  // through typing a price, and replacing the rows underneath a half-finished
  // edit is its own way of losing his work. It tells him, and he chooses.
  useEffect(() => {
    if (activePlan == null || upstreamChanged) return;
    let live = true;
    const signature = (rows: Line[]) =>
      rows.map((r) => [r.plan_line_id, r.planned_quantity, r.unit_price_orig,
                       r.source, r.source_listing_url, r.want_max].join(":")).sort().join("|");
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
  const readOnly = (plan?.finalized ?? false) || (plan?.handed_back ?? false);

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

  const save = useCallback(
    async (line: Line, patch: Partial<Line>) => {
      let next = { ...line, ...patch };

      // Marking a line "Bought" is the common case, and it used to fail: the
      // database (correctly) requires a purchase to carry a quantity AND a
      // price, but the natural order is to choose the outcome first and type
      // the numbers after - so the first save was always invalid.
      //
      // Selecting Bought now fills in what we already know: the quantity still
      // wanted (capped by what this listing was planned for) and the asking
      // price. That makes the record valid immediately and turns the common
      // line into one click instead of three fields.
      if (isBuy(next.outcome)) {
        const remaining =
          next.want_max != null
            ? Math.max(0, next.want_max - (next.want_filled ?? 0) + (line.purchased_quantity ?? 0))
            : next.planned_quantity;
        if (!next.purchased_quantity || next.purchased_quantity <= 0) {
          next = { ...next, purchased_quantity: Math.min(next.planned_quantity, remaining || next.planned_quantity) || 1 };
        }
        if (next.unit_price_jpy == null && next.currency === "JPY" && next.unit_price_orig != null) {
          next = { ...next, unit_price_jpy: Math.round(next.unit_price_orig) };
        }
      }
      const cell = String(line.plan_line_id);
      setSavingCells((s) => new Set(s).add(cell));
      // Optimistic: he keeps typing while this lands. A failure restores the
      // row and says why, rather than silently dropping what he entered.
      setLines((rows) => rows?.map((r) => (r.plan_line_id === line.plan_line_id ? next : r)) ?? rows);
      const { error } = await createClient().rpc("buyer_record_result", {
        p_plan_line_id: line.plan_line_id,
        p_outcome: next.outcome,
        p_purchased_quantity: isBuy(next.outcome) ? next.purchased_quantity : 0,
        p_unit_price_jpy: isBuy(next.outcome) ? next.unit_price_jpy : null,
        p_condition_seen: next.condition_seen,
        p_note: next.note,
      });
      setSavingCells((s) => { const c = new Set(s); c.delete(cell); return c; });
      if (error) {
        const raw = formatMutationError(error);
        setError(
          raw.includes("purchase_complete")
            ? t("buyer.needQtyAndPrice")
            : raw,
        );
        setLines((rows) => rows?.map((r) => (r.plan_line_id === line.plan_line_id ? line : r)) ?? rows);
        return false;
      }
      setError(null);
      // What he just bought is part of his spend and his fee.
      if (activePlan != null) scheduleTotals(activePlan);
      return true;
    },
    [activePlan, scheduleTotals],
  );

  if (plans && plans.length === 0) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        No purchase lists are assigned to you yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {pickable.length > 1 && (
        <div className="flex items-center gap-2">
          <label htmlFor="buyer-plan" className="text-sm text-muted-foreground">
            {t("buyer.purchaseList")}
          </label>
          <select
            id="buyer-plan"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={activePlan ?? ""}
            onChange={(e) => setActivePlan(Number(e.target.value))}
          >
            {pickable.map((p) => (
              <option key={p.plan_id} value={p.plan_id}>
                {p.name} ({p.recorded_count}/{p.line_count})
                {p.handed_back ? ` - ${t("buyer.handedBack")}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {plan && (
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold">{plan.name}</h2>
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

          {/* A file he can take away and bring back. Shops have no signal, and
              he would sometimes rather work a list on a laptop at the hotel. */}
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

      {upstreamChanged && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-amber-500 bg-amber-500/10 px-3 py-2 text-sm">
          <span className="flex-1">{t("buyer.listChanged")}</span>
          <button
            type="button"
            className="rounded border border-amber-600 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300"
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
        <section key={source} className="rounded border">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
            <h3 className="font-medium">{source}</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {t("buyer.boughtOfLines", { bought: String(rows.filter((r) => isBuy(r.outcome)).length), lines: String(rows.length) })}
              </span>
              <ShopTotals totals={totals.find((x) => x.source === source)} asking={askingByShop.get(source) ?? 0} />
              <DeliveryBulk
                planId={activePlan!}
                source={source}
                rows={rows}
                readOnly={readOnly}
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
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
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
                <th className="px-3 py-1 text-left font-normal">{t("buyer.colDelivery")}</th>
                <th className="px-3 py-1 text-left font-normal">{t("buyer.colNote")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((line, i) => (
                <Row
                  key={line.plan_line_id}
                  line={line}
                  position={i + 1}
                  readOnly={readOnly}
                  saving={savingCells.has(String(line.plan_line_id))}
                  onSave={save}
                  onMove={(dir, column) => moveFocus(ordered, line, dir, column)}
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
function moveFocus(ordered: Line[], from: Line, dir: -1 | 1, column: Column) {
  const index = ordered.findIndex((l) => l.plan_line_id === from.plan_line_id);
  const target = ordered[index + dir];
  if (!target) return;
  const el = document.querySelector<HTMLElement>(
    `[data-cell="${target.plan_line_id}:${column}"]`,
  );
  el?.focus();
  if (el instanceof HTMLInputElement) el.select();
}

function Row({
  line, position, readOnly, saving, onSave, onMove, onDeliver,
}: {
  line: Line;
  position: number;
  onDeliver: (line: Line, status: string) => void;
  readOnly: boolean;
  saving: boolean;
  onSave: (line: Line, patch: Partial<Line>) => Promise<boolean>;
  onMove: (dir: -1 | 1, column: Column) => void;
}) {
  const { t } = useTranslation();
  const purchased = isBuy(line.outcome);
  const stale = line.source_observed_at
    ? Date.now() - new Date(line.source_observed_at).getTime() > 36 * 3600 * 1000
    : false;

  return (
    <tr className="border-t align-middle">
      {/* Where he is down the shop. Deliberately the DISPLAYED position rather
          than a stable id: it is a counter for keeping his place while working
          down the list, so it has to read 1, 2, 3 whatever the sort. */}
      <td className="w-8 px-2 py-1 text-right text-xs tabular-nums text-muted-foreground">
        {position}
      </td>
      <td className="px-3 py-1">
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
            <div className="truncate font-medium">{line.card_name ?? "unknown card"}</div>
            <div className="truncate text-xs text-muted-foreground">
              {[line.set_code, line.card_number].filter(Boolean).join(" · ")}
              {line.card_english_name ? ` · ${line.card_english_name}` : ""}
            </div>
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
                <span className="ml-2 text-muted-foreground" title={line.source_observed_at ?? ""}>
                  {t("buyer.priceMayBeStale")}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-1 text-right tabular-nums">
        {line.want_max != null ? (
          // The cap belongs to the CARD, not this listing: he fills it from
          // wherever the stock turns out to be, so he needs the running total.
          <span title="total wanted across every source">
            {line.want_filled ?? 0}/{line.want_max}
            {line.want_ceiling != null && (
              <span className="block text-xs text-muted-foreground">
                max ¥{Math.round(line.want_ceiling).toLocaleString()}
              </span>
            )}
          </span>
        ) : (
          line.planned_quantity
        )}
      </td>
      <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">
        {line.unit_price_orig != null ? Math.round(line.unit_price_orig).toLocaleString() : "—"}
      </td>
      <td className="px-3 py-1">
        <select
          data-cell={`${line.plan_line_id}:outcome`}
          disabled={readOnly}
          value={line.outcome}
          onChange={(e) => void onSave(line, { outcome: e.target.value })}
          onKeyDown={(e) => handleNav(e, (d) => onMove(d, "outcome"))}
          // Transparent so the closed control reads as a grid cell, but the
          // OPTIONS carry explicit colours: the popup is drawn by the browser,
          // and it was painting a light list under text that inherited the
          // page's white. color-scheme in globals.css is the systemic half of
          // this; these two classes are the belt.
          className="w-full max-w-[11rem] bg-transparent text-foreground"
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
        onCommit={(v) => onSave(line, { purchased_quantity: v ?? 0 })}
        onMove={onMove}
      />
      <NumberCell
        line={line} column="price" readOnly={readOnly || !purchased}
        value={purchased ? line.unit_price_jpy : null}
        onCommit={(v) => onSave(line, { unit_price_jpy: v })}
        onMove={onMove}
        groupThousands
      />
      {/* unit x qty, spelled out. The prices on this screen are per copy, and
          the total he is judged against is the product - leaving the reader to
          do that multiplication is how a 3-copy line gets read as a 1-copy
          one. */}
      <SubtotalCell line={line} purchased={purchased} />
      <DeliveryCell line={line} purchased={purchased} readOnly={readOnly} onMoveTo={onDeliver} />
      {/* The condition column is gone. It sat beside the note as a second
          free-text box asking for something the listing already states, and he
          fills this in one-handed in a shop. condition_seen stays in the
          schema and in the operator's view; he is simply not asked twice. */}
      <TextCell
        line={line} column="note" readOnly={readOnly}
        value={line.note}
        onCommit={(v) => onSave(line, { note: v })}
        onMove={onMove}
      />
      <td className="w-6 pr-2 text-xs text-muted-foreground">{saving ? "…" : ""}</td>
    </tr>
  );
}

// Enter and the arrow keys walk the column; Escape abandons the edit. Without
// this the grid is a form, and an Excel user has to mouse between every cell.
function handleNav(
  e: React.KeyboardEvent,
  move: (dir: -1 | 1) => void,
  onEscape?: () => void,
) {
  if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
  else if (e.key === "Escape" && onEscape) { e.preventDefault(); onEscape(); }
}

function NumberCell({
  line, column, value, readOnly, onCommit, onMove, groupThousands,
}: {
  line: Line;
  column: Column;
  value: number | null;
  readOnly: boolean;
  onCommit: (value: number | null) => void;
  onMove: (dir: -1 | 1, column: Column) => void;
  // Prices are grouped while idle so they line up with the asking price beside
  // them; the raw digits come back the moment the cell is focused, because
  // separators in a field you are typing into fight the caret.
  groupThousands?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const format = (v: number | null) =>
    v == null ? "" : groupThousands && !focused ? v.toLocaleString() : String(v);
  const [draft, setDraft] = useState<string>(format(value));
  const committed = useRef(value == null ? "" : String(value));
  useEffect(() => {
    setDraft(format(value));
    committed.current = value == null ? "" : String(value);
  }, [value, focused]);

  return (
    <td className="px-3 py-1 text-right">
      <input
        data-cell={`${line.plan_line_id}:${column}`}
        disabled={readOnly}
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))}
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
        // Commit on leaving the cell, which is what a spreadsheet does and what
        // makes tabbing away safe.
        onBlur={() => {
          setFocused(false);
          if (draft === committed.current) return;
          committed.current = draft;
          onCommit(draft === "" ? null : Number(draft));
        }}
        onKeyDown={(e) =>
          handleNav(e, (d) => { e.currentTarget.blur(); onMove(d, column); },
            () => { setDraft(committed.current); e.currentTarget.blur(); })
        }
        className="w-24 bg-transparent text-right tabular-nums disabled:text-muted-foreground/40"
      />
    </td>
  );
}

function TextCell({
  line, column, value, readOnly, onCommit, onMove,
}: {
  line: Line;
  column: Column;
  value: string | null;
  readOnly: boolean;
  onCommit: (value: string | null) => void;
  onMove: (dir: -1 | 1, column: Column) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const committed = useRef(draft);
  useEffect(() => {
    setDraft(value ?? "");
    committed.current = value ?? "";
  }, [value]);

  return (
    <td className="px-3 py-1">
      <input
        data-cell={`${line.plan_line_id}:${column}`}
        disabled={readOnly}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === committed.current) return;
          committed.current = draft;
          onCommit(draft === "" ? null : draft);
        }}
        onKeyDown={(e) =>
          handleNav(e, (d) => { e.currentTarget.blur(); onMove(d, column); },
            () => { setDraft(committed.current); e.currentTarget.blur(); })
        }
        className="w-full bg-transparent disabled:text-muted-foreground/40"
      />
    </td>
  );
}


type SourceTotals = {
  source: string;
  total_lines: number;
  recorded_lines: number;
  purchased_lines: number;
  cards_bought: number;
  card_value_jpy: number;
  shipping_jpy: number;
  other_costs_jpy: number;
  spent_total_jpy: number;
  agent_payout_jpy: number;
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
            className="cursor-pointer rounded border px-2 py-0.5 hover:bg-accent"
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

// What this shop has cost him and what it has earned him, beside the shop it
// belongs to - he checks out one at a time, so a plan-wide figure would be the
// wrong grain.
function ShopTotals({ totals, asking }: { totals?: SourceTotals; asking: number }) {
  const { t } = useTranslation();
  if (!totals) return null;
  // The two halves of what he is owed, shown separately because they answer
  // different questions: the line fee is his wage for working the shelf, the
  // 3% is a commission on what he actually bought. A single number told him
  // neither, and he cannot check a number he cannot take apart.
  const lineFee = 100 * Number(totals.purchased_lines ?? 0);
  const commission = Math.max(0, Number(totals.agent_payout_jpy ?? 0) - lineFee);
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
        <span className="tabular-nums">
          ({t("buyer.feePerRow", { n: String(totals.purchased_lines ?? 0), amount: yen(lineFee) })}
          {" + "}
          {t("buyer.feeCommission", { amount: yen(commission) })})
        </span>
      </span>
    </span>
  );
}

// Shipping and the rest, entered where he is standing rather than messaged to
// the operator to retype. One figure per kind: entering it again corrects it,
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
              className="rounded border border-dashed px-2 py-0.5 text-muted-foreground hover:bg-accent"
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
                className="w-20 rounded border bg-background px-1 py-0.5 text-right"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save(value);
                  if (e.key === "Escape") { setEditing(null); setAmount(""); }
                }}
              />
              <button
                type="button"
                className="rounded border px-2 py-0.5 disabled:opacity-50"
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
            className="rounded border px-2 py-0.5 hover:bg-accent"
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
// he does and he does it on a phone in a shop.
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
      className="rounded border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
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
      className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      disabled={busy}
      onClick={onHandBack}
    >
      {t("buyer.handBackList")}
    </button>
  );
}

// What this line actually costs: the unit price he typed, times the copies he
// bought. Read-only on purpose - it is arithmetic, not another thing to enter.
function SubtotalCell({ line, purchased }: { line: Line; purchased: boolean }) {
  const qty = Number(line.purchased_quantity ?? 0);
  const unit = Number(line.unit_price_jpy ?? 0);
  if (!purchased || qty <= 0 || unit <= 0) {
    return <td className="px-3 py-1 text-right text-muted-foreground">—</td>;
  }
  return (
    <td className="px-3 py-1 text-right tabular-nums" title={`${unit.toLocaleString()} x ${qty}`}>
      {(unit * qty).toLocaleString()}
    </td>
  );
}

type ShopCost = { source: string; kind: string; amount_jpy: number; note: string | null };

// Customs is deliberately not here. He buys in Japan and pays at the counter;
// there is no import duty on that side of the trip, and offering the field
// only invited a wrong entry. Nothing has ever been recorded against it. The
// database still permits the value, so re-adding it is one line here.
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
  const lineFee = 100 * sum((x) => x.purchased_lines);
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
        <span className="text-xs tabular-nums">
          ({t("buyer.feePerRow", { n: String(sum((x) => x.purchased_lines)), amount: yen(lineFee) })}
          {" + "}{t("buyer.feeCommission", { amount: yen(Math.max(0, fee - lineFee)) })})
        </span>
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
          txt(r.note), txt(r.listing),
        ]),
      ];
      const safe = planName.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "list";
      // The browser build hands back a writer rather than saving by itself.
      await writeXlsx(data, {
        columns: [16, 14, 26, 10, 12, 8, 12, 20, 8, 14, 30, 40].map((width) => ({ width })),
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
      const keys = ["id","shop","card","set","number","want","asking","outcome","qty","unit_paid","note","listing"];
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
        className="rounded border px-2 py-0.5 hover:bg-accent disabled:opacity-50"
        disabled={busy !== "" || lines.length === 0}
        onClick={() => void download()}
      >
        {busy === "down" ? t("buyer.working") : t("buyer.downloadSheet")}
      </button>
      {!readOnly && (
        <>
          <label
            htmlFor={inputId}
            className={`cursor-pointer rounded border px-2 py-0.5 hover:bg-accent ${busy ? "opacity-50" : ""}`}
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
    return <td className="px-3 py-1 text-muted-foreground">{t("buyer.delivNotBought")}</td>;
  }
  const current = line.delivery_status;
  const next = deliveryNext(line.delivery_flow, current);
  const label = current ? t(DELIVERY_LABEL[current] as never) : "—";
  const flagged = current === "curation_failed";

  return (
    <td className="px-3 py-1">
      <span className="flex items-center gap-2">
        <span
          className={flagged ? "font-medium text-amber-600 dark:text-amber-400" : ""}
          title={line.delivery_status_at ? new Date(line.delivery_status_at).toLocaleString() : ""}
        >
          {label}
        </span>
        {!readOnly && next.length > 0 && (
          <select
            aria-label={t("buyer.colDelivery")}
            className="max-w-[10rem] rounded border bg-transparent px-1 text-xs text-foreground"
            value=""
            onChange={(e) => { if (e.target.value) onMoveTo(line, e.target.value); }}
          >
            <option value="" className="bg-popover text-popover-foreground">→</option>
            {next.map((status) => (
              <option key={status} value={status} className="bg-popover text-popover-foreground">
                {t(DELIVERY_LABEL[status] as never)}
              </option>
            ))}
          </select>
        )}
      </span>
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

  // Everything any bought row in this shop could move to next, so one control
  // covers a parcel whose rows are not all on the same step.
  const options = [...new Set(bought.flatMap((r) => deliveryNext(r.delivery_flow, r.delivery_status)))];
  if (options.length === 0) return null;

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
      className="rounded border bg-background px-2 py-0.5 text-xs"
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

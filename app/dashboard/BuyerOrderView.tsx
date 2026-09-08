"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMutationError } from "@/lib/mutation-error";
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
};

const OUTCOMES = [
  { value: "pending", key: "buyer.outcomePending" },
  { value: "purchased", key: "buyer.outcomeBought" },
  { value: "sold_out", key: "buyer.outcomeSoldOut" },
  { value: "not_found", key: "buyer.outcomeNotFound" },
  { value: "price_changed", key: "buyer.outcomePriceChanged" },
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
  }, [activePlan, loadLines, loadReceipts, loadTotals]);

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
  const pickable = useMemo(
    () => (plans ?? []).filter((p) => !p.finalized || p.plan_id === activePlan),
    [plans, activePlan],
  );

  // Grouped by source because he checks out one shop at a time; each source
  // becomes its own acquisition lot when the operator reconciles.
  const bySource = useMemo(() => {
    const groups = new Map<string, Line[]>();
    for (const line of lines ?? []) {
      const key = line.source ?? "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(line);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [lines]);

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
      if (next.outcome === "purchased") {
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
        p_purchased_quantity: next.outcome === "purchased" ? next.purchased_quantity : 0,
        p_unit_price_jpy: next.outcome === "purchased" ? next.unit_price_jpy : null,
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
                {t("buyer.boughtOfLines", { bought: String(rows.filter((r) => r.outcome === "purchased").length), lines: String(rows.length) })}
              </span>
              <ShopTotals totals={totals.find((x) => x.source === source)} />
              <ShopCosts
                planId={activePlan!}
                source={source}
                totals={totals.find((x) => x.source === source)}
                readOnly={readOnly}
                onSaved={() => activePlan != null && void loadTotals(activePlan)}
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
                <th className="px-3 py-1 text-left font-normal">{t("buyer.colCard")}</th>
                <th className="px-3 py-1 text-right font-normal">{t("buyer.colWant")}</th>
                <th className="px-3 py-1 text-right font-normal">{t("buyer.colAsking")}</th>
                <th className="px-3 py-1 text-left font-normal">{t("buyer.colResult")}</th>
                <th className="px-3 py-1 text-right font-normal">{t("buyer.colQty")}</th>
                <th className="px-3 py-1 text-right font-normal">{t("buyer.colPaid")}</th>
                <th className="px-3 py-1 text-left font-normal">{t("buyer.colCondition")}</th>
                <th className="px-3 py-1 text-left font-normal">{t("buyer.colNote")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((line) => (
                <Row
                  key={line.plan_line_id}
                  line={line}
                  readOnly={readOnly}
                  saving={savingCells.has(String(line.plan_line_id))}
                  onSave={save}
                  onMove={(dir, column) => moveFocus(ordered, line, dir, column)}
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
  line, readOnly, saving, onSave, onMove,
}: {
  line: Line;
  readOnly: boolean;
  saving: boolean;
  onSave: (line: Line, patch: Partial<Line>) => Promise<boolean>;
  onMove: (dir: -1 | 1, column: Column) => void;
}) {
  const { t } = useTranslation();
  const purchased = line.outcome === "purchased";
  const stale = line.source_observed_at
    ? Date.now() - new Date(line.source_observed_at).getTime() > 36 * 3600 * 1000
    : false;

  return (
    <tr className="border-t align-middle">
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
          className="w-full bg-transparent text-foreground"
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
      <TextCell
        line={line} column="condition" readOnly={readOnly}
        value={line.condition_seen}
        onCommit={(v) => onSave(line, { condition_seen: v })}
        onMove={onMove}
      />
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
function ShopTotals({ totals }: { totals?: SourceTotals }) {
  const { t } = useTranslation();
  if (!totals) return null;
  return (
    <span className="flex items-center gap-3 text-xs">
      <span className="text-muted-foreground">
        {t("buyer.spentHere")} <b className="font-semibold text-foreground">{yen(totals.spent_total_jpy)}</b>
      </span>
      <span className="text-muted-foreground" title={t("buyer.feeExplainer")}>
        {t("buyer.yourFee")} <b className="font-semibold text-emerald-600 dark:text-emerald-400">{yen(totals.agent_payout_jpy)}</b>
      </span>
    </span>
  );
}

// Shipping and the rest, entered where he is standing rather than messaged to
// the operator to retype. One figure per kind: entering it again corrects it,
// because he is reading one receipt.
function ShopCosts({
  planId, source, totals, readOnly, onSaved, onError,
}: {
  planId: number;
  source: string;
  totals?: SourceTotals;
  readOnly: boolean;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("shipping");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const recorded = Number(totals?.shipping_jpy ?? 0) + Number(totals?.other_costs_jpy ?? 0);

  async function save() {
    const value = parseTypedJpy(amount);
    if (value == null) return;
    setBusy(true);
    const { error } = await createClient().rpc("buyer_record_source_cost", {
      p_plan_id: planId, p_source: source, p_kind: kind, p_amount_jpy: value, p_note: null,
    });
    setBusy(false);
    if (error) { onError(formatMutationError(error)); return; }
    setAmount(""); setOpen(false); onSaved();
  }

  if (readOnly) {
    return recorded > 0
      ? <span className="text-xs text-muted-foreground">{t("buyer.shippingEtc")} {yen(recorded)}</span>
      : null;
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      <button
        type="button"
        className="rounded border px-2 py-0.5 hover:bg-accent"
        onClick={() => setOpen((v) => !v)}
      >
        {t("buyer.shippingEtc")}{recorded > 0 ? ` ${yen(recorded)}` : ""}
      </button>
      {open && (
        <span className="flex items-center gap-1">
          <select
            aria-label={t("buyer.shippingEtc")}
            className="rounded border bg-background px-1 py-0.5"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="shipping">{t("buyer.costShipping")}</option>
            <option value="payment_fee">{t("buyer.costPaymentFee")}</option>
            <option value="customs">{t("buyer.costCustoms")}</option>
            <option value="other">{t("buyer.costOther")}</option>
          </select>
          <input
            inputMode="numeric"
            aria-label={t("buyer.costAmount")}
            className="w-20 rounded border bg-background px-1 py-0.5 text-right"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
          />
          <button
            type="button"
            className="rounded border px-2 py-0.5 disabled:opacity-50"
            disabled={busy || parseTypedJpy(amount) == null}
            onClick={() => void save()}
          >
            {t("buyer.saveCost")}
          </button>
        </span>
      )}
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

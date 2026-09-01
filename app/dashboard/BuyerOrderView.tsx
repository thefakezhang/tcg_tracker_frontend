"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMutationError } from "@/lib/mutation-error";
import { planState, planStateLabel } from "@/lib/plan-state";

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
  { value: "pending", label: "—" },
  { value: "purchased", label: "Bought" },
  { value: "sold_out", label: "Sold out" },
  { value: "not_found", label: "Not found" },
  { value: "price_changed", label: "Price changed" },
  { value: "declined", label: "Skipped" },
] as const;

// The columns a keyboard user moves through. Outcome first, because it is the
// answer to "did you get it" and decides whether the rest applies.
const COLUMNS = ["outcome", "qty", "price", "condition", "note"] as const;
type Column = (typeof COLUMNS)[number];

export default function BuyerOrderView() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [activePlan, setActivePlan] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [receipts, setReceipts] = useState<Receipt[]>([]);

  const loadPlans = useCallback(async () => {
    const { data, error } = await createClient().rpc("buyer_assigned_plans");
    if (error) { setError(formatMutationError(error)); return; }
    const rows = (data ?? []) as Plan[];
    setPlans(rows);
    setActivePlan((current) => current ?? rows[0]?.plan_id ?? null);
  }, []);

  const loadLines = useCallback(async (planId: number) => {
    const { data, error } = await createClient().rpc("buyer_plan_lines", { p_plan_id: planId });
    if (error) { setError(formatMutationError(error)); return; }
    setLines((data ?? []) as Line[]);
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
  }, [activePlan, loadLines, loadReceipts]);

  const plan = plans?.find((p) => p.plan_id === activePlan) ?? null;
  const readOnly = plan?.finalized ?? false;

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
      const next = { ...line, ...patch };
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
        setError(formatMutationError(error));
        setLines((rows) => rows?.map((r) => (r.plan_line_id === line.plan_line_id ? line : r)) ?? rows);
        return false;
      }
      setError(null);
      return true;
    },
    [],
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
      {plans && plans.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {plans.map((p) => (
            <button
              key={p.plan_id}
              onClick={() => setActivePlan(p.plan_id)}
              className={`rounded border px-3 py-1 text-sm ${
                p.plan_id === activePlan ? "bg-accent font-medium" : "hover:bg-accent/50"
              }`}
            >
              {p.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {p.recorded_count}/{p.line_count}
              </span>
            </button>
          ))}
        </div>
      )}

      {plan && (
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold">{plan.name}</h2>
          <span className="text-sm text-muted-foreground">
            {plan.recorded_count} of {plan.line_count} recorded
          </span>
          <span className="rounded bg-muted px-2 py-0.5 text-xs">
            {planStateLabel(planState({ status: plan.status, recordedCount: plan.recorded_count }))}
          </span>
          {readOnly ? (
            <span className="rounded bg-muted px-2 py-0.5 text-xs">
              Closed - the operator has reconciled this list, nothing can change
            </span>
          ) : (
            // Without this the grid reads as a report. It is a worksheet, and
            // he needs to know his edits are landing as he makes them.
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-500">
              Open for editing - changes save as you type
            </span>
          )}
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
                {rows.filter((r) => r.outcome === "purchased").length} bought / {rows.length} lines
              </span>
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
                <th className="px-3 py-1 text-left font-normal">Card</th>
                <th className="px-3 py-1 text-right font-normal">Want</th>
                <th className="px-3 py-1 text-right font-normal">Asking</th>
                <th className="px-3 py-1 text-left font-normal">Result</th>
                <th className="px-3 py-1 text-right font-normal">Qty</th>
                <th className="px-3 py-1 text-right font-normal">Paid (¥)</th>
                <th className="px-3 py-1 text-left font-normal">Condition</th>
                <th className="px-3 py-1 text-left font-normal">Note</th>
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
            // eslint-disable-next-line @next/next/no-img-element
            <img src={line.image_url} alt="" className="h-12 w-auto rounded-sm border" loading="lazy" />
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
                  open listing
                </a>
              ) : (
                <span className="text-muted-foreground">no link</span>
              )}
              {stale && (
                <span className="ml-2 text-muted-foreground" title={line.source_observed_at ?? ""}>
                  price may be stale
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
          className="w-full bg-transparent"
        >
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
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
          {receipts.length} receipt{receipts.length === 1 ? "" : "s"}
        </span>
      )}
      {!readOnly && (
        <>
          <label
            htmlFor={inputId}
            className="cursor-pointer rounded border px-2 py-0.5 hover:bg-accent"
          >
            {busy ? "Uploading…" : receipts.length ? "Add receipt" : "Upload receipt"}
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

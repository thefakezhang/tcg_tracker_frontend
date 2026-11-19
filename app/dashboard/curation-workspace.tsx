"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSaving } from "@/lib/use-saving";
import { CurationAcceptResult, parseCurationAcceptResult } from "@/lib/image-curation-batch";
import { isAutoApprovePriceEvidence } from "@/lib/image-curation-price-evidence";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useLanguage } from "./LanguageContext";
import { useSupabaseQuery, QueryError } from "./use-query";
import { CurationCandidateCard } from "./curation-candidate-card";
import type { CurationCandidate, CurationApproval, CurationConfig, CurationMatch, CurationStatus as Status } from "./curation-model";

// Confidence bands power the section grouping, the batch-approve target, and
// the keyboard-nav flat order. Kept in a fixed high→low sequence so a
// reviewer walks from "safe to auto-approve" down to "actually needs eyes."
type Band = "high" | "medium" | "low" | "veryLow" | "unknown";
const BANDS: readonly Band[] = ["high", "medium", "low", "veryLow", "unknown"] as const;

function bandOf(conf: number | null): Band {
  if (conf == null) return "unknown";
  const p = conf * 100;
  if (p >= 95) return "high";
  if (p >= 80) return "medium";
  if (p >= 45) return "low";
  return "veryLow";
}

const BAND_CLASS: Record<Band, string> = {
  high: "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400",
  medium: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  low: "border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  veryLow: "border-destructive/50 bg-destructive/10 text-destructive",
  unknown: "border-border bg-muted text-muted-foreground",
};

// Frontend Band -> the SQL band token image_curation_queue_stats (G5) and
// batch_accept_image_buylist_candidates (G6) understand. They share bandOf's
// cuts, so a per-band Accept routes through the same idempotent RPC as a
// whole-queue one.
const SQL_BAND: Record<Band, string> = {
  high: "high", medium: "medium", low: "low", veryLow: "very_low", unknown: "unknown",
};

// PAGE_SIZE rows render initially; "Load more" pulls the next keyset page. The
// review queue can be enormous (118k+ pending in prod), so we never render the
// whole thing - the G5 header shows the true total, and G6 Accept All acts
// server-side over the WHOLE snapshot regardless of how many rows render here,
// so bulk actions are never limited to the loaded slice. ACCEPT_MAX is the
// server RPC's own per-call ceiling (it reports truncation and you run again).
const PAGE_SIZE = 200;
const ACCEPT_MAX = 5000;

interface QueueStats {
  high_water: number;
  total: number;
  matched: number;
  band_counts: Record<string, { total: number; matched: number }>;
}
interface QueueData { rows: CurationCandidate[]; stats: QueueStats; loadedAll: boolean; }

export function CurationWorkspace({ config }: { config: CurationConfig }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { saving, save } = useSaving();
  const [status, setStatus] = useState<Status>(config.initialStatus);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResult, setBatchResult] = useState<CurationAcceptResult | null>(null);
  const [selectedBuyer, setSelectedBuyer] = useState<string | null>(null); // null = all buyers
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE); // "Load more" raises this
  // The one-step undo (u): remembers the last promote/reject and reverses it
  // through the G4 compensation RPC - a full reversal (listing projection +
  // feedback state), never a bare status write, and result-aware because the
  // RPC can honestly answer `conflicted` when a later writer moved the row.
  const [lastDecision, setLastDecision] = useState<{ id: number; label: string } | null>(null);
  const [undoState, setUndoState] = useState<{ running: boolean; outcome?: string; detail?: string } | null>(null);

  const fetchCurationCandidates = useCallback(async (st: Status, limit: number): Promise<QueueData> => {
    const supabase = createClient();
    // G5: one snapshot read gives the TRUE total/matched/per-band counts and the
    // high-water candidate_id that pins the snapshot for pagination + Accept All.
    const { data: statsRaw, error: statsErr } = await supabase.rpc("image_curation_queue_stats", {
      p_kind: config.kind, p_status: st, p_buyer: null,
    });
    if (statsErr) throw statsErr;
    const stats = statsRaw as QueueStats;

    // Keyset-paginate by candidate_id (unique + monotonic, so no float-cursor
    // fragility) capped at the snapshot high-water, up to `limit` rows.
    const rows: CurationCandidate[] = [];
    let cursor: number | null = null;
    while (rows.length < limit) {
      let q = supabase
        .from(config.candidateTable)
        .select(config.candidateColumns)
        .eq("status", st)
        .lte("candidate_id", stats.high_water)
        .order("candidate_id", { ascending: false })
        .limit(Math.min(PAGE_SIZE, limit - rows.length));
      if (cursor != null) q = q.lt("candidate_id", cursor);
      const { data, error } = await q;
      if (error) throw error;
      const batch = (data ?? []).map(config.readCandidate);
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break; // exhausted the snapshot
      cursor = batch[batch.length - 1].candidate_id;
    }
    const ids = [...new Set(rows.map((row) => row.matched_id).filter((id): id is number => !!id))];
    const matches = new Map<number, CurationMatch>();
    if (ids.length) {
      const { data: definitions } = await supabase.from(config.catalogTable)
        .select(config.catalogColumns).in(config.catalogId, ids);
      for (const row of definitions ?? []) {
        const match = config.readMatch(row);
        matches.set(match.id, match);
      }
    }
    return {
      rows: rows.map((row) => ({ ...row, match: row.matched_id ? matches.get(row.matched_id) ?? null : null })),
      stats,
      loadedAll: rows.length >= stats.total,
    };
  }, [config]);

  // A new status tab is a fresh queue - reset the visible window before fetching.
  useEffect(() => { setVisibleLimit(PAGE_SIZE); }, [status]);

  const { data, error, isLoading, retry } = useSupabaseQuery([config.queryKey, status, visibleLimit], () => fetchCurationCandidates(status, visibleLimit));
  const allCurationCandidates = useMemo(() => data?.rows ?? [], [data]);
  const stats = data?.stats ?? null;
  const loadedAll = data?.loadedAll ?? true;

  // Per-buyer counts across the full fetched set - chip labels stay stable
  // as the reviewer works down through candidates, not just the filtered slice.
  const buyerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of allCurationCandidates) {
      const b = c.source_author_handle ?? "unknown";
      m.set(b, (m.get(b) ?? 0) + 1);
    }
    // Highest count first so the busiest buyer is a single mouse-target away.
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [allCurationCandidates]);

  // If the selected buyer disappears from the working set (all its
  // candidates resolved), fall back to "all" instead of leaving the
  // reviewer looking at an empty screen with no exit.
  useEffect(() => {
    if (selectedBuyer && !buyerCounts.some(([h]) => h === selectedBuyer)) {
      setSelectedBuyer(null);
    }
  }, [buyerCounts, selectedBuyer]);

  // The active working set - every downstream memo (bands, flat nav list,
  // batch-approve target) reads this, so a buyer switch cascades cleanly.
  const candidates = useMemo(
    () => (selectedBuyer ? allCurationCandidates.filter((c) => c.source_author_handle === selectedBuyer) : allCurationCandidates),
    [allCurationCandidates, selectedBuyer],
  );

  // Bucket candidates by confidence band. Preserves the fetch order inside
  // each band so the flat list below stays predictable (highest-conf first
  // within high, lowest-conf first within very-low, etc).
  const grouped = useMemo(() => {
    const g: Record<Band, CurationCandidate[]> = { high: [], medium: [], low: [], veryLow: [], unknown: [] };
    for (const c of candidates) g[bandOf(c.confidence)].push(c);
    return g;
  }, [candidates]);

  // Flat order = band order, then in-band order. Keyboard nav walks this list
  // so j/k mirror what's on screen top→bottom.
  const flat = useMemo(() => BANDS.flatMap((b) => grouped[b]), [grouped]);

  // Reset selection whenever the underlying data, active tab, or buyer
  // filter changes - otherwise the ring lingers on an off-screen index.
  useEffect(() => { setSelectedIdx(0); }, [candidates, status, selectedBuyer]);

  const supabase = createClient();

  async function act(fn: () => PromiseLike<{ error: unknown }>) {
    const ok = await save(async () => { const { error } = await fn(); if (error) throw error; });
    if (ok) retry();
    return ok;
  }
  const rememberDecision = useCallback((c: CurationCandidate) => {
    setUndoState(null);
    setLastDecision({ id: c.candidate_id, label: c.match?.english_name ?? c.match?.name ?? c.ocr_cell_label_text ?? `#${c.candidate_id}` });
  }, []);
  const approve = useCallback(async (c: CurationCandidate, o?: CurationApproval) => {
    if (await act(() => o?.geometry && o.naturalWidth && o.naturalHeight
      ? supabase.rpc(config.rpc.correct, {
        p_candidate_id: c.candidate_id,
        [config.matchParameter]: o.matchId ?? c.matched_id,
        [config.conditionParameter]: o.condition ?? c.condition ?? config.defaultCondition,
        p_price_jpy: o.priceJpy ?? c.ocr_price_jpy,
        p_curator_notes: o.notes ?? null,
        p_effective_geometry: o.geometry,
        p_natural_width: o.naturalWidth,
        p_natural_height: o.naturalHeight,
      })
      : supabase.rpc(config.rpc.promote, {
        p_candidate_id: c.candidate_id,
        [config.matchParameter]: o?.matchId ?? null, [config.conditionParameter]: o?.condition ?? null,
        p_price_jpy: o?.priceJpy ?? null, p_curator_notes: o?.notes ?? null,
      }))) rememberDecision(c);
  },
  // supabase + save + retry are stable within a render pass; act closes over
  // them from the enclosing scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [rememberDecision]);
  const reject = useCallback(async (c: CurationCandidate, notes?: string | null) => {
    if (await act(() => supabase.rpc(config.rpc.reject, { p_candidate_id: c.candidate_id, p_curator_notes: notes ?? null }))) rememberDecision(c);
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [rememberDecision]);
  const sendBack = useCallback((c: CurationCandidate, notes?: string | null) =>
    // No rememberDecision: a send-back has no durable effect to compensate -
    // it is reversed by simply acting on the candidate again.
    void act(() => supabase.rpc(config.rpc.defer, { p_candidate_id: c.candidate_id, p_curator_notes: notes ?? null })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  // Reverse a decision through G4 compensation. Idempotent by request_id;
  // surfaces `conflicted`/`failed` honestly instead of assuming success.
  const undoDecision = useCallback(async (candidateId: number) => {
    setUndoState({ running: true });
    const { data, error } = await supabase.rpc(config.rpc.undo, {
      p_candidate_id: candidateId, p_request_id: crypto.randomUUID(),
    });
    if (error) {
      setUndoState({ running: false, outcome: "failed", detail: (error as { message?: string }).message ?? "" });
      return;
    }
    const res = (data ?? {}) as { outcome?: string; detail?: string };
    const outcome = res.outcome ?? "completed";
    setUndoState({ running: false, outcome, detail: res.detail });
    setLastDecision(null);
    if (outcome === "completed") retry();
  // supabase/retry are stable within a render pass.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // G6: accept matched pending candidates in one idempotent server-side call.
  // The RPC enumerates the whole snapshot (candidate_id <= high_water) server-
  // side, so it accepts everything the operator saw even if only a page is
  // loaded here, and promotes each through the AUDITED promote with a derived
  // per-candidate request_id, so a retried batch never double-promotes. bands =
  // null accepts every confidence band (whole queue); a single band scopes it.
  const runBatchAccept = useCallback(async (bands: string[] | null) => {
    if (!stats) return;
    setBatchResult(null);
    setBatchRunning(true);
    try {
      const ok = await save(async () => {
        const { data, error } = await supabase.rpc(config.rpc.batch, {
          p_snapshot_high_water: stats.high_water,
          p_request_id: crypto.randomUUID(),
          p_status: status,
          p_buyer: selectedBuyer,
          p_bands: bands,
          p_max: ACCEPT_MAX,
        });
        if (error) throw error;
        setBatchResult(parseCurationAcceptResult(data));
      });
      if (ok) retry();
    } finally {
      setBatchRunning(false);
    }
  // supabase/save/retry are stable within a render pass; stats/status/buyer are
  // the real deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, status, selectedBuyer]);

  // Global keyboard shortcuts. Skips when the curator is typing (inputs,
  // textareas, contenteditable) or holding a modifier so browser shortcuts
  // stay untouched.
  useEffect(() => {
    const typing = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const cur = flat[selectedIdx];
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(flat.length - 1, i + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "y" && cur?.matched_id && status !== "auto_approved") {
        e.preventDefault();
        void approve(cur);
      } else if (e.key === "n" && cur && status !== "auto_approved") {
        e.preventDefault();
        void reject(cur);
      } else if (e.key === "d" && cur && status === "pending") {
        e.preventDefault();
        sendBack(cur);
      } else if (e.key === "u" && lastDecision && !undoState?.running) {
        e.preventDefault();
        void undoDecision(lastDecision.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, selectedIdx, status, approve, reject, sendBack, lastDecision, undoState, undoDecision]);

  // Scroll the selected card into view whenever the selection index changes.
  useEffect(() => {
    if (!flat.length) return;
    const el = document.querySelector<HTMLElement>(`[data-candidate-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIdx, flat.length]);

  // Loaded eligible candidates label the button; the RPC applies the pinned
  // whole-queue snapshot, including rows outside the visible page.
  const matchedInView = useMemo(
    () => candidates.filter((c) => c.matched_id && isAutoApprovePriceEvidence(c.price_evidence)).length,
    [candidates],
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t(config.title)}</h1>
        <Tabs value={status} onValueChange={(v) => setStatus(String(v) as Status)}>
          <TabsList className="min-h-11 sm:min-h-11">
            <TabsTrigger className="min-h-11 sm:min-h-11" value="needs_review">{t("curation.needsReview")}</TabsTrigger>
            <TabsTrigger className="min-h-11 sm:min-h-11" value="pending">{t("curation.pending")}</TabsTrigger>
            <TabsTrigger className="min-h-11 sm:min-h-11" value="auto_approved">{t("curation.autoApproved")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t("curation.hint")}</span>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">j</kbd>
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">k</kbd>
          <span>{t("curation.kbdNav")}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">y</kbd>
          <span>{t("curation.kbdApprove")}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">n</kbd>
          <span>{t("curation.kbdReject")}</span>
        </span>
        {status === "pending" && (
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">d</kbd>
            <span>{t("curation.kbdDefer")}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">u</kbd>
          <span>{t("curation.kbdUndo")}</span>
        </span>
      </div>

      {/* One-step undo + honest outcome. The compensation RPC can answer
          `conflicted` (a later writer moved the projection) or fail - both are
          shown rather than pretending the undo happened. */}
      {(lastDecision || undoState?.outcome) && (
        <div role="status" className="flex flex-wrap items-center gap-2 text-xs">
          {lastDecision && (
            <Button size="sm" variant="outline" className="min-h-11 sm:min-h-11" disabled={saving || undoState?.running}
              onClick={() => void undoDecision(lastDecision.id)}>
              {undoState?.running ? t("curation.undoRunning") : t("curation.undoLast", { name: lastDecision.label })}
            </Button>
          )}
          {undoState?.outcome === "completed" && <span className="text-emerald-600 dark:text-emerald-400">{t("curation.undone")}</span>}
          {undoState?.outcome === "conflicted" && <span className="text-amber-600 dark:text-amber-400">{t("curation.undoConflicted")}</span>}
          {undoState?.outcome === "failed" && <span className="text-destructive">{t("curation.undoFailed", { detail: undoState.detail ?? "" })}</span>}
        </div>
      )}

      {/* G5 queue truth + G6 whole-queue Accept All. Counts come from the
          snapshot RPC (the whole queue, not the loaded slice), so a queue
          larger than what is rendered shows as a number instead of silently
          truncated. */}
      {stats && stats.total > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            {t("curation.queueTotal", { total: stats.total, matched: stats.matched })}
            {!loadedAll && <> · {t("curation.showingOf", { shown: allCurationCandidates.length, total: stats.total })}</>}
          </span>
          {matchedInView > 0 && status !== "auto_approved" && (
            <Button size="sm" className="min-h-11 sm:min-h-11" disabled={saving || batchRunning} onClick={() => runBatchAccept(null)}>
              <Check className="size-3 mr-1" />
              {batchRunning ? t("curation.acceptAllProgress") : t("curation.acceptAll", { n: matchedInView })}
            </Button>
          )}
        </div>
      )}

      {/* Per-buyer filter chips. Horizontal scrollable list so many buyers
          stay one glance away without wrapping the layout. Chips render only
          when the fetched set has 2+ buyers - solo-buyer view stays clean. */}
      {buyerCounts.length > 1 && (
        <div className="flex flex-nowrap items-center gap-1 overflow-x-auto pb-1 text-xs">
          <button
            type="button"
            onClick={() => setSelectedBuyer(null)}
            className={`min-h-11 shrink-0 rounded-full border px-2.5 py-1 font-medium transition-colors ${
              selectedBuyer == null
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background hover:bg-muted"
            }`}
          >
            {t("curation.allBuyers")} · {allCurationCandidates.length}
          </button>
          {buyerCounts.map(([handle, n]) => (
            <button
              key={handle}
              type="button"
              onClick={() => setSelectedBuyer(handle)}
              className={`min-h-11 shrink-0 rounded-full border px-2.5 py-1 font-medium transition-colors ${
                selectedBuyer === handle
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background hover:bg-muted"
              }`}
            >
              {handle} · {n}
            </button>
          ))}
        </div>
      )}

      {error && <QueryError error={error} onRetry={retry} />}
      {batchResult && (
        <div
          role={batchResult.summary.failed ? "alert" : "status"}
          className={`rounded-md border p-3 text-sm ${
            batchResult.summary.failed ? "border-destructive/50 bg-destructive/10" : "border-green-500/50 bg-green-500/10"
          }`}
        >
          <div className="font-medium">
            {t("curation.batchSummary", {
              succeeded: batchResult.summary.succeeded,
              requested: batchResult.summary.processed,
              failed: batchResult.summary.failed,
            })}
            {batchResult.summary.truncated && <> · {t("curation.acceptAllTruncated", { n: ACCEPT_MAX })}</>}
          </div>
          {batchResult.results.filter((row) => !row.success).map((row, i) => (
            <div key={`${row.candidate_id ?? "invalid"}-${i}`} className="mt-1 break-words text-xs">
              {t("curation.batchFailure", {
                id: row.candidate_id ?? "?",
                code: row.error_code ?? "error",
                message: row.error_message ?? row.error_detail ?? t("curation.batchUnknownError"),
              })}
            </div>
          ))}
        </div>
      )}

      {BANDS.map((band) => {
        const list = grouped[band];
        if (!list.length) return null;
        // Offset of this band's first item within the flat keyboard-nav list.
        const offset = BANDS.slice(0, BANDS.indexOf(band)).reduce((sum, b) => sum + grouped[b].length, 0);
        const matched = list.filter(
          (c) => c.matched_id && isAutoApprovePriceEvidence(c.price_evidence),
        );
        return (
          <section key={band} className="space-y-2">
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-background/95 py-1 backdrop-blur">
              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${BAND_CLASS[band]}`}>
                {t(`curation.band.${band}` as never)} · {list.length}
              </span>
              {band === "high" && matched.length > 0 && status !== "auto_approved" && (
                <Button size="sm" variant="outline" className="min-h-11 sm:min-h-11" disabled={saving || batchRunning} onClick={() => runBatchAccept([SQL_BAND[band]])}>
                  <Check className="size-3 mr-1" />
                  {batchRunning ? t("curation.approveAllProgress") : t("curation.approveAllHigh", { n: matched.length })}
                </Button>
              )}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {list.map((c, i) => {
                const idx = offset + i;
                return (
                  <CurationCandidateCard
                    config={config}
                    key={c.candidate_id}
                    c={c}
                    idx={idx}
                    status={status}
                    language={language}
                    saving={saving}
                    selected={idx === selectedIdx}
                    onSelect={() => setSelectedIdx(idx)}
                    onApprove={approve}
                    onReject={reject}
                    onSendBack={sendBack}
                    onUndo={(cand) => void undoDecision(cand.candidate_id)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      {stats && !loadedAll && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" className="min-h-11 sm:min-h-11" disabled={isLoading} onClick={() => setVisibleLimit((l) => l + PAGE_SIZE)}>
            {isLoading ? t("common.loading") : t("curation.loadMore", { n: stats.total - allCurationCandidates.length })}
          </Button>
        </div>
      )}

      {!isLoading && candidates.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">{t("curation.empty")}</p>
      )}
      {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
    </div>
  );
}


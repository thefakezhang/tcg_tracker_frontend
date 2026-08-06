"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ImageOff, ArrowRight, Check, X, Pencil, Clock, Search, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { externalIdMatches, smartSearchFilters } from "@/lib/card-search";
import { useTranslation } from "@/lib/i18n";
import { useSaving } from "@/lib/use-saving";
import { CurationAcceptResult, parseCurationAcceptResult } from "@/lib/image-curation-batch";
import { useLanguage } from "./LanguageContext";
import { useSupabaseQuery, QueryError } from "./use-query";
import { getCardDisplayName, cardMeta, cardVariant, useDebouncedValue } from "./use-card-data";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ImageGeometryEditor } from "./ImageGeometryEditor";
import {
  GridBBoxJSON,
  ImageBox,
  ImageGeometry,
  parseGridGeometry,
  sameGeometry,
  shouldSubmitGeometryCorrection,
} from "@/lib/image-curation-geometry";

// Image-buylist curation. Reviews AI-detected card candidates (crop vs matched
// card) and promotes / rejects them via the SECURITY DEFINER RPCs (the browser
// can't write status directly — see project_image_curation_contract). v1 is
// singles only (pokemon_image_buylist_candidates); sealed is a follow-up.
type Status = "needs_review" | "pending";

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
interface QueueData { rows: Candidate[]; stats: QueueStats; loadedAll: boolean; }

interface MatchedCard {
  regional_name: string; english_name: string | null; set_code: string;
  card_number: string | null; misc_info: string | null; image_url: string | null;
}

interface Candidate {
  candidate_id: number;
  status: string;
  cell_image_url: string | null;
  source_image_url: string | null;
  source_grid_bbox: GridBBoxJSON;
  effective_source_grid_bbox: GridBBoxJSON;
  source_image_width: number | null;
  source_image_height: number | null;
  active_geometry_correction_id: number | null;
  ocr_price_jpy: number | null;
  ocr_text: string | null;
  ocr_overlay_text: string | null;
  ocr_cell_label_text: string | null;
  confidence: number | null;
  match_method: string | null;
  match_score_features: number | null;
  match_score_embedding: number | null;
  match_score_text: number | null;
  card_grading: string | null;
  variant_attrs: Record<string, unknown> | null;
  variant_source: string | null;
  curator_notes: string | null;
  source_author_handle: string | null;
  source_tweet_url: string | null;
  source_tweet_date: string | null;
  source_thread_root_id: string | null;
  source_thread_position: number | null;
  source_thread_root_text: string | null;
  candidate_card_id: number | null;
  card: MatchedCard | null;
}

const CAND_COLS =
  "candidate_id, status, cell_image_url, source_image_url, source_grid_bbox, effective_source_grid_bbox, source_image_width, source_image_height, active_geometry_correction_id, ocr_price_jpy, ocr_text, ocr_overlay_text, ocr_cell_label_text, confidence, match_method, match_score_features, match_score_embedding, match_score_text, card_grading, variant_attrs, variant_source, curator_notes, source_author_handle, source_tweet_url, source_tweet_date, source_thread_root_id, source_thread_position, source_thread_root_text, candidate_card_id";

export default function CurationView() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { saving, save } = useSaving();
  const [status, setStatus] = useState<Status>("needs_review");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResult, setBatchResult] = useState<CurationAcceptResult | null>(null);
  const [selectedBuyer, setSelectedBuyer] = useState<string | null>(null); // null = all buyers
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE); // "Load more" raises this

  const fetchCandidates = useCallback(async (st: Status, limit: number): Promise<QueueData> => {
    const supabase = createClient();
    // G5: one snapshot read gives the TRUE total/matched/per-band counts and the
    // high-water candidate_id that pins the snapshot for pagination + Accept All.
    const { data: statsRaw, error: statsErr } = await supabase.rpc("image_curation_queue_stats", {
      p_kind: "singles", p_status: st, p_buyer: null,
    });
    if (statsErr) throw statsErr;
    const stats = statsRaw as QueueStats;

    // Keyset-paginate by candidate_id (unique + monotonic, so no float-cursor
    // fragility) capped at the snapshot high-water, up to `limit` rows.
    const rows: Omit<Candidate, "card">[] = [];
    let cursor: number | null = null;
    while (rows.length < limit) {
      let q = supabase
        .from("pokemon_image_buylist_candidates")
        .select(CAND_COLS)
        .eq("status", st)
        .lte("candidate_id", stats.high_water)
        .order("candidate_id", { ascending: false })
        .limit(Math.min(PAGE_SIZE, limit - rows.length));
      if (cursor != null) q = q.lt("candidate_id", cursor);
      const { data, error } = await q;
      if (error) throw error;
      const batch = (data as Omit<Candidate, "card">[]) ?? [];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break; // exhausted the snapshot
      cursor = batch[batch.length - 1].candidate_id;
    }
    // batch-fetch the matched card defs by id (robust vs FK-embed guessing)
    const ids = [...new Set(rows.map((r) => r.candidate_card_id).filter((x): x is number => !!x))];
    const cardMap = new Map<number, MatchedCard>();
    if (ids.length) {
      const { data: defs } = await supabase
        .from("pokemon_card_definitions")
        .select("card_id, regional_name, english_name, set_code, card_number, misc_info, image_url")
        .in("card_id", ids);
      for (const d of (defs as ({ card_id: number } & MatchedCard)[]) ?? []) cardMap.set(d.card_id, d);
    }
    return {
      rows: rows.map((r) => ({ ...r, card: r.candidate_card_id ? cardMap.get(r.candidate_card_id) ?? null : null })),
      stats,
      loadedAll: rows.length >= stats.total,
    };
  }, []);

  // A new status tab is a fresh queue - reset the visible window before fetching.
  useEffect(() => { setVisibleLimit(PAGE_SIZE); }, [status]);

  const { data, error, isLoading, retry } = useSupabaseQuery(["curation", status, visibleLimit], () => fetchCandidates(status, visibleLimit));
  const allCandidates = useMemo(() => data?.rows ?? [], [data]);
  const stats = data?.stats ?? null;
  const loadedAll = data?.loadedAll ?? true;

  // Per-buyer counts across the full fetched set — chip labels stay stable
  // as the reviewer works down through candidates, not just the filtered slice.
  const buyerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of allCandidates) {
      const b = c.source_author_handle ?? "unknown";
      m.set(b, (m.get(b) ?? 0) + 1);
    }
    // Highest count first so the busiest buyer is a single mouse-target away.
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [allCandidates]);

  // If the selected buyer disappears from the working set (all its
  // candidates resolved), fall back to "all" instead of leaving the
  // reviewer looking at an empty screen with no exit.
  useEffect(() => {
    if (selectedBuyer && !buyerCounts.some(([h]) => h === selectedBuyer)) {
      setSelectedBuyer(null);
    }
  }, [buyerCounts, selectedBuyer]);

  // The active working set — every downstream memo (bands, flat nav list,
  // batch-approve target) reads this, so a buyer switch cascades cleanly.
  const candidates = useMemo(
    () => (selectedBuyer ? allCandidates.filter((c) => c.source_author_handle === selectedBuyer) : allCandidates),
    [allCandidates, selectedBuyer],
  );

  // Bucket candidates by confidence band. Preserves the fetch order inside
  // each band so the flat list below stays predictable (highest-conf first
  // within high, lowest-conf first within very-low, etc).
  const grouped = useMemo(() => {
    const g: Record<Band, Candidate[]> = { high: [], medium: [], low: [], veryLow: [], unknown: [] };
    for (const c of candidates) g[bandOf(c.confidence)].push(c);
    return g;
  }, [candidates]);

  // Flat order = band order, then in-band order. Keyboard nav walks this list
  // so j/k mirror what's on screen top→bottom.
  const flat = useMemo(() => BANDS.flatMap((b) => grouped[b]), [grouped]);

  // Reset selection whenever the underlying data, active tab, or buyer
  // filter changes — otherwise the ring lingers on an off-screen index.
  useEffect(() => { setSelectedIdx(0); }, [candidates, status, selectedBuyer]);

  const supabase = createClient();

  async function act(fn: () => PromiseLike<{ error: unknown }>) {
    const ok = await save(async () => { const { error } = await fn(); if (error) throw error; });
    if (ok) retry();
  }
  const approve = useCallback((c: Candidate, o?: {
    cardId?: number; grading?: string | null; priceJpy?: number | null; notes?: string | null;
    geometry?: ImageGeometry; naturalWidth?: number; naturalHeight?: number;
  }) =>
    act(() => o?.geometry && o.naturalWidth && o.naturalHeight
      ? supabase.rpc("correct_and_promote_image_buylist_candidate", {
        p_candidate_id: c.candidate_id,
        p_card_id: o.cardId ?? c.candidate_card_id,
        p_card_grading: o.grading ?? c.card_grading ?? "raw",
        p_price_jpy: o.priceJpy ?? c.ocr_price_jpy,
        p_curator_notes: o.notes ?? null,
        p_effective_geometry: o.geometry,
        p_natural_width: o.naturalWidth,
        p_natural_height: o.naturalHeight,
      })
      : supabase.rpc("promote_image_buylist_candidate", {
        p_candidate_id: c.candidate_id,
        p_card_id: o?.cardId ?? null, p_card_grading: o?.grading ?? null,
        p_price_jpy: o?.priceJpy ?? null, p_curator_notes: o?.notes ?? null,
      })),
  // supabase + save + retry are stable within a render pass; act closes over
  // them from the enclosing scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);
  const reject = useCallback((c: Candidate, notes?: string | null) =>
    act(() => supabase.rpc("reject_image_buylist_candidate", { p_candidate_id: c.candidate_id, p_curator_notes: notes ?? null })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);
  const sendBack = useCallback((c: Candidate, notes?: string | null) =>
    act(() => supabase.rpc("mark_image_buylist_candidate_needs_review", { p_candidate_id: c.candidate_id, p_curator_notes: notes ?? null })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

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
        const { data, error } = await supabase.rpc("batch_accept_image_buylist_candidates", {
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
      } else if (e.key === "y" && cur?.candidate_card_id) {
        e.preventDefault();
        approve(cur);
      } else if (e.key === "n" && cur) {
        e.preventDefault();
        reject(cur);
      } else if (e.key === "d" && cur && status === "pending") {
        e.preventDefault();
        sendBack(cur);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, selectedIdx, status, approve, reject, sendBack]);

  // Scroll the selected card into view whenever the selection index changes.
  useEffect(() => {
    if (!flat.length) return;
    const el = document.querySelector<HTMLElement>(`[data-candidate-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIdx, flat.length]);

  // Accept-All target for the current view (respects the buyer filter). The set
  // is loaded up to LOAD_CAP, so this equals the snapshot's matched count in
  // practice; the RPC re-derives the real set server-side regardless.
  const matchedInView = useMemo(() => candidates.filter((c) => c.candidate_card_id).length, [candidates]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t("curation.title")}</h1>
        <Tabs value={status} onValueChange={(v) => setStatus(String(v) as Status)}>
          <TabsList className="min-h-11 sm:min-h-11">
            <TabsTrigger className="min-h-11 sm:min-h-11" value="needs_review">{t("curation.needsReview")}</TabsTrigger>
            <TabsTrigger className="min-h-11 sm:min-h-11" value="pending">{t("curation.pending")}</TabsTrigger>
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
      </div>

      {/* G5 queue truth + G6 whole-queue Accept All. Counts come from the
          snapshot RPC (the whole queue, not the loaded slice), so a queue
          larger than what is rendered shows as a number instead of silently
          truncated. */}
      {stats && stats.total > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            {t("curation.queueTotal", { total: stats.total, matched: stats.matched })}
            {!loadedAll && <> · {t("curation.showingOf", { shown: allCandidates.length, total: stats.total })}</>}
          </span>
          {matchedInView > 0 && (
            <Button size="sm" className="min-h-11 sm:min-h-11" disabled={saving || batchRunning} onClick={() => runBatchAccept(null)}>
              <Check className="size-3 mr-1" />
              {batchRunning ? t("curation.acceptAllProgress") : t("curation.acceptAll", { n: matchedInView })}
            </Button>
          )}
        </div>
      )}

      {/* Per-buyer filter chips. Horizontal scrollable list so many buyers
          stay one glance away without wrapping the layout. Chips render only
          when the fetched set has 2+ buyers — solo-buyer view stays clean. */}
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
            {t("curation.allBuyers")} · {allCandidates.length}
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
        const matched = list.filter((c) => c.candidate_card_id);
        return (
          <section key={band} className="space-y-2">
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-background/95 py-1 backdrop-blur">
              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${BAND_CLASS[band]}`}>
                {t(`curation.band.${band}` as never)} · {list.length}
              </span>
              {band === "high" && matched.length > 0 && (
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
            {isLoading ? t("common.loading") : t("curation.loadMore", { n: stats.total - allCandidates.length })}
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

interface SearchHit { card_id: number; regional_name: string; english_name: string | null; set_code: string; card_number: string | null; misc_info: string | null; image_url: string | null; }

export function CurationCandidateCard({ c, idx, status, language, saving, selected, onSelect, onApprove, onReject, onSendBack }: {
  c: Candidate; idx: number; status: Status; language: "en" | "ja"; saving: boolean;
  selected: boolean; onSelect: () => void;
  onApprove: (c: Candidate, o?: {
    cardId?: number; grading?: string | null; priceJpy?: number | null; notes?: string | null;
    geometry?: ImageGeometry; naturalWidth?: number; naturalHeight?: number;
  }) => void;
  onReject: (c: Candidate, notes?: string | null) => void; onSendBack: (c: Candidate, notes?: string | null) => void;
}) {
  const { t } = useTranslation();
  const [correcting, setCorrecting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [override, setOverride] = useState<SearchHit | null>(null);
  const [grading, setGrading] = useState(c.card_grading || "raw");
  const [price, setPrice] = useState(c.ocr_price_jpy != null ? String(c.ocr_price_jpy) : "");
  const [notes, setNotes] = useState(c.curator_notes ?? "");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [zoom, setZoom] = useState<string | null>(null); // image URL shown in the lightbox
  const idPrefix = useId();
  const ids = {
    grading: `${idPrefix}-grading`,
    price: `${idPrefix}-price`,
    search: `${idPrefix}-search`,
    notes: `${idPrefix}-notes`,
  };
  const detectorGeometry = useMemo(() => parseGridGeometry(c.source_grid_bbox), [c.source_grid_bbox]);
  const initialGeometry = useMemo(
    () => parseGridGeometry(c.effective_source_grid_bbox) ?? detectorGeometry,
    [c.effective_source_grid_bbox, detectorGeometry],
  );
  const [geometry, setGeometry] = useState<ImageGeometry | null>(initialGeometry);
  const [naturalSize, setNaturalSize] = useState({
    width: c.source_image_width ?? 0,
    height: c.source_image_height ?? 0,
  });
  const dSearch = useDebouncedValue(search, 300);
  const matchedImg = override?.image_url ?? c.card?.image_url ?? null;
  // The notes value carried on approve / reject / defer. Empty string means
  // "no change" (COALESCE on the RPC side keeps whatever's already recorded);
  // trimmed text means "overwrite with this."
  const notesArg = () => (notes.trim() && notes !== (c.curator_notes ?? "") ? notes.trim() : null);

  // confidence as a 0-100 chip; colour by band. Rendered with a tinted
  // background (not just coloured text) so it's readable at a glance next to
  // the other outline badges — the previous text-only 10px chip disappeared
  // into the muted-foreground row.
  const conf = c.confidence != null ? Math.round(c.confidence * 100) : null;
  const confBadgeClass = conf == null
    ? ""
    : conf >= 70
      ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
      : conf >= 45
        ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-destructive/50 bg-destructive/10 text-destructive";
  const ribbon = c.variant_attrs && (c.variant_attrs.ribbon_detected || c.variant_attrs.variant_edition);
  // The banner/marker the variant detector read off the cell (e.g. laurier's
  // 英語版 / 中国語版 / 未開封 language-packaging label). Shown verbatim so the
  // curator sees the language/variant the buylist printed, even when the match
  // fell back to a JP card because the catalog has no sibling to resolve it to.
  const cellLabel = typeof c.variant_attrs?.cell_label === "string" ? (c.variant_attrs.cell_label as string) : null;

  const runSearch = useCallback(async () => {
    const s = dSearch.trim();
    if (!s) { setHits([]); return; }
    const supabase = createClient();
    // Text term + card_uid (full or displayed 8-hex prefix) + exact platform
    // external id - shared semantics with the Card Index (lib/card-search).
    // Multi-word terms AND together via one chained or() per token.
    const extIds = await externalIdMatches(supabase, "pokemon_external_identifiers", "card_id", s);
    let sq = supabase.from("pokemon_card_definitions")
      .select("card_id, regional_name, english_name, set_code, card_number, misc_info, image_url");
    for (const f of smartSearchFilters(
      s,
      ["regional_name", "english_name", "card_number"],
      "card_uid",
      "card_id",
      extIds,
    )) sq = sq.or(f);
    const { data } = await sq.limit(20);
    setHits((data as SearchHit[]) ?? []);
  }, [dSearch]);
  useMemo(() => { void runSearch(); }, [runSearch]);

  const matchName = override
    ? getCardDisplayName(override, language)
    : c.card ? getCardDisplayName(c.card, language) : t("curation.noMatch");
  const matchMeta = override
    ? cardMeta(override.set_code, override.card_number, override.misc_info)
    : c.card ? cardMeta(c.card.set_code, c.card.card_number, c.card.misc_info) : "";
  const sourceImg = c.source_image_url && /^https?:\/\//i.test(c.source_image_url) ? c.source_image_url : null;
  const geometryEdited = !sameGeometry(geometry, initialGeometry);
  const geometryDirty = shouldSubmitGeometryCorrection(
    geometry,
    initialGeometry,
    !!sourceImg,
    naturalSize.width,
    naturalSize.height,
  );

  function doApprove() {
    const priceJpy = price.trim() ? Math.round(Number(price)) : null;
    onApprove(c, {
      cardId: override?.card_id, // null → keep candidate's match
      grading: grading !== (c.card_grading || "raw") || override ? grading : null,
      priceJpy: priceJpy !== c.ocr_price_jpy ? priceJpy : null,
      notes: notesArg(),
      geometry: geometryDirty && geometry ? geometry : undefined,
      naturalWidth: geometryDirty ? naturalSize.width : undefined,
      naturalHeight: geometryDirty ? naturalSize.height : undefined,
    });
  }
  const hasMatch = !!c.candidate_card_id; // mark-correct needs an existing match; no-match → correct/reject

  const cardBBox = geometry?.card ?? null;
  const priceBBox = geometry?.price ?? null;
  // source_image_url is set by the orchestrator and was historically a local
  // filesystem path ("internal/image_recognition/eval/<buyer>/...jpg") which
  // the browser can't load. Only treat it as the CSS-crop source when it's a
  // real http(s) URL; otherwise we fall through to the cell-crop URL.
  // Older candidates (pre source-upload) have a working R2 URL in
  // cell_image_url pointing at a pre-cropped card image. When the source
  // isn't a real URL we render that directly with no CSS cropping; the
  // price slot becomes a "no price box" placeholder because the standalone
  // price crop only exists when we can CSS-crop the source.
  const cellCardImg = c.cell_image_url && /^https?:\/\//i.test(c.cell_image_url) ? c.cell_image_url : null;
  const showCardCrop = sourceImg && cardBBox;
  const showPriceCrop = sourceImg && priceBBox;
  // Lightbox target falls back to whichever URL we actually have, so click
  // always opens *something* for the curator instead of blank black.
  const lightboxImg = sourceImg ?? cellCardImg;

  return (
    <Card
      size="sm"
      data-candidate-idx={idx}
      onClick={onSelect}
      className={`cursor-pointer transition-shadow ${selected ? "ring-2 ring-primary ring-offset-1" : ""}`}
    >
      <CardContent className="space-y-2 p-3">
        <div className="grid grid-cols-2 gap-2 sm:flex">
          {/* The card we found. New candidates have a real source URL + a
              card bbox - we CSS-crop the card region. Legacy candidates
              pre-date the source-upload work and only have an R2 URL of a
              pre-cropped card in cell_image_url - we show that directly. */}
          <figure className="order-1 shrink-0 text-center sm:order-none">
            {showCardCrop ? (
              <CropPreview src={sourceImg!} bbox={cardBBox!} w={96} h={128}
                onClick={() => lightboxImg && setZoom(lightboxImg)} />
            ) : cellCardImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cellCardImg} alt="" loading="lazy"
                onClick={() => setZoom(cellCardImg)}
                className="h-32 w-24 cursor-zoom-in rounded bg-muted object-contain" />
            ) : (
              <div className="flex h-32 w-24 items-center justify-center rounded bg-muted"><ImageOff className="size-6 text-muted-foreground" /></div>
            )}
            <figcaption className="mt-0.5 text-[10px] text-muted-foreground">{t("curation.detected")}</figcaption>
          </figure>
          {/* The price banner. Only ever rendered when we can CSS-crop it
              out of a real source URL - the orchestrator's earlier
              "placeholder URL" pattern never gave us standalone price
              crops, so legacy rows simply show a "no price box" slot. */}
          <figure className="order-3 shrink-0 text-center sm:order-none">
            {showPriceCrop ? (
              <CropPreview src={sourceImg!} bbox={priceBBox!} w={96} h={48}
                onClick={() => lightboxImg && setZoom(lightboxImg)} />
            ) : (
              <div className="flex h-12 w-24 items-center justify-center rounded bg-muted">
                <span className="text-[10px] text-muted-foreground">{t("curation.noPriceCrop")}</span>
              </div>
            )}
            <figcaption className="mt-0.5 text-[10px] text-muted-foreground">{t("curation.priceBanner")}</figcaption>
          </figure>
          <ArrowRight className="mt-12 hidden size-4 shrink-0 text-muted-foreground sm:block" />
          {/* The matched catalog card. Click opens the catalog image alone
              (no source context to pan around) in the same pan+zoom
              inspector. */}
          <figure className="order-2 shrink-0 text-center sm:order-none">
            {matchedImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={matchedImg} alt="" loading="lazy" onClick={() => setZoom(matchedImg)}
                className="h-32 w-24 cursor-zoom-in rounded bg-muted object-contain" />
            ) : (
              <div className="flex h-32 w-24 items-center justify-center rounded bg-muted text-3xl font-semibold text-muted-foreground" title={t("curation.noMatch")}>?</div>
            )}
            <figcaption className="mt-0.5 text-[10px] text-muted-foreground">{t("curation.matched")}</figcaption>
          </figure>
          {/* signals */}
          <div className="order-4 col-span-2 min-w-0 flex-1 space-y-1 text-xs sm:order-none">
            <div className="truncate font-medium">{matchName}</div>
            {matchMeta && <div className="truncate text-muted-foreground">{matchMeta}</div>}
            <div className="flex flex-wrap gap-1">
              {conf != null && <Badge variant="outline" className={`font-semibold ${confBadgeClass}`}>{conf}% · {c.match_method}</Badge>}
              {c.card_grading && c.card_grading !== "raw" && <Badge variant="secondary" className="text-[10px]">{c.card_grading}</Badge>}
              {cellLabel ? <Badge className="text-[10px] border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-400" variant="outline">{cellLabel}</Badge> : null}
              {ribbon ? <Badge variant="secondary" className="text-[10px]">{t("curation.variant")}</Badge> : null}
            </div>
            {(c.match_score_features != null || c.match_score_embedding != null) && (
              <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                {c.match_score_features != null && <span>SIFT: <span className="font-mono">{c.match_score_features}</span></span>}
                {c.match_score_embedding != null && <span>CLIP: <span className="font-mono">{c.match_score_embedding.toFixed(3)}</span></span>}
              </div>
            )}
            <div className="text-muted-foreground">{c.ocr_price_jpy != null ? `¥${c.ocr_price_jpy.toLocaleString()}` : t("curation.noPrice")}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {c.source_author_handle}{c.source_tweet_date ? ` · ${c.source_tweet_date}` : ""}
              {c.source_tweet_url && <> · <a href={c.source_tweet_url} target="_blank" rel="noreferrer" className="underline">{t("curation.source")}</a></>}
            </div>
          </div>
        </div>

        {correcting && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-2">
            {sourceImg && geometry && detectorGeometry && (
              <ImageGeometryEditor
                src={sourceImg}
                geometry={geometry}
                naturalWidth={naturalSize.width}
                naturalHeight={naturalSize.height}
                onNaturalSize={(width, height) => setNaturalSize({ width, height })}
                onChange={setGeometry}
                onReset={() => setGeometry(detectorGeometry)}
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor={ids.grading} className="text-xs">{t("curation.grading")}</Label>
                <select id={ids.grading} value={grading} onChange={(e) => setGrading(e.target.value)} className="min-h-11 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="raw">{t("curation.raw")}</option>
                  <option value="psa_10">PSA 10</option>
                </select></div>
              <div><Label htmlFor={ids.price} className="text-xs">{t("curation.priceJpy")}</Label>
                <Input id={ids.price} type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="min-h-11" /></div>
            </div>
            <div>
              <Label htmlFor={ids.search} className="text-xs flex items-center gap-1"><Search className="size-3" />{t("curation.changeCard")}</Label>
              <Input id={ids.search} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("curation.searchPlaceholder")} className="min-h-11" />
              {override && <div className="mt-1 flex min-w-0 items-center gap-1 text-xs"><Badge variant="secondary" className="min-w-0 truncate">{getCardDisplayName(override, language)} · {cardMeta(override.set_code, override.card_number, override.misc_info)}</Badge><Button variant="ghost" size="icon" className="min-h-11 min-w-11 sm:min-h-11 sm:min-w-11" aria-label={t("curation.clearOverride")} onClick={() => setOverride(null)}><X className="size-3" /></Button></div>}
              {search && hits.length > 0 && (
                <div className="mt-1 max-h-40 overflow-auto rounded-md border bg-background">
                  {hits.map((h) => (
                    <button key={h.card_id} onClick={() => { setOverride(h); setSearch(""); setHits([]); }}
                      className="block min-h-11 w-full truncate px-2 py-1 text-left text-xs hover:bg-accent">
                      {getCardDisplayName(h, language)} · {cardMeta(h.set_code, h.card_number, h.misc_info)}{cardVariant(h.misc_info) ? "" : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col items-stretch gap-2 border-t pt-2 sm:flex-row sm:items-center">
              <Button
                size="sm"
                disabled={saving || !(override || hasMatch) || (geometryEdited && !geometryDirty)}
                className="min-h-11 sm:min-h-11"
                onClick={doApprove}
              >
                <Check className="size-4 mr-1" />{t("curation.approveFixes")}
              </Button>
              <Button size="sm" variant="outline" className="min-h-11 sm:min-h-11" disabled={saving} onClick={() => onReject(c, notesArg())}>
                <X className="size-4 mr-1" />{t("curation.rejectNoMatch")}
              </Button>
              <span className="text-[10px] text-muted-foreground sm:ml-auto">{t("curation.rejectHint")}</span>
            </div>
          </div>
        )}

        {/* Curator notes. Always visible so a reviewer can drop a note without
            first opening the correct panel — leftover intent lands on approve /
            reject / defer alike via COALESCE on the RPC's p_curator_notes. */}
        <div>
          <Label htmlFor={ids.notes} className="text-xs flex items-center gap-1"><Pencil className="size-3" />{t("curation.curatorNotes")}</Label>
          <textarea
            id={ids.notes}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("curation.curatorNotesPlaceholder")}
            rows={2}
            className="mt-0.5 min-h-11 w-full resize-y rounded-md border bg-background px-2 py-1 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* the three curator decisions: it's right · it's wrong (fix or reject) · later */}
          <Button
            size="sm"
            className="min-h-11 sm:min-h-11"
            disabled={saving || !hasMatch || (geometryEdited && !geometryDirty)}
            onClick={() => geometryEdited ? doApprove() : onApprove(c, { notes: notesArg() })}
          >
            <Check className="size-4 mr-1" />{t("curation.markCorrect")}
          </Button>
          <Button size="sm" variant={correcting ? "secondary" : "outline"} className="min-h-11 sm:min-h-11" disabled={saving} onClick={() => setCorrecting((v) => !v)}>
            <Pencil className="size-4 mr-1" />{t("curation.correctMatch")}
          </Button>
          <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-11" onClick={() => setShowDetails((v) => !v)}>
            {showDetails ? t("curation.hideDetails") : t("curation.showDetails")}
          </Button>
          {status === "pending" && (
            <Button size="sm" variant="ghost" className="min-h-11 sm:ml-auto sm:min-h-11" disabled={saving} onClick={() => onSendBack(c, notesArg())}>
              <Clock className="size-4 mr-1" />{t("curation.deferLater")}
            </Button>
          )}
          {saving && <Loader2 className="size-4 animate-spin" />}
        </div>
        {!hasMatch && !correcting && <p className="text-[10px] text-muted-foreground">{t("curation.noMatchHint")}</p>}

        {/* Details drawer: read-only view of everything the pipeline recorded
            about this candidate. Hidden by default because the reviewer's
            primary loop doesn't need it; useful when a match feels off. */}
        {showDetails && (
          <div className="space-y-1 rounded-md border bg-muted/20 p-2 text-[11px]">
            {(c.ocr_text || c.ocr_overlay_text || c.ocr_cell_label_text) && (
              <div>
                <div className="font-semibold text-muted-foreground">{t("curation.detailsOcr")}</div>
                {c.ocr_text && <div>text: <span className="font-mono">{c.ocr_text}</span></div>}
                {c.ocr_overlay_text && <div>overlay: <span className="font-mono">{c.ocr_overlay_text}</span></div>}
                {c.ocr_cell_label_text && <div>cell label: <span className="font-mono">{c.ocr_cell_label_text}</span></div>}
              </div>
            )}
            {(c.source_thread_root_id || c.source_thread_root_text) && (
              <div>
                <div className="font-semibold text-muted-foreground">{t("curation.detailsThread")}</div>
                {c.source_thread_position != null && <div>position #{c.source_thread_position}</div>}
                {c.source_thread_root_text && <div className="whitespace-pre-wrap break-words">{c.source_thread_root_text}</div>}
              </div>
            )}
            {(c.match_score_features != null || c.match_score_embedding != null || c.match_score_text != null || c.match_method) && (
              <div>
                <div className="font-semibold text-muted-foreground">{t("curation.detailsScores")}</div>
                {c.match_method && <div>method: <span className="font-mono">{c.match_method}</span></div>}
                {c.match_score_features != null && <div>SIFT: <span className="font-mono">{c.match_score_features}</span></div>}
                {c.match_score_embedding != null && <div>CLIP: <span className="font-mono">{c.match_score_embedding.toFixed(3)}</span></div>}
                {c.match_score_text != null && <div>text: <span className="font-mono">{c.match_score_text.toFixed(3)}</span></div>}
              </div>
            )}
            {(c.variant_attrs || c.variant_source) && (
              <div>
                <div className="font-semibold text-muted-foreground">{t("curation.detailsVariant")}</div>
                {c.variant_source && <div>source: <span className="font-mono">{c.variant_source}</span></div>}
                {c.variant_attrs && <div className="whitespace-pre-wrap font-mono">{JSON.stringify(c.variant_attrs)}</div>}
              </div>
            )}
          </div>
        )}
      </CardContent>
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </Card>
  );
}

// A thumbnail that shows the cropped region of `src` defined by `bbox`,
// scaled to fit a `w` x `h` box. Uses CSS only - no JS image measurement
// and no extra HTTP requests - so it renders the moment the source image
// loads. `object-fit: none` plus a negative `object-position` shows the
// crop region at 1:1 image pixels, then transform:scale shrinks it down
// (or up) so it fills the display rectangle while preserving aspect.
function CropPreview({ src, bbox, w, h, onClick }: {
  src: string; bbox: ImageBox; w: number; h: number; onClick?: () => void;
}) {
  const cw = Math.max(1, bbox.x1 - bbox.x0);
  const ch = Math.max(1, bbox.y1 - bbox.y0);
  const scale = Math.min(w / cw, h / ch);
  return (
    <div
      onClick={onClick}
      className={`overflow-hidden rounded bg-muted ${onClick ? "cursor-zoom-in" : ""}`}
      style={{ width: `${w}px`, height: `${h}px` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src} alt="" loading="lazy" draggable={false}
        style={{
          width: `${cw}px`, height: `${ch}px`,
          objectFit: "none",
          objectPosition: `-${bbox.x0}px -${bbox.y0}px`,
          transformOrigin: "top left",
          transform: `scale(${scale})`,
          maxWidth: "none", maxHeight: "none",
        }}
      />
    </div>
  );
}

// Fullscreen image inspector with proper pan + zoom. Wheel zooms around the
// cursor; click-and-drag pans; double-click resets. Click the dark backdrop
// or the ✕ to close. Replaces an older fit-vs-200% toggle that could only
// zoom in, never let the curator pan around to look at the rest of the
// sheet.
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; t0: { x: number; y: number } } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Esc closes; arrow keys nudge the pan (handy on trackpads). Also lock
  // background page scroll so wheel events on the lightbox never bleed
  // through to the underlying page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      const step = 80 / scale;
      if (e.key === "ArrowLeft") setTranslate((t) => ({ x: t.x + step, y: t.y }));
      else if (e.key === "ArrowRight") setTranslate((t) => ({ x: t.x - step, y: t.y }));
      else if (e.key === "ArrowUp") setTranslate((t) => ({ x: t.x, y: t.y + step }));
      else if (e.key === "ArrowDown") setTranslate((t) => ({ x: t.x, y: t.y - step }));
    };
    window.addEventListener("keydown", onKey);
    const prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // React attaches wheel listeners as passive, so onWheel's preventDefault
    // is a no-op. Attach a native non-passive listener on the container so
    // wheel scrolling anywhere inside the lightbox never scrolls the page
    // behind it.
    const el = containerRef.current;
    const nativeWheel = (e: WheelEvent) => e.preventDefault();
    el?.addEventListener("wheel", nativeWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevBodyOverflow;
      el?.removeEventListener("wheel", nativeWheel);
    };
  }, [onClose, scale]);

  const onWheel = (e: React.WheelEvent) => {
    // Zoom around the cursor position so the point under the mouse stays
    // visually anchored - the standard "zoom to cursor" UX. Without this,
    // every wheel tick rubber-bands the focal point back to the center.
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const next = Math.min(12, Math.max(0.2, scale * factor));
    const ratio = next / scale;
    setTranslate((t) => ({
      x: cx - (cx - t.x) * ratio,
      y: cy - (cy - t.y) * ratio,
    }));
    setScale(next);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, t0: translate };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setTranslate({ x: dragRef.current.t0.x + dx, y: dragRef.current.t0.y + dy });
  };
  const stopDrag = () => { dragRef.current = null; };
  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  // Click anywhere in the lightbox EXCEPT on the image itself closes. The
  // image gets stopPropagation on its own click handler so dragging + panning
  // never accidentally closes.
  const onBackdropClick = (e: React.MouseEvent) => {
    if (imgRef.current && e.target instanceof Node && imgRef.current.contains(e.target)) return;
    onClose();
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 overflow-hidden bg-black/85"
      onClick={onBackdropClick}
      onWheel={onWheel}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src} alt="" draggable={false}
          style={{
            maxHeight: "92vh", maxWidth: "92vw",
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: "center",
            transition: dragRef.current ? "none" : "transform 80ms ease-out",
            userSelect: "none",
          }}
        />
      </div>
      <button onClick={onClose} aria-label="Close"
        className="fixed right-3 top-3 rounded-full bg-white/15 p-2 text-white hover:bg-white/25">
        <X className="size-5" />
      </button>
      <div className="pointer-events-none fixed bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-[11px] text-white">
        Wheel: zoom · Drag: pan · Double-click: reset · Esc / click outside: close
      </div>
    </div>
  );
}

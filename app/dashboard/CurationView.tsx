"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageOff, ArrowRight, Check, X, Pencil, Clock, Search, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSaving } from "@/lib/use-saving";
import { useLanguage } from "./LanguageContext";
import { useSupabaseQuery, QueryError } from "./use-query";
import { getCardDisplayName, cardMeta, cardVariant, useDebouncedValue } from "./use-card-data";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

// Image-buylist curation. Reviews AI-detected card candidates (crop vs matched
// card) and promotes / rejects them via the SECURITY DEFINER RPCs (the browser
// can't write status directly — see project_image_curation_contract). v1 is
// singles only (pokemon_image_buylist_candidates); sealed is a follow-up.
type Status = "needs_review" | "pending";

interface MatchedCard {
  regional_name: string; english_name: string | null; set_code: string;
  card_number: string | null; misc_info: string | null; image_url: string | null;
}

// Rectangle in source-image pixel coordinates.
interface BBox { x0: number; y0: number; x1: number; y1: number; }

// source_grid_bbox JSONB shape, with backwards compat. The orchestrator used
// to store only the card box ({x0,y0,x1,y1}); the newer shape splits it into
// {card, price} so the curation UI can render the card and the price banner
// as two separate clean crops. parseGridBBox() collapses both into a single
// {card, price?} view.
type GridBBoxJSON = BBox | { card?: BBox; price?: BBox } | null | undefined;

function parseGridBBox(raw: GridBBoxJSON): { card: BBox | null; price: BBox | null } {
  if (!raw) return { card: null, price: null };
  // Modern shape: explicit `card` / `price` keys.
  if ("card" in raw || "price" in raw) {
    return { card: raw.card ?? null, price: raw.price ?? null };
  }
  // Legacy shape: flat {x0,y0,x1,y1} = card box only.
  if ("x0" in raw && "x1" in raw) return { card: raw as BBox, price: null };
  return { card: null, price: null };
}

interface Candidate {
  candidate_id: number;
  status: string;
  cell_image_url: string | null;
  source_image_url: string | null;
  source_grid_bbox: GridBBoxJSON;
  ocr_price_jpy: number | null;
  confidence: number | null;
  match_method: string | null;
  match_score_features: number | null;
  match_score_embedding: number | null;
  card_grading: string | null;
  variant_attrs: Record<string, unknown> | null;
  source_author_handle: string | null;
  source_tweet_url: string | null;
  source_tweet_date: string | null;
  candidate_card_id: number | null;
  card: MatchedCard | null;
}

const CAND_COLS =
  "candidate_id, status, cell_image_url, source_image_url, source_grid_bbox, ocr_price_jpy, confidence, match_method, match_score_features, match_score_embedding, card_grading, variant_attrs, source_author_handle, source_tweet_url, source_tweet_date, candidate_card_id";

export default function CurationView() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { saving, save } = useSaving();
  const [status, setStatus] = useState<Status>("needs_review");

  const fetchCandidates = useCallback(async (st: Status): Promise<Candidate[]> => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("pokemon_image_buylist_candidates")
      .select(CAND_COLS)
      .eq("status", st)
      .order("confidence", { ascending: true, nullsFirst: true }) // lowest confidence first — most need eyes
      .limit(200);
    if (error) throw error;
    const rows = (data as Omit<Candidate, "card">[]) ?? [];
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
    return rows.map((r) => ({ ...r, card: r.candidate_card_id ? cardMap.get(r.candidate_card_id) ?? null : null }));
  }, []);

  const { data, error, isLoading, retry } = useSupabaseQuery(["curation", status], () => fetchCandidates(status));
  const candidates = useMemo(() => data ?? [], [data]);

  async function act(fn: () => PromiseLike<{ error: unknown }>) {
    const ok = await save(async () => { const { error } = await fn(); if (error) throw error; });
    if (ok) retry();
  }
  const supabase = createClient();
  const approve = (c: Candidate, o?: { cardId?: number; grading?: string | null; priceJpy?: number | null }) =>
    act(() => supabase.rpc("promote_image_buylist_candidate", {
      p_candidate_id: c.candidate_id,
      p_card_id: o?.cardId ?? null, p_card_grading: o?.grading ?? null, p_price_jpy: o?.priceJpy ?? null,
    }));
  const reject = (c: Candidate) =>
    act(() => supabase.rpc("reject_image_buylist_candidate", { p_candidate_id: c.candidate_id, p_curator_notes: null }));
  const sendBack = (c: Candidate) =>
    act(() => supabase.rpc("mark_image_buylist_candidate_needs_review", { p_candidate_id: c.candidate_id, p_curator_notes: null }));

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t("curation.title")}</h1>
        <Tabs value={status} onValueChange={(v) => setStatus(String(v) as Status)}>
          <TabsList>
            <TabsTrigger value="needs_review">{t("curation.needsReview")}</TabsTrigger>
            <TabsTrigger value="pending">{t("curation.pending")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <p className="text-sm text-muted-foreground">{t("curation.hint")}</p>

      {error && <QueryError onRetry={retry} />}

      <div className="grid gap-3 lg:grid-cols-2">
        {candidates.map((c) => (
          <CandidateCard key={c.candidate_id} c={c} status={status} language={language} saving={saving}
            onApprove={approve} onReject={reject} onSendBack={sendBack} />
        ))}
      </div>
      {!isLoading && candidates.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">{t("curation.empty")}</p>
      )}
      {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
    </div>
  );
}

interface SearchHit { card_id: number; regional_name: string; english_name: string | null; set_code: string; card_number: string | null; misc_info: string | null; image_url: string | null; }

function CandidateCard({ c, status, language, saving, onApprove, onReject, onSendBack }: {
  c: Candidate; status: Status; language: "en" | "ja"; saving: boolean;
  onApprove: (c: Candidate, o?: { cardId?: number; grading?: string | null; priceJpy?: number | null }) => void;
  onReject: (c: Candidate) => void; onSendBack: (c: Candidate) => void;
}) {
  const { t } = useTranslation();
  const [correcting, setCorrecting] = useState(false);
  const [override, setOverride] = useState<SearchHit | null>(null);
  const [grading, setGrading] = useState(c.card_grading || "raw");
  const [price, setPrice] = useState(c.ocr_price_jpy != null ? String(c.ocr_price_jpy) : "");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [zoom, setZoom] = useState<string | null>(null); // image URL shown in the lightbox
  const dSearch = useDebouncedValue(search, 300);
  const matchedImg = override?.image_url ?? c.card?.image_url ?? null;

  // confidence as a 0-100 chip; colour by band
  const conf = c.confidence != null ? Math.round(c.confidence * 100) : null;
  const confColor = conf == null ? "" : conf >= 70 ? "text-green-600" : conf >= 45 ? "text-amber-600" : "text-destructive";
  const ribbon = c.variant_attrs && (c.variant_attrs.ribbon_detected || c.variant_attrs.variant_edition);

  const runSearch = useCallback(async () => {
    const s = dSearch.trim();
    if (!s) { setHits([]); return; }
    const supabase = createClient();
    const safe = s.replace(/[,()*]/g, " ");
    const { data } = await supabase.from("pokemon_card_definitions")
      .select("card_id, regional_name, english_name, set_code, card_number, misc_info, image_url")
      .or(`regional_name.ilike.%${safe}%,english_name.ilike.%${safe}%,card_number.ilike.%${safe}%`)
      .limit(20);
    setHits((data as SearchHit[]) ?? []);
  }, [dSearch]);
  useMemo(() => { void runSearch(); }, [runSearch]);

  const matchName = override
    ? getCardDisplayName(override, language)
    : c.card ? getCardDisplayName(c.card, language) : t("curation.noMatch");
  const matchMeta = override
    ? cardMeta(override.set_code, override.card_number, override.misc_info)
    : c.card ? cardMeta(c.card.set_code, c.card.card_number, c.card.misc_info) : "";

  function doApprove() {
    const priceJpy = price.trim() ? Math.round(Number(price)) : null;
    onApprove(c, {
      cardId: override?.card_id, // null → keep candidate's match
      grading: grading !== (c.card_grading || "raw") || override ? grading : null,
      priceJpy: priceJpy !== c.ocr_price_jpy ? priceJpy : null,
    });
  }
  const hasMatch = !!c.candidate_card_id; // mark-correct needs an existing match; no-match → correct/reject

  const { card: cardBBox, price: priceBBox } = parseGridBBox(c.source_grid_bbox);
  // source_image_url is set by the orchestrator and was historically a local
  // filesystem path ("internal/image_recognition/eval/<buyer>/...jpg") which
  // the browser can't load. Only treat it as the CSS-crop source when it's a
  // real http(s) URL; otherwise we fall through to the cell-crop URL.
  const sourceImg = c.source_image_url && /^https?:\/\//i.test(c.source_image_url) ? c.source_image_url : null;
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
    <Card size="sm">
      <CardContent className="space-y-2 p-3">
        <div className="flex gap-2">
          {/* The card we found. New candidates have a real source URL + a
              card bbox - we CSS-crop the card region. Legacy candidates
              pre-date the source-upload work and only have an R2 URL of a
              pre-cropped card in cell_image_url - we show that directly. */}
          <figure className="shrink-0 text-center">
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
          <figure className="shrink-0 text-center">
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
          <ArrowRight className="mt-12 size-4 shrink-0 text-muted-foreground" />
          {/* The matched catalog card. Click opens the catalog image alone
              (no source context to pan around) in the same pan+zoom
              inspector. */}
          <figure className="shrink-0 text-center">
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
          <div className="min-w-0 flex-1 space-y-1 text-xs">
            <div className="truncate font-medium">{matchName}</div>
            {matchMeta && <div className="truncate text-muted-foreground">{matchMeta}</div>}
            <div className="flex flex-wrap gap-1">
              {conf != null && <Badge variant="outline" className={`text-[10px] ${confColor}`}>{conf}% · {c.match_method}</Badge>}
              {c.card_grading && c.card_grading !== "raw" && <Badge variant="secondary" className="text-[10px]">{c.card_grading}</Badge>}
              {ribbon ? <Badge variant="secondary" className="text-[10px]">{t("curation.variant")}</Badge> : null}
            </div>
            <div className="text-muted-foreground">{c.ocr_price_jpy != null ? `¥${c.ocr_price_jpy.toLocaleString()}` : t("curation.noPrice")}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {c.source_author_handle}{c.source_tweet_date ? ` · ${c.source_tweet_date}` : ""}
              {c.source_tweet_url && <> · <a href={c.source_tweet_url} target="_blank" rel="noreferrer" className="underline">{t("curation.source")}</a></>}
            </div>
          </div>
        </div>

        {correcting && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-2">
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">{t("curation.grading")}</Label>
                <select value={grading} onChange={(e) => setGrading(e.target.value)} className="h-8 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="raw">{t("curation.raw")}</option>
                  <option value="psa_10">PSA 10</option>
                </select></div>
              <div><Label className="text-xs">{t("curation.priceJpy")}</Label>
                <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="h-8" /></div>
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1"><Search className="size-3" />{t("curation.changeCard")}</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("curation.searchPlaceholder")} className="h-8" />
              {override && <div className="mt-1 flex items-center gap-1 text-xs"><Badge variant="secondary">{getCardDisplayName(override, language)} · {cardMeta(override.set_code, override.card_number, override.misc_info)}</Badge><Button variant="ghost" size="icon" className="size-5" onClick={() => setOverride(null)}><X className="size-3" /></Button></div>}
              {search && hits.length > 0 && (
                <div className="mt-1 max-h-40 overflow-auto rounded-md border bg-background">
                  {hits.map((h) => (
                    <button key={h.card_id} onClick={() => { setOverride(h); setSearch(""); setHits([]); }}
                      className="block w-full truncate px-2 py-1 text-left text-xs hover:bg-accent">
                      {getCardDisplayName(h, language)} · {cardMeta(h.set_code, h.card_number, h.misc_info)}{cardVariant(h.misc_info) ? "" : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 border-t pt-2">
              <Button size="sm" disabled={saving || !(override || hasMatch)} onClick={doApprove}>
                <Check className="size-4 mr-1" />{t("curation.approveFixes")}
              </Button>
              <Button size="sm" variant="outline" disabled={saving} onClick={() => onReject(c)}>
                <X className="size-4 mr-1" />{t("curation.rejectNoMatch")}
              </Button>
              <span className="ml-auto text-[10px] text-muted-foreground">{t("curation.rejectHint")}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {/* the three curator decisions: it's right · it's wrong (fix or reject) · later */}
          <Button size="sm" disabled={saving || !hasMatch} onClick={() => onApprove(c)}>
            <Check className="size-4 mr-1" />{t("curation.markCorrect")}
          </Button>
          <Button size="sm" variant={correcting ? "secondary" : "outline"} disabled={saving} onClick={() => setCorrecting((v) => !v)}>
            <Pencil className="size-4 mr-1" />{t("curation.correctMatch")}
          </Button>
          {status === "pending" && (
            <Button size="sm" variant="ghost" className="ml-auto" disabled={saving} onClick={() => onSendBack(c)}>
              <Clock className="size-4 mr-1" />{t("curation.deferLater")}
            </Button>
          )}
          {saving && <Loader2 className="size-4 animate-spin" />}
        </div>
        {!hasMatch && !correcting && <p className="text-[10px] text-muted-foreground">{t("curation.noMatchHint")}</p>}
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
  src: string; bbox: BBox; w: number; h: number; onClick?: () => void;
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

  // Esc closes; arrow keys nudge the pan (handy on trackpads).
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
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, scale]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
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
    e.stopPropagation();
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

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 overflow-hidden bg-black/85"
      onClick={onClose}
      onWheel={onWheel}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
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

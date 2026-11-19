"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ImageOff, ArrowRight, Check, X, Pencil, Clock, Search, Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useDebouncedValue } from "./use-card-data";
import { ImageGeometryEditor } from "./ImageGeometryEditor";
import { PriceEvidenceBadge } from "./PriceEvidenceBadge";
import { type ImageGeometry, parseGridGeometry, sameGeometry, shouldSubmitGeometryCorrection } from "@/lib/image-curation-geometry";
import { matchDisplayName, type CurationCardProps, type CurationCandidate, type CurationApproval, type CurationMatch, type CurationConfig } from "./curation-model";
import { CropPreview, Lightbox } from "./curation-images";

export function CurationCandidateCard({ config, c, idx, status, language, saving, selected, onSelect, onApprove, onReject, onSendBack, onUndo }:
  CurationCardProps<CurationCandidate, CurationApproval> & { config: CurationConfig }) {
  const { t } = useTranslation();
  const [correcting, setCorrecting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [override, setOverride] = useState<CurationMatch | null>(null);
  const [condition, setCondition] = useState(c.condition || config.defaultCondition);
  const [price, setPrice] = useState(c.ocr_price_jpy != null ? String(c.ocr_price_jpy) : "");
  const [notes, setNotes] = useState(c.curator_notes ?? "");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<CurationMatch[]>([]);
  const [zoom, setZoom] = useState<string | null>(null); // image URL shown in the lightbox
  const idPrefix = useId();
  const ids = {
    condition: `${idPrefix}-${config.conditionField}`,
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
  const matchedImg = override?.image_url ?? c.match?.image_url ?? null;
  // The notes value carried on approve / reject / defer. Empty string means
  // "no change" (COALESCE on the RPC side keeps whatever's already recorded);
  // trimmed text means "overwrite with this."
  const notesArg = () => (notes.trim() && notes !== (c.curator_notes ?? "") ? notes.trim() : null);

  // confidence as a 0-100 chip; colour by band. Rendered with a tinted
  // background (not just coloured text) so it's readable at a glance next to
  // the other outline badges - the previous text-only 10px chip disappeared
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
  const cellLabel = c.cellLabel;

  useEffect(() => {
    const query = dSearch.trim();
    if (!query) { setHits([]); return; }
    let active = true;
    void config.search(query).then((matches) => { if (active) setHits(matches); });
    return () => { active = false; };
  }, [config, dSearch]);

  const currentMatch = override ?? c.match;
  const matchName = currentMatch ? matchDisplayName(currentMatch, language) : t("curation.noMatch");
  const matchMeta = currentMatch?.meta ?? "";
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
      matchId: override?.id, // null → keep candidate's match
      condition: condition !== (c.condition || config.defaultCondition) || override ? condition : null,
      priceJpy: priceJpy !== c.ocr_price_jpy ? priceJpy : null,
      notes: notesArg(),
      geometry: geometryDirty && geometry ? geometry : undefined,
      naturalWidth: geometryDirty ? naturalSize.width : undefined,
      naturalHeight: geometryDirty ? naturalSize.height : undefined,
    });
  }
  const hasMatch = !!c.matched_id; // mark-correct needs an existing match; no-match → correct/reject

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
              {conf != null && (
                <Badge
                  variant="outline"
                  className={`max-w-full whitespace-normal break-words font-semibold ${confBadgeClass}`}
                  title={t("curation.identityConfidenceHint")}
                  aria-label={`${t("curation.identityConfidence", { confidence: conf })}. ${t("curation.identityConfidenceHint")}`}
                >
                  {t("curation.identityConfidence", { confidence: conf })}{c.match_method ? ` · ${c.match_method}` : ""}
                </Badge>
              )}
              <PriceEvidenceBadge evidence={c.price_evidence} />
              {c.condition && c.condition !== config.defaultCondition && <Badge variant="secondary" className="text-[10px]">{c.condition}</Badge>}
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
              <div><Label htmlFor={ids.condition} className="text-xs">{t(config.conditionLabel)}</Label>
                <select id={ids.condition} value={condition} onChange={(e) => setCondition(e.target.value)} className="min-h-11 w-full rounded-md border bg-background px-2 text-sm">
                  {config.conditionOptions.map(({ value, label }) => (
                    <option key={value} value={value}>{label === "PSA 10" ? label : t(label)}</option>
                  ))}
                </select></div>
              <div><Label htmlFor={ids.price} className="text-xs">{t("curation.priceJpy")}</Label>
                <Input id={ids.price} type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="min-h-11" /></div>
            </div>
            <div>
              <Label htmlFor={ids.search} className="text-xs flex items-center gap-1"><Search className="size-3" />{t(config.changeMatchLabel)}</Label>
              <Input id={ids.search} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t(config.searchPlaceholder)} className="min-h-11" />
              {override && <div className="mt-1 flex min-w-0 items-center gap-1 text-xs"><Badge variant="secondary" className="min-w-0 truncate">{matchDisplayName(override, language)} · {override.meta}</Badge><Button variant="ghost" size="icon" className="min-h-11 min-w-11 sm:min-h-11 sm:min-w-11" aria-label={t("curation.clearOverride")} onClick={() => setOverride(null)}><X className="size-3" /></Button></div>}
              {search && hits.length > 0 && (
                <div className="mt-1 max-h-40 overflow-auto rounded-md border bg-background">
                  {hits.map((h) => (
                    <button key={h.id} onClick={() => { setOverride(h); setSearch(""); setHits([]); }}
                      className="block min-h-11 w-full truncate px-2 py-1 text-left text-xs hover:bg-accent">
                      {matchDisplayName(h, language)} · {h.meta}
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
            first opening the correct panel - leftover intent lands on approve /
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
          {status === "auto_approved" ? (
            <>
              {/* Spot-check: the only decision on a promoted row is a full
                  reversal (G4 compensation) - the queue actions would either
                  double-promote or leave the price effect standing. */}
              {onUndo && (
                <Button size="sm" variant="outline" className="min-h-11 sm:min-h-11" disabled={saving} onClick={() => onUndo(c)}>
                  <X className="size-4 mr-1" />{t("curation.reverse")}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-11" onClick={() => setShowDetails((v) => !v)}>
                {showDetails ? t("curation.hideDetails") : t("curation.showDetails")}
              </Button>
            </>
          ) : (
            <>
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
            </>
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

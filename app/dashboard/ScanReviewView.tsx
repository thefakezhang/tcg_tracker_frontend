"use client";

// Scanner batch review: the operator surface where a scanned capture becomes a
// decided card (backend #1016, under the story in #1011 and the epic in #930).
//
// The standard this screen exists to meet: whenever the pipeline is unsure what
// a card is, that card must reach a person, and that person must be able to
// pick the right one. The failure it prevents is not a crash. It is a wrong
// card, priced and listed, that nobody was ever asked about.
//
// Design: docs/scanner_review_screen.md in the backend repo.

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight,
  Loader2, Pencil, RotateCcw, ScanLine,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { smartSearchFilters } from "@/lib/card-search";
import { useTranslation } from "@/lib/i18n";
import {
  type ScanBand, type ScanCapture,
  SCAN_BANDS, batchProgress, claimKey, countClaims, groupByBand,
  isProposalContested, remainingFor,
} from "@/lib/scan-review";
import { cardMeta, getCardDisplayName, type CardDefinition } from "./use-card-data";
import { POKEMON_CARD_DEF_COLS } from "./use-card-data";
import { useLanguage } from "./LanguageContext";
import { useSupabaseQuery, QueryError } from "./use-query";
import {
  type CandidateCard, type ScanBatchSummary,
  fetchCardsByUid, useScanBatch, useScanBatches, useScanDecisions, useTcgplayerConditions,
} from "./use-scan-review";
import { CardCandidatePicker, type PickerCandidate } from "./CardCandidatePicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

const BAND_CLASS: Record<ScanBand, string> = {
  decided: "border-border bg-muted text-muted-foreground",
  high: "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400",
  medium: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  low: "border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-400",
  parked: "border-destructive/50 bg-destructive/10 text-destructive",
};

// A confirm that needs no thought is the failure mode here, so only the band
// the recognizer was genuinely sure about gets a one-click confirm. Everywhere
// else the operator has to choose a card before anything can be recorded.
const ONE_CLICK_CONFIRM: ReadonlySet<ScanBand> = new Set<ScanBand>(["high"]);

export default function ScanReviewView() {
  const { t } = useTranslation();
  const [batchId, setBatchId] = useState<string | null>(null);
  const batches = useScanBatches();

  if (batchId) {
    return <BatchReview batchId={batchId} onBack={() => setBatchId(null)} />;
  }

  if (batches.error) return <div className="p-4"><QueryError error={batches.error} onRetry={batches.retry} /></div>;
  if (batches.isLoading && !batches.data) {
    return <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  }

  const rows = batches.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-12 text-center text-muted-foreground">
        <ScanLine className="size-8" aria-hidden />
        <p className="text-sm">{t("scanReview.noBatches")}</p>
        <p className="max-w-md text-xs">{t("scanReview.noBatchesHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      {rows.map((batch) => <BatchRow key={batch.batchId} batch={batch} onOpen={() => setBatchId(batch.batchId)} />)}
    </div>
  );
}

function BatchRow({ batch, onOpen }: { batch: ScanBatchSummary; onOpen: () => void }) {
  const { t } = useTranslation();
  const remaining = batch.total - batch.decided;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-4 rounded-lg border p-3 text-left transition-colors hover:border-muted-foreground/40 hover:bg-muted/40"
    >
      <ScanLine className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{batch.batchLabel}</p>
        <p className="truncate text-xs text-muted-foreground">
          {t(`trips.leg${batch.leg === "export" ? "Export" : "Import"}` as "trips.legImport")}
          {" · "}{batch.recognizer}{" · "}{batch.inventorySource}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm tabular-nums">{t("scanReview.progress", { decided: String(batch.decided), total: String(batch.total) })}</p>
        {remaining > 0
          ? <p className="text-xs text-muted-foreground">{t("scanReview.remaining", { count: String(remaining) })}</p>
          : <p className="text-xs text-green-600 dark:text-green-400">{t("scanReview.batchComplete")}</p>}
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

function BatchReview({ batchId, onBack }: { batchId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const batch = useScanBatch(batchId);
  const { conditions, defaultConditionId } = useTcgplayerConditions();
  const { decide, clear } = useScanDecisions();

  const [conditionId, setConditionId] = useState<number | null>(null);
  const effectiveCondition = conditionId ?? defaultConditionId;
  const [openCaptureId, setOpenCaptureId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ decided: true, high: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Availability as reported by the RPC, keyed by listing group. Learned as
  // decisions are made, never assumed.
  const [availability, setAvailability] = useState<Map<string, number>>(new Map());
  // A visible record of what was just decided. Without it a mis-click is
  // unrecoverable, because nothing on screen says what changed.
  const [lastDecision, setLastDecision] = useState<string | null>(null);

  const captures = useMemo(() => batch.data?.captures ?? [], [batch.data]);
  const cards = batch.data?.cards ?? new Map<string, CandidateCard>();
  const images = batch.data?.images ?? new Map();
  const grouped = useMemo(() => groupByBand(captures), [captures]);
  const claims = useMemo(() => countClaims(captures), [captures]);
  const progress = useMemo(() => batchProgress(captures), [captures]);

  const runDecision = useCallback(
    async (capture: ScanCapture, cardUid: string) => {
      if (effectiveCondition == null) return;
      setBusy(capture.captureId);
      setError(null);
      try {
        const result = await decide(capture.captureId, cardUid, effectiveCondition);
        setAvailability((prev) => {
          const next = new Map(prev);
          next.set(claimKey(result.decidedCardUid, result.decidedConditionId), result.availableQuantity);
          return next;
        });
        const card = cards.get(result.decidedCardUid);
        setLastDecision(
          t(result.decision === "corrected" ? "scanReview.lastCorrected" : "scanReview.lastConfirmed", {
            ordinal: String(capture.ordinal),
            card: card ? card.name : result.decidedCardUid.slice(0, 8),
          }),
        );
        setOpenCaptureId(null);
        await batch.retry();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(null);
      }
    },
    [batch, cards, decide, effectiveCondition, t],
  );

  const runClear = useCallback(
    async (capture: ScanCapture) => {
      setBusy(capture.captureId);
      setError(null);
      try {
        await clear(capture.captureId);
        setLastDecision(t("scanReview.lastCleared", { ordinal: String(capture.ordinal) }));
        setOpenCaptureId(null);
        await batch.retry();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setBusy(null);
      }
    },
    [batch, clear, t],
  );

  const openCapture = captures.find((c) => c.captureId === openCaptureId) ?? null;

  if (batch.error) return <div className="p-4"><QueryError error={batch.error} onRetry={batch.retry} /></div>;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden /> {t("scanReview.backToBatches")}
        </Button>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary" className="tabular-nums">
            {t("scanReview.progress", { decided: String(progress.decided), total: String(progress.total) })}
          </Badge>
          {progress.corrected > 0 && (
            <Badge variant="outline" className="tabular-nums">
              {t("scanReview.correctedCount", { count: String(progress.corrected) })}
            </Badge>
          )}
          {progress.correctionRate != null && progress.correctionRate > 0 && (
            <span className="text-xs text-muted-foreground">
              {t("scanReview.correctionRate", { rate: String(Math.round(progress.correctionRate * 100)) })}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="scan-condition" className="text-xs text-muted-foreground">{t("scanReview.condition")}</label>
          <select
            id="scan-condition"
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={effectiveCondition ?? ""}
            onChange={(event) => setConditionId(Number(event.target.value))}
          >
            {conditions.map((c) => <option key={c.conditionId} value={c.conditionId}>{c.code}</option>)}
          </select>
        </div>
      </div>

      {lastDecision && (
        <p className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
          {lastDecision}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {batch.isLoading && !batch.data
        ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        : SCAN_BANDS.map((band) => {
            const list = grouped[band];
            if (list.length === 0) return null;
            const isCollapsed = collapsed[band] ?? false;
            return (
              <section key={band} className="space-y-2">
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [band]: !isCollapsed }))}
                  className="flex items-center gap-2"
                >
                  {isCollapsed ? <ChevronRight className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
                  <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${BAND_CLASS[band]}`}>
                    {t(`scanReview.band.${band}` as "scanReview.band.high")} · {list.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <ul className="space-y-1.5">
                    {list.map((capture) => (
                      <CaptureRow
                        key={capture.captureId}
                        capture={capture}
                        band={band}
                        cards={cards}
                        contested={
                          effectiveCondition != null
                          && isProposalContested(capture, effectiveCondition, availability, claims)
                        }
                        remaining={
                          capture.decidedCardUid != null && capture.decidedConditionId != null
                            ? remainingFor(capture.decidedCardUid, capture.decidedConditionId, availability, claims)
                            : null
                        }
                        busy={busy === capture.captureId}
                        canOneClick={ONE_CLICK_CONFIRM.has(band) && effectiveCondition != null}
                        onOpen={() => setOpenCaptureId(capture.captureId)}
                        onConfirm={() => capture.proposedCardUid && runDecision(capture, capture.proposedCardUid)}
                        onClear={() => runClear(capture)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

      <Sheet open={openCapture != null} onOpenChange={(open) => !open && setOpenCaptureId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
          {openCapture && (
            <>
              <SheetHeader>
                <SheetTitle>{t("scanReview.captureTitle", { ordinal: String(openCapture.ordinal) })}</SheetTitle>
              </SheetHeader>
              <CaptureDecider
                capture={openCapture}
                cards={cards}
                images={images.get(openCapture.captureId) ?? { front: null, back: null }}
                busy={busy === openCapture.captureId}
                onDecide={(cardUid) => runDecision(openCapture, cardUid)}
                onClear={() => runClear(openCapture)}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CaptureRow(props: {
  capture: ScanCapture;
  band: ScanBand;
  cards: Map<string, CandidateCard>;
  contested: boolean;
  remaining: number | null;
  busy: boolean;
  canOneClick: boolean;
  onOpen: () => void;
  onConfirm: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { capture, cards, contested, remaining, busy } = props;

  const shownUid = capture.decidedCardUid ?? capture.proposedCardUid;
  const card = shownUid ? cards.get(shownUid) : undefined;
  const decided = capture.decision != null;

  return (
    <li className="flex items-center gap-3 rounded-lg border p-2">
      <span className="w-10 shrink-0 text-center font-mono text-sm tabular-nums text-muted-foreground">
        {capture.ordinal}
      </span>
      <button type="button" onClick={props.onOpen} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium">
          {card ? getCardDisplayName({ regional_name: card.name, english_name: card.englishName }, language) : t("scanReview.unidentified")}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {card ? cardMeta(card.setCode, card.cardNumber, card.miscInfo) : (capture.parkReason ? t(`scanReview.park.${capture.parkReason}` as "scanReview.park.ambiguous") : "")}
        </p>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {contested && (
          <Badge variant="outline" className="border-destructive/50 text-destructive">
            <AlertTriangle className="mr-1 size-3" aria-hidden />{t("scanReview.contested")}
          </Badge>
        )}
        {decided && remaining != null && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("scanReview.availableAfter", { count: String(remaining) })}
          </span>
        )}
        {capture.proposedScore != null && !decided && (
          <Badge variant="secondary" className="font-mono text-[10px]">{Math.round(capture.proposedScore * 100)}</Badge>
        )}
        {decided ? (
          <>
            <Badge variant={capture.decision === "corrected" ? "outline" : "secondary"}>
              {t(capture.decision === "corrected" ? "scanReview.corrected" : "scanReview.confirmed")}
            </Badge>
            <Button size="sm" variant="ghost" disabled={busy} onClick={props.onClear} title={t("scanReview.undo")}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
            </Button>
          </>
        ) : (
          <>
            {/* Only the band the recognizer was sure about gets a one-click
                confirm; the rest must be opened and chosen deliberately. */}
            {props.canOneClick && capture.proposedCardUid && !contested && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={props.onConfirm}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                <span className="ml-1">{t("scanReview.confirm")}</span>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={props.onOpen}>
              <Pencil className="size-4" aria-hidden /><span className="ml-1">{t("scanReview.review")}</span>
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function CaptureDecider(props: {
  capture: ScanCapture;
  cards: Map<string, CandidateCard>;
  images: { front: string | null; back: string | null };
  busy: boolean;
  onDecide: (cardUid: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { capture, cards, images, busy } = props;
  const [selected, setSelected] = useState<string | null>(capture.decidedCardUid ?? capture.proposedCardUid);
  const [searchCards, setSearchCards] = useState<Map<string, CandidateCard>>(new Map());

  const toPicker = useCallback(
    (card: CandidateCard, score: number | null, marginToNext: number | null): PickerCandidate => ({
      cardUid: card.cardUid,
      name: getCardDisplayName({ regional_name: card.name, english_name: card.englishName }, language),
      meta: cardMeta(card.setCode, card.cardNumber, card.miscInfo),
      imageUrl: card.imageUrl,
      rarity: card.rarity,
      score,
      marginToNext,
      price: card.price,
      currency: card.currency,
    }),
    [language],
  );

  const shortlist = useMemo(() => {
    const out: PickerCandidate[] = [];
    capture.candidates.forEach((candidate, index) => {
      const card = cards.get(candidate.cardUid) ?? searchCards.get(candidate.cardUid);
      if (!card) return;
      const next = capture.candidates[index + 1];
      out.push(toPicker(card, candidate.score, next ? candidate.score - next.score : null));
    });
    return out;
  }, [capture.candidates, cards, searchCards, toPicker]);

  // Search must be able to reach any card. A capture whose recognizer returned
  // nothing is otherwise a dead end, and "needs manual identification" becomes
  // a status that tells a person to act while offering nothing to act with.
  const onSearch = useCallback(
    async (term: string): Promise<PickerCandidate[]> => {
      const supabase = createClient();
      let query = supabase
        .from("pokemon_card_definitions")
        .select(POKEMON_CARD_DEF_COLS)
        .limit(40);
      for (const filter of smartSearchFilters(
        term,
        ["regional_name", "english_name", "set_code", "card_number"],
        "card_uid",
        "card_id",
        [],
      )) {
        query = query.or(filter);
      }
      const { data } = await query;
      const uids = ((data as CardDefinition[] | null) ?? [])
        .map((d) => d.card_uid)
        .filter((uid): uid is string => typeof uid === "string");
      const hydrated = await fetchCardsByUid(uids);
      setSearchCards((prev) => new Map([...prev, ...hydrated]));
      return [...hydrated.values()].map((card) => toPicker(card, null, null));
    },
    [toPicker],
  );

  const selectedCard = selected ? cards.get(selected) ?? searchCards.get(selected) : undefined;
  const isCorrection = capture.proposedCardUid != null && selected !== capture.proposedCardUid;

  return (
    <div className="space-y-4 p-4">
      {capture.parkReason && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t(`scanReview.park.${capture.parkReason}` as "scanReview.park.ambiguous")}
          {capture.parkDetail ? ` · ${capture.parkDetail}` : ""}
        </p>
      )}

      <CardCandidatePicker
        images={[
          { url: images.front, label: t("scanReview.front") },
          { url: images.back, label: t("scanReview.back") },
        ]}
        candidates={shortlist}
        selectedCardUid={selected}
        onSelect={setSelected}
        onSearch={onSearch}
        disabled={busy}
      />

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button
          disabled={busy || selected == null}
          onClick={() => selected && props.onDecide(selected)}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          <span className="ml-1">
            {isCorrection ? t("scanReview.saveCorrection") : t("scanReview.confirm")}
          </span>
        </Button>
        {capture.decision != null && (
          <Button variant="outline" disabled={busy} onClick={props.onClear}>
            <RotateCcw className="size-4" aria-hidden /><span className="ml-1">{t("scanReview.undo")}</span>
          </Button>
        )}
        {selectedCard && (
          <span className="text-xs text-muted-foreground">
            {t("scanReview.willRecord", {
              card: getCardDisplayName({ regional_name: selectedCard.name, english_name: selectedCard.englishName }, language),
            })}
          </span>
        )}
        {selected == null && (
          <span className="text-xs text-muted-foreground">{t("scanReview.chooseFirst")}</span>
        )}
      </div>
    </div>
  );
}

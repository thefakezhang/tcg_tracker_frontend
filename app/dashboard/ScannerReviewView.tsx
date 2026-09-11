"use client";

/**
 * Scanner batch review.
 *
 * The scanner recognises a card; a person confirms it. This is where that
 * happens, and it exists because the alternative is a threshold loose enough
 * to auto-assign nearly everything - which is precisely the wrong trade when
 * the output is a priced, public listing.
 *
 * Two decisions shape the whole screen:
 *
 * The operator supplies the CONDITION. Recognition cannot recover it from a
 * scan, and it is what separates one listing from another, so a capture is not
 * decidable until a condition is chosen. That is why the confirm button stays
 * disabled rather than defaulting to Near Mint: a wrong default silently
 * misprices every card that takes it.
 *
 * Every candidate is shown, including weak ones. A low score is a reason not
 * to decide automatically, never a reason to hide a card from someone who can
 * recognise it on sight.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { useTranslation, type TranslationKey } from "@/lib/i18n";

const BUCKET = "inventory-card-media";
// Long enough to review a batch without re-minting mid-session, short enough
// that a leaked URL is not a standing grant.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export interface ScannerCandidate {
  card_uid: string;
  score: number;
}

export interface ScannerCapture {
  capture_id: string;
  ordinal: number;
  front_object_key: string | null;
  back_object_key: string | null;
  candidates: ScannerCandidate[];
  proposed_card_uid: string | null;
  proposed_score: number | null;
  top_margin: number | null;
  park_reason: string | null;
  park_detail: string | null;
  decision: string | null;
  decided_card_uid: string | null;
  decided_condition_id: number | null;
}

export interface ScannerBatch {
  batch_id: string;
  batch_label: string;
  leg: string;
  recognizer: string;
  staged_at: string;
}

export interface ConditionOption {
  condition_id: number;
  code: string;
  display_name: string;
}

/**
 * Why a capture needs a person, in the operator's words rather than the
 * database's. A park reason that reads as an enum tells a reviewer nothing
 * about what to do next.
 */
export function parkExplanation(
  capture: ScannerCapture,
  t: (key: TranslationKey) => string,
): string {
  if (capture.park_reason === "no_candidates") return t("scanner.parkNoCandidates");
  if (capture.park_reason === "below_min_score") return t("scanner.parkWeak");
  if (capture.park_reason === "ambiguous") return t("scanner.parkAmbiguous");
  if (capture.park_reason === "inventory_exhausted")
    return t("scanner.parkExhausted");
  return t("scanner.parkUnknown");
}

/**
 * A capture is decidable only once a card AND a condition are chosen.
 *
 * Exported so the rule is testable on its own: it is the one thing standing
 * between a scan and a priced listing.
 */
export function canDecide(
  selectedCard: string | null,
  selectedCondition: number | null,
): boolean {
  return Boolean(selectedCard) && Boolean(selectedCondition);
}

/** Highest score first, so the strongest proposal is the first thing read. */
export function rankedCandidates(capture: ScannerCapture): ScannerCandidate[] {
  return [...(capture.candidates ?? [])].sort((a, b) => b.score - a.score);
}

export function CaptureCard({
  capture,
  conditions,
  imageUrls,
  onDecide,
  busy,
}: {
  capture: ScannerCapture;
  conditions: ConditionOption[];
  imageUrls: { front?: string; back?: string };
  onDecide: (cardUid: string, conditionId: number) => Promise<void>;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [card, setCard] = useState<string | null>(capture.proposed_card_uid);
  const [condition, setCondition] = useState<number | null>(
    capture.decided_condition_id,
  );

  const ranked = useMemo(() => rankedCandidates(capture), [capture]);
  const decided = Boolean(capture.decision);

  return (
    <Card className="p-4 space-y-3" data-testid={`capture-${capture.ordinal}`}>
      <div className="flex items-baseline justify-between">
        {/* The ordinal is what makes review actionable rather than theoretical:
            it is how a physical card is found again in a box of 200. */}
        <span className="font-mono text-sm">#{capture.ordinal}</span>
        {decided ? (
          <span className="text-xs uppercase tracking-wide text-emerald-600">
            {capture.decision}
          </span>
        ) : (
          <span className="text-xs text-amber-600">
            {parkExplanation(capture, t)}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        {imageUrls.front && (
          <Image
            src={imageUrls.front}
            alt={t("scanner.frontAlt")}
            width={150}
            height={210}
            className="rounded border"
            unoptimized
          />
        )}
        {/* The back is context only. It identifies nothing - see
            scanner_intake - and is shown because a reviewer sometimes needs it
            to tell an edition apart. */}
        {imageUrls.back && (
          <Image
            src={imageUrls.back}
            alt={t("scanner.backAlt")}
            width={150}
            height={210}
            className="rounded border opacity-80"
            unoptimized
          />
        )}
      </div>

      <div className="space-y-1">
        {ranked.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("scanner.noCandidates")}
          </p>
        )}
        {ranked.map((candidate) => (
          <label
            key={candidate.card_uid}
            className="flex items-center gap-2 text-sm"
          >
            <input
              type="radio"
              name={`card-${capture.capture_id}`}
              checked={card === candidate.card_uid}
              onChange={() => setCard(candidate.card_uid)}
              disabled={decided || busy}
            />
            <span className="font-mono text-xs">{candidate.card_uid}</span>
            <span className="text-muted-foreground">
              {candidate.score.toFixed(3)}
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {/* No default. Condition is the operator's input, and defaulting it
            would silently misprice every card that took the default. */}
        <select
          className="border rounded px-2 py-1 text-sm"
          value={condition ?? ""}
          onChange={(event) =>
            setCondition(event.target.value ? Number(event.target.value) : null)
          }
          disabled={decided || busy}
          aria-label={t("scanner.condition")}
        >
          <option value="">{t("scanner.chooseCondition")}</option>
          {conditions.map((option) => (
            <option key={option.condition_id} value={option.condition_id}>
              {option.code} — {option.display_name}
            </option>
          ))}
        </select>

        <Button
          size="sm"
          disabled={decided || busy || !canDecide(card, condition)}
          onClick={() => card && condition && onDecide(card, condition)}
        >
          {capture.proposed_card_uid && card === capture.proposed_card_uid
            ? t("scanner.confirm")
            : t("scanner.correct")}
        </Button>
      </div>
    </Card>
  );
}

export default function ScannerReviewView() {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);

  const [batches, setBatches] = useState<ScannerBatch[]>([]);
  const [activeBatch, setActiveBatch] = useState<string | null>(null);
  const [captures, setCaptures] = useState<ScannerCapture[]>([]);
  const [conditions, setConditions] = useState<ConditionOption[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<Record<string, number>>({});

  useEffect(() => {
    void (async () => {
      const [batchRes, conditionRes] = await Promise.all([
        supabase
          .from("scanner_batches")
          .select("batch_id,batch_label,leg,recognizer,staged_at")
          .order("staged_at", { ascending: false }),
        // Only the TCGplayer scale: inventory grades on it and so does the US
        // listing leg, so a Japanese source's code would enter inventory in a
        // form eBay cannot express.
        supabase
          .from("conditions")
          .select("condition_id,code,display_name")
          .eq("standard", "tcgplayer")
          .order("condition_id"),
      ]);
      if (batchRes.error) setError(batchRes.error.message);
      setBatches(batchRes.data ?? []);
      setConditions(conditionRes.data ?? []);
      if (!activeBatch && batchRes.data?.length) {
        setActiveBatch(batchRes.data[0].batch_id);
      }
    })();
  }, [supabase, activeBatch]);

  const loadCaptures = useCallback(
    async (batchId: string) => {
      const { data, error: captureError } = await supabase
        .from("scanner_batch_captures")
        .select("*")
        .eq("batch_id", batchId)
        .order("ordinal");
      if (captureError) {
        setError(captureError.message);
        return;
      }
      const rows = (data ?? []) as ScannerCapture[];
      setCaptures(rows);

      // The bucket is private, so every image needs a signed URL. Minted in
      // one call per batch rather than per capture: a 200-image batch would
      // otherwise open 400 requests before showing anything.
      const keys = rows
        .flatMap((row) => [row.front_object_key, row.back_object_key])
        .filter((key): key is string => Boolean(key));
      if (keys.length) {
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrls(keys, SIGNED_URL_TTL_SECONDS);
        const next: Record<string, string> = {};
        for (const entry of signed ?? []) {
          if (entry.path && entry.signedUrl) next[entry.path] = entry.signedUrl;
        }
        setUrls(next);
      }
    },
    [supabase],
  );

  useEffect(() => {
    if (activeBatch) void loadCaptures(activeBatch);
  }, [activeBatch, loadCaptures]);

  const decide = useCallback(
    async (captureId: string, cardUid: string, conditionId: number) => {
      setBusy(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc(
        "decide_scanner_batch_capture",
        {
          p_capture_id: captureId,
          p_card_uid: cardUid,
          p_condition_id: conditionId,
        },
      );
      setBusy(false);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      // Reported, never stored: what the listing would carry if built now.
      // Zero is not an error but is worth seeing - it means the box holds a
      // card the inventory does not.
      const quantity = (data as { available_quantity?: number } | null)
        ?.available_quantity;
      if (typeof quantity === "number") {
        setAvailable((prev) => ({ ...prev, [captureId]: quantity }));
      }
      if (activeBatch) void loadCaptures(activeBatch);
    },
    [supabase, activeBatch, loadCaptures],
  );

  const undecided = captures.filter((capture) => !capture.decision).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("scanner.help")}</p>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {batches.map((batch) => (
          <Button
            key={batch.batch_id}
            size="sm"
            variant={batch.batch_id === activeBatch ? "default" : "outline"}
            onClick={() => setActiveBatch(batch.batch_id)}
          >
            {batch.batch_label}
          </Button>
        ))}
      </div>

      {batches.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("scanner.noBatches")}</p>
      )}

      {activeBatch && (
        <p className="text-sm">
          {t("scanner.remaining")}: {undecided} / {captures.length}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {captures.map((capture) => (
          <div key={capture.capture_id} className="space-y-1">
            <CaptureCard
              capture={capture}
              conditions={conditions}
              busy={busy}
              imageUrls={{
                front: capture.front_object_key
                  ? urls[capture.front_object_key]
                  : undefined,
                back: capture.back_object_key
                  ? urls[capture.back_object_key]
                  : undefined,
              }}
              onDecide={(cardUid, conditionId) =>
                decide(capture.capture_id, cardUid, conditionId)
              }
            />
            {available[capture.capture_id] !== undefined && (
              <p className="text-xs text-muted-foreground">
                {t("scanner.covers")}: {available[capture.capture_id]}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

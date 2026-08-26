"use client";

import { useMemo, useState } from "react";
import { ImageOff, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";
import { formatUsd } from "@/lib/money";
import { useTranslation } from "@/lib/i18n";
import { QueryError, useSupabaseQuery } from "./use-query";
import {
  counterpartCompletenessKey,
  formatCounterpartRoi,
  reviewEnglishCounterpart,
  type EnglishCounterpartCompleteness,
  type EnglishCounterpartDecisionInput,
} from "./english-counterpart";

export interface EnglishCounterpartReviewRow {
  candidate_uid: string;
  review_version: number;
  status: "review" | "failed";
  identity_basis: string;
  confidence: number | string;
  evidence: Record<string, unknown>;
  provenance: string;
  failure_code: string | null;
  first_seen_at: string;
  last_seen_at: string;
  japanese_card_id: number;
  japanese_card_uid: string;
  japanese_name: string | null;
  japanese_english_name: string | null;
  japanese_set_code: string | null;
  japanese_card_number: string | null;
  japanese_misc_info: string | null;
  japanese_image_url: string | null;
  japan_exclusive_artwork: boolean;
  japan_exclusive_stamps: boolean;
  proposed_english_card_id: number | null;
  proposed_english_card_uid: string | null;
  proposed_english_name: string | null;
  proposed_english_set_code: string | null;
  proposed_english_card_number: string | null;
  proposed_english_misc_info: string | null;
  proposed_english_image_url: string | null;
  gate_status: string | null;
  completeness: EnglishCounterpartCompleteness | null;
  best_net_profit_usd: number | string | null;
  best_roi_ratio: number | string | null;
  profit_denominator_usd: number | string | null;
}

export async function fetchEnglishCounterpartReviewRows(
  supabase: ReturnType<typeof createClient>,
): Promise<EnglishCounterpartReviewRow[]> {
  return selectAll<EnglishCounterpartReviewRow>(
    () => supabase
      .from("pokemon_english_counterpart_review_v")
      .select("*")
      .in("status", ["review", "failed"]),
    ["candidate_uid"],
  );
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function printingIdentity(
  setCode: string | null,
  cardNumber: string | null,
  miscInfo: string | null,
): string {
  return [setCode, cardNumber, miscInfo && miscInfo !== "UNKNOWN" ? miscInfo : null]
    .filter(Boolean)
    .join(" · ");
}

function readableError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function CandidateImage({ src, alt }: { src: string | null; alt: string }) {
  return src ? (
    <img
      src={src}
      alt={alt}
      className="aspect-[5/7] w-full rounded-md bg-muted object-contain"
      loading="lazy"
    />
  ) : (
    <div className="flex aspect-[5/7] w-full items-center justify-center rounded-md bg-muted">
      <ImageOff className="size-8 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

export function EnglishCounterpartCandidateCard({
  row,
  onSaved,
}: {
  row: EnglishCounterpartReviewRow;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [englishCardId, setEnglishCardId] = useState(
    row.proposed_english_card_id == null ? "" : String(row.proposed_english_card_id),
  );
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [busyDecision, setBusyDecision] = useState<EnglishCounterpartDecisionInput["decision"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const normalizedCardId = Number(englishCardId);
  const evidenceReady = /^https:\/\/[^\s#]+$/.test(evidenceUrl.trim())
    && decisionNote.trim().length > 0
    && decisionNote.trim().length <= 500;
  const exactReady = evidenceReady
    && Number.isInteger(normalizedCardId)
    && normalizedCardId > 0;
  const confidence = numberOrNull(row.confidence);
  const profit = numberOrNull(row.best_net_profit_usd);
  const roi = numberOrNull(row.best_roi_ratio);
  const denominator = numberOrNull(row.profit_denominator_usd);

  const decide = async (decision: EnglishCounterpartDecisionInput["decision"]) => {
    setBusyDecision(decision);
    setError(null);
    try {
      await reviewEnglishCounterpart(createClient(), {
        candidateUid: row.candidate_uid,
        expectedVersion: row.review_version,
        decision,
        englishCardId: decision === "exact" ? normalizedCardId : null,
        evidenceUrl: decision === "exact" || decision === "no_counterpart" ? evidenceUrl : null,
        decisionNote: decision === "exact" || decision === "no_counterpart" ? decisionNote : null,
      });
      await onSaved();
    } catch (decisionError) {
      setError(readableError(decisionError));
    } finally {
      setBusyDecision(null);
    }
  };

  return (
    <Card className="min-w-0 overflow-hidden" data-candidate-status={row.status}>
      <CardHeader className="min-w-0 gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={row.status === "failed" ? "destructive" : "outline"}>
            {row.status === "failed" ? t("counterpart.failed") : t("counterpart.review")}
          </Badge>
          <Badge variant="secondary">{row.identity_basis.replaceAll("_", " ")}</Badge>
          <span className="text-xs text-muted-foreground">
            {t("counterpart.confidence")}: {confidence == null ? t("common.unknown") : `${(confidence * 100).toFixed(0)}%`}
          </span>
        </div>
        <CardTitle className="break-words text-base">
          {row.japanese_name ?? row.japanese_english_name ?? t("counterpart.japanesePrinting")}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_9rem_minmax(0,1fr)]">
          <CandidateImage
            src={row.japanese_image_url}
            alt={row.japanese_name ?? t("counterpart.japanesePrinting")}
          />
          <div className="min-w-0 text-sm">
            <div className="font-medium">{t("counterpart.japanesePrinting")}</div>
            <div className="mt-1 break-words text-muted-foreground">
              {printingIdentity(row.japanese_set_code, row.japanese_card_number, row.japanese_misc_info) || t("common.unknown")}
            </div>
            <div className="mt-1 break-all text-xs text-muted-foreground">ID {row.japanese_card_id}</div>
          </div>
          <CandidateImage
            src={row.proposed_english_image_url}
            alt={row.proposed_english_name ?? t("counterpart.proposedPrinting")}
          />
          <div className="min-w-0 text-sm">
            <div className="font-medium">{t("counterpart.proposedPrinting")}</div>
            {row.proposed_english_card_id == null ? (
              <p className="mt-1 text-muted-foreground">{t("counterpart.noProposal")}</p>
            ) : (
              <>
                <div className="mt-1 break-words">{row.proposed_english_name}</div>
                <div className="break-words text-muted-foreground">
                  {printingIdentity(row.proposed_english_set_code, row.proposed_english_card_number, row.proposed_english_misc_info)}
                </div>
                <div className="mt-1 break-all text-xs text-muted-foreground">ID {row.proposed_english_card_id}</div>
              </>
            )}
          </div>
        </div>

        {row.japan_exclusive_artwork && (
          <div className="flex min-w-0 items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm text-amber-900 dark:text-amber-200">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{t("counterpart.exclusiveArtworkWarning")}</span>
          </div>
        )}
        {!row.japan_exclusive_artwork && row.japan_exclusive_stamps && (
          <div className="rounded-md border border-blue-500/40 bg-blue-500/10 p-2 text-sm text-blue-900 dark:text-blue-200">
            {t("counterpart.stampOnlyNote")}
          </div>
        )}

        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          <div className="min-w-0 rounded-md border p-3 text-sm">
            <div className="font-medium">{t("counterpart.candidateEvidence")}</div>
            <pre className="mt-2 max-h-44 min-w-0 overflow-y-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
              {JSON.stringify(row.evidence, null, 2)}
            </pre>
            <dl className="mt-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{t("counterpart.provenance")}</dt>
              <dd className="break-all">{row.provenance}</dd>
              {row.failure_code && (
                <>
                  <dt className="text-muted-foreground">{t("counterpart.failureCode")}</dt>
                  <dd className="break-all text-destructive">{row.failure_code}</dd>
                </>
              )}
            </dl>
          </div>
          <div className="min-w-0 rounded-md border p-3 text-sm">
            <div className="font-medium">{t("counterpart.profitSignal")}</div>
            {row.completeness === "complete" ? (
              <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t("counterpart.gate")}</dt>
                <dd className="break-words">{row.gate_status ?? t("common.unknown")}</dd>
                <dt className="text-muted-foreground">Profit</dt>
                <dd>{profit == null ? t("common.unknown") : formatUsd(profit)}</dd>
                <dt className="text-muted-foreground">ROI</dt>
                <dd>{roi == null ? t("common.unknown") : formatCounterpartRoi(roi)}</dd>
                <dt className="text-muted-foreground">Denominator</dt>
                <dd>{denominator == null ? t("common.unknown") : formatUsd(denominator)}</dd>
              </dl>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("counterpart.unknownReason", {
                  reason: row.completeness
                    ? t(counterpartCompletenessKey(row.completeness))
                    : t("common.unknown"),
                })}
              </p>
            )}
          </div>
        </div>

        {row.status === "review" ? (
          <div className="min-w-0 space-y-3 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{t("counterpart.decisionHelp")}</p>
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              <label className="min-w-0 space-y-1 text-sm">
                <span>{t("counterpart.evidenceUrl")}</span>
                <Input
                  type="url"
                  inputMode="url"
                  value={evidenceUrl}
                  onChange={(event) => setEvidenceUrl(event.target.value)}
                  placeholder="https://"
                  className="min-h-11 min-w-0"
                />
              </label>
              <label className="min-w-0 space-y-1 text-sm">
                <span>{t("counterpart.englishCardId")}</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={englishCardId}
                  onChange={(event) => setEnglishCardId(event.target.value)}
                  className="min-h-11 min-w-0"
                />
              </label>
            </div>
            <label className="block min-w-0 space-y-1 text-sm">
              <span>{t("counterpart.decisionNote")}</span>
              <Textarea
                value={decisionNote}
                maxLength={500}
                onChange={(event) => setDecisionNote(event.target.value)}
                className="min-h-24 min-w-0 resize-y"
              />
            </label>
            {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                className="min-h-11"
                disabled={busyDecision != null || !exactReady}
                onClick={() => void decide("exact")}
              >
                {busyDecision === "exact" ? t("counterpart.saving") : t("counterpart.confirmExact")}
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={busyDecision != null || !evidenceReady}
                onClick={() => void decide("no_counterpart")}
              >
                {busyDecision === "no_counterpart" ? t("counterpart.saving") : t("counterpart.confirmNoCounterpart")}
              </Button>
              <Button
                variant="ghost"
                className="min-h-11"
                disabled={busyDecision != null}
                onClick={() => void decide("reject")}
              >
                {busyDecision === "reject" ? t("counterpart.saving") : t("counterpart.reject")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
            <Button
              variant="outline"
              className="min-h-11"
              disabled={busyDecision != null}
              onClick={() => void decide("retry")}
            >
              {busyDecision === "retry" ? t("counterpart.saving") : t("counterpart.retryCandidate")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function EnglishCounterpartReviewView() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"all" | "review" | "failed">("all");
  const [announcement, setAnnouncement] = useState("");
  const query = useSupabaseQuery<EnglishCounterpartReviewRow[]>(
    ["pokemon-english-counterpart-review"],
    () => fetchEnglishCounterpartReviewRows(createClient()),
  );
  const rows = useMemo(
    () => (query.data ?? []).filter((row) => filter === "all" || row.status === filter),
    [filter, query.data],
  );

  const saved = async () => {
    setAnnouncement(t("counterpart.saved"));
    await query.retry();
  };

  return (
    <main className="min-w-0 overflow-x-hidden p-3 sm:p-5">
      <div className="mx-auto min-w-0 max-w-6xl space-y-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{t("counterpart.queueTitle")}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("counterpart.queueHelp")}</p>
          </div>
          <Button
            variant="outline"
            className="min-h-11 shrink-0"
            disabled={query.isValidating}
            onClick={() => void query.retry()}
          >
            <RefreshCw className={query.isValidating ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
            {t("counterpart.refresh")}
          </Button>
        </div>

        <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label={t("counterpart.queueTitle")}>
          {(["all", "review", "failed"] as const).map((value) => (
            <Button
              key={value}
              variant={filter === value ? "default" : "outline"}
              className="min-h-11"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all"
                ? t("counterpart.filterAll")
                : value === "review"
                  ? t("counterpart.filterReview")
                  : t("counterpart.filterFailed")}
            </Button>
          ))}
        </div>

        <p aria-live="polite" className="sr-only">{announcement}</p>
        {query.error && <QueryError error={query.error} onRetry={() => void query.retry()} />}
        {query.isLoading && !query.data && (
          <div className="rounded-md border p-6 text-sm text-muted-foreground">{t("common.loading")}</div>
        )}
        {!query.isLoading && !query.error && rows.length === 0 && (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("counterpart.queueEmpty")}
          </div>
        )}
        <div className="min-w-0 space-y-4">
          {rows.map((row) => (
            <EnglishCounterpartCandidateCard key={row.candidate_uid} row={row} onSaved={saved} />
          ))}
        </div>
      </div>
    </main>
  );
}

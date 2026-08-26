"use client";

import { useMemo } from "react";
import { CircleCheck, CircleHelp, ExternalLink, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { selectAllByIds } from "@/lib/supabase/select-all";
import { formatUsd } from "@/lib/money";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery } from "./use-query";
import type { Game } from "./GameContext";
import type { CardDefinition } from "./use-card-data";

export type EnglishCounterpartStatus =
  | "exact"
  | "no_counterpart"
  | "review"
  | "failed"
  | "pending";

export type EnglishCounterpartCompleteness =
  | "complete"
  | "missing_mapping"
  | "missing_jp_price"
  | "missing_us_price"
  | "missing_realized_comps"
  | "insufficient_realized_comps"
  | "stale_realized_comps"
  | "missing_fx"
  | "missing_cost_profile"
  | "no_counterpart";

export interface EnglishCounterpartPrice {
  comparison_kind: "raw" | "psa";
  raw_tier: number;
  psa_grade: number;
  english_card_uid: string | null;
  jp_price_usd: number | string | null;
  jp_source: string | null;
  jp_listing_count: number;
  jp_price_as_of: string | null;
  us_ask_price_usd: number | string | null;
  us_ask_source: string | null;
  us_ask_listing_count: number;
  us_ask_price_as_of: string | null;
  realized_price_usd: number | string | null;
  realized_sources: string[];
  realized_sample_count: number;
  realized_window_start: string | null;
  realized_latest_sold_at: string | null;
  realized_completeness: EnglishCounterpartCompleteness;
  decision_price_usd: number | string | null;
  profit_price_basis: "current_ask" | "realized_comp_cap" | "current_ask_fallback" | null;
  liquidity_penalty_ratio: number | string | null;
  net_exit_usd: number | string | null;
  net_profit_usd: number | string | null;
  roi_ratio: number | string | null;
  profit_denominator_usd: number | string | null;
  completeness: EnglishCounterpartCompleteness;
  profitable: boolean | null;
  computed_at: string;
}

export interface EnglishCounterpartCardRow {
  card_id: number;
  card_uid: string;
  counterpart_status: EnglishCounterpartStatus;
  english_card_uid: string | null;
  english_card_id: number | null;
  english_regional_name: string | null;
  english_name: string | null;
  english_set_code: string | null;
  english_card_number: string | null;
  english_misc_info: string | null;
  english_edition: string | null;
  english_foil_treatment: string | null;
  confidence: number | string | null;
  identity_basis: string | null;
  evidence: Record<string, unknown> | null;
  provenance: string | null;
  review_posture: string | null;
  decision_note: string | null;
  evidence_url: string | null;
  mapping_version: number | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_candidate_count: number;
  failed_candidate_count: number;
  gate_status: string | null;
  completeness: EnglishCounterpartCompleteness;
  best_net_profit_usd: number | string | null;
  best_roi_ratio: number | string | null;
  profit_denominator_usd: number | string | null;
  comparison_rows: number;
  complete_rows: number;
  coverage_ratio: number | string | null;
  best_raw: EnglishCounterpartPrice | null;
  best_psa: EnglishCounterpartPrice | null;
  prices_computed_at: string | null;
  candidate_updated_at: string | null;
}

export function isJapanesePokemonCard(
  card: Pick<CardDefinition, "language">,
): boolean {
  return !card.language || card.language === "jp";
}

export async function fetchEnglishCounterparts(
  supabase: ReturnType<typeof createClient>,
  cardIds: Array<number | string>,
): Promise<EnglishCounterpartCardRow[]> {
  return selectAllByIds<EnglishCounterpartCardRow>(
    cardIds,
    ["card_id"],
    (chunk) => supabase
      .from("pokemon_english_counterpart_card_v")
      .select("*")
      .in("card_id", chunk),
  );
}

export function useEnglishCounterparts(
  game: Game,
  cardIds: Array<number | string>,
) {
  const ids = useMemo(
    () => [...new Set(cardIds.map(String))].sort((a, b) => a.localeCompare(b)),
    [cardIds],
  );
  const key = game === "pokemon" && ids.length > 0
    ? ["pokemon-english-counterparts", ids.join(",")]
    : null;
  const query = useSupabaseQuery<EnglishCounterpartCardRow[]>(
    key,
    () => fetchEnglishCounterparts(createClient(), ids),
  );
  const byCardId = useMemo(() => {
    const rows = new Map<number, EnglishCounterpartCardRow>();
    for (const row of query.data ?? []) rows.set(Number(row.card_id), row);
    return rows;
  }, [query.data]);
  return { ...query, byCardId };
}

function numeric(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatCounterpartRoi(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function counterpartCompletenessKey(
  completeness: EnglishCounterpartCompleteness,
):
  | "counterpart.complete"
  | "counterpart.missingMapping"
  | "counterpart.missingJpPrice"
  | "counterpart.missingUsPrice"
  | "counterpart.missingRealizedComps"
  | "counterpart.insufficientRealizedComps"
  | "counterpart.staleRealizedComps"
  | "counterpart.missingFx"
  | "counterpart.missingCostProfile"
  | "counterpart.noCounterpart" {
  switch (completeness) {
    case "complete": return "counterpart.complete";
    case "missing_mapping": return "counterpart.missingMapping";
    case "missing_jp_price": return "counterpart.missingJpPrice";
    case "missing_us_price": return "counterpart.missingUsPrice";
    case "missing_realized_comps": return "counterpart.missingRealizedComps";
    case "insufficient_realized_comps": return "counterpart.insufficientRealizedComps";
    case "stale_realized_comps": return "counterpart.staleRealizedComps";
    case "missing_fx": return "counterpart.missingFx";
    case "missing_cost_profile": return "counterpart.missingCostProfile";
    case "no_counterpart": return "counterpart.noCounterpart";
  }
}

function counterpartProfitBasisKey(
  basis: EnglishCounterpartPrice["profit_price_basis"],
): "counterpart.basisCurrentAsk" | "counterpart.basisRealizedCap" | "counterpart.basisAskFallback" {
  if (basis === "realized_comp_cap") return "counterpart.basisRealizedCap";
  if (basis === "current_ask") return "counterpart.basisCurrentAsk";
  return "counterpart.basisAskFallback";
}

function compactDate(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function CounterpartPriceLine({ price }: { price: EnglishCounterpartPrice }) {
  const { t } = useTranslation();
  const label = price.comparison_kind === "raw"
    ? t("counterpart.rawTier", { tier: price.raw_tier })
    : t("counterpart.exactPsa", { grade: price.psa_grade });
  const jp = numeric(price.jp_price_usd);
  const usAsk = numeric(price.us_ask_price_usd);
  const realized = numeric(price.realized_price_usd);
  const decision = numeric(price.decision_price_usd);
  const denominator = numeric(price.profit_denominator_usd);
  const profit = numeric(price.net_profit_usd);
  const roi = numeric(price.roi_ratio);
  const penalty = numeric(price.liquidity_penalty_ratio);
  const complete = price.completeness === "complete";
  const soldWindowStart = compactDate(price.realized_window_start);
  const latestSold = compactDate(price.realized_latest_sold_at);
  return (
    <div className="min-w-0 text-xs">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span className="shrink-0 font-medium">{label}</span>
        {complete ? (
          <span className={profit != null && profit >= 0 ? "font-medium text-emerald-700 dark:text-emerald-400" : "font-medium text-destructive"}>
            {profit == null ? t("common.unknown") : formatUsd(profit)}
            {roi == null ? "" : ` · ${formatCounterpartRoi(roi)}`}
          </span>
        ) : (
          <span className="text-right text-muted-foreground">
            {t("counterpart.unknownReason", { reason: t(counterpartCompletenessKey(price.completeness)) })}
          </span>
        )}
      </div>
      <div
        role="group"
        aria-label={t("counterpart.jpPrice")}
        data-signal-class="jp-acquisition"
        className="mt-1 min-w-0 break-words text-[11px] text-muted-foreground"
      >
        <span className="font-medium text-foreground/80">{t("counterpart.jpPrice")}</span>: {jp == null ? t("common.unknown") : formatUsd(jp)}
        {price.jp_source ? ` · ${price.jp_source}` : ""}
        {price.jp_source ? ` · ${t("counterpart.listingCount", { count: price.jp_listing_count })}` : ""}
      </div>
      <div className="mt-1 grid min-w-0 gap-1 sm:grid-cols-2">
        <div
          role="group"
          aria-label={t("counterpart.currentAsk")}
          data-signal-class="current-ask"
          className="min-w-0 rounded border border-sky-500/20 bg-sky-500/5 px-2 py-1 text-[11px]"
        >
          <div className="font-medium text-foreground">{t("counterpart.currentAsk")}</div>
          <div className="min-w-0 break-words text-muted-foreground">
            {usAsk == null ? t("common.unknown") : formatUsd(usAsk)}
            {price.us_ask_source ? ` · ${price.us_ask_source}` : ""}
            {price.us_ask_source ? ` · ${t("counterpart.listingCount", { count: price.us_ask_listing_count })}` : ""}
          </div>
        </div>
        <div
          role="group"
          aria-label={t("counterpart.realizedSoldComps")}
          data-signal-class="realized-sold-comps"
          className="min-w-0 rounded border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-[11px]"
        >
          <div className="font-medium text-foreground">{t("counterpart.realizedSoldComps")}</div>
          <div className="min-w-0 break-words text-muted-foreground">
            {realized == null ? t("common.unknown") : formatUsd(realized)}
            {` · ${t("counterpart.soldCompCount", { count: price.realized_sample_count })}`}
            {price.realized_sources.length > 0 ? ` · ${price.realized_sources.join(" + ")}` : ""}
          </div>
          {(soldWindowStart || latestSold) && (
            <div className="min-w-0 break-words text-muted-foreground">
              {t("counterpart.soldWindow", {
                start: soldWindowStart ?? t("common.unknown"),
                latest: latestSold ?? t("common.unknown"),
              })}
            </div>
          )}
          {price.realized_completeness !== "complete" && (
            <div className="text-amber-700 dark:text-amber-400">
              {t(counterpartCompletenessKey(price.realized_completeness))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-1 grid min-w-0 gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground sm:grid-cols-2">
        <span>{t("counterpart.profitDecision")}: {decision == null ? t("common.unknown") : formatUsd(decision)} · {t(counterpartProfitBasisKey(price.profit_price_basis))}</span>
        <span>{t("counterpart.liquidityPenalty")}: {penalty == null ? t("common.unknown") : `${(penalty * 100).toFixed(0)}%`}</span>
        <span>{t("counterpart.denominator")}: {denominator == null ? t("common.unknown") : formatUsd(denominator)}</span>
        <span>{t("counterpart.completeness")}: {t(counterpartCompletenessKey(price.completeness))}</span>
      </div>
    </div>
  );
}

export interface EnglishCounterpartDecisionInput {
  candidateUid: string;
  expectedVersion: number;
  decision: "exact" | "no_counterpart" | "reject" | "retry";
  englishCardId?: number | null;
  evidenceUrl?: string | null;
  decisionNote?: string | null;
}

export async function reviewEnglishCounterpart(
  supabase: ReturnType<typeof createClient>,
  input: EnglishCounterpartDecisionInput,
): Promise<unknown> {
  const { data, error } = await supabase.rpc(
    "review_pokemon_english_counterpart",
    {
      p_candidate_uid: input.candidateUid,
      p_decision: input.decision,
      p_english_card_id: input.englishCardId ?? null,
      p_expected_version: input.expectedVersion,
      p_evidence_url: input.evidenceUrl?.trim() || null,
      p_decision_note: input.decisionNote?.trim() || null,
    },
  );
  if (error) throw error;
  return data;
}

export function EnglishCounterpartPanel({
  row,
  compact = false,
  loading = false,
  error,
}: {
  row?: EnglishCounterpartCardRow | null;
  compact?: boolean;
  loading?: boolean;
  error?: unknown;
}) {
  const { t } = useTranslation();
  const status = row?.counterpart_status ?? "pending";
  const statusLabel = error
    ? t("counterpart.unavailable")
    : loading && !row
      ? t("common.loading")
      : status === "exact"
        ? t("counterpart.exact")
        : status === "no_counterpart"
          ? t("counterpart.noCounterpart")
          : status === "review"
            ? t("counterpart.review")
            : status === "failed"
              ? t("counterpart.failed")
              : t("counterpart.pending");
  const statusIcon = status === "exact"
    ? <CircleCheck className="size-3.5" aria-hidden="true" />
    : status === "review" || status === "failed"
      ? <TriangleAlert className="size-3.5" aria-hidden="true" />
      : <CircleHelp className="size-3.5" aria-hidden="true" />;
  const identity = row?.english_set_code || row?.english_card_number
    ? [
        row.english_set_code,
        row.english_card_number,
        row.english_edition,
        row.english_foil_treatment,
      ].filter(Boolean).join(" · ")
    : null;

  return (
    <section
      aria-label={t("counterpart.panelLabel")}
      data-counterpart-status={error ? "unavailable" : status}
      className={compact
        ? "mt-1 min-w-0 rounded-md border border-foreground/10 bg-muted/30 px-2 py-1.5"
        : "min-w-0 rounded-lg border bg-muted/20 p-3"}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className={status === "exact"
            ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
            : status === "review" || status === "failed"
              ? "border-amber-500/60 text-amber-700 dark:text-amber-400"
              : "text-muted-foreground"}
        >
          {statusIcon}
          {statusLabel}
        </Badge>
        {status === "exact" && identity && (
          <span className="min-w-0 truncate text-xs font-medium">{identity}</span>
        )}
      </div>

      {status === "exact" && row && (
        <>
          <div className="mt-1 min-w-0 text-xs">
            <span className="font-medium">{row.english_regional_name ?? row.english_name ?? t("counterpart.englishPrinting")}</span>
            {row.english_misc_info && row.english_misc_info !== "UNKNOWN" ? (
              <span className="text-muted-foreground"> · {row.english_misc_info}</span>
            ) : null}
          </div>
          <div className="mt-1.5 space-y-1 border-t border-foreground/10 pt-1.5">
            {row.best_raw ? <CounterpartPriceLine price={row.best_raw} /> : (
              <div className="text-xs text-muted-foreground">
                {t("counterpart.rawTierUnknown")}
              </div>
            )}
            {row.best_psa ? <CounterpartPriceLine price={row.best_psa} /> : (
              <div className="text-xs text-muted-foreground">
                {t("counterpart.psaUnknown")}
              </div>
            )}
          </div>
        </>
      )}

      {!error && !loading && status === "review" && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("counterpart.reviewCount", { count: row?.review_candidate_count ?? 0 })}
        </p>
      )}
      {!error && !loading && status === "failed" && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("counterpart.failedCount", { count: row?.failed_candidate_count ?? 0 })}
        </p>
      )}
      {!error && !loading && status === "pending" && (
        <p className="mt-1 text-xs text-muted-foreground">{t("counterpart.pendingHelp")}</p>
      )}
      {!error && !loading && status === "no_counterpart" && (
        <p className="mt-1 text-xs text-muted-foreground">{t("counterpart.noCounterpartHelp")}</p>
      )}
      {!!error && <p className="mt-1 text-xs text-destructive">{t("counterpart.unavailableHelp")}</p>}

      {!compact && row && (
        <div className="mt-2 min-w-0 border-t border-foreground/10 pt-2 text-xs text-muted-foreground">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {t("counterpart.coverage")}: {row.complete_rows}/{row.comparison_rows}
            </span>
            <span>{t("counterpart.completeness")}: {t(counterpartCompletenessKey(row.completeness))}</span>
            <span>{t("counterpart.gate")}: {row.gate_status ?? t("common.unknown")}</span>
            {row.confidence != null && (
              <span>{t("counterpart.confidence")}: {(Number(row.confidence) * 100).toFixed(0)}%</span>
            )}
            {row.identity_basis && <span>{t("counterpart.basis")}: {row.identity_basis.replaceAll("_", " ")}</span>}
            {row.provenance && <span className="break-all">{t("counterpart.provenance")}: {row.provenance}</span>}
            {row.evidence_url && (
              <a
                href={row.evidence_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1 font-medium text-foreground underline underline-offset-2 sm:min-h-0"
              >
                {t("counterpart.evidence")}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            )}
          </div>
          {row.decision_note && (
            <p className="mt-1 break-words">
              {t("counterpart.decisionNote")}: {row.decision_note}
            </p>
          )}
          {row.reviewed_by && (
            <p className="mt-1 break-all">
              {t("counterpart.reviewedBy")}: {row.reviewed_by}
              {row.reviewed_at ? ` · ${new Date(row.reviewed_at).toLocaleString()}` : ""}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

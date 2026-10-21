"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, ImageOff, LoaderCircle, RefreshCw, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/dates";
import { useTranslation } from "@/lib/i18n";
import { formatJpy } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";
import {
  formatObservationBox,
  observationCursor,
  parseUnresolvedBuylistObservationRows,
  type ObservationBox,
  type UnresolvedBuylistObservationRow,
} from "@/lib/unresolved-buylist-observations";
import { QueryError, useSupabaseQuery } from "./use-query";

const PAGE_SIZE = 24;

function httpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function ObservationCrop({
  source,
  width,
  height,
  box,
  label,
  compact = false,
}: {
  source: string;
  width: number;
  height: number;
  box: ObservationBox | null;
  label: string;
  compact?: boolean;
}) {
  const imageUrl = httpUrl(source);
  if (imageUrl == null || box == null) {
    return (
      <div className="flex min-h-28 items-center justify-center gap-2 rounded-lg bg-muted px-3 text-sm text-muted-foreground">
        <ImageOff className="size-4" />
        {label}
      </div>
    );
  }
  const cropWidth = box.x1 - box.x0;
  const cropHeight = box.y1 - box.y0;
  const xPosition = width === cropWidth ? 0 : (box.x0 / (width - cropWidth)) * 100;
  const yPosition = height === cropHeight ? 0 : (box.y0 / (height - cropHeight)) * 100;
  const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
  return (
    <div
      role="img"
      aria-label={label}
      className="w-full rounded-lg bg-muted bg-no-repeat shadow-inner"
      style={{
        aspectRatio: `${cropWidth} / ${cropHeight}`,
        maxHeight: compact ? "9rem" : "18rem",
        backgroundImage: `url(${JSON.stringify(proxyUrl)})`,
        backgroundPosition: `${xPosition}% ${yPosition}%`,
        backgroundSize: `${(width / cropWidth) * 100}% ${(height / cropHeight) * 100}%`,
      }}
    />
  );
}

export function UnresolvedObservationCard({
  row,
}: {
  row: UnresolvedBuylistObservationRow;
}) {
  const { t, language } = useTranslation();
  const tweetUrl = httpUrl(row.tweetUrl);
  const grade = row.grade.status === "observed"
    ? t("unresolvedPrices.gradeObserved", { grade: row.grade.value ?? "" })
    : row.grade.status === "not_applicable"
      ? t("unresolvedPrices.gradeNotApplicable")
      : t("unresolvedPrices.gradeNotObserved");
  const confidence = new Intl.NumberFormat(language, {
    style: "percent",
    maximumFractionDigits: 1,
  });

  return (
    <Card
      className="min-w-0 overflow-hidden"
      data-testid="unresolved-price-observation-card"
    >
      <CardHeader className="min-w-0 gap-2 p-4 pb-2">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="break-words text-sm">
              @{row.twitterHandle}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(row.routedAt, language)}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            <Badge variant="secondary">{t("unresolvedPrices.unknownIdentity")}</Badge>
            <Badge variant="outline">
              {row.productKind === "sealed"
                ? t("unresolvedPrices.sealed")
                : t("unresolvedPrices.singles")}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("unresolvedPrices.imageCell", {
            image: row.sourceImageIndex + 1,
            cell: row.sourceCellIndex + 1,
          })}
          {" · "}
          {grade}
        </p>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4 p-4 pt-2">
        <div
          className="flex min-w-0 items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-200"
          role="status"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>{t("unresolvedPrices.financialIneligible")}</span>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium">{t("unresolvedPrices.cardCrop")}</p>
            <ObservationCrop
              source={row.sourceImageUrl}
              width={row.sourceImageWidth}
              height={row.sourceImageHeight}
              box={row.effectiveGeometry.card}
              label={t("unresolvedPrices.cardCrop")}
            />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium">{t("unresolvedPrices.priceCrop")}</p>
            <ObservationCrop
              source={row.sourceImageUrl}
              width={row.sourceImageWidth}
              height={row.sourceImageHeight}
              box={row.prices[0]?.effectiveBox ?? row.effectiveGeometry.price}
              label={t("unresolvedPrices.priceCrop")}
              compact
            />
          </div>
        </div>

        <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
          <p className="break-words">
            {t("unresolvedPrices.cardGeometry")}: {formatObservationBox(row.sourceGeometry.card)}
            {" → "}{formatObservationBox(row.effectiveGeometry.card)}
          </p>
          {row.variant != null && (
            <p className="break-words">
              {t("unresolvedPrices.variant")}: {row.variant}
            </p>
          )}
          <p className="break-all font-mono text-[10px]">
            {t("unresolvedPrices.sourceDigest")}: {row.sourceContentSha256}
          </p>
          <p className="break-words font-mono text-[10px]">
            {t("unresolvedPrices.routingEvidence", {
              outcome: row.routingOutcomeId,
              ordinal: row.observationOrdinal,
            })}
            {" · "}{row.policyVersion}
          </p>
        </div>

        <div className="min-w-0 space-y-2">
          <h4 className="text-xs font-medium">{t("unresolvedPrices.verifiedPrices")}</h4>
          {row.prices.map((price, index) => (
            <div
              key={`${price.amountJpy}-${index}`}
              className="min-w-0 rounded-md border p-3 text-xs"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-base font-semibold tabular-nums">
                  {formatJpy(price.amountJpy)}
                </span>
                <Badge variant="outline">
                  {price.tier ?? t("unresolvedPrices.untiered")}
                </Badge>
              </div>
              <p className="mt-1 break-words text-muted-foreground">
                {t("unresolvedPrices.association", {
                  method: price.method,
                })}
                {price.ocrConfidence == null
                  ? ""
                  : ` · ${t("unresolvedPrices.ocrConfidence", {
                      confidence: confidence.format(price.ocrConfidence),
                    })}`}
              </p>
              <p className="mt-1 break-words font-mono text-[10px] text-muted-foreground">
                {t("unresolvedPrices.priceGeometry")}: {formatObservationBox(price.sourceBox)}
                {" → "}{formatObservationBox(price.effectiveBox)}
              </p>
            </div>
          ))}
        </div>

        {tweetUrl && (
          <a
            href={tweetUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <ExternalLink className="size-4 shrink-0" />
            <span className="truncate">{t("unresolvedPrices.sourcePost")}</span>
          </a>
        )}
      </CardContent>
    </Card>
  );
}

export default function UnresolvedPriceObservationsPanel() {
  const { t } = useTranslation();
  const fetchFirstPage = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc(
      "list_unresolved_buylist_price_observations",
      {
        p_limit: PAGE_SIZE,
        p_before_routing_outcome_id: null,
        p_before_observation_ordinal: null,
      },
    );
    if (error) throw error;
    return parseUnresolvedBuylistObservationRows(data);
  }, []);
  const query = useSupabaseQuery("unresolved-buylist-price-observations", fetchFirstPage);
  const [rows, setRows] = useState<UnresolvedBuylistObservationRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);

  useEffect(() => {
    if (query.data == null) return;
    setRows(query.data);
    setHasMore(query.data.length === PAGE_SIZE);
    setMoreError(null);
  }, [query.data]);

  const loadMore = useCallback(async () => {
    const cursor = observationCursor(rows);
    if (cursor == null || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc(
        "list_unresolved_buylist_price_observations",
        {
          p_limit: PAGE_SIZE,
          p_before_routing_outcome_id: cursor.routingOutcomeId,
          p_before_observation_ordinal: cursor.observationOrdinal,
        },
      );
      if (error) throw error;
      const next = parseUnresolvedBuylistObservationRows(data);
      setRows((current) => [...current, ...next]);
      setHasMore(next.length === PAGE_SIZE);
    } catch (error) {
      setMoreError(error);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, rows]);

  return (
    <section className="min-w-0 space-y-3 rounded-md border p-4" aria-labelledby="unresolved-price-observations-title">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="unresolved-price-observations-title" className="text-sm font-medium">
            {t("unresolvedPrices.title")}
          </h3>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            {t("unresolvedPrices.help")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-11"
          onClick={() => void query.retry()}
          disabled={query.isLoading || query.isValidating}
        >
          {query.isLoading || query.isValidating
            ? <LoaderCircle className="size-4 animate-spin" />
            : <RefreshCw className="size-4" />}
          {t("health.reload")}
        </Button>
      </div>

      {query.error && <QueryError error={query.error} onRetry={() => void query.retry()} />}
      {!query.error && !query.isLoading && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("unresolvedPrices.empty")}</p>
      )}
      {rows.length > 0 && (
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          {rows.map((row) => (
            <UnresolvedObservationCard
              key={`${row.routingOutcomeId}-${row.observationOrdinal}`}
              row={row}
            />
          ))}
        </div>
      )}

      {moreError != null && (
        <QueryError error={moreError} onRetry={() => void loadMore()} />
      )}
      {hasMore && (
        <Button
          variant="outline"
          className="min-h-11 w-full sm:w-auto"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore && <LoaderCircle className="size-4 animate-spin" />}
          {t("unresolvedPrices.loadMore")}
        </Button>
      )}
    </section>
  );
}

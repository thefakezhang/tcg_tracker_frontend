"use client";

import { useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";

/** One queued (source, lane) pair from request_card_refresh. */
type QueuedEntry = { source: string; lane: string; eta_class: string };

/** request_card_refresh returns one of these per requested card. */
export type CardRefreshVerdict = {
  card_id: number;
  queued: QueuedEntry[];
  already_pending: string[];
  not_targetable: string[];
};

/**
 * RefreshPricesAction requests an on-demand price refresh for the given cards
 * (redesign R6) and renders the RPC's verdict inline.
 *
 * The verdict is rendered verbatim from the backend contract: a source is either
 * queued (with an ETA derived from its lane), already queued, or not targetable
 * because that shop stores no durable per-card handle. Nothing is inferred here -
 * the matrix lives in the RPC (docs/targeted_refresh.md).
 */
export function RefreshPricesAction({
  cardIds,
  onQueued,
  size = "sm",
}: {
  cardIds: number[];
  onQueued?: (verdicts: CardRefreshVerdict[]) => void;
  size?: "sm" | "default";
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [verdicts, setVerdicts] = useState<CardRefreshVerdict[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!cardIds.length || busy) return;
    setBusy(true);
    setError(null);
    setVerdicts(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("request_card_refresh", {
      p_card_ids: cardIds,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const parsed = (data ?? []) as CardRefreshVerdict[];
    setVerdicts(parsed);
    onQueued?.(parsed);
  };

  // Aggregate across the selected cards so the summary reads per source, not per card.
  const queued = new Map<string, string>(); // source -> lane
  const pending = new Set<string>();
  const blocked = new Set<string>();
  for (const v of verdicts ?? []) {
    for (const q of v.queued) queued.set(q.source, q.lane);
    for (const s of v.already_pending) pending.add(s);
    for (const s of v.not_targetable) blocked.add(s);
  }

  const etaFor = (lane: string) =>
    lane === "http"
      ? t("refreshPrices.etaMinutes")
      : lane === "browser"
        ? t("refreshPrices.etaHour")
        : t("refreshPrices.etaSession");

  const label =
    cardIds.length > 1
      ? t("refreshPrices.buttonN", { count: cardIds.length })
      : t("refreshPrices.button");

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size={size} onClick={run} disabled={busy || cardIds.length === 0}>
        {busy ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        {label}
      </Button>

      {error && <p className="text-destructive text-xs">{t("refreshPrices.error", { message: error })}</p>}

      {verdicts && !error && (
        <div className="text-xs leading-relaxed">
          {queued.size > 0 && (
            <p>
              <span className="text-muted-foreground">{t("refreshPrices.queued")}: </span>
              {[...queued.entries()]
                .map(([source, lane]) => `${source} (${etaFor(lane)})`)
                .join(", ")}
            </p>
          )}
          {pending.size > 0 && (
            <p className="text-muted-foreground">
              {t("refreshPrices.alreadyPending")}: {[...pending].join(", ")}
            </p>
          )}
          {blocked.size > 0 && (
            <p className="text-muted-foreground">
              {t("refreshPrices.notTargetable")}: {[...blocked].join(", ")}
            </p>
          )}
          {queued.size === 0 && pending.size === 0 && blocked.size === 0 && (
            <p className="text-muted-foreground">{t("refreshPrices.none")}</p>
          )}
        </div>
      )}
    </div>
  );
}

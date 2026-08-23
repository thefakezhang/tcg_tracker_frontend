"use client";

import { useEffect, useRef, useState } from "react";
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

/** card_refresh_targets: what a refresh WOULD do, queueing nothing. */
type CardRefreshTargets = {
  card_id: number;
  targetable: QueuedEntry[];
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
/** How often the queued work is checked, and how long it is followed for. */
const WATCH_POLL_MS = 10_000;
const WATCH_MAX_MS = 30 * 60 * 1000;

export function RefreshPricesAction({
  cardIds,
  onQueued,
  onRefreshed,
  size = "sm",
}: {
  cardIds: number[];
  onQueued?: (verdicts: CardRefreshVerdict[]) => void;
  /**
   * Called once the work queued by this button has finished, so the caller can
   * re-read the card and show the new prices.
   *
   * Without it the request is fire-and-forget: the worker updates
   * pokemon_market_listings.last_updated minutes later, but the open view still
   * renders the values it loaded before the click, so FreshnessChip keeps
   * reporting the old "Updated N h ago". Asking for a refresh and being told the
   * data is hours old is the same as the refresh not working.
   */
  onRefreshed?: () => void;
  size?: "sm" | "default";
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [verdicts, setVerdicts] = useState<CardRefreshVerdict[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState<number[]>([]);
  // Held in a ref so changing the callback identity cannot restart the watch.
  const onRefreshedRef = useRef(onRefreshed);
  onRefreshedRef.current = onRefreshed;

  // Ask the backend whether these cards can benefit from a refresh at all. The
  // source matrix deliberately lives in the RPC - that is what lets a shop which
  // starts storing a durable per-card handle show up here with no frontend
  // change - so asking is the only honest way to decide whether to offer the
  // button. card_refresh_targets is read-only and queues nothing.
  const [targets, setTargets] = useState<CardRefreshTargets[] | null>(null);
  const idsKey = cardIds.join(",");
  useEffect(() => {
    let cancelled = false;
    const ids = idsKey ? idsKey.split(",").map(Number) : [];
    if (!ids.length) {
      setTargets([]);
      return;
    }
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("card_refresh_targets", { p_card_ids: ids });
      if (!cancelled) setTargets((data ?? []) as CardRefreshTargets[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

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
    // Follow only the cards that actually got queued. A card that was already
    // pending is somebody else's request to wait on, and a card nothing could be
    // queued for will never produce a completion to notice.
    setWatching(parsed.filter((v) => v.queued.length > 0).map((v) => v.card_id));
  };

  // Watch the queued work and tell the caller when it is done. This polls rather
  // than subscribing, matching RefreshInFlightStrip: the dashboard deliberately
  // carries no realtime dependency.
  useEffect(() => {
    if (watching.length === 0) return;
    let cancelled = false;
    const startedAt = Date.now();
    const supabase = createClient();

    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      setWatching([]);
      onRefreshedRef.current?.();
    };

    const poll = async () => {
      if (cancelled) return;
      const { data, error: pollError } = await supabase
        .from("refresh_requests")
        .select("request_id")
        .in("card_id", watching)
        .in("status", ["pending", "running"])
        .limit(1);
      if (cancelled) return;
      // A failed poll says nothing about the work, so keep waiting rather than
      // reporting a completion that may not have happened.
      if (pollError) return;
      if ((data ?? []).length === 0) {
        finish();
        return;
      }
      // Give up following eventually. The prices may still land later, but a
      // poll that runs forever is a leak, and the drain has clearly not gone the
      // way the ETA promised.
      if (Date.now() - startedAt > WATCH_MAX_MS && !cancelled) {
        cancelled = true;
        setWatching([]);
      }
    };

    void poll();
    const id = setInterval(() => void poll(), WATCH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [watching]);

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

  // Absence is the default: offer no button at all when nothing about these
  // cards can actually be refreshed (never a disabled one). Also render nothing
  // until the answer is known, so a button never flashes in and then vanishes.
  const anyTargetable = (targets ?? []).some((v) => v.targetable.length > 0);
  if (targets === null || !anyTargetable) return null;

  return (
    <div className="flex flex-col gap-1">
      <Button className="min-h-11 whitespace-normal sm:min-h-0" variant="outline" size={size} onClick={run} disabled={busy || cardIds.length === 0}>
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

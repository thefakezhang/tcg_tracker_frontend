"use client";

// "Where should I sell this, and what will it actually leave me?"
//
// The card browser answers with one exit price. The operator sells through
// four channels and only two of them leave public evidence, so the other two
// are derived from the operator's own books. Those are different kinds of
// claim and this panel never lets them look alike: a measured channel shows
// the sample behind it, a derived one says what rate it came from.
//
// Backend: pokemon_card_exit_options + channel_realization_rates, refreshed by
// scripts/refresh-channel-realization.sh (tcg_tracker#1778).

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";

const EXIT_COLUMNS =
  "card_id, psa_grade, market_usd, market_source, " +
  "tcg_realized_usd, tcg_low_usd, tcg_high_usd, tcg_units, " +
  "ebay_realized_usd, ebay_p25_usd, ebay_p75_usd, ebay_comps, " +
  "tcg_net_usd, ebay_net_usd, in_person_net_usd, vendor_net_usd, " +
  "best_channel, best_net_usd, updated_at";

export interface ExitOptionRow {
  card_id: number;
  psa_grade: number;
  market_usd: number | null;
  market_source: string | null;
  tcg_realized_usd: number | null;
  tcg_low_usd: number | null;
  tcg_high_usd: number | null;
  tcg_units: number;
  ebay_realized_usd: number | null;
  ebay_p25_usd: number | null;
  ebay_p75_usd: number | null;
  ebay_comps: number;
  tcg_net_usd: number | null;
  ebay_net_usd: number | null;
  in_person_net_usd: number | null;
  vendor_net_usd: number | null;
  best_channel: string | null;
  best_net_usd: number | null;
  updated_at: string | null;
}

export type ChannelKey = "in_person" | "tcgplayer" | "ebay" | "vendor";

const usd = (n: number | null | undefined): string =>
  n == null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

// A channel's net, and the evidence class that net rests on. "measured" means
// this card's own sales; "derived" means a market price multiplied by a rate
// measured across the whole book. Keeping them distinguishable on screen is
// the entire point - presenting a derived number as a measured one is the
// mistake this feature was built to stop.
export function channelRows(row: ExitOptionRow) {
  return [
    {
      key: "in_person" as ChannelKey,
      net: row.in_person_net_usd,
      basis: "derived" as const,
      detail: row.market_usd != null ? `market ${usd(row.market_usd)}` : null,
    },
    {
      key: "tcgplayer" as ChannelKey,
      net: row.tcg_net_usd,
      basis: "measured" as const,
      detail:
        row.tcg_realized_usd != null
          ? `${usd(row.tcg_realized_usd)} realized · ${row.tcg_units} sold`
          : null,
    },
    {
      key: "ebay" as ChannelKey,
      net: row.ebay_net_usd,
      basis: "measured" as const,
      detail:
        row.ebay_realized_usd != null
          ? `${usd(row.ebay_realized_usd)} median · ${row.ebay_comps} comps`
          : null,
    },
    {
      key: "vendor" as ChannelKey,
      net: row.vendor_net_usd,
      basis: "derived" as const,
      detail: row.market_usd != null ? `market ${usd(row.market_usd)}` : null,
    },
  ];
}

// Sorted best-first, with unpriced channels last. A null net is NOT zero: it
// means the channel could not be priced at all, which reads differently from
// "this channel pays nothing" and must not sort as if it did.
export function rankedChannels(row: ExitOptionRow) {
  return [...channelRows(row)].sort((a, b) => {
    if (a.net == null && b.net == null) return 0;
    if (a.net == null) return 1;
    if (b.net == null) return -1;
    return b.net - a.net;
  });
}

export default function ExitChannelPanel({ cardId, psaGrade = 0 }: { cardId: number; psaGrade?: number }) {
  const { t } = useTranslation();
  const [row, setRow] = useState<ExitOptionRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("pokemon_card_exit_options")
        .select(EXIT_COLUMNS)
        .eq("card_id", cardId)
        .eq("psa_grade", psaGrade)
        .abortSignal(controller.signal)
        .maybeSingle();
      if (cancelled) return;
      setRow((data as ExitOptionRow | null) ?? null);
      setLoading(false);
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cardId, psaGrade]);

  if (loading) return <Skeleton className="h-28 w-full" />;
  // No row is the ordinary case for a card with no market reference and no
  // sales, so it says so rather than rendering an empty frame.
  if (!row) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        {t("exit.noEvidence")}
      </div>
    );
  }

  const ranked = rankedChannels(row);
  const best = ranked[0];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">{t("exit.title")}</h4>
        {row.market_usd != null && (
          <span className="text-xs text-muted-foreground">
            {t("exit.market")} <span className="tabular-nums">{usd(row.market_usd)}</span>
            {row.market_source === "ebay_sold_median" && (
              <Badge variant="outline" className="ml-1 h-auto px-1 py-px text-[10px] font-normal">
                {t("exit.fallbackMarket")}
              </Badge>
            )}
          </span>
        )}
      </div>

      <div className="divide-y rounded-md border">
        {ranked.map((c) => {
          const isBest = c.net != null && best?.net != null && c.key === best.key;
          return (
            <div
              key={c.key}
              className={`flex items-center justify-between gap-3 px-3 py-2 ${isBest ? "bg-emerald-500/5" : ""}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{t(`exit.channel.${c.key}` as never)}</span>
                  {isBest && (
                    <Badge className="h-auto px-1 py-px text-[10px] font-normal">{t("exit.best")}</Badge>
                  )}
                  <Badge
                    variant="outline"
                    className="h-auto px-1 py-px text-[10px] font-normal"
                    title={t(c.basis === "measured" ? "exit.measuredHelp" : "exit.derivedHelp")}
                  >
                    {t(c.basis === "measured" ? "exit.measured" : "exit.derived")}
                  </Badge>
                </div>
                {c.detail && <div className="truncate text-[10px] text-muted-foreground">{c.detail}</div>}
              </div>
              <div className="shrink-0 text-right">
                <div className="font-medium tabular-nums">{usd(c.net)}</div>
                <div className="text-[10px] text-muted-foreground">{t("exit.net")}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

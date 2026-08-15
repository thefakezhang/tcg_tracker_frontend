"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Eye, EyeOff, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";
import { useTranslation } from "@/lib/i18n";
import { useLanguage } from "./LanguageContext";
import { fetchCardRowsByIds, fetchCardRowById, type CardRowData } from "./use-card-data";
import { useOwnedInventoryCounts, ownedInventoryKey } from "./owned-inventory";
import { OwnedCountLine } from "./OwnedCountLine";
import CardDetailModal from "./CardDetailModal";

interface WatchedDeal {
  rule_id: number;
  card_id: number;
  psa_grade: number;
  decided_at: string;
  flagged_price: number | null;
  flagged_currency: string | null;
  current_price: number | null;
  current_currency: string | null;
  current_observed_on: string | null;
  reason: string | null;
  regional_name: string;
  english_name: string | null;
  set_code: string;
  card_number: string | null;
  image_url: string | null;
  store_sightings: StoreSighting[] | null;
}

interface StoreSighting {
  sighting_id: number;
  store_name: string;
  observed_price: number;
  currency: string;
  fx_rate_to_usd: number;
  price_usd: number;
  observed_at: string;
  note: string | null;
}

function price(value: number | null, currency: string | null) {
  if (value == null) return "-";
  return `${currency === "JPY" ? "¥" : currency === "USD" ? "$" : ""}${Number(value).toLocaleString()}${currency && currency !== "JPY" && currency !== "USD" ? ` ${currency}` : ""}`;
}

export default function DecisionWatchlist() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [rows, setRows] = useState<WatchedDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unwatchingRuleId, setUnwatchingRuleId] = useState<number | null>(null);
  // Market data (ROI + the row for the detail modal) + owned inventory per card,
  // so the watchlist carries the same info as the main browse rows.
  const [cardData, setCardData] = useState<Map<string, CardRowData>>(new Map());
  const [selectedCard, setSelectedCard] = useState<CardRowData | null>(null);

  useEffect(() => {
    const supabase = createClient();
    selectAll<WatchedDeal>(
      () => supabase.from("active_deal_watchlist_v").select("*") ,
      ["rule_id"],
    ).then(setRows).catch((loadError) => {
      console.error("Failed to load watchlist:", loadError);
      setError(true);
    }).finally(() => setLoading(false));
  }, []);

  const ownedIdentities = useMemo(
    () => rows.map((r) => ({ game: "pokemon" as const, cardId: r.card_id })),
    [rows],
  );
  const ownedCounts = useOwnedInventoryCounts("pokemon", ownedIdentities);

  useEffect(() => {
    if (rows.length === 0) { setCardData(new Map()); return; }
    const supabase = createClient();
    let cancelled = false;
    void fetchCardRowsByIds(supabase, "pokemon", rows.map((r) => r.card_id)).then((m) => {
      if (!cancelled) setCardData(m);
    });
    return () => { cancelled = true; };
  }, [rows]);

  const openCard = async (cardId: number, psaGrade: number) => {
    const cached = cardData.get(String(cardId));
    if (cached) { setSelectedCard(cached); return; }
    const card = await fetchCardRowById(createClient(), "pokemon", cardId, psaGrade);
    if (card) setSelectedCard(card);
  };

  // Sort/filter by how much of each card is already held: low stock (0/1) to
  // the top so the cards that still need buying lead, plus a max-owned cap.
  const [lowStockFirst, setLowStockFirst] = useState(true);
  const [maxOwned, setMaxOwned] = useState("");
  const ownedQtyFor = (cardId: number) =>
    ownedCounts.get(ownedInventoryKey({ game: "pokemon", cardId }))?.owned ?? 0;
  const displayRows = useMemo(() => {
    const cap = maxOwned.trim() === "" ? null : Number(maxOwned);
    let out = cap == null || Number.isNaN(cap) ? rows : rows.filter((r) => ownedQtyFor(r.card_id) <= cap);
    if (lowStockFirst) {
      out = [...out].sort((a, b) => {
        const qa = ownedQtyFor(a.card_id), qb = ownedQtyFor(b.card_id);
        if (qa !== qb) return qa - qb;
        const ra = cardData.get(String(a.card_id))?.roi ?? -Infinity;
        const rb = cardData.get(String(b.card_id))?.roi ?? -Infinity;
        return rb - ra;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, maxOwned, lowStockFirst, ownedCounts, cardData]);
  const fmtRoi = (roi: number | null | undefined) =>
    roi == null ? "-" : `${Math.round(roi * 100) / 100}%`;

  async function unwatch(ruleId: number) {
    setActionError(null);
    setUnwatchingRuleId(ruleId);
    const { error: unwatchError } = await createClient().rpc("deactivate_deal_watch", { p_rule_id: ruleId });
    if (unwatchError) {
      setActionError(unwatchError.message);
    } else {
      setRows((current) => current.filter((row) => row.rule_id !== ruleId));
    }
    setUnwatchingRuleId(null);
  }

  if (loading) {
    return <div className="h-32 animate-pulse rounded-md bg-muted" />;
  }

  if (error) {
    return <div role="alert" className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">{t("decision.watchlistLoadError")}</div>;
  }

  if (rows.length === 0) {
    return <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{t("decision.emptyWatchlist")}</div>;
  }

  return (
    <div className="space-y-3">
      {actionError ? <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{t("decision.unwatchError")}: {actionError}</div> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button variant={lowStockFirst ? "default" : "outline"} size="sm" className="h-11 sm:h-8" onClick={() => setLowStockFirst((v) => !v)}>
          {t("trips.lowStockFirst")}
        </Button>
        <label className="flex items-center gap-1 text-muted-foreground">
          {t("trips.maxOwned")}
          <Input type="number" min={0} value={maxOwned} onChange={(e) => setMaxOwned(e.target.value)} placeholder="—" className="h-11 w-16 sm:h-8" />
        </label>
      </div>
      {/* The price_below_exit rule has no backend evaluator; this IS the
          evaluation: the view already joins at-watch vs current price, so a
          watch has FIRED when the current price sits at or below the flagged
          price. Until now nothing computed that - Watch was a bookmark. */}
      {(() => {
        const fired = displayRows.filter((r) =>
          r.flagged_price != null && r.current_price != null &&
          r.flagged_currency === r.current_currency && r.current_price <= r.flagged_price).length;
        return fired > 0 ? (
          <div role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-sm text-emerald-600 dark:text-emerald-400">
            {t("decision.alertFiredCount", { n: fired })}
          </div>
        ) : null;
      })()}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {displayRows.map((row) => {
        const comparable = row.flagged_price != null && row.current_price != null && row.flagged_currency === row.current_currency;
        const movement = comparable ? row.current_price! - row.flagged_price! : null;
        const fired = comparable && row.current_price! <= row.flagged_price!;
        const sightings = row.store_sightings ?? [];
        const owned = ownedCounts.get(ownedInventoryKey({ game: "pokemon", cardId: row.card_id }));
        const marketRoi = cardData.get(String(row.card_id))?.roi ?? null;
        return (
          <article
            key={row.rule_id}
            className={`flex cursor-pointer gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/40 md:col-span-2 xl:col-span-1${fired ? " ring-1 ring-emerald-500/50" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => void openCard(row.card_id, row.psa_grade)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void openCard(row.card_id, row.psa_grade); } }}
          >
            {row.image_url ? <img src={row.image_url} alt="" className="h-24 w-16 rounded object-cover" /> : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="truncate font-medium">{language === "en" && row.english_name ? row.english_name : row.regional_name}</h3>
                  <p className="text-xs text-muted-foreground">{row.set_code} {row.card_number} · {row.psa_grade === 0 ? t("evidence.raw") : `PSA ${row.psa_grade}`} · {t("column.roi")} {fmtRoi(marketRoi)}</p>
                  <OwnedCountLine owned={owned?.owned} incoming={owned?.incoming} avgCost={owned?.avgCost} totalCost={owned?.costBasis} />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant="outline"><Eye className="size-3" />{t("decision.watching")}</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                    disabled={unwatchingRuleId === row.rule_id}
                    onClick={(e) => { e.stopPropagation(); void unwatch(row.rule_id); }}
                  >
                    <EyeOff className="size-3.5" />
                    {unwatchingRuleId === row.rule_id ? t("decision.unwatching") : t("decision.unwatch")}
                  </Button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-[10px] uppercase text-muted-foreground">{t("decision.flagged")}</div><div className="font-medium">{price(row.flagged_price, row.flagged_currency)}</div><div className="text-[10px] text-muted-foreground">{new Date(row.decided_at).toLocaleDateString(language)}</div></div>
                <div><div className="text-[10px] uppercase text-muted-foreground">{t("decision.now")}</div><div className="flex items-center gap-1 font-medium">{price(row.current_price, row.current_currency)}{movement != null && movement > 0 ? <ArrowUpRight className="size-3 text-emerald-500" /> : movement != null && movement < 0 ? <ArrowDownRight className="size-3 text-rose-500" /> : null}{fired && <span className="rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">{t("decision.alertFired")}</span>}</div><div className="text-[10px] text-muted-foreground">{row.current_observed_on ? new Date(`${row.current_observed_on}T00:00:00`).toLocaleDateString(language) : "-"}</div></div>
              </div>
              {row.reason ? <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{row.reason}</p> : null}
              {sightings.length > 0 ? (
                <div className="mt-3 border-t pt-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 text-xs font-medium"><Store className="size-3.5" />{t("decision.storeRound")}</div>
                    <span className="text-[10px] text-muted-foreground">{t("decision.sightingCount", { count: sightings.length })}</span>
                  </div>
                  <div className="space-y-2">
                    {sightings.map((sighting, index) => (
                      <div key={sighting.sighting_id} className="rounded-md bg-muted/45 px-2 py-1.5 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{sighting.store_name}</div>
                            <div className="text-[10px] text-muted-foreground">{new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "short" }).format(new Date(sighting.observed_at))}</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-semibold tabular-nums">{price(Number(sighting.observed_price), sighting.currency)}</div>
                            {sighting.currency !== "USD" ? <div className="text-[10px] text-muted-foreground">{t("decision.normalizedUsd", { value: `$${Number(sighting.price_usd).toFixed(2)}` })}</div> : null}
                          </div>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          {sighting.note ? <span className="min-w-0 truncate text-[10px] text-muted-foreground">{sighting.note}</span> : <span />}
                          {index === 0 ? <Badge className="h-4 px-1 text-[9px]">{t("decision.cheapest")}</Badge> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </article>
        );
        })}
      </div>

      <CardDetailModal
        card={selectedCard}
        open={!!selectedCard}
        onClose={() => setSelectedCard(null)}
        initialPsaMode={selectedCard?.psaGrade ? "psa" : "non-psa"}
      />
    </div>
  );
}

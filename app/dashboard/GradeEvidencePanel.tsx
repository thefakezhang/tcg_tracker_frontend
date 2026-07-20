"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleAlert, Database, Gauge, LineChart, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { useLanguage } from "./LanguageContext";
import { useExitBasis } from "./ExitBasisContext";
import { fetchLocationMap } from "./use-card-data";
import {
  eventAppliesToCard,
  exitValue,
  latestSignals,
  type GradeSignal,
  type SignalEvent,
  type SlabSale,
} from "./grade-signals";

interface GradeEvidencePanelProps {
  cardId: number;
  setCode: string;
  listingFreshnessLabel: string;
}

const SIGNAL_COLUMNS = "card_id, psa_grade, model_version, computed_at, tier, best_jp_bid_jpy, best_jp_bid_location, best_jp_bid_age_days, band_p10, band_p25, band_p50, band_p75, last_sale_jpy, last_sale_at, trend_slope, trend_direction, comp_count_recent, comp_count_lifetime, listing_count, sell_through, clearing_vs_ask, days_to_exit_est, cohort, pop, pop_velocity, flags";

function moneyJpy(value: number | null): string {
  return value == null ? "-" : `¥${Math.round(value).toLocaleString()}`;
}

function percentage(value: number | null): string {
  return value == null ? "-" : `${Math.round(value * 100)}%`;
}

type TranslateFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

function signalTierLabel(tier: string | null, unknown: string): string {
  if (!tier) return unknown;
  return tier.replaceAll("_", " ").replace(/^tier /, "Tier ");
}

function trendIcon(direction: string | null) {
  if (direction === "rising") return <ArrowUpRight className="size-4 text-emerald-600" aria-label="rising" />;
  if (direction === "falling") return <ArrowDownRight className="size-4 text-rose-600" aria-label="falling" />;
  return <ArrowRight className="size-4 text-muted-foreground" aria-label="flat or unknown" />;
}

function flagLabels(signal: GradeSignal, t: TranslateFn): string[] {
  const labels: string[] = [];
  if (signal.flags.thin_evidence) labels.push(t("evidence.thinEvidence"));
  if (signal.flags.cohort_derived) labels.push(signal.flags.cohort_own_weight != null
    ? t("evidence.cohortDerivedWeight", { weight: Math.round(signal.flags.cohort_own_weight * 100) })
    : t("evidence.cohortDerived"));
  if (signal.flags.inversion_derived) labels.push(signal.flags.inversion_confidence != null
    ? t("evidence.gradeInversionConfidence", { confidence: Math.round(signal.flags.inversion_confidence * 100) })
    : t("evidence.gradeInversion"));
  return labels;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function CompSparkline({ sales, events }: { sales: SlabSale[]; events: SignalEvent[] }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const dated = sales
    .filter((sale): sale is SlabSale & { saleDate: string } => !!sale.saleDate)
    .sort((a, b) => a.saleDate.localeCompare(b.saleDate));
  if (dated.length < 2) return null;

  const times = dated.map((sale) => new Date(sale.saleDate).getTime());
  const prices = dated.map((sale) => sale.priceUsd);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const x = (time: number) => 10 + ((time - minTime) / Math.max(1, maxTime - minTime)) * 340;
  const y = (price: number) => 84 - ((price - minPrice) / Math.max(1, maxPrice - minPrice)) * 70;
  const points = dated.map((sale) => `${x(new Date(sale.saleDate).getTime())},${y(sale.priceUsd)}`).join(" ");
  const markers = events.filter((event) => {
    const time = new Date(`${event.startsOn}T00:00:00Z`).getTime();
    return time >= minTime && time <= maxTime;
  });

  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <svg viewBox="0 0 360 96" className="h-24 w-full" role="img" aria-label="Recent sold comps with market event markers">
        <line x1="10" y1="84" x2="350" y2="84" className="stroke-border" />
        {markers.map((event) => {
          const markerX = x(new Date(`${event.startsOn}T00:00:00Z`).getTime());
          return (
            <g key={event.eventId}>
              <line x1={markerX} y1="6" x2={markerX} y2="86" className="stroke-amber-500" strokeDasharray="3 3" />
              <circle cx={markerX} cy="7" r="3" className="fill-amber-500">
                <title>{event.title}</title>
              </circle>
            </g>
          );
        })}
        <polyline points={points} fill="none" className="stroke-primary" strokeWidth="2" strokeLinejoin="round" />
        {dated.map((sale, index) => (
          <circle key={`${sale.saleDate}:${sale.priceUsd}:${index}`} cx={x(new Date(sale.saleDate).getTime())} cy={y(sale.priceUsd)} r="2.5" className="fill-background stroke-primary">
                <title>{`${new Date(sale.saleDate).toLocaleDateString(language)}: $${sale.priceUsd.toLocaleString(language)}${sale.platform ? ` · ${sale.platform}` : ""}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{new Date(minTime).toLocaleDateString(language)}</span>
        <span>{t("evidence.soldComps", { count: dated.length })}</span>
        <span>{new Date(maxTime).toLocaleDateString(language)}</span>
      </div>
    </div>
  );
}

function GradeEvidenceCard({
  signal,
  sales,
  events,
  bidLocation,
}: {
  signal: GradeSignal;
  sales: SlabSale[];
  events: SignalEvent[];
  bidLocation: string | null;
}) {
  const { t } = useTranslation();
  const { exitPercentile } = useExitBasis();
  const flags = flagLabels(signal, t);
  const basis = exitValue(signal, exitPercentile);
  const pricePerPop = basis != null && signal.pop != null && signal.pop > 0 ? basis / signal.pop : null;
  const hasSparkline = sales.filter((sale) => sale.saleDate).length >= 2;

  return (
    <section className="rounded-lg border bg-card p-3 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold">{signal.psaGrade === 0 ? t("evidence.raw") : `PSA ${signal.psaGrade}`}</h4>
          {trendIcon(signal.trendDirection)}
          <Badge variant="outline" className="capitalize">{signalTierLabel(signal.tier, t("evidence.unknownSource"))}</Badge>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">P{exitPercentile} {t("evidence.conservativeExit")}</div>
          <div className="font-semibold tabular-nums">{moneyJpy(basis)}</div>
        </div>
      </div>

      {flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {flags.map((flag) => <Badge key={flag} variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-300"><CircleAlert className="size-3" />{flag}</Badge>)}
        </div>
      )}

      <div className="mt-3 grid grid-cols-4 gap-2 rounded-md bg-muted/40 p-2">
        <Metric label="P10" value={moneyJpy(signal.bandP10)} />
        <Metric label="P25" value={moneyJpy(signal.bandP25)} />
        <Metric label="P50" value={moneyJpy(signal.bandP50)} />
        <Metric label="P75" value={moneyJpy(signal.bandP75)} />
      </div>

      <div className="mt-3">
        {hasSparkline ? (
          <CompSparkline sales={sales} events={events} />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <Database className="size-4 shrink-0" />
            {t("evidence.noCompSeries")}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Metric label={t("evidence.recentLifetimeComps")} value={`${signal.compCountRecent ?? 0} / ${signal.compCountLifetime ?? 0}`} />
        <Metric label={t("evidence.listings")} value={signal.listingCount ?? "-"} />
        <Metric label={t("evidence.sellThrough")} value={percentage(signal.sellThrough)} />
        <Metric label={t("evidence.clearingVsAsk")} value={percentage(signal.clearingVsAsk)} />
        <Metric label={t("evidence.bestJpBid")} value={<span>{moneyJpy(signal.bestJpBidJpy)}{bidLocation ? <span className="block text-xs font-normal text-muted-foreground">{bidLocation}</span> : null}</span>} />
        <Metric label={t("evidence.bidHeld")} value={signal.bestJpBidAgeDays == null ? t("evidence.unknown") : t("evidence.days", { count: signal.bestJpBidAgeDays })} />
        <Metric label={t("evidence.population")} value={signal.pop ?? "-"} />
        <Metric label={t("evidence.pricePerPop")} value={pricePerPop == null ? "-" : moneyJpy(pricePerPop)} />
        <Metric label={t("evidence.popVelocity")} value={signal.popVelocity == null ? t("evidence.notEnoughHistory") : `${signal.popVelocity >= 0 ? "+" : ""}${signal.popVelocity.toFixed(1)}`} />
        <Metric label={t("evidence.exitEstimate")} value={signal.daysToExitEst == null ? "-" : t("evidence.days", { count: Math.round(signal.daysToExitEst) })} />
        <Metric label={t("evidence.cohort")} value={signal.cohort ?? "-"} />
        <Metric label={t("evidence.model")} value={signal.modelVersion} />
      </div>
    </section>
  );
}

export default function GradeEvidencePanel({ cardId, setCode, listingFreshnessLabel }: GradeEvidencePanelProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { exitPercentile, setExitPercentile } = useExitBasis();
  const [signals, setSignals] = useState<GradeSignal[]>([]);
  const [sales, setSales] = useState<SlabSale[]>([]);
  const [events, setEvents] = useState<SignalEvent[]>([]);
  const [locations, setLocations] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const supabase = createClient();
    Promise.all([
      selectAll<Record<string, unknown>>(
        () => supabase.from("pokemon_grade_signals").select(SIGNAL_COLUMNS).eq("card_id", cardId),
        ["card_id", "psa_grade", "model_version"],
      ),
      selectAll<Record<string, unknown>>(
        () => supabase.from("cardladder_slab_sales").select("sale_id, grade, sale_date, price_usd, platform").eq("card_id", cardId),
        ["sale_id"],
      ),
      selectAll<Record<string, unknown>>(
        () => supabase.from("market_events").select("event_id, starts_on, ends_on, scope, scope_ref, card_ids, title, kind, confidence"),
        ["event_id"],
      ),
      fetchLocationMap(supabase),
    ]).then(([signalRows, saleRows, eventRows, locationMap]) => {
      if (cancelled) return;
      setSignals(latestSignals(signalRows));
      setSales(saleRows.map((row) => ({
        grade: Number(row.grade),
        saleDate: row.sale_date == null ? null : String(row.sale_date),
        priceUsd: Number(row.price_usd),
        platform: row.platform == null ? null : String(row.platform),
      })));
      setEvents(eventRows.map((row) => ({
        eventId: Number(row.event_id),
        startsOn: String(row.starts_on),
        endsOn: row.ends_on == null ? null : String(row.ends_on),
        scope: String(row.scope),
        scopeRef: row.scope_ref == null ? null : String(row.scope_ref),
        cardIds: Array.isArray(row.card_ids) ? row.card_ids.map(Number) : null,
        title: String(row.title),
        kind: String(row.kind),
        confidence: String(row.confidence),
      })).filter((event) => eventAppliesToCard(event, cardId, setCode)));
      setLocations(new Map([...locationMap.entries()].map(([id, location]) => [id, location.name])));
      setLoading(false);
    }).catch((error) => {
      if (cancelled) return;
      console.error("Failed to load grade evidence:", error);
      setSignals([]);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [cardId, setCode]);

  const newestSnapshot = useMemo(() => signals.reduce<string | null>((newest, signal) => !newest || signal.computedAt > newest ? signal.computedAt : newest, null), [signals]);

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><LineChart className="size-4" />{t("evidence.title")}</h3>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Gauge className="size-3" />{t("evidence.signalFreshness")}: {newestSnapshot ? new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(newestSnapshot)) : "-"}</span>
            <span className="inline-flex items-center gap-1"><Users className="size-3" />{listingFreshnessLabel}</span>
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {t("evidence.exitBasis")}
          <select className="h-8 rounded-md border bg-background px-2 text-foreground" value={exitPercentile} onChange={(event) => setExitPercentile(Number(event.target.value) as 10 | 25 | 50)}>
            <option value={10}>P10</option>
            <option value={25}>P25</option>
            <option value={50}>P50</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
      ) : signals.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{t("evidence.none")}</div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {[...signals].sort((a, b) => b.psaGrade - a.psaGrade).map((signal) => (
            <GradeEvidenceCard
              key={`${signal.cardId}:${signal.psaGrade}`}
              signal={signal}
              sales={sales.filter((sale) => sale.grade === signal.psaGrade)}
              events={events}
              bidLocation={signal.bestJpBidLocation == null ? null : locations.get(signal.bestJpBidLocation) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

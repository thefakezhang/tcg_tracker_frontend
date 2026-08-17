"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useLanguage } from "./LanguageContext";
import { useSupabaseQuery, QueryError } from "./use-query";

import { formatDate } from "@/lib/dates";
// The decision-quality feedback loop (000209) finally on screen: every
// opportunity the operator SAW is classified as taken / dismissed /
// dismissed_then_bought / implicit_pass / open. Counts come from the
// server-side summary view (the row view is 10k+ and PostgREST-capped);
// the recent list fetches only the decided rows, a bounded page.

interface SummaryRow {
  outcome_status: string;
  opportunity_kind: string | null;
  n: number;
  cards: number;
  newest_seen_at: string | null;
}

interface RecentRow {
  exposure_id: number;
  card_id: number;
  outcome_status: string;
  source_name: string | null;
  entry_price: number | null;
  entry_currency: string | null;
  first_seen_at: string;
  dismissed_at: string | null;
  dismiss_reason: string | null;
  bought_at: string | null;
}

interface OutcomesData {
  summary: SummaryRow[];
  recent: RecentRow[];
  names: Map<number, string>;
}

const DECIDED = ["taken", "dismissed", "dismissed_then_bought"];

// Statuses ordered by how much the operator should care.
const STATUS_ORDER = ["dismissed_then_bought", "taken", "dismissed", "open", "implicit_pass"];

const STATUS_TONE: Record<string, string> = {
  taken: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
  dismissed: "text-amber-600 dark:text-amber-400 border-amber-500/40",
  dismissed_then_bought: "text-destructive border-destructive/40",
  implicit_pass: "text-muted-foreground border-border",
  open: "text-sky-600 dark:text-sky-400 border-sky-500/40",
};

async function fetchOutcomes(): Promise<OutcomesData> {
  const supabase = createClient();
  const [{ data: summary, error: e1 }, { data: recent, error: e2 }] = await Promise.all([
    supabase.from("deal_outcome_summary_v").select("*"),
    supabase
      .from("deal_opportunity_outcomes_v")
      .select("exposure_id, card_id, outcome_status, source_name, entry_price, entry_currency, first_seen_at, dismissed_at, dismiss_reason, bought_at")
      .in("outcome_status", DECIDED)
      .order("first_seen_at", { ascending: false })
      .limit(30),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const rows = (recent ?? []) as RecentRow[];
  const ids = [...new Set(rows.map((r) => r.card_id))];
  const names = new Map<number, string>();
  if (ids.length) {
    const { data: defs } = await supabase
      .from("pokemon_card_definitions")
      .select("card_id, regional_name, english_name")
      .in("card_id", ids);
    for (const d of (defs as { card_id: number; regional_name: string; english_name: string | null }[]) ?? []) {
      names.set(d.card_id, d.english_name || d.regional_name);
    }
  }
  return { summary: (summary ?? []) as SummaryRow[], recent: rows, names };
}

export default function DecisionOutcomes() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { data, error, isLoading, retry } = useSupabaseQuery(["deal-outcomes"], fetchOutcomes);

  const totals = useMemo(() => {
    const m = new Map<string, { n: number; cards: number }>();
    for (const r of data?.summary ?? []) {
      const cur = m.get(r.outcome_status) ?? { n: 0, cards: 0 };
      cur.n += Number(r.n);
      cur.cards += Number(r.cards);
      m.set(r.outcome_status, cur);
    }
    return m;
  }, [data]);

  if (error) return <QueryError onRetry={retry} />;
  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;

  const price = (p: number | null, c: string | null) => (p == null ? "-" : `${c === "JPY" ? "¥" : "$"}${Number(p).toLocaleString()}`);

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-xs text-muted-foreground">{t("outcomes.hint")}</p>
      <div className="flex flex-wrap gap-2">
        {STATUS_ORDER.filter((s) => totals.has(s)).map((s) => {
          const v = totals.get(s)!;
          return (
            <div key={s} className={`rounded-md border px-3 py-1.5 text-sm ${STATUS_TONE[s] ?? ""}`}>
              <span className="font-semibold tabular-nums">{v.n.toLocaleString()}</span>{" "}
              {t(`outcomes.status.${s}` as never)}
              <span className="ml-1 text-[10px] opacity-70">{t("outcomes.cards", { n: v.cards })}</span>
            </div>
          );
        })}
      </div>

      {data!.recent.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t("outcomes.colCard")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("outcomes.colStatus")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("outcomes.colSource")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("outcomes.colEntry")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("outcomes.colWhen")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("outcomes.colReason")}</th>
              </tr>
            </thead>
            <tbody>
              {data!.recent.map((r) => (
                <tr key={r.exposure_id} className="border-t">
                  <td className="px-3 py-1.5">{data!.names.get(r.card_id) ?? `#${r.card_id}`}</td>
                  <td className={`whitespace-nowrap px-3 py-1.5 text-xs ${STATUS_TONE[r.outcome_status]?.split(" ")[0] ?? ""}`}>
                    {t(`outcomes.status.${r.outcome_status}` as never)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{r.source_name ?? "-"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{price(r.entry_price, r.entry_currency)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                    {formatDate(r.bought_at ?? r.dismissed_at ?? r.first_seen_at, language)}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-1.5 text-xs text-muted-foreground" title={r.dismiss_reason ?? undefined}>
                    {r.dismiss_reason ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

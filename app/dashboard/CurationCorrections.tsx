"use client";

import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";

// The per-buyer curator-quality feedback loop (000123) on screen: how often
// the human had to fix what the pipeline proposed, per buyer and kind.
// Reads the server-side summary view (curation_corrections_summary_v) - the
// row view is 60k+ and PostgREST-capped.

interface Row {
  buyer_handle: string | null;
  kind: string | null;
  decided: number;
  rejected: number;
  card_fixes: number;
  grading_fixes: number;
  price_fixes: number;
  newest_reviewed_at: string | null;
}

async function fetchCorrections(): Promise<Row[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("curation_corrections_summary_v")
    .select("*")
    .order("decided", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Row[];
}

const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "-");

export default function CurationCorrections() {
  const { t } = useTranslation();
  const { data, error, isLoading, retry } = useSupabaseQuery(["curation-corrections"], fetchCorrections);

  if (error) return <QueryError onRetry={retry} />;
  if (isLoading || !data?.length) return null;

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">{t("corrections.title")}</h2>
      <p className="max-w-prose text-xs text-muted-foreground">{t("corrections.hint")}</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t("corrections.colBuyer")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("corrections.colKind")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("corrections.colDecided")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("corrections.colRejected")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("corrections.colCard")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("corrections.colGrading")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("corrections.colPrice")}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={`${r.buyer_handle}|${r.kind}`} className="border-t">
                <td className="whitespace-nowrap px-3 py-1.5">{r.buyer_handle ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{r.kind ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{Number(r.decided).toLocaleString()}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{Number(r.rejected).toLocaleString()}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums" title={String(r.card_fixes)}>{pct(Number(r.card_fixes), Number(r.decided))}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums" title={String(r.grading_fixes)}>{pct(Number(r.grading_fixes), Number(r.decided))}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums" title={String(r.price_fixes)}>{pct(Number(r.price_fixes), Number(r.decided))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

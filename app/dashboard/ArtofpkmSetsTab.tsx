"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useSaving } from "@/lib/use-saving";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The artofpkm set crosswalk (pokemon_artofpkm_sets, migration 000282): every
// set the authoritative Japanese catalog lists, joined to our set_code where
// the seeder's auto-mapper resolved it (exact JP name, then unique release
// date) and left for the curator where it did not. Binding writes through
// card_index_bind_artofpkm_set; the seeder never overwrites a curator binding.
// This is also the set-enrichment ledger: JP + EN names, dates and eras for
// every JP set, whether or not our shop-derived pokemon_sets knew it.

interface Row {
  aop_set_id: number;
  name_en: string;
  name_jp: string | null;
  era: string | null;
  release_date: string | null;
  card_count: number | null;
  set_code: string | null;
  mapping_method: string;
  mapping_note: string | null;
}

async function fetchSets(): Promise<Row[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("pokemon_artofpkm_sets")
    .select("aop_set_id, name_en, name_jp, era, release_date, card_count, set_code, mapping_method, mapping_note")
    .order("release_date", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Row[];
}

const METHOD_TONE: Record<string, string> = {
  unmapped: "text-destructive",
  curator: "text-emerald-600 dark:text-emerald-400",
  name_exact: "text-muted-foreground",
  date_unique: "text-amber-600 dark:text-amber-400",
};

export default function ArtofpkmSetsTab() {
  const { t } = useTranslation();
  const { data, error, isLoading, retry } = useSupabaseQuery(["artofpkm-sets"], fetchSets);
  const [filter, setFilter] = useState<"all" | "unmapped">("unmapped");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const { saving, save } = useSaving();
  const [saveError, setSaveError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = data ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((r) =>
      (filter === "all" || !r.set_code) &&
      (!q || r.name_en.toLowerCase().includes(q) || (r.name_jp ?? "").toLowerCase().includes(q) || (r.set_code ?? "").toLowerCase().includes(q)),
    );
  }, [data, filter, search]);

  const bind = async (r: Row) => {
    const code = (drafts[r.aop_set_id] ?? "").trim();
    if (!code) return;
    setSaveError(null);
    const ok = await save(async () => {
      const { error } = await createClient().rpc("card_index_bind_artofpkm_set", { p_aop_set_id: r.aop_set_id, p_set_code: code, p_note: null });
      if (error) {
        setSaveError(error.message);
        throw error;
      }
    });
    if (ok) retry();
  };

  if (error) return <QueryError onRetry={retry} />;
  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  const unmapped = (data ?? []).filter((r) => !r.set_code).length;

  return (
    <div className="min-w-0 space-y-3">
      <p className="max-w-prose text-xs text-muted-foreground">{t("aopSets.hint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={filter === "unmapped" ? "default" : "outline"} className="min-h-11 sm:min-h-8" onClick={() => setFilter("unmapped")}>
          {t("aopSets.unmapped", { n: unmapped })}
        </Button>
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} className="min-h-11 sm:min-h-8" onClick={() => setFilter("all")}>
          {t("aopSets.all", { n: (data ?? []).length })}
        </Button>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("aopSets.search")} className="min-h-11 w-full sm:min-h-8 sm:w-56" />
      </div>
      {saveError && <p role="alert" className="text-xs text-destructive">{saveError}</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t("aopSets.colSet")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("aopSets.colEra")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("aopSets.colDate")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("aopSets.colCards")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("aopSets.colCode")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("aopSets.colBind")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.aop_set_id} className="border-t align-top">
                <td className="px-3 py-1.5">
                  <a href={`https://www.artofpkm.com/sets/${r.aop_set_id}`} target="_blank" rel="noreferrer" className="hover:underline">{r.name_en}</a>
                  {r.name_jp && <div className="text-xs text-muted-foreground">{r.name_jp}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{r.era ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">{r.release_date ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{r.card_count ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <span className={`font-mono ${METHOD_TONE[r.mapping_method] ?? ""}`}>{r.set_code ?? t("aopSets.none")}</span>
                  <div className="text-[10px] text-muted-foreground" title={r.mapping_note ?? undefined}>{r.mapping_method}{r.mapping_note ? ` · ${r.mapping_note}` : ""}</div>
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1">
                    <Input
                      value={drafts[r.aop_set_id] ?? ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.aop_set_id]: e.target.value.toUpperCase() }))}
                      placeholder={r.set_code ?? "SV8A"}
                      className="h-11 w-24 font-mono sm:h-8"
                    />
                    <Button size="sm" className="min-h-11 sm:min-h-8" disabled={saving || !(drafts[r.aop_set_id] ?? "").trim()} onClick={() => void bind(r)}>
                      {t("aopSets.bind")}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

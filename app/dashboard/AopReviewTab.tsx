"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useSaving } from "@/lib/use-saving";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Singles review: the artofpkm rows that no automated tier could settle, so a
// human has to look at the card.
//
// Everything the resolver COULD decide has already left this queue - rows whose
// card the catalog demonstrably holds were removed, and rows with a usable
// printed number were created. What is left is the residue where a name alone
// cannot separate two possibilities:
//
//   - OLD-UPC, the unnumbered old-back promo bucket. Two thirds of it shares a
//     name with a card already filed in a real set (Erika's Bulbasaur is in
//     OLD-LS, Trainer Certification in OLD-CR), because promos were historically
//     spun out of this bucket one product at a time. The rest are genuinely
//     missing promos, several of them famous.
//   - the sets whose crosswalk evidence is split across several of our codes,
//     where the queued card may belong to a sibling set rather than this one.
//
// So each row is shown with its artofpkm scan AND every catalog card sharing its
// name, with their set, number and finish. The operator compares the pictures.
// This replaced the set-crosswalk tab, whose job is finished: zero bindings now
// point at an empty stub and the verifier settles the rest from evidence.

interface Candidate {
  candidate_id: number;
  source_name: string;
  set_code: string | null;
  card_number: string | null;
  misc_info: string | null;
  language: string | null;
  source_image_url: string | null;
  source_fields: { by_source?: { artofpkm?: { english_name?: string; illustrator?: string; rarity?: string } } } | null;
}

interface Existing {
  card_id: number;
  regional_name: string;
  english_name: string | null;
  set_code: string;
  card_number: string | null;
  misc_info: string | null;
  image_url: string | null;
}

export interface ReviewRow extends Candidate {
  english_name: string;
  illustrator: string;
  lookalikes: Existing[];
}

// foldName is the comparison key for "is this the same printed card". It must
// stay in step with matchreview.FoldCardName on the backend: width and case are
// noise, spaces are noise, and a one-character bracket group IS identity
// (アンノーン[J] is not アンノーン[R]) but its brackets are not, because sources
// write the same card as アンノーンJ.
export function foldName(s: string): string {
  return (s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[[［]([^\]］])[\]］]/g, "$1")
    .replace(/\s+/g, "");
}

export async function fetchReview(): Promise<ReviewRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("pokemon_match_candidates")
    .select("candidate_id, source_name, set_code, card_number, misc_info, language, source_image_url, source_fields")
    .eq("status", "pending")
    .eq("source_fields->>source", "artofpkm")
    .order("set_code", { ascending: true })
    .order("source_name", { ascending: true })
    .limit(2000);
  if (error) throw error;
  const cands = (data ?? []) as Candidate[];
  if (cands.length === 0) return [];

  // One round trip for every catalog card sharing a name with any candidate.
  // Names are matched exactly here and folded in JS: PostgREST cannot express
  // the fold, and the exact set is small enough that over-fetching is cheaper
  // than a request per row.
  const names = Array.from(new Set(cands.map((c) => c.source_name).filter(Boolean)));
  const { data: defs, error: defErr } = await supabase
    .from("pokemon_card_definitions")
    .select("card_id, regional_name, english_name, set_code, card_number, misc_info, image_url")
    .in("regional_name", names)
    .limit(5000);
  if (defErr) throw defErr;

  const byName = new Map<string, Existing[]>();
  for (const d of (defs ?? []) as Existing[]) {
    const k = foldName(d.regional_name);
    const arr = byName.get(k) ?? [];
    arr.push(d);
    byName.set(k, arr);
  }
  return cands.map((c) => {
    const aop = c.source_fields?.by_source?.artofpkm ?? {};
    return {
      ...c,
      english_name: aop.english_name ?? "",
      illustrator: aop.illustrator ?? "",
      lookalikes: (byName.get(foldName(c.source_name)) ?? []).sort((a, b) => a.set_code.localeCompare(b.set_code)),
    };
  });
}

export default function AopReviewTab() {
  const { t } = useTranslation();
  const { data, error, isLoading, retry } = useSupabaseQuery(["aop-review"], fetchReview);
  const [filter, setFilter] = useState<"all" | "clash" | "clean">("all");
  const [search, setSearch] = useState("");
  const [done, setDone] = useState<Record<number, "created" | "skipped">>({});
  const { saving, save } = useSaving();
  const [saveError, setSaveError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = data ?? [];
    const q = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        (filter === "all" || (filter === "clash" ? r.lookalikes.length > 0 : r.lookalikes.length === 0)) &&
        (!q ||
          r.source_name.toLowerCase().includes(q) ||
          r.english_name.toLowerCase().includes(q) ||
          (r.set_code ?? "").toLowerCase().includes(q)),
    );
  }, [data, filter, search]);

  const create = async (r: ReviewRow) => {
    setSaveError(null);
    const ok = await save(async () => {
      const { error: e } = await createClient().rpc("card_index_resolve_pokemon_candidate_create", {
        p_candidate_id: r.candidate_id,
        p_regional_name: r.source_name,
        p_english_name: r.english_name || null,
        p_set_code: r.set_code,
        p_card_number: r.card_number || null,
        p_language: r.language || "jp",
        p_misc_info: r.misc_info || "UNKNOWN",
      });
      if (e) {
        setSaveError(e.message);
        throw e;
      }
    });
    if (ok) setDone((d) => ({ ...d, [r.candidate_id]: "created" }));
  };

  const skip = async (r: ReviewRow) => {
    setSaveError(null);
    const ok = await save(async () => {
      const { error: e } = await createClient().rpc("card_index_resolve_pokemon_candidate_reject", {
        p_candidate_id: r.candidate_id,
      });
      if (e) {
        setSaveError(e.message);
        throw e;
      }
    });
    if (ok) setDone((d) => ({ ...d, [r.candidate_id]: "skipped" }));
  };

  if (error) return <QueryError onRetry={retry} />;
  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;

  const all = data ?? [];
  const clash = all.filter((r) => r.lookalikes.length > 0).length;

  return (
    <div className="min-w-0 space-y-3">
      <p className="max-w-prose text-xs text-muted-foreground">{t("aopReview.hint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} className="min-h-11 sm:min-h-8" onClick={() => setFilter("all")}>
          {t("aopReview.all", { n: all.length })}
        </Button>
        <Button size="sm" variant={filter === "clash" ? "default" : "outline"} className="min-h-11 sm:min-h-8" onClick={() => setFilter("clash")}>
          {t("aopReview.clash", { n: clash })}
        </Button>
        <Button size="sm" variant={filter === "clean" ? "default" : "outline"} className="min-h-11 sm:min-h-8" onClick={() => setFilter("clean")}>
          {t("aopReview.clean", { n: all.length - clash })}
        </Button>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("aopReview.search")}
          className="min-h-11 w-full sm:min-h-8 sm:w-56"
        />
      </div>
      {saveError && (
        <p role="alert" className="text-xs text-destructive">
          {saveError}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("aopReview.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const state = done[r.candidate_id];
            return (
              <li key={r.candidate_id} className={`rounded-md border p-3 ${state ? "opacity-50" : ""}`}>
                <div className="flex flex-wrap gap-4">
                  <div className="w-28 shrink-0">
                    {r.source_image_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={r.source_image_url} alt={r.source_name} className="w-full rounded" loading="lazy" />
                    ) : (
                      <div className="flex h-36 w-full items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                        {t("aopReview.noImage")}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-medium">{r.source_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[r.english_name, r.set_code, r.card_number, r.misc_info, r.illustrator].filter(Boolean).join(" · ")}
                    </div>
                    {r.lookalikes.length === 0 ? (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">{t("aopReview.noClash")}</p>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          {t("aopReview.clashCount", { n: r.lookalikes.length })}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {r.lookalikes.map((d) => (
                            <div key={d.card_id} className="flex w-24 flex-col gap-1">
                              {d.image_url ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={d.image_url} alt={d.regional_name} className="w-full rounded" loading="lazy" />
                              ) : (
                                <div className="flex h-32 w-full items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
                                  {t("aopReview.noImage")}
                                </div>
                              )}
                              <span className="text-[10px] leading-tight text-muted-foreground">
                                {d.set_code}
                                <br />
                                {d.card_number}
                                {d.misc_info && d.misc_info !== "UNKNOWN" ? ` · ${d.misc_info}` : ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" className="min-h-11 sm:min-h-8" disabled={saving || !!state} onClick={() => create(r)}>
                        {state === "created" ? t("aopReview.created") : t("aopReview.create")}
                      </Button>
                      <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" disabled={saving || !!state} onClick={() => skip(r)}>
                        {state === "skipped" ? t("aopReview.skipped") : t("aopReview.skip")}
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

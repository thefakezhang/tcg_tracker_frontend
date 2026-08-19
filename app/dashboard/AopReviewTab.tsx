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

export interface ReviewRow extends Candidate {
  english_name: string;
  illustrator: string;
  // Whether the row's identity is complete: its set_code names a real set and
  // it carries a printed number. That is the only thing on this screen that
  // decides anything, because identity is (set_code, card_number, misc_info,
  // language). A shared NAME is not a conflict - it is the normal case, and
  // showing counts of it asked the operator to adjudicate noise.
  ready: boolean;
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

// canonicalName strips the catalog-feed's own markup and writes the glyph the
// catalog uses. It must stay in step with matchreview.FoldCardName, which folds
// the same two tokens. Applied both to the "do we hold this" test and to what
// Create sends, because storing the raw string is how 39 twins of cards we
// already held got written with "{PRISM_STAR}" in their Japanese name.
export function canonicalName(s: string): string {
  return (s ?? "").replace(/^\{MEGA\}/, "M").replace(/\{PRISM_STAR\}/g, "\u25c7");
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

  // One round trip for the set codes that exist. A candidate whose set_code
  // names no set cannot be created - that is one blocker.
  const { data: sets, error: setErr } = await supabase
    .from("pokemon_sets")
    .select("set_code, language")
    .limit(5000);
  if (setErr) throw setErr;
  const known = new Set(((sets ?? []) as { set_code: string; language: string }[]).map((x) => `${x.language}\u001f${x.set_code}`));

  // The other blocker: a card we ALREADY hold at this set and number under this
  // name, in some finish. artofpkm never states a finish, so its rows arrive
  // with misc_info UNKNOWN and match no card we hold as 1ED / アンリミ /
  // レアリティなし. Comparing the full identity therefore called them new, and a
  // bulk run created 23 unspecified-finish copies of cards we already had.
  // The resolver has always refused to resolve an unstated finish ONTO a
  // specific-finish card because you cannot tell which print it is; that same
  // uncertainty means it must not be created either. It is a curator's
  // question, not a new card.
  const numbers = Array.from(new Set(cands.map((c) => c.card_number).filter(Boolean))) as string[];
  const held = new Set<string>();
  if (numbers.length > 0) {
    const { data: defs, error: defErr } = await supabase
      .from("pokemon_card_definitions")
      .select("set_code, card_number, regional_name")
      .in("card_number", numbers)
      .limit(10000);
    if (defErr) throw defErr;
    for (const d of (defs ?? []) as { set_code: string; card_number: string; regional_name: string }[]) {
      held.add(`${d.set_code}\u001f${d.card_number}\u001f${canonicalName(d.regional_name)}`);
    }
  }

  return cands.map((c) => {
    const aop = c.source_fields?.by_source?.artofpkm ?? {};
    return {
      ...c,
      english_name: aop.english_name ?? "",
      illustrator: aop.illustrator ?? "",
      ready:
        Boolean(c.set_code) &&
        known.has(`${c.language ?? "jp"}\u001f${c.set_code}`) &&
        Boolean(c.card_number) &&
        !held.has(`${c.set_code}\u001f${c.card_number}\u001f${canonicalName(c.source_name)}`),
    };
  });
}

export default function AopReviewTab() {
  const { t } = useTranslation();
  const { data, error, isLoading, retry } = useSupabaseQuery(["aop-review"], fetchReview);
  const [filter, setFilter] = useState<"all" | "ready" | "blocked">("all");
  const [search, setSearch] = useState("");
  const [done, setDone] = useState<Record<number, "created" | "skipped">>({});
  // Which row is mid-flight. useSaving's flag is component-wide, so using it to
  // disable would grey out every button on the page for one row's request.
  const [busy, setBusy] = useState<number | null>(null);
  // Bulk create is two-step on purpose: it writes hundreds of definitions and
  // there is no undo in this screen. `armed` is the first click, `bulk` is the
  // live progress, and it stops on the first failure rather than plough on.
  const [armed, setArmed] = useState(false);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const { save } = useSaving();
  const [saveError, setSaveError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = data ?? [];
    const q = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        // A resolved row leaves the worklist. Fading it in place read as a
        // broken button rather than a success: a disabled control on a dimmed
        // row is what failure looks like everywhere else in the app.
        !done[r.candidate_id] &&
        (filter === "all" || (filter === "ready" ? r.ready : !r.ready)) &&
        (!q ||
          r.source_name.toLowerCase().includes(q) ||
          r.english_name.toLowerCase().includes(q) ||
          (r.set_code ?? "").toLowerCase().includes(q)),
    );
  }, [data, filter, search, done]);

  const create = async (r: ReviewRow) => {
    setSaveError(null);
    setBusy(r.candidate_id);
    const ok = await save(async () => {
      const { error: e } = await createClient().rpc("card_index_resolve_pokemon_candidate_create", {
        p_candidate_id: r.candidate_id,
        p_regional_name: canonicalName(r.source_name),
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
    setBusy(null);
    if (ok) setDone((d) => ({ ...d, [r.candidate_id]: "created" }));
  };

  const skip = async (r: ReviewRow) => {
    setSaveError(null);
    setBusy(r.candidate_id);
    const ok = await save(async () => {
      const { error: e } = await createClient().rpc("card_index_resolve_pokemon_candidate_reject", {
        p_candidate_id: r.candidate_id,
      });
      if (e) {
        setSaveError(e.message);
        throw e;
      }
    });
    setBusy(null);
    if (ok) setDone((d) => ({ ...d, [r.candidate_id]: "skipped" }));
  };

  // Every row here has a complete identity and matches no card, so each is a
  // card we lack. Creating them one click at a time asks the same question
  // hundreds of times with one possible answer.
  const createAllReady = async () => {
    const targets = (data ?? []).filter((r) => r.ready && !done[r.candidate_id]);
    if (targets.length === 0) return;
    setArmed(false);
    setSaveError(null);
    setBulk({ done: 0, total: targets.length });
    const supabase = createClient();
    for (let i = 0; i < targets.length; i++) {
      const r = targets[i];
      const { error: e } = await supabase.rpc("card_index_resolve_pokemon_candidate_create", {
        p_candidate_id: r.candidate_id,
        p_regional_name: canonicalName(r.source_name),
        p_english_name: r.english_name || null,
        p_set_code: r.set_code,
        p_card_number: r.card_number || null,
        p_language: r.language || "jp",
        p_misc_info: r.misc_info || "UNKNOWN",
      });
      if (e) {
        // Stop here. Whatever broke this row is likely to break the rest, and
        // the ones already created stay created - the counter says how many.
        setSaveError(t("aopReview.bulkStopped", { n: i, name: r.source_name, msg: e.message }));
        setBulk(null);
        return;
      }
      setDone((d) => ({ ...d, [r.candidate_id]: "created" }));
      setBulk({ done: i + 1, total: targets.length });
    }
    setBulk(null);
  };

  if (error) return <QueryError onRetry={retry} />;
  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;

  const all = data ?? [];
  const ready = all.filter((r) => r.ready).length;
  const readyPending = all.filter((r) => r.ready && !done[r.candidate_id]).length;
  const resolved = Object.keys(done).length;

  return (
    <div className="min-w-0 space-y-3">
      <p className="max-w-prose text-xs text-muted-foreground">{t("aopReview.hint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} className="min-h-11 sm:min-h-8" onClick={() => setFilter("all")}>
          {t("aopReview.all", { n: all.length })}
        </Button>
        <Button size="sm" variant={filter === "ready" ? "default" : "outline"} className="min-h-11 sm:min-h-8" onClick={() => setFilter("ready")}>
          {t("aopReview.ready", { n: ready })}
        </Button>
        <Button size="sm" variant={filter === "blocked" ? "default" : "outline"} className="min-h-11 sm:min-h-8" onClick={() => setFilter("blocked")}>
          {t("aopReview.blocked", { n: all.length - ready })}
        </Button>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("aopReview.search")}
          className="min-h-11 w-full sm:min-h-8 sm:w-56"
        />
      </div>
      {readyPending > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {bulk ? (
            <p className="text-xs text-muted-foreground">{t("aopReview.bulkProgress", { done: bulk.done, total: bulk.total })}</p>
          ) : armed ? (
            <>
              <Button size="sm" variant="destructive" className="min-h-11 sm:min-h-8" onClick={createAllReady}>
                {t("aopReview.bulkConfirm", { n: readyPending })}
              </Button>
              <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => setArmed(false)}>
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" className="min-h-11 sm:min-h-8" onClick={() => setArmed(true)}>
              {t("aopReview.bulk", { n: readyPending })}
            </Button>
          )}
        </div>
      )}
      {resolved > 0 && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{t("aopReview.resolved", { n: resolved })}</p>
      )}
      {saveError && (
        <p role="alert" className="text-xs text-destructive">
          {saveError}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("aopReview.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.candidate_id} className="rounded-md border p-3">
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
                    {r.ready ? null : (
                      <p className="text-xs text-amber-600 dark:text-amber-400">{t("aopReview.blockedWhy")}</p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" className="min-h-11 sm:min-h-8" disabled={busy === r.candidate_id} onClick={() => create(r)}>
                        {busy === r.candidate_id ? t("aopReview.working") : t("aopReview.create")}
                      </Button>
                      <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" disabled={busy === r.candidate_id} onClick={() => skip(r)}>
                        {t("aopReview.skip")}
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
          ))}
        </ul>
      )}
    </div>
  );
}

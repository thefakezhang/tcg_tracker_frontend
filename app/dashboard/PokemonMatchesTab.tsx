"use client";

import { useMemo, useState } from "react";
import { Search, Trash2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useDebouncedValue } from "./use-card-data";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Pokemon match memory (docs/match_memory.md).
//
// A row remembers "this source, spelling it this way, means this card" and is
// keyed on (source, regional_name, set_code, card_number, misc_info, language).
// The matcher reads it live and ranks it ABOVE its own inference tiers, so a row
// here is the operator's durable "until I change it" answer - add or remove is
// effective on the very next run.
//
// The `source` axis is why this is not a flat list: a row confirmed for collectr
// deliberately does not auto-match for snkrdunk (that becomes a queued proposal
// instead), so the source must be visible and filterable.

interface CardTarget {
  regional_name: string;
  set_code: string;
  card_number: string;
  misc_info: string;
}

interface CardMatch {
  alias_id: number;
  source: string;
  regional_name: string;
  set_code: string;
  card_number: string;
  misc_info: string;
  language: string;
  card_uid: string;
  note: string | null;
  updated_at: string | null;
  // The card this match resolves to, embedded via the card_uid FK.
  target: CardTarget | null;
}

async function fetchMatches(search: string, source: string): Promise<CardMatch[]> {
  const supabase = createClient();
  let q = supabase
    .from("pokemon_card_matches")
    .select(
      "alias_id, source, regional_name, set_code, card_number, misc_info, language, card_uid, note, updated_at, target:pokemon_card_definitions(regional_name, set_code, card_number, misc_info)",
    )
    .order("regional_name")
    .limit(300);
  if (source) q = q.eq("source", source);
  const s = search.trim();
  if (s) {
    const safe = s.replace(/[%,]/g, " ");
    q = q.or(`regional_name.ilike.%${safe}%,set_code.ilike.%${safe}%,card_number.ilike.%${safe}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as CardMatch[];
}

// The source list drives the filter chips. Fetched separately from the rows so
// filtering to one source does not collapse the chip row to that single source.
async function fetchSources(): Promise<string[]> {
  const { data, error } = await createClient()
    .from("pokemon_card_matches")
    .select("source")
    .limit(5000);
  if (error) throw error;
  const seen = new Set<string>();
  for (const r of (data ?? []) as { source: string }[]) if (r.source) seen.add(r.source);
  return [...seen].sort();
}

const BLANK = {
  regional_name: "",
  set_code: "",
  card_number: "",
  misc_info: "",
  language: "jp",
  platform: "tcgplayer",
  external_id: "",
};

// Identity axes render as "UNKNOWN"-free breadcrumbs; UNKNOWN is a sentinel, not
// information the operator needs to read.
function identity(parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && p !== "UNKNOWN").join(" · ");
}

export default function PokemonMatchesTab() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const debounced = useDebouncedValue(search, 300);
  const { data, error, isLoading, retry } = useSupabaseQuery(
    ["pokemon-matches", debounced, source],
    () => fetchMatches(debounced, source),
  );
  const { data: sourceData, retry: retrySources } = useSupabaseQuery(["pokemon-match-sources"], fetchSources);
  const matches = useMemo(() => data ?? [], [data]);
  const sources = sourceData ?? [];

  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const set = (k: keyof typeof BLANK, v: string) => setForm((p) => ({ ...p, [k]: v }));

  async function add() {
    if (!form.regional_name.trim() || !form.external_id.trim()) {
      setFormErr(t("matches.required"));
      return;
    }
    setBusy(true);
    setFormErr(null);
    const { error: e } = await createClient().rpc("card_index_bind_pokemon_alias", {
      p_regional_name: form.regional_name,
      p_set_code: form.set_code,
      p_card_number: form.card_number,
      p_misc_info: form.misc_info,
      p_language: form.language,
      p_platform: form.platform,
      p_external_id: form.external_id,
    });
    setBusy(false);
    if (e) {
      setFormErr(e.message);
      return;
    }
    setForm({ ...BLANK });
    retry();
    retrySources();
  }

  async function remove(id: number) {
    setBusy(true);
    setFormErr(null);
    const { error: e } = await createClient().rpc("card_index_remove_pokemon_alias", { p_alias_id: id });
    setBusy(false);
    if (e) {
      // Deleting memory is destructive curation; a silent failure would leave the
      // operator believing a wrong match was unlearned when it still routes.
      setFormErr(e.message);
      return;
    }
    retry();
    retrySources();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        {!isLoading && (
          <span className="text-sm text-muted-foreground">
            {t("matches.count").replace("{n}", String(matches.length))}
          </span>
        )}
        <div className="relative w-72">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t("matches.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("matches.hint")}</p>

      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant={source === "" ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setSource("")}
          >
            {t("matches.allSources")}
          </Button>
          {sources.map((s) => (
            <Button
              key={s}
              variant={source === s ? "default" : "outline"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setSource(s === source ? "" : s)}
            >
              {s}
            </Button>
          ))}
        </div>
      )}

      {/* Add form */}
      <div className="rounded-md border border-dashed p-2">
        <div className="flex flex-wrap items-end gap-2">
          <Input className="w-40" placeholder={t("cardIndex.fName")} value={form.regional_name} onChange={(e) => set("regional_name", e.target.value)} />
          <Input className="w-24" placeholder={t("cardIndex.fSet")} value={form.set_code} onChange={(e) => set("set_code", e.target.value)} />
          <Input className="w-28" placeholder={t("cardIndex.fNumber")} value={form.card_number} onChange={(e) => set("card_number", e.target.value)} />
          <Input className="w-28" placeholder={t("cardIndex.fMisc")} value={form.misc_info} onChange={(e) => set("misc_info", e.target.value)} />
          <Input className="w-16" placeholder={t("cardIndex.fLanguage")} value={form.language} onChange={(e) => set("language", e.target.value)} />
          <Input className="w-28" placeholder="TCGID" value={form.external_id} onChange={(e) => set("external_id", e.target.value)} />
          <Button size="sm" disabled={busy || !form.regional_name.trim() || !form.external_id.trim()} onClick={add}>
            <Plus className="size-4" /> {t("matches.add")}
          </Button>
        </div>
        {formErr && <p className="mt-1 text-sm text-destructive">{formErr}</p>}
      </div>

      {error ? (
        <QueryError onRetry={retry} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("matches.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-[12%] px-3 py-2 font-medium">{t("matches.colSource")}</th>
                <th className="w-[46%] px-3 py-2 font-medium">{t("matches.colReported")}</th>
                <th className="w-[32%] px-3 py-2 font-medium">{t("matches.colCard")}</th>
                <th className="w-[10%] px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.alias_id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{m.source}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium">{m.regional_name}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {identity([m.set_code, m.card_number, m.misc_info, m.language])}
                    </span>
                    {m.note && <span className="ml-1 text-xs text-muted-foreground/70">({m.note})</span>}
                  </td>
                  <td className="px-3 py-2">
                    {m.target ? (
                      <>
                        <span className="font-medium">{m.target.regional_name}</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          {identity([m.target.set_code, m.target.card_number, m.target.misc_info])}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={busy}
                      onClick={() => remove(m.alias_id)}
                      title={t("matches.remove")}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
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

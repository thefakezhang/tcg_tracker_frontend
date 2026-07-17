"use client";

import { useState } from "react";
import { Search, Trash2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useDebouncedValue } from "./use-card-data";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Pokemon singles text-variance aliases (docs/card_index_curation_console.md).
// An alias maps a source text tuple → a target card (by card_uid); the fallback
// matcher reads this table live, so add/remove here is effective on the next run.

interface CardTarget {
  regional_name: string;
  set_code: string;
  card_number: string;
  misc_info: string;
}

interface Alias {
  alias_id: number;
  regional_name: string;
  set_code: string;
  card_number: string;
  misc_info: string;
  language: string;
  card_uid: string;
  // The card this alias resolves to, embedded via the card_uid FK.
  target: CardTarget | null;
}

async function fetchAliases(search: string): Promise<Alias[]> {
  const supabase = createClient();
  let q = supabase
    .from("pokemon_card_aliases")
    .select("alias_id, regional_name, set_code, card_number, misc_info, language, card_uid, target:pokemon_card_definitions(regional_name, set_code, card_number, misc_info)")
    .order("regional_name")
    .limit(300);
  const s = search.trim();
  if (s) {
    const safe = s.replace(/[%,]/g, " ");
    q = q.or(`regional_name.ilike.%${safe}%,set_code.ilike.%${safe}%,card_number.ilike.%${safe}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Alias[];
}

const BLANK = { regional_name: "", set_code: "", card_number: "", misc_info: "", language: "jp", platform: "tcgplayer", external_id: "" };

export default function PokemonAliasesTab() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);
  const { data, error, isLoading, retry } = useSupabaseQuery(["pokemon-aliases", debounced], () => fetchAliases(debounced));
  const aliases = data ?? [];
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const set = (k: keyof typeof BLANK, v: string) => setForm((p) => ({ ...p, [k]: v }));

  async function add() {
    if (!form.regional_name.trim() || !form.external_id.trim()) {
      setFormErr(t("aliases.required"));
      return;
    }
    setBusy(true);
    setFormErr(null);
    const { error: e } = await createClient().rpc("card_index_bind_pokemon_alias", {
      p_regional_name: form.regional_name, p_set_code: form.set_code, p_card_number: form.card_number,
      p_misc_info: form.misc_info, p_language: form.language, p_platform: form.platform, p_external_id: form.external_id,
    });
    setBusy(false);
    if (e) { setFormErr(e.message); return; }
    setForm({ ...BLANK });
    retry();
  }

  async function remove(id: number) {
    setBusy(true);
    await createClient().rpc("card_index_remove_pokemon_alias", { p_alias_id: id });
    setBusy(false);
    retry();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        {!isLoading && (
          <span className="text-sm text-muted-foreground">{t("aliases.count").replace("{n}", String(aliases.length))}</span>
        )}
        <div className="relative w-72">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder={t("aliases.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("aliases.hint")}</p>

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
            <Plus className="size-4" /> {t("aliases.add")}
          </Button>
        </div>
        {formErr && <p className="mt-1 text-sm text-destructive">{formErr}</p>}
      </div>

      {error ? (
        <QueryError onRetry={retry} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : aliases.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("aliases.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-[58%] px-3 py-2 font-medium">{t("aliases.colSource")}</th>
                <th className="w-[32%] px-3 py-2 font-medium">{t("aliases.colTarget")}</th>
                <th className="w-[10%] px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {aliases.map((a) => (
                <tr key={a.alias_id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-medium">{a.regional_name}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {[a.set_code !== "UNKNOWN" ? a.set_code : null, a.card_number, a.misc_info !== "UNKNOWN" ? a.misc_info : null, a.language]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {a.target ? (
                      <>
                        <span className="font-medium">{a.target.regional_name}</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          {[a.target.set_code !== "UNKNOWN" ? a.target.set_code : null, a.target.card_number, a.target.misc_info !== "UNKNOWN" ? a.target.misc_info : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="ghost" size="icon" className="size-7" disabled={busy} onClick={() => remove(a.alias_id)} title={t("aliases.remove")}>
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

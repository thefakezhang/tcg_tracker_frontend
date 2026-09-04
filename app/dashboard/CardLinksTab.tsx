"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { normalizePlatformID, platformSearchURL, platformUrl } from "@/lib/platform-url";
import { ZoomableImage } from "@/components/ui/zoomable-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useDebouncedValue } from "./use-card-data";
import { CardIndexMutationError } from "./PokemonCardIndex";
import { POKEMON_INDEX_LINK_COVERAGE_VIEW } from "./pokemon-index-visibility";

// The link worklist: cards the catalog holds but no platform can price, because
// nothing points at them. It replaces the artofpkm review tab, which answered
// the opposite question ("which cards are we missing") and is retired.
//
// It reads pokemon_card_link_coverage_v (000310), whose is_numbered column
// carries the split the work divides along. A NUMBERED card can be matched
// automatically - (set_code, card_number) keys it, which is what the snkrdunk
// harvest and match-gen run on - so those are not a person's job. A card whose
// number is a stand-in (旧裏 on old-back cards, DPBP#nnn, a bare set code on
// unnumbered promos like XY-P, UNKNOWN) identifies no position within its set,
// so no matcher can ever key on it and the id has to be bound by hand. That is
// this tab.
//
// Work runs set by set, because the operator searches a platform per set and
// the id is easiest to read off a set's own listing page.

const PLATFORMS = ["tcgplayer", "snkrdunk"] as const;
type Platform = (typeof PLATFORMS)[number];

const PAGE = 300;

export interface CoverageRow {
  card_id: number;
  card_uid: string;
  regional_name: string;
  english_name: string | null;
  set_code: string;
  card_number: string;
  misc_info: string | null;
  image_url: string | null;
  set_name: string | null;
  is_numbered: boolean;
  tcgplayer_id: string | null;
  snkrdunk_id: string | null;
  has_tcgplayer: boolean;
  has_snkrdunk: boolean;
}

// Which sets still hold unnumbered cards missing an id, and how many. The
// operator picks a set and works it; a count of zero means the set is finished
// and it leaves the list on the next load.
export async function fetchSetsNeedingLinks(platform: Platform | "any"): Promise<{ set_code: string; set_name: string | null; n: number }[]> {
  const supabase = createClient();
  let q = supabase
    .from(POKEMON_INDEX_LINK_COVERAGE_VIEW)
    .select("set_code, set_name")
    .eq("is_numbered", false)
    .limit(5000);
  if (platform === "any") q = q.or("has_tcgplayer.eq.false,has_snkrdunk.eq.false");
  else q = q.eq(platform === "tcgplayer" ? "has_tcgplayer" : "has_snkrdunk", false);

  const { data, error } = await q;
  if (error) throw error;
  const counts = new Map<string, { set_code: string; set_name: string | null; n: number }>();
  for (const row of (data ?? []) as { set_code: string; set_name: string | null }[]) {
    const seen = counts.get(row.set_code);
    if (seen) seen.n += 1;
    else counts.set(row.set_code, { set_code: row.set_code, set_name: row.set_name, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n);
}

export async function fetchCards(setCode: string, platform: Platform | "any", search: string): Promise<CoverageRow[]> {
  const supabase = createClient();
  let q = supabase
    .from(POKEMON_INDEX_LINK_COVERAGE_VIEW)
    .select("card_id, card_uid, regional_name, english_name, set_code, card_number, misc_info, image_url, set_name, is_numbered, tcgplayer_id, snkrdunk_id, has_tcgplayer, has_snkrdunk")
    .eq("is_numbered", false)
    .eq("set_code", setCode)
    .order("regional_name")
    .limit(PAGE);
  if (platform === "any") q = q.or("has_tcgplayer.eq.false,has_snkrdunk.eq.false");
  else q = q.eq(platform === "tcgplayer" ? "has_tcgplayer" : "has_snkrdunk", false);
  const s = search.trim();
  if (s) q = q.or(`regional_name.ilike.%${s}%,english_name.ilike.%${s}%`);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CoverageRow[];
}

export default function CardLinksTab() {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState<Platform | "any">("any");
  const [setCode, setSetCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const dSearch = useDebouncedValue(search, 300);
  // Rows the operator has just bound, so the list reflects the work without a
  // refetch that would reorder what they are reading.
  const [bound, setBound] = useState<Record<number, Partial<Record<Platform, string>>>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sets = useSupabaseQuery(["link-sets", platform], () => fetchSetsNeedingLinks(platform));
  const cards = useSupabaseQuery(
    setCode ? ["link-cards", setCode, platform, dSearch] : null,
    () => fetchCards(setCode as string, platform, dSearch),
  );

  const rows = useMemo(() => cards.data ?? [], [cards.data]);

  async function attach(row: CoverageRow, p: Platform, raw: string) {
    const normalized = normalizePlatformID(p, raw);
    if (normalized.invalidURL) {
      setError(t("cardIndex.linkURLInvalid"));
      return;
    }
    const id = normalized.value.trim();
    if (!id) return;
    setBusy(row.card_id);
    setError(null);
    const { error: e } = await createClient().rpc("card_index_attach_pokemon_link", {
      p_card_id: row.card_id,
      p_platform: normalized.platform,
      p_external_id: id,
    });
    setBusy(null);
    if (e) {
      setError(e.message);
      return;
    }
    setBound((prev) => ({ ...prev, [row.card_id]: { ...prev[row.card_id], [normalized.platform as Platform]: id } }));
  }

  const boundCount = Object.values(bound).reduce((n, v) => n + Object.keys(v).length, 0);

  if (sets.error) return <QueryError error={sets.error} onRetry={sets.retry} />;

  return (
    <div className="min-w-0 space-y-3">
      <p className="max-w-prose text-xs text-muted-foreground">{t("cardLinks.hint")}</p>

      <div className="flex flex-wrap items-center gap-2">
        {(["any", "tcgplayer", "snkrdunk"] as const).map((p) => (
          <Button
            key={p}
            size="sm"
            variant={platform === p ? "default" : "outline"}
            className="min-h-11 sm:min-h-8"
            onClick={() => { setPlatform(p); setSetCode(null); }}
          >
            {p === "any" ? t("cardLinks.eitherPlatform") : p}
          </Button>
        ))}
        {boundCount > 0 && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            {t("cardLinks.boundThisSession", { n: boundCount })}
          </span>
        )}
      </div>

      <CardIndexMutationError message={error} />

      {!setCode ? (
        sets.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (sets.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("cardLinks.allDone")}</p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full table-fixed text-sm">
              <thead className="hidden border-b bg-muted/40 text-left text-xs text-muted-foreground sm:table-header-group">
                <tr>
                  <th className="w-[18%] px-3 py-2 font-medium">{t("cardLinks.colSet")}</th>
                  <th className="w-[58%] px-3 py-2 font-medium">{t("cardIndex.fName")}</th>
                  <th className="w-[24%] px-3 py-2 text-right font-medium">{t("cardLinks.colNeeding")}</th>
                </tr>
              </thead>
              <tbody>
                {(sets.data ?? []).map((s) => (
                  <tr key={s.set_code} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => setSetCode(s.set_code)}>
                    <td className="px-3 py-2 font-mono text-xs">{s.set_code}</td>
                    <td className="truncate px-3 py-2">{s.set_name ?? ""}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{s.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => { setSetCode(null); setSearch(""); }}>
              {t("cardLinks.backToSets")}
            </Button>
            <span className="font-mono text-sm">{setCode}</span>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("cardLinks.search")}
              className="min-h-11 w-full sm:min-h-8 sm:w-56"
            />
          </div>

          {cards.error ? (
            <QueryError error={cards.error} onRetry={cards.retry} />
          ) : cards.isLoading && !cards.data ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("cardLinks.setDone")}</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full table-fixed text-sm">
                <thead className="hidden border-b bg-muted/40 text-left text-xs text-muted-foreground sm:table-header-group">
                  <tr>
                    <th className="w-[36%] px-3 py-2 font-medium">{t("cardIndex.colCard")}</th>
                    <th className="w-[32%] px-3 py-2 font-medium">tcgplayer</th>
                    <th className="w-[32%] px-3 py-2 font-medium">snkrdunk</th>
                  </tr>
                </thead>
                <tbody className="block sm:table-row-group">
                  {rows.map((row) => (
                    <tr key={row.card_id} className="block border-b p-3 last:border-0 sm:table-row sm:p-0">
                      <td className="block p-0 pb-2 sm:table-cell sm:px-3 sm:py-2">
                        <div className="flex items-center gap-3">
                          {row.image_url ? (
                            <ZoomableImage src={row.image_url} className="h-10 w-7 shrink-0 rounded border object-cover" />
                          ) : (
                            <div className="h-10 w-7 shrink-0 rounded border bg-muted" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-medium">{row.regional_name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {[row.english_name, row.card_number, row.misc_info !== "UNKNOWN" ? row.misc_info : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </div>
                        </div>
                      </td>
                      {PLATFORMS.map((p) => (
                        <LinkCell
                          key={p}
                          row={row}
                          platform={p}
                          justBound={bound[row.card_id]?.[p]}
                          busy={busy === row.card_id}
                          onAttach={(raw) => attach(row, p, raw)}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length === PAGE && (
            <p className="text-xs text-muted-foreground">{t("cardLinks.pageCap", { n: PAGE })}</p>
          )}
        </div>
      )}
    </div>
  );
}

// One platform's cell: the id it already has, or a field to give it one. The
// field accepts a pasted product URL as well as a bare id - normalizePlatformID
// extracts it, the same parse the Card Index editor uses - and the search link
// opens that platform pre-filled with the card's Japanese name and set, which
// is how the operator finds the id in the first place.
function LinkCell({
  row,
  platform,
  justBound,
  busy,
  onAttach,
}: {
  row: CoverageRow;
  platform: Platform;
  justBound?: string;
  busy: boolean;
  onAttach: (raw: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const existing = justBound ?? (platform === "tcgplayer" ? row.tcgplayer_id : row.snkrdunk_id);

  if (existing) {
    const url = platformUrl(platform, existing, "single", null);
    return (
      <td className="block p-0 py-1 sm:table-cell sm:px-3 sm:py-2">
        <Badge variant="outline" className="font-mono">
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="hover:underline">
              {existing}
            </a>
          ) : (
            existing
          )}
        </Badge>
      </td>
    );
  }

  const searchURL = platformSearchURL(platform, row.regional_name, row.set_code);
  return (
    <td className="block p-0 py-1 sm:table-cell sm:px-3 sm:py-2">
      <div className="flex items-center gap-1.5">
        <Input
          className="h-11 min-w-0 flex-1 font-mono text-xs sm:h-8"
          placeholder={t("cardIndex.linkIdPlaceholder")}
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              onAttach(value);
              setValue("");
            }
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-11 shrink-0 sm:h-8"
          disabled={busy || !value.trim()}
          onClick={() => { onAttach(value); setValue(""); }}
        >
          {t("cardIndex.addLink")}
        </Button>
        {searchURL && (
          <a
            href={searchURL}
            target="_blank"
            rel="noopener noreferrer"
            title={t("cardIndex.searchOn", { platform })}
            className="shrink-0 rounded-md p-2 text-muted-foreground hover:text-foreground sm:p-1"
          >
            <ExternalLink className="size-4" />
          </a>
        )}
      </div>
    </td>
  );
}

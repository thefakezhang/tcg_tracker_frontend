"use client";

import { useEffect, useRef, useState } from "react";
import { Search, ImageOff, Pencil, Plus, Trash2, GitMerge } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";
import { externalIdMatches, smartSearchFilters } from "@/lib/card-search";
import { isOpaqueLinkID, linkChipLabel, platformShort } from "@/lib/source-labels";
import { uploadCardImage } from "@/lib/upload-card-image";
import {
  normalizePlatformID,
  platformSearchURL,
  platformUrl,
  pokemonSingleFilterPlatforms,
  pokemonSinglePlatforms,
} from "@/lib/platform-url";
import { ZoomableImage } from "@/components/ui/zoomable-image";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useDebouncedValue } from "./use-card-data";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  PokemonCuratorFlagChips,
  PokemonCuratorFlagSwitches,
  pokemonCuratorFlagValues,
  type PokemonCuratorFlagValues,
} from "./PokemonCuratorFlags";
import PokemonMatchesTab from "./PokemonMatchesTab";
import CardLinksTab from "./CardLinksTab";

// Card Index editor for pokemon SINGLES (Stage 2-A). Mirrors the sealed catalog
// surface over the card_index_*_pokemon_* RPCs so variant adds + TCGID links go
// through the UI + the durable card_uid, not hand-SQL. Platform id is a link, not
// an anchor (one id can attach to several variant cards), so link add never evicts.

// What card_index_attach_pokemon_link returns (R1). The attach resolves every
// pending candidate the card now FULLY covers, and reports an id it silently
// overwrote in that (card, platform) slot.
interface AttachReport {
  resolved: { candidate_id: number; source_name: string }[];
  replaced_id: string | null;
}

interface CardLink {
  platform_name: string;
  external_reference_id: string;
  listing_url?: string | null;
  listing_only?: boolean;
}

export function CardIndexMutationError({ message }: { message: string | null }) {
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message) errorRef.current?.focus({ preventScroll: true });
  }, [message]);

  if (!message) return null;

  return (
    <div
      ref={errorRef}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      tabIndex={-1}
      data-testid="card-index-mutation-error"
      className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-destructive"
    >
      {message}
    </div>
  );
}
export interface IndexCard {
  card_id: number;
  card_uid: string;
  english_name_version: number;
  regional_name: string;
  english_name: string | null;
  set_code: string;
  card_number: string;
  language: string;
  misc_info: string;
  image_url: string | null;
  // Manual curator flags (000093 / 000293). The Card Index is the one surface
  // that lists the WHOLE catalog, so a card with no price summary (and hence
  // invisible to the Card Browser) can still be marked here.
  is_japan_exclusive: boolean | null;
  is_cute: boolean | null;
  links: CardLink[];
}

export function pokemonEditActionLabel(
  card: Pick<IndexCard, "regional_name" | "card_number">,
  editLabel: string,
) {
  return `${editLabel} ${card.regional_name} ${card.card_number}`;
}

export const pokemonEditActionClassName = "size-11 shrink-0 sm:size-7";

const COLS = "card_id, card_uid, english_name_version, regional_name, english_name, set_code, card_number, language, misc_info, image_url, is_japan_exclusive, is_cute";
const PLATFORMS = pokemonSinglePlatforms;
const PLATFORM_SHORT: Record<string, string> = Object.fromEntries(pokemonSinglePlatforms.map((p) => [p, platformShort(p)]));
const PLATFORM_HINT_KEYS: Record<string, TranslationKey> = {
  tcgplayer: "cardIndex.linkFormat.tcgplayer",
  snkrdunk: "cardIndex.linkFormat.snkrdunk",
  pricecharting: "cardIndex.linkFormat.pricecharting",
  collectr: "cardIndex.linkFormat.collectr",
  cardladder: "cardIndex.linkFormat.cardladder",
  cardkingdom: "cardIndex.linkFormat.cardkingdom",
  shinsoku: "cardIndex.linkFormat.shinsoku",
  surugaya: "cardIndex.linkFormat.surugaya",
  expedition_gaming: "cardIndex.linkFormat.expedition",
  tcgplayer_SKU: "cardIndex.linkFormat.tcgplayerSku",
};
const selectClass = "h-9 rounded-md border bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

// Platform axis for the chip filter above the results table. Kept in sync
// with PLATFORMS/PLATFORM_SHORT above so the filter list can't drift.
const FILTERABLE_PLATFORMS = pokemonSingleFilterPlatforms;

export async function fetchIndex(
  search: string,
  limit: number,
  platforms: string[],
): Promise<{ cards: IndexCard[]; total: number }> {
  const supabase = createClient();
  const s = search.trim();
  // Text term + card_uid (full or displayed 8-hex prefix) + exact platform
  // external id - shared semantics with the curation pickers (lib/card-search).
  // Multi-word terms AND together via one chained or() per token.
  const extIds = await externalIdMatches(supabase, "pokemon_external_identifiers", "card_id", s);
  const orFilters = smartSearchFilters(
    s,
    ["regional_name", "english_name", "set_code", "card_number"],
    "card_uid",
    "card_id",
    extIds,
  );

  // When the operator selected one or more source chips, gate every card query
  // on the cards carrying an ID for at least one of those platforms. Empty
  // selection = no gate.
  //
  // This is an INNER JOIN pushed into Postgres, not a fetch-ids-then-filter
  // round trip. Reading the id list into the client cannot work here: the list
  // is sized by the data, not by a page (tcgplayer alone owns 29,849 rows), so
  // it blew PostgREST's silent 1000-row cap and gated the catalog on ~3% of its
  // ids - and because the same truncated list gated the COUNT, the header
  // agreed with the lie instead of exposing it. Sending 29,849 ids back up as a
  // `.in(...)` would also overflow the URL. See lib/supabase/select-all.ts.
  const gated = platforms.length > 0;
  // The embed exists only to filter; `platform_name` is the cheapest column
  // that makes the join expressible. !inner drops cards with no matching link.
  const gateSelect = gated ? ", pokemon_external_identifiers!inner(platform_name)" : "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyGate = (q: any) => (gated ? q.in("pokemon_external_identifiers.platform_name", platforms) : q);

  let cq = supabase.from("pokemon_card_definitions").select(`card_id${gateSelect}`, { count: "exact", head: true });
  if (s) for (const f of orFilters) cq = cq.or(f);
  cq = applyGate(cq);
  const { count: total, error: countError } = await cq;
  if (countError) throw countError;
  let q = supabase.from("pokemon_card_definitions").select(`${COLS}${gateSelect}`).order("regional_name").limit(limit);
  if (s) for (const f of orFilters) q = q.or(f);
  q = applyGate(q);
  const { data, error } = await q;
  if (error) throw error;
  // Drop the join-only embed so it can't leak into the rendered card object.
  const rows = ((data ?? []) as Record<string, unknown>[]).map(
    ({ pokemon_external_identifiers: _gate, ...r }) => r,
  ) as unknown as Omit<IndexCard, "links">[];
  const ids = rows.map((r) => r.card_id);
  const linkMap = new Map<number, CardLink[]>();
  if (ids.length) {
    // One card fans out to ~6 platform links, so a full catalog page (500) asks
    // for ~3000 rows and PostgREST silently truncates at 1000 - cards past the
    // cutoff would render with no anchors at all. selectAll pages instead.
    const [links, shinsokuLocation] = await Promise.all([
      selectAll<{ card_id: number } & CardLink>(
        () => supabase
          .from("pokemon_external_identifiers")
          .select("card_id, platform_name, external_reference_id")
          .in("card_id", ids),
        ["card_id", "platform_name"],
      ),
      supabase.from("locations").select("location_id").eq("name", "shinsoku").maybeSingle(),
    ]);
    if (shinsokuLocation.error) throw shinsokuLocation.error;
    const shinsokuURL = new Map<number, string>();
    if (shinsokuLocation.data?.location_id != null) {
      // A card can have several condition-specific Shinsoku product pages.
      // Select the cheapest current Sell row deterministically for the compact
      // Card Index chip; the detail modal continues to expose every listing.
      const rows = await selectAll<{
        card_id: number;
        condition: number | null;
        psa_grade: number | null;
        price: number;
        listing_url: string;
      }>(
        () => supabase
          .from("pokemon_market_listings")
          .select("card_id, condition, psa_grade, price, listing_url")
          .in("card_id", ids)
          .eq("location_id", shinsokuLocation.data.location_id)
          .eq("price_type", "Sell")
          .not("listing_url", "is", null),
        ["card_id", "price", "condition", "psa_grade"],
      );
      for (const row of rows) {
        if (!shinsokuURL.has(row.card_id)) shinsokuURL.set(row.card_id, row.listing_url);
      }
    }
    const shinsokuIdentityCards = new Set<number>();
    for (const l of links) {
      const arr = linkMap.get(l.card_id) ?? [];
      if (l.platform_name === "shinsoku") shinsokuIdentityCards.add(l.card_id);
      arr.push({
        platform_name: l.platform_name,
        external_reference_id: l.external_reference_id,
        listing_url: l.platform_name === "shinsoku" ? shinsokuURL.get(l.card_id) ?? null : null,
      });
      linkMap.set(l.card_id, arr);
    }
    // A current sell product is useful even when the card has not acquired a
    // Shinsoku IAP identity row yet. Keep this presentation-only link out of the
    // identity editor while still exposing it in the compact index.
    for (const [cardID, listingURL] of shinsokuURL) {
      if (shinsokuIdentityCards.has(cardID)) continue;
      const productID = listingURL.match(/\/product\/(\d+)$/)?.[1] ?? "sell";
      const arr = linkMap.get(cardID) ?? [];
      arr.push({
        platform_name: "shinsoku",
        external_reference_id: productID,
        listing_url: listingURL,
        listing_only: true,
      });
      linkMap.set(cardID, arr);
    }
  }
  return {
    cards: rows.map((r) => ({
      ...r,
      links: (linkMap.get(r.card_id) ?? []).sort((a, b) => a.platform_name.localeCompare(b.platform_name)),
    })),
    total: total ?? rows.length,
  };
}

const CATALOG_PAGE = 500;

export default function PokemonCardIndex() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"cards" | "matches" | "links">("cards");
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant={tab === "cards" ? "default" : "outline"} onClick={() => setTab("cards")}>
          {t("cardIndex.tabCards")}
        </Button>
        <Button size="sm" variant={tab === "matches" ? "default" : "outline"} onClick={() => setTab("matches")}>
          {t("cardIndex.tabMatches")}
        </Button>
        <Button size="sm" variant={tab === "links" ? "default" : "outline"} onClick={() => setTab("links")}>
          {t("cardIndex.tabLinks")}
        </Button>
      </div>
      {tab === "cards" ? <CardsTab /> : tab === "matches" ? <PokemonMatchesTab /> : <CardLinksTab />}
    </div>
  );
}

function CardsTab() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(CATALOG_PAGE);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const debounced = useDebouncedValue(search, 300);
  const platformsKey = Array.from(selectedPlatforms).sort().join(",");
  const { data, error, isLoading, retry } = useSupabaseQuery(
    ["card-index-pokemon", debounced, String(limit), platformsKey],
    () => fetchIndex(debounced, limit, Array.from(selectedPlatforms)),
  );
  const cards = data?.cards ?? [];
  const total = data?.total ?? 0;
  const [editing, setEditing] = useState<IndexCard | null>(null);
  const [creating, setCreating] = useState(false);

  function togglePlatform(p: string) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        {/* Reserve the count's row even while loading so the search group stays
            put - previously the count was `{!isLoading && ...}`, so with
            justify-between the search snapped from left to right when the count
            appeared. A min-height keeps the row height stable too. */}
        <span className="min-h-5 text-sm text-muted-foreground">
          {!isLoading &&
            t("cardIndex.countOf").replace("{shown}", String(cards.length)).replace("{total}", String(total))}
        </span>
        <div className="grid min-w-0 w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:items-end">
          <label className="min-w-0 w-full space-y-1 sm:w-auto">
            <span className="text-xs font-medium text-muted-foreground sm:sr-only">{t("cardIndex.searchLabel")}</span>
            <span className="relative block min-w-0 w-full sm:w-72">
              <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-11 pl-8 sm:h-8" placeholder={t("cardIndex.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
            </span>
          </label>
          <Button className="h-11 w-full sm:h-8 sm:w-auto" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> {t("cardIndex.newCard")}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <MultiSelectFilter
          options={FILTERABLE_PLATFORMS}
          labels={PLATFORM_SHORT}
          selected={selectedPlatforms}
          onToggle={togglePlatform}
          onClear={() => setSelectedPlatforms(new Set())}
          allLabel={t("cardIndex.sourceAll")}
          clearLabel={t("cardIndex.clearFilter")}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("cardIndex.hintPokemon")}</p>

      {error && <QueryError error={error} onRetry={retry} />}
      {isLoading && !data ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : cards.length === 0 ? (
        !error && <p className="text-sm text-muted-foreground">{t("cardIndex.empty")}</p>
      ) : (
        <div data-testid="pokemon-index-results" className="overflow-hidden rounded-md border">
          <table className="w-full table-fixed text-sm">
            <thead className="hidden border-b bg-muted/40 text-left text-xs text-muted-foreground sm:table-header-group">
              <tr>
                <th className="w-[44%] px-3 py-2 font-medium">{t("cardIndex.colCard")}</th>
                <th className="w-[14%] px-3 py-2 font-medium">{t("cardIndex.colVariant")}</th>
                <th className="w-[30%] px-3 py-2 font-medium">{t("cardIndex.colLinks")}</th>
                <th className="w-[12%] px-3 py-2 font-medium">{t("cardIndex.colUid")}</th>
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {cards.map((c) => (
                <tr key={c.card_uid} className="block border-b p-3 last:border-0 sm:table-row sm:p-0">
                  <td className="block p-0 pb-2 sm:table-cell sm:px-3 sm:py-2">
                    <div className="flex items-center gap-3">
                      {c.image_url ? (
                        <ZoomableImage src={c.image_url} className="h-10 w-7 rounded border object-cover" />
                      ) : (
                        <div className="flex h-10 w-7 items-center justify-center rounded border bg-muted">
                          <ImageOff className="size-3 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{c.regional_name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[c.english_name, c.set_code !== "UNKNOWN" ? c.set_code : null, c.card_number, c.language]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="block p-0 py-1 sm:table-cell sm:px-3 sm:py-2">
                    {/* Variant badge plus the curator flags that are set on this
                        printing; an unflagged base printing keeps the bare dash. */}
                    {(c.misc_info && c.misc_info !== "UNKNOWN") || c.is_japan_exclusive || c.is_cute ? (
                      <div className="flex flex-wrap gap-1">
                        {c.misc_info && c.misc_info !== "UNKNOWN" && <Badge variant="outline">{c.misc_info}</Badge>}
                        <PokemonCuratorFlagChips card={c} />
                      </div>
                    ) : (
                      <span className="hidden text-xs text-muted-foreground sm:inline">-</span>
                    )}
                  </td>
                  <td className="block min-w-0 p-0 py-1 sm:table-cell sm:px-3 sm:py-2">
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {c.links.length === 0 ? (
                        <span className="text-xs text-muted-foreground">{t("cardIndex.noLinks")}</span>
                      ) : (
                        c.links.map((l) => {
                          const url = platformUrl(l.platform_name, l.external_reference_id, "single", l.listing_url);
                          // Opaque keys (torecabirth row uids, identity keys)
                          // show the platform only; the raw key stays on the tooltip.
                          const opaque = isOpaqueLinkID(l.platform_name, l.external_reference_id);
                          const label = linkChipLabel(l.platform_name, l.external_reference_id);
                          const chipClass = `rounded border px-1.5 py-0.5 text-xs text-muted-foreground${opaque ? " border-dashed" : ""}`;
                          return url ? (
                            <a key={l.platform_name + l.external_reference_id} href={url} target="_blank" rel="noreferrer" title={l.external_reference_id} className={`${chipClass} hover:bg-muted`}>
                              {label}
                            </a>
                          ) : (
                            <span key={l.platform_name + l.external_reference_id} title={l.external_reference_id} className={chipClass}>
                              {label}
                            </span>
                          );
                        })
                      )}
                    </div>
                  </td>
                  <td className="mt-2 block border-t p-0 pt-2 sm:mt-0 sm:table-cell sm:border-0 sm:px-3 sm:py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{c.card_uid.slice(0, 8)}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={pokemonEditActionClassName}
                        onClick={() => setEditing(c)}
                        aria-label={pokemonEditActionLabel(c, t("cardIndex.edit"))}
                        title={t("cardIndex.edit")}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && !error && cards.length < total && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + CATALOG_PAGE)}>
            {t("cardIndex.loadMore").replace("{n}", String(Math.min(CATALOG_PAGE, total - cards.length)))}
          </Button>
        </div>
      )}

      <PokemonCardModal card={editing} open={!!editing || creating} isCreate={creating} onOpenChange={(o) => { if (!o) { setEditing(null); setCreating(false); } }} onSaved={retry} />
    </div>
  );
}

const BLANK = { regional_name: "", english_name: "", set_code: "", card_number: "", language: "jp", misc_info: "", image_url: "" };

export function pokemonEditRPCArgs(
  cardID: number,
  expectedVersion: number,
  form: typeof BLANK,
  imageURL: string,
) {
  return {
    p_card_id: cardID,
    p_expected_version: expectedVersion,
    p_regional_name: form.regional_name,
    p_english_name: form.english_name,
    p_set_code: form.set_code,
    p_card_number: form.card_number,
    p_language: form.language,
    p_misc_info: form.misc_info,
    p_image_url: imageURL,
  };
}

// Create OR edit a singles card_def + manage its platform links. All writes go
// through the SECURITY DEFINER RPCs (000116).
function PokemonCardModal({
  card,
  open,
  isCreate,
  onOpenChange,
  onSaved,
}: {
  card: IndexCard | null;
  open: boolean;
  isCreate: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // new-link inputs (create + edit)
  const [linkPlatform, setLinkPlatform] = useState("tcgplayer");
  const [linkId, setLinkId] = useState("");
  const [linkExtracted, setLinkExtracted] = useState(false);
  const [linkInvalidURL, setLinkInvalidURL] = useState(false);
  // Local mirror of the card's links. The attach flow keeps the modal OPEN (an
  // operator attaching one id usually has several), so the rendered list cannot
  // come from the `card` prop - that snapshot goes stale the moment we attach.
  const [links, setLinks] = useState<CardLink[]>((card?.links ?? []).filter((l) => !l.listing_only));
  // What the last attach actually did: which queued candidates it answered, and
  // whether it silently overwrote an id that was already in that slot.
  const [attachInfo, setAttachInfo] = useState<AttachReport | null>(null);
  // On CREATE a card can be given several external ids: staged here, then
  // attached after the card row exists (the create RPC only seeds one anchor).
  const [newLinks, setNewLinks] = useState<{ platform: string; id: string }[]>([]);
  // uploadFile is held in memory until save() succeeds; we only touch storage
  // AFTER the RPC returns a card_id so we never leak orphan objects from
  // abandoned form dialogs.
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  // Merge/delete (edit only). Merge folds THIS card into a chosen survivor and
  // deletes this one; delete removes a spurious card outright.
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeResults, setMergeResults] = useState<IndexCard[]>([]);
  const [mergeTarget, setMergeTarget] = useState<IndexCard | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Create a sibling edition variant (same identity, different misc) - for the
  // edition-collapse case where the catalog has only one of 1ED / アンリミ.
  const [variantMisc, setVariantMisc] = useState("");
  // Curator flags (edit only). Each switch writes through its own RPC the
  // moment it is toggled - like link attach, and unlike the identity fields
  // above which wait for Save - so the local mirror is what the modal renders
  // and `onSaved` refreshes the list's chips behind it.
  const [flags, setFlags] = useState<PokemonCuratorFlagValues>(pokemonCuratorFlagValues(card));
  const set = (k: keyof typeof BLANK, v: string) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    setError(null);
    setLinkId("");
    setLinkExtracted(false);
    setLinkInvalidURL(false);
    setLinkPlatform("tcgplayer");
    setNewLinks([]);
    setUploadFile(null);
    setLinks((card?.links ?? []).filter((l) => !l.listing_only));
    setAttachInfo(null);
    if (isCreate || !card) setForm({ ...BLANK });
    else setForm({
      regional_name: card.regional_name ?? "",
      english_name: card.english_name ?? "",
      set_code: card.set_code === "UNKNOWN" ? "" : card.set_code ?? "",
      card_number: card.card_number ?? "",
      language: card.language ?? "jp",
      misc_info: card.misc_info === "UNKNOWN" ? "" : card.misc_info ?? "",
      image_url: card.image_url ?? "",
    });
    setMergeSearch("");
    setMergeResults([]);
    setMergeTarget(null);
    setConfirmDelete(false);
    setVariantMisc("");
    setFlags(pokemonCuratorFlagValues(isCreate ? null : card));
  }, [card, isCreate, open]);

  // Debounced search for a merge target (any card but this one).
  useEffect(() => {
    const q = mergeSearch.trim();
    if (!q || !card || mergeTarget) { setMergeResults([]); return; }
    const timer = setTimeout(async () => {
      const supabase = createClient();
      // Same resolver as the index search box (lib/card-search): name / set /
      // number text, the displayed 8-hex uid prefix or a full uuid, and exact
      // platform external ids - a merge target is most often picked by uid.
      const extIds = await externalIdMatches(supabase, "pokemon_external_identifiers", "card_id", q);
      let mq = supabase
        .from("pokemon_card_definitions")
        .select("card_id, card_uid, english_name_version, regional_name, english_name, set_code, card_number, language, misc_info, image_url")
        .neq("card_uid", card.card_uid);
      for (const f of smartSearchFilters(q, ["regional_name", "english_name", "set_code", "card_number"], "card_uid", "card_id", extIds)) mq = mq.or(f);
      const { data } = await mq.limit(8);
      setMergeResults(((data as IndexCard[]) ?? []).map((c) => ({ ...c, links: [] })));
    }, 250);
    return () => clearTimeout(timer);
  }, [mergeSearch, card, mergeTarget]);

  async function save() {
    if (!form.regional_name.trim()) { setError(t("cardIndex.nameRequired")); return; }
    if (linkInvalidURL) { setError(t("cardIndex.linkURLInvalid")); return; }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    let rpcError: { message: string } | null = null;
    let cardIdForUpload: number | null = null;
    let expectedEditVersion = card?.english_name_version ?? 0;
    if (isCreate) {
      // Every staged link, plus a not-yet-added one still in the input row.
      const staged = [...newLinks, ...(linkId.trim() ? [{ platform: linkPlatform, id: linkId.trim() }] : [])];
      const res = await supabase.rpc("card_index_create_pokemon_card", {
        p_regional_name: form.regional_name, p_english_name: form.english_name, p_set_code: form.set_code,
        p_card_number: form.card_number, p_language: form.language, p_misc_info: form.misc_info,
        p_platform: staged[0]?.platform ?? null, p_external_id: staged[0]?.id ?? null,
        p_image_url: form.image_url.trim() || null,
      });
      rpcError = res.error;
      if (typeof res.data === "number") cardIdForUpload = res.data;
      // The create RPC seeds the first anchor; attach any remaining links now
      // that the card row exists. Stop on the first error so it surfaces.
      if (!rpcError && cardIdForUpload != null) {
        for (const l of staged.slice(1)) {
          const { error: ae } = await supabase.rpc("card_index_attach_pokemon_link", {
            p_card_id: cardIdForUpload, p_platform: l.platform, p_external_id: l.id,
          });
          if (ae) { rpcError = ae; break; }
        }
      }
    } else if (card) {
      const editResult = await supabase.rpc("card_index_edit_pokemon_card", {
        ...pokemonEditRPCArgs(card.card_id, expectedEditVersion, form, form.image_url.trim()),
      });
      rpcError = editResult.error;
      const report = editResult.data as { status?: string; version?: number } | null;
      if (!rpcError && report?.status === "version_conflict") {
        rpcError = { message: t("cardIndex.versionConflict") };
      } else if (!rpcError && typeof report?.version === "number") {
        expectedEditVersion = report.version;
      }
      cardIdForUpload = card.card_id;
    }
    if (rpcError) { setBusy(false); setError(rpcError.message); return; }

    // Only touch Supabase Storage AFTER the RPC has committed the row so a
    // failed save doesn't leak an orphan object.
    if (uploadFile && cardIdForUpload != null) {
      const up = await uploadCardImage({ game: "pokemon", id: cardIdForUpload, file: uploadFile });
      if ("error" in up) { setBusy(false); setError(`Upload: ${up.error}`); return; }
      if (isCreate) {
        const versionResult = await supabase
          .from("pokemon_card_definitions")
          .select("english_name_version")
          .eq("card_id", cardIdForUpload)
          .single();
        if (versionResult.error) { setBusy(false); setError(versionResult.error.message); return; }
        expectedEditVersion = Number(versionResult.data?.english_name_version ?? 0);
      }
      const imageResult = await supabase.rpc("card_index_edit_pokemon_card", {
        ...pokemonEditRPCArgs(cardIdForUpload, expectedEditVersion, form, up.url),
      });
      if (imageResult.error) { setBusy(false); setError(`Set image_url: ${imageResult.error.message}`); return; }
      const imageReport = imageResult.data as { status?: string } | null;
      if (imageReport?.status === "version_conflict") {
        setBusy(false);
        setError(t("cardIndex.versionConflict"));
        return;
      }
    }

    setBusy(false);
    onSaved();
    onOpenChange(false);
  }

  async function addLink() {
    if (!card || !linkId.trim()) return;
    const id = linkId.trim();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: e } = await supabase.rpc("card_index_attach_pokemon_link", {
      p_card_id: card.card_id, p_platform: linkPlatform, p_external_id: id,
    });
    setBusy(false);
    if (e) { setError(e.message); return; }
    // Mirror the upsert locally: one id per (card, platform).
    setLinks((prev) => [...prev.filter((l) => l.platform_name !== linkPlatform), { platform_name: linkPlatform, external_reference_id: id }]);
    setAttachInfo((data ?? null) as AttachReport | null);
    setLinkId("");
    setLinkExtracted(false);
    setLinkInvalidURL(false);
    onSaved();
    // Deliberately NOT closing: the attach may have answered queued candidates
    // or replaced an existing id, and closing would throw that report away
    // before the operator ever sees it.
  }

  async function removeLink(platform: string) {
    if (!card) return;
    setBusy(true);
    const supabase = createClient();
    const { error: e } = await supabase.rpc("card_index_remove_pokemon_link", { p_card_id: card.card_id, p_platform: platform });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setLinks((prev) => prev.filter((l) => l.platform_name !== platform));
    setAttachInfo(null);
    onSaved();
  }

  // Merge THIS card into the chosen survivor (moves links/listings/inventory,
  // adds redirect aliases, deletes this card). Server-side RPC 000172.
  async function doMerge() {
    if (!card || !mergeTarget) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.rpc("card_index_merge_pokemon_card", {
      p_from_uid: card.card_uid, p_into_uid: mergeTarget.card_uid,
    });
    setBusy(false);
    if (e) { setError(e.message); return; }
    onSaved();
    onOpenChange(false);
  }

  // Delete a spurious card. The RPC refuses if the card carries inventory/sales
  // (that message surfaces here so the curator merges instead).
  async function doDelete() {
    if (!card) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.rpc("card_index_delete_pokemon_card", { p_card_uid: card.card_uid });
    setBusy(false);
    if (e) { setError(e.message); setConfirmDelete(false); return; }
    onSaved();
    onOpenChange(false);
  }

  // Create a sibling card with THIS card's identity but a different misc - the
  // missing edition (e.g. アンリミ next to a 1ED, or vice versa) that a source
  // needs so its slabs stop collapsing onto the one existing printing.
  async function doCreateVariant() {
    if (!card || !variantMisc.trim()) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: e } = await supabase.rpc("card_index_create_pokemon_card", {
      p_regional_name: form.regional_name, p_english_name: form.english_name,
      p_set_code: form.set_code, p_card_number: form.card_number, p_language: form.language,
      p_misc_info: variantMisc.trim(),
      p_platform: null, p_external_id: null,
      p_image_url: form.image_url.trim() || null,
    });
    setBusy(false);
    if (e) { setError(e.message); return; }
    if (data == null) { setError(t("cardIndex.variantExists")); return; }
    onSaved();
    onOpenChange(false);
  }

  const searchURL = platformSearchURL(
    linkPlatform,
    isCreate ? form.regional_name : card?.regional_name ?? "",
    isCreate ? form.set_code : card?.set_code ?? "",
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isCreate ? t("cardIndex.createTitlePokemon") : t("cardIndex.editTitlePokemon")}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-1 [&_input]:h-11 [&_select]:h-11 sm:[&_input]:h-8 sm:[&_select]:h-9">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label>{t("cardIndex.fName")}</Label>
            <Input value={form.regional_name} onChange={(e) => set("regional_name", e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>{t("cardIndex.fEnglish")}</Label>
            <Input value={form.english_name} onChange={(e) => set("english_name", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("cardIndex.fSet")}</Label>
            <Input value={form.set_code} onChange={(e) => set("set_code", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("cardIndex.fNumber")}</Label>
            <Input value={form.card_number} onChange={(e) => set("card_number", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("cardIndex.fLanguage")}</Label>
            <Input value={form.language} onChange={(e) => set("language", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("cardIndex.fMisc")}</Label>
            <Input value={form.misc_info} onChange={(e) => set("misc_info", e.target.value)} placeholder="ミラー, 1ED, …" />
          </div>
          {/* image_url row: paste a URL OR upload a file. Uploaded file is
              held in memory until Save; on save the RPC returns a card_id
              and we upload to {game}/{card_uid}/user_{ts}.{ext} in Supabase
              Storage, then set image_url to the resulting public URL. */}
          <div className="space-y-1 sm:col-span-2">
            <Label>{t("cardIndex.fImageUrl")}</Label>
            <div className="flex items-center gap-2">
              <Input
                className="flex-1"
                value={form.image_url}
                onChange={(e) => set("image_url", e.target.value)}
                placeholder="https://..."
                disabled={uploadFile !== null}
              />
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="w-40"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
              {(uploadFile || form.image_url.trim()) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={uploadFile ? URL.createObjectURL(uploadFile) : form.image_url.trim()}
                  alt="preview"
                  className="h-14 w-10 rounded border object-cover"
                />
              )}
            </div>
            {uploadFile && (
              <p className="text-xs text-muted-foreground">
                {uploadFile.name} - uploads on save
              </p>
            )}
          </div>
        </div>

        {/* Curator flags (edit only): the Card Index is the one surface that
            reaches cards with no price summary, which the Card Browser (and so
            the Card Detail Modal) never lists. Same switches, same RPCs. */}
        {!isCreate && card && (
          <div className="space-y-2 border-t pt-3">
            <Label>{t("cardIndex.flagsTitle")}</Label>
            <div className="flex flex-wrap items-center gap-2" data-testid="pokemon-index-curator-flags">
              <PokemonCuratorFlagSwitches
                cardId={card.card_id}
                values={flags}
                onChange={(flag, value) => {
                  setFlags((prev) => ({ ...prev, [flag]: value }));
                  onSaved();
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("cardIndex.flagsHint")}</p>
          </div>
        )}

        {/* Links: on create, one optional anchor; on edit, list + add/remove. */}
        <div className="space-y-2 border-t pt-3">
          <Label>{t("cardIndex.links")}</Label>
          {!isCreate && card && links.length > 0 && (
            <div className="space-y-1">
              {links.map((l) => (
                <div key={l.platform_name} className="flex items-center gap-2 text-sm">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">{PLATFORM_SHORT[l.platform_name] ?? l.platform_name}</span>
                  <span className="flex-1 truncate font-mono text-xs">{l.external_reference_id}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={busy}
                    onClick={() => removeLink(l.platform_name)}
                    aria-label={`${t("cardIndex.removeLink")}: ${PLATFORM_SHORT[l.platform_name] ?? l.platform_name}`}
                    title={`${t("cardIndex.removeLink")}: ${PLATFORM_SHORT[l.platform_name] ?? l.platform_name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {/* Links staged for a new card (create only). The create RPC seeds the
              first; save() attaches the rest. */}
          {isCreate && newLinks.length > 0 && (
            <div className="space-y-1">
              {newLinks.map((l, i) => (
                <div key={l.platform + l.id + i} className="flex items-center gap-2 text-sm">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">{PLATFORM_SHORT[l.platform] ?? l.platform}</span>
                  <span className="flex-1 truncate font-mono text-xs">{l.id}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={busy}
                    onClick={() => setNewLinks((p) => p.filter((_, j) => j !== i))}
                    aria-label={`${t("cardIndex.removeLink")}: ${PLATFORM_SHORT[l.platform] ?? l.platform}`}
                    title={`${t("cardIndex.removeLink")}: ${PLATFORM_SHORT[l.platform] ?? l.platform}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <select
              className={`${selectClass} w-28`}
              value={linkPlatform}
              onChange={(e) => {
                setLinkPlatform(e.target.value);
                setLinkExtracted(false);
              }}
            >
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <Input
              className="flex-1"
              placeholder={t("cardIndex.linkIdPlaceholder")}
              value={linkId}
              aria-invalid={linkInvalidURL}
              onChange={(e) => {
                const normalized = normalizePlatformID(linkPlatform, e.target.value);
                setLinkPlatform(normalized.platform);
                setLinkId(normalized.value);
                setLinkExtracted(normalized.extracted);
                setLinkInvalidURL(normalized.invalidURL);
              }}
            />
            {/* Create stages the link into the list; edit attaches it to the
                existing card immediately (existing behavior). */}
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !linkId.trim() || linkInvalidURL}
              onClick={
                isCreate
                  ? () => {
                      setNewLinks((p) => [...p, { platform: linkPlatform, id: linkId.trim() }]);
                      setLinkId("");
                      setLinkExtracted(false);
                      setLinkInvalidURL(false);
                    }
                  : addLink
              }
            >
              {t("cardIndex.addLink")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{t(PLATFORM_HINT_KEYS[linkPlatform] ?? "cardIndex.linkFormat.generic")}</span>
            {searchURL && (
              <a
                className="underline underline-offset-2 hover:text-foreground"
                href={searchURL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("cardIndex.searchOn", { platform: linkPlatform })}
              </a>
            )}
          </div>
          {linkExtracted && (
            <p className="text-xs text-emerald-600 dark:text-emerald-500">
              {t("cardIndex.idExtracted", { platform: linkPlatform })}
            </p>
          )}
          {linkInvalidURL && (
            <p className="text-xs text-destructive">{t("cardIndex.linkURLInvalid")}</p>
          )}
          {attachInfo?.replaced_id && (
            <p className="text-xs text-amber-600 dark:text-amber-500">
              {t("cardIndex.attachReplaced")}{" "}
              <span className="select-all font-mono">{attachInfo.replaced_id}</span>
            </p>
          )}
          {attachInfo && attachInfo.resolved.length > 0 && (
            <p className="text-xs text-emerald-600 dark:text-emerald-500">
              {t("cardIndex.attachResolved").replace("{n}", String(attachInfo.resolved.length))}{" "}
              {attachInfo.resolved.map((r) => r.source_name).join(", ")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{isCreate ? t("cardIndex.anchorHint") : t("cardIndex.linkHintPokemon")}</p>
        </div>

        {/* Create an edition variant (edit only): a sibling card sharing this
            identity but a different misc - the missing 1ED/アンリミ printing. */}
        {!isCreate && card && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Plus className="size-3.5" /> {t("cardIndex.createVariantTitle")}
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="flex-1"
                placeholder={t("cardIndex.createVariantPlaceholder")}
                value={variantMisc}
                onChange={(e) => setVariantMisc(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doCreateVariant(); }}
              />
              <Button variant="outline" size="sm" disabled={busy || !variantMisc.trim()} onClick={doCreateVariant}>
                {t("cardIndex.createVariant")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("cardIndex.createVariantHint")}</p>
          </div>
        )}

        {/* Danger zone (edit only): merge this card into a survivor, or delete a
            spurious card. Both go through the SECURITY DEFINER RPCs (000172). */}
        {!isCreate && card && (
          <div className="space-y-3 rounded-md border border-destructive/40 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <GitMerge className="size-3.5" /> {t("cardIndex.mergeTitle")}
            </div>
            {mergeTarget ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm">
                  {t("cardIndex.mergeInto")}: <span className="font-medium">{mergeTarget.regional_name}</span>
                  <span className="ml-1 text-xs text-muted-foreground">{mergeTarget.set_code} {mergeTarget.card_number} {mergeTarget.misc_info}</span>
                </span>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setMergeTarget(null)}>{t("common.cancel")}</Button>
                <Button variant="destructive" size="sm" disabled={busy} onClick={doMerge}>{t("cardIndex.mergeConfirm")}</Button>
              </div>
            ) : (
              <div className="space-y-1">
                <Input placeholder={t("cardIndex.mergeSearchPokemon")} value={mergeSearch} onChange={(e) => setMergeSearch(e.target.value)} />
                {mergeResults.length > 0 && (
                  <div className="max-h-40 overflow-auto rounded border">
                    {mergeResults.map((r) => (
                      <button key={r.card_uid} type="button"
                        className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-muted"
                        onClick={() => { setMergeTarget(r); setMergeResults([]); setMergeSearch(""); }}>
                        <span className="flex-1 truncate">{r.regional_name}{r.english_name ? ` / ${r.english_name}` : ""}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{r.set_code} {r.card_number} {r.misc_info}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{t("cardIndex.mergeHintPokemon")}</p>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-destructive/20 pt-2">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t("cardIndex.deleteConfirm")}</span>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</Button>
                  <Button variant="destructive" size="sm" disabled={busy} onClick={doDelete}>
                    <Trash2 className="size-3.5" /> {t("cardIndex.delete")}
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="size-3.5" /> {t("cardIndex.deleteCard")}
                </Button>
              )}
            </div>
          </div>
        )}
        </div>
        <div className="sticky bottom-0 z-10 space-y-2 bg-background pt-2">
          <CardIndexMutationError message={error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
            <Button onClick={save} disabled={busy || !form.regional_name.trim()}>
              {busy ? t("common.saving") : isCreate ? t("cardIndex.create") : t("common.save")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

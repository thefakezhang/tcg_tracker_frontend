"use client";

import { useEffect, useState } from "react";
import { Search, ImageOff, Pencil, Plus, Trash2, GitMerge } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";
import { uploadCardImage } from "@/lib/upload-card-image";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useDebouncedValue } from "./use-card-data";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import PokemonAliasesTab from "./PokemonAliasesTab";

// Card Index editor for pokemon SINGLES (Stage 2-A). Mirrors the sealed catalog
// surface over the card_index_*_pokemon_* RPCs so variant adds + TCGID links go
// through the UI + the durable card_uid, not hand-SQL. Platform id is a link, not
// an anchor (one id can attach to several variant cards), so link add never evicts.

interface CardLink {
  platform_name: string;
  external_reference_id: string;
}
interface IndexCard {
  card_id: number;
  card_uid: string;
  regional_name: string;
  english_name: string | null;
  set_code: string;
  card_number: string;
  language: string;
  misc_info: string;
  image_url: string | null;
  links: CardLink[];
}

const COLS = "card_id, card_uid, regional_name, english_name, set_code, card_number, language, misc_info, image_url";
const PLATFORMS = ["tcgplayer", "snkrdunk", "pricecharting", "collectr", "cardladder", "surugaya", "expedition_gaming", "tcgplayer_SKU"];
const PLATFORM_SHORT: Record<string, string> = { tcgplayer: "TCG", snkrdunk: "SNKR", pricecharting: "PC", collectr: "COLL", cardladder: "CL", surugaya: "SRG", expedition_gaming: "EXP", tcgplayer_SKU: "SKU" };
const selectClass = "h-9 rounded-md border bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

function tcgURL(platform: string, id: string): string | null {
  if (platform === "tcgplayer") return `https://www.tcgplayer.com/product/${id}`;
  if (platform === "pricecharting") return `https://www.pricecharting.com/game/${id}`;
  return null;
}

// Platform axis for the chip filter above the results table. Kept in sync
// with PLATFORMS/PLATFORM_SHORT above so the filter list can't drift.
const FILTERABLE_PLATFORMS = ["tcgplayer", "snkrdunk", "pricecharting", "collectr", "cardladder", "surugaya", "expedition_gaming"] as const;

async function fetchIndex(
  search: string,
  limit: number,
  platforms: string[],
): Promise<{ cards: IndexCard[]; total: number }> {
  const supabase = createClient();
  const s = search.trim();
  const safe = s.replace(/[%,]/g, " ");
  const orFilter = `regional_name.ilike.%${safe}%,english_name.ilike.%${safe}%,set_code.ilike.%${safe}%,card_number.ilike.%${safe}%`;

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
  if (s) cq = cq.or(orFilter);
  cq = applyGate(cq);
  const { count: total } = await cq;
  let q = supabase.from("pokemon_card_definitions").select(`${COLS}${gateSelect}`).order("regional_name").limit(limit);
  if (s) q = q.or(orFilter);
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
    const links = await selectAll<{ card_id: number } & CardLink>(
      () => supabase
        .from("pokemon_external_identifiers")
        .select("card_id, platform_name, external_reference_id")
        .in("card_id", ids),
      ["card_id", "platform_name"],
    );
    for (const l of links) {
      const arr = linkMap.get(l.card_id) ?? [];
      arr.push({ platform_name: l.platform_name, external_reference_id: l.external_reference_id });
      linkMap.set(l.card_id, arr);
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
  const [tab, setTab] = useState<"cards" | "aliases">("cards");
  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        <Button size="sm" variant={tab === "cards" ? "default" : "outline"} onClick={() => setTab("cards")}>
          {t("cardIndex.tabCards")}
        </Button>
        <Button size="sm" variant={tab === "aliases" ? "default" : "outline"} onClick={() => setTab("aliases")}>
          {t("cardIndex.tabAliases")}
        </Button>
      </div>
      {tab === "cards" ? <CardsTab /> : <PokemonAliasesTab />}
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        {!isLoading && (
          <span className="text-sm text-muted-foreground">
            {t("cardIndex.countOf").replace("{shown}", String(cards.length)).replace("{total}", String(total))}
          </span>
        )}
        <div className="flex items-center gap-2">
          <div className="relative w-72">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder={t("cardIndex.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Button onClick={() => setCreating(true)}>
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

      {error ? (
        <QueryError onRetry={retry} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("cardIndex.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-[44%] px-3 py-2 font-medium">{t("cardIndex.colCard")}</th>
                <th className="w-[14%] px-3 py-2 font-medium">{t("cardIndex.colVariant")}</th>
                <th className="w-[30%] px-3 py-2 font-medium">{t("cardIndex.colLinks")}</th>
                <th className="w-[12%] px-3 py-2 font-medium">{t("cardIndex.colUid")}</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.card_uid} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      {c.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.image_url} alt="" className="h-10 w-7 rounded border object-cover" />
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
                  <td className="px-3 py-2">
                    {c.misc_info && c.misc_info !== "UNKNOWN" ? (
                      <Badge variant="outline">{c.misc_info}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {c.links.length === 0 ? (
                        <span className="text-xs text-muted-foreground">{t("cardIndex.noLinks")}</span>
                      ) : (
                        c.links.map((l) => {
                          const url = tcgURL(l.platform_name, l.external_reference_id);
                          const label = `${PLATFORM_SHORT[l.platform_name] ?? l.platform_name} ${l.external_reference_id}`;
                          return url ? (
                            <a key={l.platform_name + l.external_reference_id} href={url} target="_blank" rel="noreferrer" className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted">
                              {label}
                            </a>
                          ) : (
                            <span key={l.platform_name + l.external_reference_id} className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                              {label}
                            </span>
                          );
                        })
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{c.card_uid.slice(0, 8)}</span>
                      <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => setEditing(c)} title={t("cardIndex.edit")}>
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

      {!isLoading && cards.length < total && (
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
  const set = (k: keyof typeof BLANK, v: string) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    setError(null);
    setLinkId("");
    setLinkPlatform("tcgplayer");
    setUploadFile(null);
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
  }, [card, isCreate, open]);

  // Debounced search for a merge target (any card but this one).
  useEffect(() => {
    const q = mergeSearch.trim();
    if (!q || !card || mergeTarget) { setMergeResults([]); return; }
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("pokemon_card_definitions")
        .select("card_id, card_uid, regional_name, english_name, set_code, card_number, language, misc_info, image_url")
        .or(`regional_name.ilike.%${q}%,english_name.ilike.%${q}%`)
        .neq("card_uid", card.card_uid)
        .limit(8);
      setMergeResults(((data as IndexCard[]) ?? []).map((c) => ({ ...c, links: [] })));
    }, 250);
    return () => clearTimeout(timer);
  }, [mergeSearch, card, mergeTarget]);

  async function save() {
    if (!form.regional_name.trim()) { setError(t("cardIndex.nameRequired")); return; }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    let rpcError;
    let cardIdForUpload: number | null = null;
    if (isCreate) {
      const res = await supabase.rpc("card_index_create_pokemon_card", {
        p_regional_name: form.regional_name, p_english_name: form.english_name, p_set_code: form.set_code,
        p_card_number: form.card_number, p_language: form.language, p_misc_info: form.misc_info,
        p_platform: linkId.trim() ? linkPlatform : null, p_external_id: linkId.trim() || null,
        p_image_url: form.image_url.trim() || null,
      });
      rpcError = res.error;
      if (typeof res.data === "number") cardIdForUpload = res.data;
    } else if (card) {
      ({ error: rpcError } = await supabase.rpc("card_index_edit_pokemon_card", {
        p_card_id: card.card_id, p_regional_name: form.regional_name, p_english_name: form.english_name,
        p_set_code: form.set_code, p_card_number: form.card_number, p_language: form.language, p_misc_info: form.misc_info,
        p_image_url: form.image_url.trim(),
      }));
      cardIdForUpload = card.card_id;
    }
    if (rpcError) { setBusy(false); setError(rpcError.message); return; }

    // Only touch Supabase Storage AFTER the RPC has committed the row so a
    // failed save doesn't leak an orphan object.
    if (uploadFile && cardIdForUpload != null) {
      const up = await uploadCardImage({ game: "pokemon", id: cardIdForUpload, file: uploadFile });
      if ("error" in up) { setBusy(false); setError(`Upload: ${up.error}`); return; }
      const { error: setImgErr } = await supabase.rpc("card_index_edit_pokemon_card", {
        p_card_id: cardIdForUpload, p_regional_name: form.regional_name, p_english_name: form.english_name,
        p_set_code: form.set_code, p_card_number: form.card_number, p_language: form.language,
        p_misc_info: form.misc_info, p_image_url: up.url,
      });
      if (setImgErr) { setBusy(false); setError(`Set image_url: ${setImgErr.message}`); return; }
    }

    setBusy(false);
    onSaved();
    onOpenChange(false);
  }

  async function addLink() {
    if (!card || !linkId.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { error: e } = await supabase.rpc("card_index_attach_pokemon_link", {
      p_card_id: card.card_id, p_platform: linkPlatform, p_external_id: linkId.trim(),
    });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setLinkId("");
    onSaved();
    onOpenChange(false);
  }

  async function removeLink(platform: string) {
    if (!card) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.rpc("card_index_remove_pokemon_link", { p_card_id: card.card_id, p_platform: platform });
    setBusy(false);
    onSaved();
    onOpenChange(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isCreate ? t("cardIndex.createTitlePokemon") : t("cardIndex.editTitlePokemon")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label>{t("cardIndex.fName")}</Label>
            <Input value={form.regional_name} onChange={(e) => set("regional_name", e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
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
          <div className="col-span-2 space-y-1">
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

        {/* Links: on create, one optional anchor; on edit, list + add/remove. */}
        <div className="space-y-2 border-t pt-3">
          <Label>{t("cardIndex.links")}</Label>
          {!isCreate && card && card.links.length > 0 && (
            <div className="space-y-1">
              {card.links.map((l) => (
                <div key={l.platform_name} className="flex items-center gap-2 text-sm">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">{PLATFORM_SHORT[l.platform_name] ?? l.platform_name}</span>
                  <span className="flex-1 truncate font-mono text-xs">{l.external_reference_id}</span>
                  <Button variant="ghost" size="icon" className="size-7" disabled={busy} onClick={() => removeLink(l.platform_name)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <select className={`${selectClass} w-28`} value={linkPlatform} onChange={(e) => setLinkPlatform(e.target.value)}>
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <Input className="flex-1" placeholder={t("cardIndex.linkIdPlaceholder")} value={linkId} onChange={(e) => setLinkId(e.target.value)} />
            {!isCreate && (
              <Button variant="outline" size="sm" disabled={busy || !linkId.trim()} onClick={addLink}>
                {t("cardIndex.addLink")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{isCreate ? t("cardIndex.anchorHint") : t("cardIndex.linkHintPokemon")}</p>
        </div>

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

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={busy || !form.regional_name.trim()}>
            {busy ? t("common.saving") : isCreate ? t("cardIndex.create") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Search, ImageOff, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";
import { externalIdMatches, searchOrFilter } from "@/lib/card-search";
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
import MtgAliasesTab from "./MtgAliasesTab";

// Card Index editor for mtg. Mirrors the pokemon-singles surface over the
// card_index_*_mtg_* RPCs (000126). mtg identity is split: the durable card_uid +
// (language, is_foil) live on the variant, the printing tuple (name/set/number/
// art_type/foil_type/misc_info) on the shared universal. The flattened view
// mtg_card_definitions_v (000128) exposes it as one row per variant, with the
// English name aliased as regional_name. A platform id is a link, not an anchor
// (one tcgplayer SKU spans EN/JP x foil/nonfoil), so link add never evicts.

interface CardLink {
  platform_name: string;
  external_reference_id: string;
}
interface IndexCard {
  card_id: number;
  card_uid: string;
  regional_name: string; // English name (aliased in the view)
  local_name: string | null;
  set_code: string;
  card_number: string;
  language: string;
  is_foil: boolean;
  art_type: string;
  foil_type: string;
  misc_info: string;
  image_url: string | null;
  links: CardLink[];
}

const COLS =
  "card_id, card_uid, regional_name, local_name, set_code, card_number, language, is_foil, art_type, foil_type, misc_info, image_url";
const PLATFORMS = ["tcgplayer", "tcgplayer_SKU", "cardmarket"];
const PLATFORM_SHORT: Record<string, string> = { tcgplayer: "TCG", tcgplayer_SKU: "SKU", cardmarket: "CM" };
const ART_TYPES = ["NON_FULL_ART", "FULL_ART"];
const selectClass = "h-9 rounded-md border bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

function tcgURL(platform: string, id: string): string | null {
  if (platform === "tcgplayer") return `https://www.tcgplayer.com/product/${id}`;
  return null;
}

const CATALOG_PAGE = 500;

// Platform axis for the chip filter above the results table. Kept in sync
// with PLATFORMS/PLATFORM_SHORT above so the filter list can't drift.
const FILTERABLE_PLATFORMS = ["tcgplayer", "cardmarket"] as const;

async function fetchIndex(
  search: string,
  limit: number,
  platforms: string[],
): Promise<{ cards: IndexCard[]; total: number }> {
  const supabase = createClient();
  const s = search.trim();
  const safe = s.replace(/[%,]/g, " ");
  // Text term + card_uid (full or displayed 8-hex prefix) + exact platform
  // external id - shared semantics with the curation pickers (lib/card-search).
  const extIds = await externalIdMatches(supabase, "mtg_external_identifiers", "card_id", s);
  const orFilter = searchOrFilter(
    [
      `regional_name.ilike.%${safe}%`,
      `local_name.ilike.%${safe}%`,
      `set_code.ilike.%${safe}%`,
      `card_number.ilike.%${safe}%`,
    ],
    s,
    "card_uid",
    "card_id",
    extIds,
  );

  // Chip filter: gate cards on the ones that carry an ID for any of the
  // selected platforms. Empty selection = no gate.
  //
  // Pushed into Postgres as an inner join rather than fetched as an id list:
  // mtg_external_identifiers holds 418,096 rows (268,916 for tcgplayer alone),
  // so the old read-the-ids-back approach was truncated to 1000 by PostgREST
  // and silently filtered the catalog on 0.37% of its ids, count included.
  // PostgREST resolves this embed through the view via the base table's FK.
  const gated = platforms.length > 0;
  const gateSelect = gated ? ", mtg_external_identifiers!inner(platform_name)" : "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyGate = (q: any) => (gated ? q.in("mtg_external_identifiers.platform_name", platforms) : q);

  let cq = supabase.from("mtg_card_definitions_v").select(`card_id${gateSelect}`, { count: "exact", head: true });
  if (s) cq = cq.or(orFilter);
  cq = applyGate(cq);
  const { count: total } = await cq;
  let q = supabase.from("mtg_card_definitions_v").select(`${COLS}${gateSelect}`).order("regional_name").limit(limit);
  if (s) q = q.or(orFilter);
  q = applyGate(q);
  const { data, error } = await q;
  if (error) throw error;
  // Drop the join-only embed so it can't leak into the rendered card object.
  const rows = ((data ?? []) as Record<string, unknown>[]).map(
    ({ mtg_external_identifiers: _gate, ...r }) => r,
  ) as unknown as Omit<IndexCard, "links">[];
  const ids = rows.map((r) => r.card_id);
  const linkMap = new Map<number, CardLink[]>();
  if (ids.length) {
    // Fans out ~1 row per platform per card, so a full page outgrows the
    // PostgREST 1000-row cap and anchors vanish silently. See selectAll.
    const links = await selectAll<{ card_id: number } & CardLink>(
      () => supabase
        .from("mtg_external_identifiers")
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

export default function MtgCardIndex() {
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
      {tab === "cards" ? <MtgCardsTab /> : <MtgAliasesTab />}
    </div>
  );
}

function MtgCardsTab() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(CATALOG_PAGE);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const debounced = useDebouncedValue(search, 300);
  const platformsKey = Array.from(selectedPlatforms).sort().join(",");
  const { data, error, isLoading, retry } = useSupabaseQuery(
    ["card-index-mtg", debounced, String(limit), platformsKey],
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
        {/* Always-mounted left slot: when the count span unmounted during
            loading, justify-between collapsed to one child and the search
            bar jumped to the left edge on every load cycle. */}
        <div className="flex items-center gap-2">
          {!isLoading && (
            <span className="text-sm text-muted-foreground">
              {t("cardIndex.countOf").replace("{shown}", String(cards.length)).replace("{total}", String(total))}
            </span>
          )}
        </div>
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
      <p className="text-xs text-muted-foreground">{t("cardIndex.hintMtg")}</p>

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
                          {[c.local_name, c.set_code, c.card_number, c.language]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {c.is_foil && <Badge variant="outline" className="border-amber-500/50 text-amber-600">foil</Badge>}
                      {c.art_type === "FULL_ART" && <Badge variant="outline">full art</Badge>}
                      {c.foil_type && c.foil_type !== "STANDARD" && <Badge variant="outline">{c.foil_type}</Badge>}
                      {c.misc_info && c.misc_info !== "UNKNOWN" && <Badge variant="outline">{c.misc_info}</Badge>}
                      {!c.is_foil && c.art_type !== "FULL_ART" &&
                        (!c.foil_type || c.foil_type === "STANDARD") &&
                        (!c.misc_info || c.misc_info === "UNKNOWN") && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                    </div>
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

      <MtgCardModal card={editing} open={!!editing || creating} isCreate={creating} onOpenChange={(o) => { if (!o) { setEditing(null); setCreating(false); } }} onSaved={retry} />
    </div>
  );
}

const BLANK = {
  name: "", local_name: "", set_code: "", card_number: "",
  language: "en", is_foil: "false", art_type: "NON_FULL_ART", foil_type: "", misc_info: "",
  image_url: "",
};

// Create OR edit an mtg variant + manage its platform links. All writes go through
// the SECURITY DEFINER RPCs (000126); create/edit find-or-create the universal.
function MtgCardModal({
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
  const [linkPlatform, setLinkPlatform] = useState("tcgplayer");
  const [linkId, setLinkId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const set = (k: keyof typeof BLANK, v: string) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    setError(null);
    setLinkId("");
    setLinkPlatform("tcgplayer");
    setUploadFile(null);
    if (isCreate || !card) setForm({ ...BLANK });
    else setForm({
      name: card.regional_name ?? "",
      local_name: card.local_name ?? "",
      set_code: card.set_code ?? "",
      card_number: card.card_number ?? "",
      language: card.language ?? "en",
      is_foil: card.is_foil ? "true" : "false",
      art_type: card.art_type || "NON_FULL_ART",
      foil_type: card.foil_type === "STANDARD" ? "" : card.foil_type ?? "",
      misc_info: card.misc_info === "UNKNOWN" ? "" : card.misc_info ?? "",
      image_url: card.image_url ?? "",
    });
  }, [card, isCreate, open]);

  async function save() {
    if (!form.name.trim()) { setError(t("cardIndex.nameRequired")); return; }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const common = {
      p_name: form.name, p_local_name: form.local_name, p_set_code: form.set_code,
      p_card_number: form.card_number, p_art_type: form.art_type, p_foil_type: form.foil_type,
      p_misc_info: form.misc_info, p_language: form.language, p_is_foil: form.is_foil === "true",
      // Create passes NULL to keep the universal's image_url alone; edit passes
      // trimmed value ('' = clear). Different NULL-semantics per RPC (see 000141).
      p_image_url: isCreate ? (form.image_url.trim() || null) : form.image_url.trim(),
    };
    let rpcError;
    let cardIdForUpload: number | null = null;
    if (isCreate) {
      const res = await supabase.rpc("card_index_create_mtg_card", {
        ...common,
        p_platform: linkId.trim() ? linkPlatform : null, p_external_id: linkId.trim() || null,
      });
      rpcError = res.error;
      if (typeof res.data === "number") cardIdForUpload = res.data;
    } else if (card) {
      ({ error: rpcError } = await supabase.rpc("card_index_edit_mtg_card", { p_card_id: card.card_id, ...common }));
      cardIdForUpload = card.card_id;
    }
    if (rpcError) { setBusy(false); setError(rpcError.message); return; }

    // Only upload AFTER the RPC has committed the variant. MTG image_url lives
    // on the universal (shared across sibling variants), so this write is
    // visible on every foil/language sibling too.
    if (uploadFile && cardIdForUpload != null) {
      const up = await uploadCardImage({ game: "mtg", id: cardIdForUpload, file: uploadFile });
      if ("error" in up) { setBusy(false); setError(`Upload: ${up.error}`); return; }
      const { error: setImgErr } = await supabase.rpc("card_index_edit_mtg_card", {
        p_card_id: cardIdForUpload, ...common, p_image_url: up.url,
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
    const { error: e } = await supabase.rpc("card_index_attach_mtg_link", {
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
    await supabase.rpc("card_index_remove_mtg_link", { p_card_id: card.card_id, p_platform: platform });
    setBusy(false);
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isCreate ? t("cardIndex.createTitleMtg") : t("cardIndex.editTitleMtg")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label>{t("cardIndex.fName")}</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>{t("cardIndex.fLocalName")}</Label>
            <Input value={form.local_name} onChange={(e) => set("local_name", e.target.value)} />
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
            <Label>{t("cardIndex.fFoil")}</Label>
            <select className={`${selectClass} w-full`} value={form.is_foil} onChange={(e) => set("is_foil", e.target.value)}>
              <option value="false">no</option>
              <option value="true">yes</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t("cardIndex.fArtType")}</Label>
            <select className={`${selectClass} w-full`} value={form.art_type} onChange={(e) => set("art_type", e.target.value)}>
              {ART_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t("cardIndex.fFoilType")}</Label>
            <Input value={form.foil_type} onChange={(e) => set("foil_type", e.target.value)} placeholder="サージ, エッチング, …" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>{t("cardIndex.fMisc")}</Label>
            <Input value={form.misc_info} onChange={(e) => set("misc_info", e.target.value)} placeholder="ショーケース枠, 旧枠仕様, …" />
          </div>
          {/* image_url lives on the universal (shared across variants) - editing
              or uploading here swaps art for every sibling of this printing.
              That's usually what you want since MTG variants share art. */}
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

        {/* Links: on create, one optional link; on edit, list + add/remove. */}
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

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={busy || !form.name.trim()}>
            {busy ? t("common.saving") : isCreate ? t("cardIndex.create") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

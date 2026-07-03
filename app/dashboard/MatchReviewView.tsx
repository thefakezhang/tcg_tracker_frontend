"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Check, X, Plus, Search, Link2, ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// Match review queue (docs/card_index_curation_console.md): the curator empties the
// cloud candidate table the backend fills. One component, driven by a per-game
// config so sealed + pokemon singles share the exact same review flow (unified
// process). Each row stores only the source side + a pointer to the proposed
// catalog item; the catalog side is resolved from that pointer, never duplicated.

type Game = "pokemon_sealed" | "pokemon" | "mtg";

interface CatalogLink {
  platform_name: string;
  external_reference_id: string;
}
// Generic catalog item: the game's row projected to id/uid/name/subtitle/links.
interface CatalogItem {
  id: number;
  uid: string;
  name: string;
  subtitle: string;
  links: CatalogLink[];
}
interface Candidate {
  candidate_id: number;
  source_platform: string;
  source_key: string;
  source_name: string;
  source_raw: string | null;
  source_fields: Record<string, string> | null;
  source_image_url: string | null;
  proposed_id: number | null; // aliased from proposed_(product|card)_id
  candidate_ids: number[] | null; // aliased from candidate_(product|card)_ids
  confidence: number | null;
  reason: string | null;
}

type Field = { key: string; label: string; kind?: "select"; options?: string[]; full?: boolean };

interface GameConfig {
  game: Game;
  candidatesTable: string;
  proposedCol: string;
  candidateIdsCol: string;
  catalogTable: string;
  catalogSelect: string;
  extIdsTable: string;
  idCol: string;
  uidCol: string;
  nameCol: string; // search + display column on the catalog table
  subtitle: (row: Record<string, unknown>) => string;
  rpcConfirm: string;
  rpcCreate: string;
  rpcReject: string;
  rpcAlias?: string; // resolve candidate as an alias of an existing item (pokemon only)
  rpcBulkConfirm: string; // confirm many (those with a proposed match) in one call
  rpcBulkReject: string; // reject many in one call
  confirmIdParam: string; // p_product_id | p_card_id
  createFields: Field[];
  createNameKey: string; // the required field
  createDefaults: (c: Candidate) => Record<string, string>;
  createArgs: (c: Candidate, form: Record<string, string>) => Record<string, unknown>;
}

const ART_TYPES = ["NON_FULL_ART", "FULL_ART"];
const IS_FOIL = ["false", "true"];
const PRODUCT_TYPES = [
  "booster_box", "booster_bundle", "booster_pack", "elite_trainer_box",
  "premium_collection", "build_battle_box", "special_collection", "tin",
  "pokecenter_exclusive", "vintage_box", "other",
];
const EDITIONS = ["standard", "1ed", "unlimited"];
const CONDITIONS = ["standard", "shrink", "no_shrink"];
const selectClass = "h-9 w-full rounded-md border bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";
const norm = (v?: string) => (v && !v.startsWith("UNKNOWN") ? v : "");
const joinParts = (parts: (string | null | undefined)[]) =>
  parts.filter((v) => v && v !== "UNKNOWN" && v !== "UNKNOWN_PRODUCT_TYPE").join(" · ");

const CONFIGS: Record<Game, GameConfig> = {
  pokemon_sealed: {
    game: "pokemon_sealed",
    candidatesTable: "pokemon_sealed_match_candidates",
    proposedCol: "proposed_product_id",
    candidateIdsCol: "candidate_product_ids",
    catalogTable: "pokemon_sealed_products",
    catalogSelect: "product_id, product_uid, name, english_name, set_code, product_type, language, misc_info, variant_edition, sealed_condition",
    extIdsTable: "pokemon_sealed_external_identifiers",
    idCol: "product_id",
    uidCol: "product_uid",
    nameCol: "name",
    subtitle: (r) => joinParts([r.product_type as string, r.language as string, r.set_code as string]),
    rpcConfirm: "card_index_resolve_candidate_confirm",
    rpcCreate: "card_index_resolve_candidate_create",
    rpcReject: "card_index_resolve_candidate_reject",
    rpcBulkConfirm: "card_index_resolve_candidates_confirm",
    rpcBulkReject: "card_index_resolve_candidates_reject",
    confirmIdParam: "p_product_id",
    createNameKey: "name",
    createFields: [
      { key: "name", label: "cardIndex.fName", full: true },
      { key: "english_name", label: "cardIndex.fEnglish", full: true },
      { key: "set_code", label: "cardIndex.fSet" },
      { key: "language", label: "cardIndex.fLanguage" },
      { key: "product_type", label: "cardIndex.fType", kind: "select", options: PRODUCT_TYPES },
      { key: "variant_edition", label: "cardIndex.fEdition", kind: "select", options: EDITIONS },
      { key: "sealed_condition", label: "cardIndex.fCondition", kind: "select", options: CONDITIONS },
      { key: "misc_info", label: "cardIndex.fMisc" },
    ],
    createDefaults: (c) => {
      const f = c.source_fields ?? {};
      return {
        name: c.source_name, english_name: "",
        set_code: norm(f.set_code) || "UNKNOWN", product_type: norm(f.product_type) || "booster_box",
        language: f.language || "jp", misc_info: norm(f.misc_info) || "UNKNOWN",
        variant_edition: f.variant_edition || "standard", sealed_condition: "standard",
      };
    },
    createArgs: (c, form) => ({
      p_candidate_id: c.candidate_id, p_name: form.name, p_english_name: form.english_name,
      p_set_code: form.set_code, p_product_type: form.product_type, p_language: form.language,
      p_misc_info: form.misc_info, p_variant_edition: form.variant_edition,
      p_sealed_condition: form.sealed_condition, p_image_url: c.source_image_url ?? "",
    }),
  },
  pokemon: {
    game: "pokemon",
    candidatesTable: "pokemon_match_candidates",
    proposedCol: "proposed_card_id",
    candidateIdsCol: "candidate_card_ids",
    catalogTable: "pokemon_card_definitions",
    catalogSelect: "card_id, card_uid, regional_name, english_name, set_code, card_number, language, misc_info",
    extIdsTable: "pokemon_external_identifiers",
    idCol: "card_id",
    uidCol: "card_uid",
    nameCol: "regional_name",
    subtitle: (r) => joinParts([r.set_code as string, r.card_number as string, r.misc_info as string, r.language as string]),
    rpcConfirm: "card_index_resolve_pokemon_candidate_confirm",
    rpcCreate: "card_index_resolve_pokemon_candidate_create",
    rpcReject: "card_index_resolve_pokemon_candidate_reject",
    rpcAlias: "card_index_resolve_pokemon_candidate_alias",
    rpcBulkConfirm: "card_index_resolve_pokemon_candidates_confirm",
    rpcBulkReject: "card_index_resolve_pokemon_candidates_reject",
    confirmIdParam: "p_card_id",
    createNameKey: "regional_name",
    createFields: [
      { key: "regional_name", label: "cardIndex.fName", full: true },
      { key: "english_name", label: "cardIndex.fEnglish", full: true },
      { key: "set_code", label: "cardIndex.fSet" },
      { key: "card_number", label: "cardIndex.fNumber" },
      { key: "language", label: "cardIndex.fLanguage" },
      { key: "misc_info", label: "cardIndex.fMisc" },
    ],
    createDefaults: (c) => {
      const f = c.source_fields ?? {};
      return {
        regional_name: c.source_name, english_name: "",
        set_code: norm(f.set_code), card_number: f.card_number || "",
        language: f.language || "jp", misc_info: norm(f.misc_info),
      };
    },
    createArgs: (c, form) => ({
      p_candidate_id: c.candidate_id, p_regional_name: form.regional_name, p_english_name: form.english_name,
      p_set_code: form.set_code, p_card_number: form.card_number, p_language: form.language, p_misc_info: form.misc_info,
    }),
  },
  mtg: {
    game: "mtg",
    candidatesTable: "mtg_match_candidates",
    proposedCol: "proposed_card_id",
    candidateIdsCol: "candidate_card_ids",
    // Flattened view (000128): universal join + card_uid, English name aliased as regional_name.
    catalogTable: "mtg_card_definitions_v",
    catalogSelect: "card_id, card_uid, regional_name, set_code, card_number, language, is_foil, art_type, foil_type, misc_info, local_name",
    extIdsTable: "mtg_external_identifiers",
    idCol: "card_id",
    uidCol: "card_uid",
    nameCol: "regional_name",
    subtitle: (r) => joinParts([r.set_code as string, r.card_number as string, r.language as string, (r.is_foil ? "foil" : "") as string]),
    rpcConfirm: "card_index_resolve_mtg_candidate_confirm",
    rpcCreate: "card_index_resolve_mtg_candidate_create",
    rpcReject: "card_index_resolve_mtg_candidate_reject",
    rpcBulkConfirm: "card_index_resolve_mtg_candidates_confirm",
    rpcBulkReject: "card_index_resolve_mtg_candidates_reject",
    confirmIdParam: "p_card_id",
    createNameKey: "name",
    createFields: [
      { key: "name", label: "cardIndex.fName", full: true },
      { key: "local_name", label: "cardIndex.fLocalName", full: true },
      { key: "set_code", label: "cardIndex.fSet" },
      { key: "card_number", label: "cardIndex.fNumber" },
      { key: "language", label: "cardIndex.fLanguage" },
      { key: "is_foil", label: "cardIndex.fFoil", kind: "select", options: IS_FOIL },
      { key: "art_type", label: "cardIndex.fArtType", kind: "select", options: ART_TYPES },
      { key: "foil_type", label: "cardIndex.fFoilType" },
      { key: "misc_info", label: "cardIndex.fMisc" },
    ],
    createDefaults: (c) => {
      const f = c.source_fields ?? {};
      return {
        name: c.source_name, local_name: "",
        set_code: norm(f.set_code), card_number: f.card_number || "",
        language: f.language || "en", is_foil: f.is_foil === "true" ? "true" : "false",
        art_type: f.art_type || "NON_FULL_ART", foil_type: f.foil_type || "STANDARD",
        misc_info: f.misc_info || "UNKNOWN",
      };
    },
    createArgs: (c, form) => ({
      p_candidate_id: c.candidate_id, p_name: form.name, p_local_name: form.local_name,
      p_set_code: form.set_code, p_card_number: form.card_number,
      p_art_type: form.art_type, p_foil_type: form.foil_type, p_misc_info: form.misc_info,
      p_language: form.language, p_is_foil: form.is_foil === "true",
    }),
  },
};

const PLATFORM_SHORT: Record<string, string> = { pricecharting: "PC", tcgplayer: "TCG", snkrdunk: "SNKR", collectr: "COLL" };
function anchorURL(platform: string, id: string): string | null {
  switch (platform) {
    case "pricecharting": return `https://www.pricecharting.com/game/${id}`;
    case "snkrdunk": return `https://snkrdunk.com/apparels/${id}`;
    case "tcgplayer": return `https://www.tcgplayer.com/product/${id}`;
    default: return null;
  }
}

interface QueueData {
  candidates: Candidate[];
  items: Map<number, CatalogItem>;
}

async function fetchQueue(cfg: GameConfig): Promise<QueueData> {
  const supabase = createClient();
  const { data: rows, error } = await supabase
    .from(cfg.candidatesTable)
    .select(`candidate_id, source_platform, source_key, source_name, source_raw, source_fields, source_image_url, proposed_id:${cfg.proposedCol}, candidate_ids:${cfg.candidateIdsCol}, confidence, reason`)
    .eq("status", "pending")
    .order("confidence", { ascending: false, nullsFirst: false })
    .order("candidate_id", { ascending: true })
    .limit(200);
  if (error) throw error;
  const candidates = (rows ?? []) as Candidate[];

  const ids = new Set<number>();
  for (const c of candidates) {
    if (c.proposed_id) ids.add(c.proposed_id);
    for (const id of c.candidate_ids ?? []) ids.add(id);
  }
  const items = new Map<number, CatalogItem>();
  if (ids.size) {
    const idList = [...ids];
    const { data: crows, error: cerr } = await supabase.from(cfg.catalogTable).select(cfg.catalogSelect).in(cfg.idCol, idList);
    if (cerr) throw cerr;
    const { data: links, error: lerr } = await supabase
      .from(cfg.extIdsTable)
      .select(`${cfg.idCol}, platform_name, external_reference_id`)
      .in(cfg.idCol, idList);
    if (lerr) throw lerr;
    const linkMap = new Map<number, CatalogLink[]>();
    for (const l of (links ?? []) as Record<string, unknown>[]) {
      const id = l[cfg.idCol] as number;
      const arr = linkMap.get(id) ?? [];
      arr.push({ platform_name: l.platform_name as string, external_reference_id: l.external_reference_id as string });
      linkMap.set(id, arr);
    }
    for (const r of (crows ?? []) as Record<string, unknown>[]) {
      const id = r[cfg.idCol] as number;
      items.set(id, {
        id,
        uid: (r[cfg.uidCol] as string) ?? "",
        name: (r[cfg.nameCol] as string) ?? "",
        subtitle: cfg.subtitle(r),
        links: (linkMap.get(id) ?? []).sort((a, b) => a.platform_name.localeCompare(b.platform_name)),
      });
    }
  }
  return { candidates, items };
}

function Anchors({ links }: { links: CatalogLink[] }) {
  if (!links.length) return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {links.map((l) => {
        const url = anchorURL(l.platform_name, l.external_reference_id);
        const label = `${PLATFORM_SHORT[l.platform_name] ?? l.platform_name} ${l.external_reference_id}`;
        return url ? (
          <a key={l.platform_name + l.external_reference_id} href={url} target="_blank" rel="noreferrer"
            className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary">
            {label}
          </a>
        ) : (
          <span key={l.platform_name + l.external_reference_id} className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
            {label}
          </span>
        );
      })}
    </div>
  );
}

export default function MatchReviewView() {
  const { t } = useTranslation();
  const [game, setGame] = useState<Game>("pokemon_sealed");
  const cfg = CONFIGS[game];
  const { data, error, isLoading, retry } = useSupabaseQuery(["match-review", game], () => fetchQueue(cfg));
  const candidates = data?.candidates ?? [];
  const items = data?.items ?? new Map<number, CatalogItem>();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [createFor, setCreateFor] = useState<Candidate | null>(null);
  const [matchFor, setMatchFor] = useState<{ c: Candidate; alias: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const proposedCount = useMemo(
    () => candidates.filter((c) => selected.has(c.candidate_id) && c.proposed_id).length,
    [candidates, selected],
  );
  function toggle(id: number) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === candidates.length ? new Set() : new Set(candidates.map((c) => c.candidate_id))));
  }
  async function bulk(rpc: string) {
    setBusyId(-1);
    setErr(null);
    const { error: e } = await createClient().rpc(rpc, { p_ids: [...selected] });
    setBusyId(null);
    if (e) setErr(e.message);
    else { setSelected(new Set()); retry(); }
  }

  const platforms = useMemo(
    () => Array.from(new Set(candidates.map((c) => c.source_platform))).sort(),
    [candidates],
  );

  async function confirm(c: Candidate, id: number) {
    setBusyId(c.candidate_id);
    setErr(null);
    const { error: e } = await createClient().rpc(cfg.rpcConfirm, { p_candidate_id: c.candidate_id, [cfg.confirmIdParam]: id });
    setBusyId(null);
    if (e) setErr(e.message);
    else retry();
  }
  async function reject(c: Candidate) {
    setBusyId(c.candidate_id);
    setErr(null);
    const { error: e } = await createClient().rpc(cfg.rpcReject, { p_candidate_id: c.candidate_id });
    setBusyId(null);
    if (e) setErr(e.message);
    else retry();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{t("review.title")}</h1>
        <div className="ml-2 flex gap-1">
          {(["pokemon_sealed", "pokemon", "mtg"] as const).map((g) => (
            <Button key={g} size="sm" variant={game === g ? "default" : "outline"} onClick={() => { setGame(g); setSelected(new Set()); }}>
              {t(`game.${g}` as "game.pokemon_sealed")}
            </Button>
          ))}
        </div>
        {!isLoading && (
          <span className="text-sm text-muted-foreground">
            {t("review.count").replace("{n}", String(candidates.length))}
            {platforms.length > 0 && ` · ${platforms.join(", ")}`}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("review.hint")}</p>
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{t("review.selected").replace("{n}", String(selected.size))}</span>
          <Button size="sm" variant="outline" disabled={busyId === -1 || proposedCount === 0} onClick={() => bulk(cfg.rpcBulkConfirm)}>
            <Check className="size-3.5 text-green-600" /> {t("review.bulkConfirm").replace("{n}", String(proposedCount))}
          </Button>
          <Button size="sm" variant="outline" disabled={busyId === -1} onClick={() => bulk(cfg.rpcBulkReject)}>
            <X className="size-3.5 text-destructive" /> {t("review.bulkReject").replace("{n}", String(selected.size))}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{t("review.clearSel")}</Button>
        </div>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}

      {error ? (
        <QueryError onRetry={retry} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("review.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input type="checkbox" checked={candidates.length > 0 && selected.size === candidates.length}
                    ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < candidates.length; }}
                    onChange={toggleAll} />
                </th>
                <th className="w-[24%] px-3 py-2 font-medium">{t("review.colSource")}</th>
                <th className="w-[30%] px-3 py-2 font-medium">{t("review.colMatch")}</th>
                <th className="w-[22%] px-3 py-2 font-medium">{t("review.colAnchors")}</th>
                <th className="w-[10%] px-3 py-2 font-medium">{t("review.colConfidence")}</th>
                <th className="w-[12%] px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const proposed = c.proposed_id ? items.get(c.proposed_id) : null;
                const picks = (c.candidate_ids ?? []).map((id) => items.get(id)).filter(Boolean) as CatalogItem[];
                const busy = busyId === c.candidate_id;
                const fields = c.source_fields ?? {};
                return (
                  <tr key={c.candidate_id} className="border-b align-top last:border-0">
                    <td className="px-2 py-2">
                      <input type="checkbox" checked={selected.has(c.candidate_id)} onChange={() => toggle(c.candidate_id)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-2">
                        {c.source_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.source_image_url} alt="" className="h-10 w-7 shrink-0 rounded border object-cover" />
                        ) : (
                          <div className="flex h-10 w-7 shrink-0 items-center justify-center rounded border bg-muted">
                            <ImageOff className="size-3 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium">{c.source_name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            <span className="font-mono">{c.source_platform}</span>
                            {" · "}
                            {joinParts([fields.set_code, fields.card_number, fields.product_type, fields.language])}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {proposed ? (
                        <div className="min-w-0">
                          <div className="truncate font-medium">{proposed.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {proposed.subtitle} <span className="font-mono">{proposed.uid.slice(0, 8)}</span>
                          </div>
                        </div>
                      ) : picks.length > 0 ? (
                        <div className="space-y-1">
                          {picks.map((p) => (
                            <button key={p.id} type="button" disabled={busy} onClick={() => confirm(c, p.id)}
                              className="block w-full truncate rounded border px-1.5 py-0.5 text-left text-xs hover:border-primary hover:bg-muted">
                              {p.name} <span className="text-muted-foreground">{p.subtitle}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("review.noMatch")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Anchors links={proposed?.links ?? []} />
                    </td>
                    <td className="px-3 py-2">
                      {c.confidence != null ? (
                        <span className="font-medium">{Math.round(c.confidence * 100)}%</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                      {c.reason && <div className="truncate text-[10px] text-muted-foreground">{c.reason}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {proposed && (
                          <Button variant="outline" size="icon" className="size-7" disabled={busy}
                            title={t("review.confirm")} onClick={() => confirm(c, proposed.id)}>
                            <Check className="size-3.5 text-green-600" />
                          </Button>
                        )}
                        <Button variant="outline" size="icon" className="size-7" disabled={busy}
                          title={t("review.match")} onClick={() => setMatchFor({ c, alias: false })}>
                          <Search className="size-3.5" />
                        </Button>
                        {cfg.rpcAlias && (
                          <Button variant="outline" size="icon" className="size-7" disabled={busy}
                            title={t("review.alias")} onClick={() => setMatchFor({ c, alias: true })}>
                            <Link2 className="size-3.5" />
                          </Button>
                        )}
                        <Button variant="outline" size="icon" className="size-7" disabled={busy}
                          title={t("review.create")} onClick={() => setCreateFor(c)}>
                          <Plus className="size-3.5" />
                        </Button>
                        <Button variant="outline" size="icon" className="size-7" disabled={busy}
                          title={t("review.reject")} onClick={() => reject(c)}>
                          <X className="size-3.5 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateFromCandidate cfg={cfg} candidate={createFor} open={!!createFor}
        onOpenChange={(o) => { if (!o) setCreateFor(null); }}
        onCreated={() => { setCreateFor(null); retry(); }} />
      <MatchToExisting cfg={cfg} candidate={matchFor?.c ?? null} alias={matchFor?.alias ?? false}
        rpc={matchFor?.alias ? (cfg.rpcAlias as string) : cfg.rpcConfirm} open={!!matchFor}
        onOpenChange={(o) => { if (!o) setMatchFor(null); }}
        onMatched={() => { setMatchFor(null); retry(); }} />
    </div>
  );
}

// MatchToExisting resolves the candidate onto an EXISTING catalog item the curator
// finds by search. alias=false → "this already exists, don't duplicate" (confirm);
// alias=true → "this source spelling is an alias of that card" (bind alias). Both
// pass (candidate_id, chosen id) to their RPC.
function MatchToExisting({
  cfg, candidate, alias, rpc, open, onOpenChange, onMatched,
}: {
  cfg: GameConfig;
  candidate: Candidate | null;
  alias: boolean;
  rpc: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onMatched: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ id: number; name: string; subtitle: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<number | null>(null);

  if (candidate && seeded !== candidate.candidate_id) {
    setSearch(candidate.source_name);
    setSeeded(candidate.candidate_id);
    setError(null);
  }

  useEffect(() => {
    const q = search.trim();
    if (!q) { setResults([]); return; }
    const h = setTimeout(async () => {
      const { data } = await createClient()
        .from(cfg.catalogTable)
        .select(cfg.catalogSelect)
        .ilike(cfg.nameCol, `%${q.replace(/[%,]/g, " ")}%`)
        .limit(8);
      setResults(((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r[cfg.idCol] as number, name: (r[cfg.nameCol] as string) ?? "", subtitle: cfg.subtitle(r),
      })));
    }, 300);
    return () => clearTimeout(h);
  }, [search, cfg]);

  async function matchTo(id: number) {
    if (!candidate) return;
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().rpc(rpc, { p_candidate_id: candidate.candidate_id, [alias ? "p_card_id" : cfg.confirmIdParam]: id });
    setBusy(false);
    if (e) { setError(e.message); return; }
    onMatched();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{alias ? t("review.aliasTitle") : t("review.matchTitle")}</DialogTitle></DialogHeader>
        {candidate && (
          <p className="text-xs text-muted-foreground">{t("review.matchFrom").replace("{name}", candidate.source_name)}</p>
        )}
        <Input placeholder={t("review.matchSearch")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {results.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("review.noResults")}</p>
          ) : (
            results.map((r) => (
              <button key={r.id} type="button" disabled={busy} onClick={() => matchTo(r.id)}
                className="flex w-full items-center justify-between rounded border px-2 py-1.5 text-left text-sm hover:border-primary hover:bg-muted">
                <span className="truncate">{r.name}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">{r.subtitle}</span>
              </button>
            ))
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// CreateFromCandidate mints a new catalog item from a candidate's source identity
// and links the source in one transaction (the game's resolve_*_create RPC), the
// single-source path. Prefilled from the candidate; the curator tunes and confirms.
function CreateFromCandidate({
  cfg, candidate, open, onOpenChange, onCreated,
}: {
  cfg: GameConfig;
  candidate: Candidate | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<number | null>(null);

  if (candidate && seeded !== candidate.candidate_id) {
    setForm(cfg.createDefaults(candidate));
    setSeeded(candidate.candidate_id);
    setError(null);
  }
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const nameOk = (form[cfg.createNameKey] ?? "").trim().length > 0;

  async function create() {
    if (!candidate) return;
    if (!nameOk) { setError(t("cardIndex.nameRequired")); return; }
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().rpc(cfg.rpcCreate, cfg.createArgs(candidate, form));
    setBusy(false);
    if (e) { setError(e.message); return; }
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{t("review.createTitle")}</DialogTitle></DialogHeader>
        {candidate && (
          <p className="text-xs text-muted-foreground">
            {t("review.createFrom").replace("{platform}", candidate.source_platform).replace("{key}", candidate.source_key)}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {cfg.createFields.map((fld) => (
            <div key={fld.key} className={fld.full ? "col-span-2 space-y-1" : "space-y-1"}>
              <Label>{t(fld.label as "cardIndex.fName")}</Label>
              {fld.kind === "select" ? (
                <select className={selectClass} value={form[fld.key] ?? ""} onChange={(e) => set(fld.key, e.target.value)}>
                  {(fld.options ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <Input value={form[fld.key] ?? ""} onChange={(e) => set(fld.key, e.target.value)} />
              )}
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
          <Button onClick={create} disabled={busy || !nameOk}>{busy ? t("common.saving") : t("review.createConfirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

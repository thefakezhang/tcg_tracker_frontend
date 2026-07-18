"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Check, X, Plus, Search, Link2, AlertTriangle, GitMerge, Move } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { externalIdMatches, searchOrFilter } from "@/lib/card-search";
import { selectAll } from "@/lib/supabase/select-all";
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
  matched: { platform: string; id: string }[] | null; // unified: platform ids that matched this card
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
  numberCol?: string; // card-number column, if the catalog has one (singles/mtg, not sealed)
  unified?: boolean; // identity-keyed queue with a matched-links set (pokemon, 000131)
  subtitle: (row: Record<string, unknown>) => string;
  rpcConfirm: string;
  rpcCreate: string;
  rpcReject: string;
  rpcAlias?: string; // resolve candidate as an alias of an existing item (pokemon only)
  rpcBulkConfirm: string; // confirm many (those with a proposed match) in one call
  rpcBulkReject: string; // reject many in one call
  rpcBulkCreate?: string; // mint many at once from source_fields (generated bucket, all three games)
  confirmIdParam: string; // p_product_id | p_card_id
  createFields: Field[];
  createNameKey: string; // the required field
  createDefaults: (c: Candidate) => Record<string, string>;
  createArgs: (c: Candidate, form: Record<string, string>) => Record<string, unknown>;
}

const PAGE_SIZE = 500; // rows loaded per page in the review queue
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
    unified: true,
    subtitle: (r) => joinParts([r.product_type as string, r.language as string, r.set_code as string]),
    rpcConfirm: "card_index_resolve_candidate_confirm",
    rpcCreate: "card_index_resolve_candidate_create",
    rpcReject: "card_index_resolve_candidate_reject",
    rpcBulkConfirm: "card_index_resolve_candidates_confirm",
    rpcBulkReject: "card_index_resolve_candidates_reject",
    rpcBulkCreate: "card_index_bulk_create_sealed_from_candidates",
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
    numberCol: "card_number",
    unified: true,
    subtitle: (r) => joinParts([r.set_code as string, r.card_number as string, r.misc_info as string, r.language as string]),
    rpcConfirm: "card_index_resolve_pokemon_candidate_confirm",
    rpcCreate: "card_index_resolve_pokemon_candidate_create",
    rpcReject: "card_index_resolve_pokemon_candidate_reject",
    rpcAlias: "card_index_resolve_pokemon_candidate_alias",
    rpcBulkConfirm: "card_index_resolve_pokemon_candidates_confirm",
    rpcBulkReject: "card_index_resolve_pokemon_candidates_reject",
    rpcBulkCreate: "card_index_bulk_create_pokemon_from_candidates",
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
    numberCol: "card_number",
    unified: true,
    subtitle: (r) => joinParts([r.set_code as string, r.card_number as string, r.language as string, (r.is_foil ? "foil" : "") as string]),
    rpcConfirm: "card_index_resolve_mtg_candidate_confirm",
    rpcCreate: "card_index_resolve_mtg_candidate_create",
    rpcReject: "card_index_resolve_mtg_candidate_reject",
    rpcAlias: "card_index_resolve_mtg_candidate_alias",
    rpcBulkConfirm: "card_index_resolve_mtg_candidates_confirm",
    rpcBulkReject: "card_index_resolve_mtg_candidates_reject",
    rpcBulkCreate: "card_index_bulk_create_mtg_from_candidates",
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

const PLATFORM_SHORT: Record<string, string> = { pricecharting: "PC", tcgplayer: "TCG", snkrdunk: "SNKR", collectr: "COLL", shinsoku: "SHIN", cardkingdom: "CK", torecabirth: "TB", torecabank: "TBK", big_tcg: "BIG", toban: "TOBAN" };
function anchorURL(platform: string, id: string): string | null {
  switch (platform) {
    case "pricecharting": return `https://www.pricecharting.com/game/${id}`;
    case "snkrdunk": return `https://snkrdunk.com/apparels/${id}`;
    case "tcgplayer": return `https://www.tcgplayer.com/product/${id}`;
    case "cardrush": return `https://www.cardrush-pokemon.jp/product/${id}`;
    // Card Kingdom sell ids are numeric EC-CUBE product ids; buylist keys
    // (psa10:…, box:…) have no per-item page.
    case "cardkingdom": return /^\d+$/.test(id) ? `https://card-kingdom.jp/pokemon/products/detail/${id}` : null;
    // BIG TCG sell ids are "sell:NNN" ocnk product ids; buylist ids and
    // identity keys have no per-item page.
    case "big_tcg": return /^sell:\d+$/.test(id) ? `https://www.big-toreka.jp/product/${id.slice(5)}` : null;
    default: return null;
  }
}

// SOURCE_LABEL renders a human-facing name for the source tag the backend
// writes onto source_fields.source. Kept explicit rather than heuristic so a
// curator glancing at the row knows exactly which retailer's queue surfaced
// this candidate. When the tag isn't in this map (unknown / legacy row), we
// fall back to the raw string so debug info stays visible.
const SOURCE_LABEL: Record<string, string> = {
  cardrush_sealed: "Cardrush",
  snkrdunk_sealed: "Snkrdunk",
  cardrush: "Cardrush",
  snkrdunk: "Snkrdunk",
  pricecharting: "PriceCharting",
  tcgplayer: "TCGplayer",
  collectr: "Collectr",
  hareruya: "Hareruya",
  fukufuku: "Fukufuku",
  shinsoku: "Shinsoku",
  cardkingdom: "Card Kingdom",
  torecabirth: "Toreca Birth",
  torecabank: "Toreca Bank",
  big_tcg: "BIG TCG",
  toban: "Kaitori Touban",
  cardladder: "Card Ladder",
  surugaya: "Surugaya",
  expedition_gaming: "Expedition Gaming",
};

// SOURCE_FILTERS lists the retailer tags a curator can narrow the queue to,
// per game (the tags each game's pushers actually write). "" = all sources.
const SOURCE_FILTERS: Record<Game, string[]> = {
  pokemon_sealed: ["cardrush_sealed", "snkrdunk_sealed", "pricecharting", "tcgplayer", "cardkingdom", "torecabank", "big_tcg", "toban", "surugaya"],
  pokemon: ["cardrush", "collectr", "snkrdunk", "shinsoku", "cardkingdom", "torecabirth", "torecabank", "big_tcg", "toban", "tcgplayer", "cardladder", "surugaya", "expedition_gaming"],
  mtg: ["cardrush", "hareruya", "fukufuku", "tcgplayer"],
};

// formatSourceOrigin turns (source, side) into "Cardrush (buy)" style text.
// When the row carries no source tag we fall back to the caller's default
// label - that keeps the older MatchReview UI's "from JP scrape" behavior for
// truly-uninformed rows while giving every properly-tagged row a real name.
function formatSourceOrigin(source: string | undefined | null, side: string | undefined | null): string | null {
  if (!source) return null;
  const label = SOURCE_LABEL[source] ?? source;
  if (side) return `${label} (${side})`;
  return label;
}

// CollisionPanel renders a two-part breakdown for a candidate whose match
// resolver detected an ID collision. Top section is what the incoming
// candidate claims to be; each collision entry below shows a platform id
// that already belongs to a different product, with actions for the sealed
// game only:
//   - Merge product #Y into #X: the ghost product Y (owner of the colliding
//     id) gets folded into the correct product X the candidate's identity
//     resolved to. Moves external ids, market listings, buylist rows,
//     inventory, price summaries, and deletes Y. Confirms the candidate
//     against X. This is the "fix the duplicate" path.
//   - Move id only: keep Y as its own product (it may model a different
//     shrink-state or misc variant), but move just the platform id from Y
//     to X. Confirms the candidate against X.
// Both actions require the candidate's identity to have resolved to an
// existing product (`proposed_id`); otherwise there's no target to
// merge INTO, and we surface the info without action buttons.
//
// Singles/mtg games pass no callbacks and the panel is read-only for those.
interface CollisionPanelProps {
  collisions: CollisionEntry[];
  incomingIdentity: string[];
  incomingName: string;
  incomingSourceExternal: { platform: string; id: string } | null;
  proposedId: number | null;
  busy: boolean;
  onMerge?: (fromId: number, intoId: number) => Promise<void>;
  onAttach?: (platform: string, id: string, intoId: number) => Promise<void>;
}
function CollisionPanel({
  collisions, incomingIdentity, incomingName, incomingSourceExternal, proposedId, busy, onMerge, onAttach,
}: CollisionPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="mt-1 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[10px] space-y-2">
      <div className="flex items-center gap-1 font-semibold text-destructive">
        <AlertTriangle className="size-3 shrink-0" />
        {t("review.idCollision")}
      </div>

      {/* Incoming candidate: what does the row claim to be? */}
      <div className="rounded border border-border/60 bg-background/60 p-1.5">
        <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
          {t("review.collisionIncoming")}
        </div>
        <div className="mt-0.5 font-medium">{incomingName}</div>
        <div className="text-muted-foreground">{incomingIdentity.join(" · ") || "—"}</div>
        {incomingSourceExternal && (
          <div className="text-muted-foreground">
            {(PLATFORM_SHORT[incomingSourceExternal.platform] ?? incomingSourceExternal.platform)}
            {" #"}
            {(() => {
              const url = anchorURL(incomingSourceExternal.platform, incomingSourceExternal.id);
              return url ? (
                <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-primary">{incomingSourceExternal.id}</a>
              ) : incomingSourceExternal.id;
            })()}
          </div>
        )}
        {proposedId != null && (
          <div className="mt-0.5 text-muted-foreground">
            {t("review.collisionResolvesTo").replace("{id}", String(proposedId))}
          </div>
        )}
      </div>

      {/* One box per colliding platform id, with resolution actions. */}
      {collisions.map((coll, i) => {
        const platformLabel = PLATFORM_SHORT[coll.platform] ?? coll.platform;
        const url = coll.id_url ?? anchorURL(coll.platform, coll.id);
        const identityLine = [
          coll.existing_set_code,
          coll.existing_card_number,
        ].filter(Boolean).join(" · ");
        const canAct = proposedId != null && coll.existing_card_id != null && proposedId !== coll.existing_card_id;
        return (
          <div key={`${coll.platform}:${coll.id}:${i}`} className="rounded border border-border/60 bg-background/60 p-1.5">
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
              {t("review.collisionExisting")}
            </div>
            <div className="mt-0.5">
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2 hover:text-primary">
                  {platformLabel} #{coll.id}
                </a>
              ) : (
                <span className="font-medium">{platformLabel} #{coll.id}</span>
              )}
              <span className="text-muted-foreground"> {t("review.collisionOwnedBy")} </span>
              <span className="font-medium">
                #{coll.existing_card_id ?? "?"}
                {coll.existing_name ? ` 「${coll.existing_name}」` : ""}
              </span>
            </div>
            {identityLine && (
              <div className="text-muted-foreground">{identityLine}</div>
            )}
            {canAct && (onMerge || onAttach) && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {onMerge && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onMerge(coll.existing_card_id!, proposedId!)}
                    className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[10px] hover:border-primary hover:text-primary disabled:opacity-50"
                    title={t("review.collisionMergeHint")
                      .replace("{from}", String(coll.existing_card_id))
                      .replace("{into}", String(proposedId))}
                  >
                    <GitMerge className="size-3" />
                    {t("review.collisionMerge")
                      .replace("{from}", String(coll.existing_card_id))
                      .replace("{into}", String(proposedId))}
                  </button>
                )}
                {onAttach && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAttach(coll.platform, coll.id, proposedId!)}
                    className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-[10px] hover:border-primary hover:text-primary disabled:opacity-50"
                    title={t("review.collisionMoveHint")
                      .replace("{platform}", platformLabel)
                      .replace("{id}", coll.id)
                      .replace("{into}", String(proposedId))}
                  >
                    <Move className="size-3" />
                    {t("review.collisionMove")}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="text-[9px] text-muted-foreground">
        {t("review.collisionHint")}
      </div>
    </div>
  );
}

// CollisionEntry mirrors the structured record the backend writes into
// source_fields.collisions (PR #402 / internal/matchreview/candidate.go).
interface CollisionEntry {
  platform: string;
  id: string;
  id_url?: string;
  existing_card_id?: number;
  existing_name?: string;
  existing_set_code?: string;
  existing_card_number?: string;
}

// parseCollisions extracts a structured list of colliding-platform-id records
// out of a candidate's source_fields. New rows (post backend #402) carry a
// JSON array on `collisions`; older rows only have the legacy `collision`
// string in the shape:
//   "platform:id (url?) already on product #N <name> set=X num=Y"
//   "platform:id already on <core> (card N)"
// The regex tolerates both. Rows without either field return []. Callers can
// render nothing when the list is empty.
function parseCollisions(fields: Record<string, string>): CollisionEntry[] {
  const rawJSON = fields.collisions;
  if (rawJSON) {
    try {
      const parsed = JSON.parse(rawJSON) as CollisionEntry[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through to string parsing
    }
  }
  const s = fields.collision;
  if (!s) return [];
  // Legacy per-entry format is one of:
  //   platform:id already on <name> <set> (card N)
  //   platform:id (url) already on product #N 「name」 set=X num=Y
  // We split on '; ' first because the string composer joins entries that way.
  return s
    .split(/;\s+/)
    .map((entry) => parseCollisionEntry(entry))
    .filter((e): e is CollisionEntry => e !== null);
}

function parseCollisionEntry(entry: string): CollisionEntry | null {
  // Try the enriched form first: platform:id (url) already on product #N 「name」 set=X num=Y
  const enriched = entry.match(/^(\w+):(\S+)\s+\((https?:\/\/[^)]+)\)\s+already on product #(\d+)(?:\s+「([^」]*)」)?(?:\s+set=(\S+))?(?:\s+num=(\S+))?/);
  if (enriched) {
    return {
      platform: enriched[1],
      id: enriched[2],
      id_url: enriched[3],
      existing_card_id: Number(enriched[4]),
      existing_name: enriched[5] || undefined,
      existing_set_code: enriched[6] || undefined,
      existing_card_number: enriched[7] || undefined,
    };
  }
  // Legacy compact form: platform:id already on <name> <set> (card N)
  const legacy = entry.match(/^(\w+):(\S+)\s+already on\s+(.+?)\s+\(card\s+(\d+)\)/);
  if (legacy) {
    return {
      platform: legacy[1],
      id: legacy[2],
      existing_card_id: Number(legacy[4]),
      existing_name: legacy[3].trim() || undefined,
    };
  }
  return null;
}

interface QueueData {
  candidates: Candidate[];
  items: Map<number, CatalogItem>;
  total: number;
}

// A bucket is one of the curator's mental "files". generated/manual/nonexistant are
// all rows of the candidates table, split by status + confidence; they share the row
// UI and the move actions. (aliases + saved are separate tables, fetched elsewhere.)
type Bucket = "generated" | "manual" | "nonexistant" | "aliases";

// applyBucket narrows a candidates query to one bucket (mutating the PostgREST
// filter builder). Typed loosely because the builder's generics don't survive the
// conditional chaining.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyBucket(q: any, bucket: Bucket): any {
  if (bucket === "nonexistant") return q.eq("status", "rejected");
  if (bucket === "generated") return q.eq("status", "pending").gte("confidence", 0.7);
  return q.eq("status", "pending").or("confidence.lt.0.7,confidence.is.null"); // manual
}

// applySource narrows a candidates query to one retailer. A row matches when the
// scalar tag (source_fields.source) OR the accumulated multi-retailer array
// (source_fields.sources, merged by the unified upsert) carries it. Filtering
// server-side keeps the header count and pagination honest.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySource(q: any, source: string): any {
  if (!source) return q;
  return q.or(`source_fields->>source.eq.${source},source_fields->sources.cs.["${source}"]`);
}

async function fetchQueue(cfg: GameConfig, bucket: Bucket, limit: number, source: string): Promise<QueueData> {
  const supabase = createClient();
  // Total in this bucket, so the header shows the real size (not just the loaded page).
  const { count: total } = await applySource(applyBucket(
    supabase.from(cfg.candidatesTable).select("candidate_id", { count: "exact", head: true }),
    bucket,
  ), source);
  const { data: rows, error } = await applySource(applyBucket(
    supabase
      .from(cfg.candidatesTable)
      .select(`candidate_id, source_platform, source_key, source_name, source_raw, source_fields, source_image_url, proposed_id:${cfg.proposedCol}, candidate_ids:${cfg.candidateIdsCol}, confidence, reason${cfg.unified ? ", matched" : ""}`),
    bucket,
  ), source)
    .order("confidence", { ascending: false, nullsFirst: false })
    .order("candidate_id", { ascending: true })
    .limit(limit);
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
    // Both reads MUST page: the catalog select returns one row per id and so
    // outgrows the PostgREST cap once the curator hits "load more" past 1000
    // rows (a truncated catalog row makes an EXISTING card render as "create
    // new" - a duplicate waiting to happen), and the link select fans out ~6
    // rows per card, so it truncates on the very first page. See selectAll.
    const crows = await selectAll<Record<string, unknown>>(
      () => supabase.from(cfg.catalogTable).select(cfg.catalogSelect).in(cfg.idCol, idList),
      [cfg.idCol],
    );
    const links = await selectAll<Record<string, unknown>>(
      () => supabase.from(cfg.extIdsTable).select(`${cfg.idCol}, platform_name, external_reference_id`).in(cfg.idCol, idList),
      [cfg.idCol, "platform_name"], // (id, platform) is unique: a total order, so paging can't drop rows
    );
    const linkMap = new Map<number, CatalogLink[]>();
    for (const l of links) {
      const id = l[cfg.idCol] as number;
      const arr = linkMap.get(id) ?? [];
      arr.push({ platform_name: l.platform_name as string, external_reference_id: l.external_reference_id as string });
      linkMap.set(id, arr);
    }
    for (const r of crows) {
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
  return { candidates, items, total: total ?? candidates.length };
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

const BUCKETS: Bucket[] = ["generated", "manual", "nonexistant"];

export default function MatchReviewView() {
  const { t } = useTranslation();
  const [game, setGame] = useState<Game>("pokemon_sealed");
  const [bucket, setBucket] = useState<Bucket>("generated");
  const [source, setSource] = useState<string>(""); // "" = all sources
  const [limit, setLimit] = useState(PAGE_SIZE);
  const cfg = CONFIGS[game];
  const { data, error, isLoading, retry } = useSupabaseQuery(["match-review", game, bucket, source, String(limit)], () => fetchQueue(cfg, bucket, limit, source));
  const candidates = data?.candidates ?? [];
  const items = data?.items ?? new Map<number, CatalogItem>();
  const total = data?.total ?? 0;
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [createFor, setCreateFor] = useState<Candidate | null>(null);
  const [matchFor, setMatchFor] = useState<{ c: Candidate; alias: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const proposedCount = useMemo(
    () => candidates.filter((c) => selected.has(c.candidate_id) && c.proposed_id).length,
    [candidates, selected],
  );
  // Bulk-create is meaningful only for selected candidates that have no proposed
  // match AND aren't in the "unmatched" marker lane (rejects live there). The
  // RPC skips ineligible rows server-side too, but grey the button out client-side
  // when there's nothing to do.
  const createCount = useMemo(
    () =>
      candidates.filter(
        (c) =>
          selected.has(c.candidate_id) &&
          !c.proposed_id &&
          c.source_platform !== "unmatched",
      ).length,
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
            <Button key={g} size="sm" variant={game === g ? "default" : "outline"} onClick={() => { setGame(g); setSource(""); setSelected(new Set()); setLimit(PAGE_SIZE); }}>
              {t(`game.${g}` as "game.pokemon_sealed")}
            </Button>
          ))}
        </div>
      </div>
      {/* Buckets: the curator's files, as tabs. Moving a row between buckets is one click. */}
      <div className="flex items-center gap-2 border-b pb-2">
        <div className="flex gap-1">
          {BUCKETS.map((b) => (
            <Button key={b} size="sm" variant={bucket === b ? "default" : "ghost"}
              onClick={() => { setBucket(b); setSelected(new Set()); setLimit(PAGE_SIZE); }}>
              {t(`review.bucket.${b}` as "review.bucket.generated")}
            </Button>
          ))}
        </div>
        {/* Per-source filter: narrow the queue to one retailer (e.g. review a
            newly-added source like Shinsoku in isolation). Server-side, so the
            count and pagination stay honest. */}
        <select
          className="h-8 rounded-md border bg-transparent px-2 text-sm text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          value={source}
          onChange={(e) => { setSource(e.target.value); setSelected(new Set()); setLimit(PAGE_SIZE); }}
        >
          <option value="">{t("review.sourceAll")}</option>
          {SOURCE_FILTERS[game].map((s) => (
            <option key={s} value={s}>{SOURCE_LABEL[s] ?? s}</option>
          ))}
        </select>
        {!isLoading && (
          <span className="text-sm text-muted-foreground">
            {t("review.countOf").replace("{shown}", String(candidates.length)).replace("{total}", String(total))}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t(`review.bucketHint.${bucket}` as "review.bucketHint.generated")}</p>
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">{t("review.selected").replace("{n}", String(selected.size))}</span>
          <Button size="sm" variant="outline" disabled={busyId === -1 || proposedCount === 0} onClick={() => bulk(cfg.rpcBulkConfirm)}>
            <Check className="size-3.5 text-green-600" /> {t("review.bulkConfirm").replace("{n}", String(proposedCount))}
          </Button>
          {cfg.rpcBulkCreate && (
            <Button
              size="sm"
              variant="outline"
              disabled={busyId === -1 || createCount === 0}
              onClick={() => bulk(cfg.rpcBulkCreate!)}
            >
              <Plus className="size-3.5 text-blue-600" /> {t("review.bulkCreate").replace("{n}", String(createCount))}
            </Button>
          )}
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
                // Retailer provenance: the unified upsert accumulates every source that
                // surfaced this card into a `sources` array; fall back to the scalar
                // `source` for single-source rows.
                const rawSources = (fields as Record<string, unknown>).sources;
                const sources: string[] = Array.isArray(rawSources)
                  ? (rawSources as string[])
                  : fields.source ? [fields.source] : [];
                // Source label: prefer the human name for the tag ("Cardrush (buy)")
                // over the raw internal string. The unified path may accumulate
                // multiple sources; join their human names with " · ".
                const sourceOrigin = fields.source
                  ? formatSourceOrigin(fields.source, fields.side)
                  : sources.length > 0
                    ? sources.map((s) => SOURCE_LABEL[s] ?? s).join(" · ")
                    : null;
                // Rich collision breakdown: prefer the structured JSON emitted by
                // matchreview.Upsert (backend PR #402); parse the legacy `collision`
                // string when the row predates the structured field. Older rows still
                // render usefully - just without the platform URL.
                const collisions = parseCollisions(fields);
                // Fuller identity subtitle: include EVERY sealed axis the backend
                // stores on source_fields, in the order a curator scans them. Empty
                // slots stay empty (filter). Same shape works for singles/mtg
                // because the sealed-only fields resolve to "" there.
                const identityBits = [
                  fields.set_code,
                  fields.card_number,
                  fields.product_type,
                  fields.misc_info,
                  fields.sealed_kind,
                  fields.sealed_condition && fields.sealed_condition !== "standard"
                    ? `${fields.sealed_condition}`
                    : "",
                  fields.language,
                ].filter(Boolean);
                // The source's OWN raw descriptor (what the retailer/platform reported
                // for this listing), shown under the proposed catalog identity so the
                // curator can eyeball whether the match is right. Read from GENERIC
                // keys every converter populates - never source-specific names, so this
                // shared UI stays source-agnostic. Empty slots (a source that doesn't
                // carry a field) filter out.
                const sourceBits = [
                  fields.raw_name,
                  fields.raw_set,
                  fields.raw_number,
                  fields.raw_variant,
                  fields.grade && fields.grade !== "psa" ? fields.grade : "",
                  fields.cert ? `cert ${fields.cert}` : "",
                ].filter(Boolean);
                // In practice ~zero candidates carry a source image in the current
                // pipeline; the empty placeholder is pure visual noise. Only render
                // the slot when we actually have an image URL.
                const showImageSlot = Boolean(c.source_image_url);
                return (
                  <tr key={c.candidate_id} className="border-b align-top last:border-0">
                    <td className="px-2 py-2">
                      <input type="checkbox" checked={selected.has(c.candidate_id)} onChange={() => toggle(c.candidate_id)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-2">
                        {showImageSlot && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.source_image_url!} alt="" className="h-10 w-7 shrink-0 rounded border object-cover" />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium">{c.source_name}</div>
                          <div className="text-xs text-muted-foreground break-words">
                            {identityBits.join(" · ")}
                          </div>
                          {sourceBits.length > 0 && (
                            // NOT truncated: this is the raw source descriptor the
                            // curator reads to confirm the match - an ellipsis here
                            // hides the very field (the variant / promo) that decides it.
                            <div className="text-[11px] italic text-muted-foreground/70 break-words" title="what the source reported (for confirming the match)">
                              {sourceBits.join(" · ")}
                            </div>
                          )}
                          {collisions.length > 0 && (
                            <CollisionPanel
                              collisions={collisions}
                              incomingIdentity={identityBits}
                              incomingName={c.source_name}
                              incomingSourceExternal={
                                c.source_platform !== "identity" && c.source_platform !== "unmatched"
                                  ? { platform: c.source_platform, id: c.source_key }
                                  : null
                              }
                              proposedId={c.proposed_id}
                              busy={busyId === c.candidate_id}
                              onMerge={cfg.game === "pokemon_sealed" ? async (fromId: number, intoId: number) => {
                                setBusyId(c.candidate_id);
                                try {
                                  const supabase = createClient();
                                  const { error: mergeErr } = await supabase.rpc("card_index_merge_sealed_products", {
                                    p_from_id: fromId,
                                    p_into_id: intoId,
                                  });
                                  if (mergeErr) throw mergeErr;
                                  const { error: confErr } = await supabase.rpc(cfg.rpcConfirm, {
                                    p_candidate_id: c.candidate_id,
                                    [cfg.confirmIdParam]: intoId,
                                  });
                                  if (confErr) throw confErr;
                                  retry();
                                } finally {
                                  setBusyId(null);
                                }
                              } : undefined}
                              onAttach={cfg.game === "pokemon_sealed" ? async (platform: string, id: string, intoId: number) => {
                                setBusyId(c.candidate_id);
                                try {
                                  const supabase = createClient();
                                  const { error: attachErr } = await supabase.rpc("card_index_attach_sealed_link", {
                                    p_product_id: intoId,
                                    p_platform: platform,
                                    p_external_id: id,
                                    p_source_url: null,
                                  });
                                  if (attachErr) throw attachErr;
                                  const { error: confErr } = await supabase.rpc(cfg.rpcConfirm, {
                                    p_candidate_id: c.candidate_id,
                                    [cfg.confirmIdParam]: intoId,
                                  });
                                  if (confErr) throw confErr;
                                  retry();
                                } finally {
                                  setBusyId(null);
                                }
                              } : undefined}
                            />
                          )}
                          <div className="truncate text-[10px] text-muted-foreground">
                            {cfg.unified ? (
                              sourceOrigin
                                // Retailers with a per-product page (big_tcg sell,
                                // toban) store it on source_fields.product_url;
                                // link the provenance line straight to it.
                                ? fields.product_url ? (
                                    <a href={fields.product_url} target="_blank" rel="noreferrer" className="underline hover:text-primary">
                                      {t("review.srcFrom").replace("{src}", sourceOrigin)}
                                    </a>
                                  ) : (
                                    t("review.srcFrom").replace("{src}", sourceOrigin)
                                  )
                                : t("review.srcJp")
                            ) : c.source_platform === "unmatched" ? (
                              t("review.srcUnmatched")
                            ) : c.source_platform === "tcgplayer" ? (
                              <a href={`https://www.tcgplayer.com/product/${c.source_key}`} target="_blank" rel="noreferrer" className="underline hover:text-primary">
                                {t("review.srcFrom").replace("{src}", `TCGplayer #${c.source_key}`)}
                              </a>
                            ) : (
                              t("review.srcFrom").replace("{src}", `${c.source_platform} #${c.source_key}`)
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {cfg.unified ? (
                        <div className="min-w-0 space-y-1">
                          {proposed ? (
                            // proposed_id is set: this identity ALREADY exists as a
                            // curated card. Show it (name + uid) and its confirmed
                            // platform links so the curator sees this row JOINS an
                            // existing anchor - it is not a new-card creation. Without
                            // this, an anchored candidate looked identical to a fresh
                            // identity (the "no anchor when it clearly should" bug).
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-foreground break-words">
                                {proposed.name}
                                <span className="ml-1 font-mono text-[10px] text-muted-foreground">{proposed.uid.slice(0, 8)}</span>
                              </div>
                              {proposed.links.length > 0 && <Anchors links={proposed.links} />}
                            </div>
                          ) : (
                            <div className="text-xs italic text-muted-foreground">{t("review.newIdentity")}</div>
                          )}
                          {c.matched && c.matched.length > 0 && (
                            // The NEW link(s) this candidate proposes to attach (e.g.
                            // the Card Ladder cert) - distinct from the existing anchor
                            // links above.
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{t("review.adds")}</span>
                              {c.matched.map((m) => {
                                const url = anchorURL(m.platform, m.id);
                                const label = `${PLATFORM_SHORT[m.platform] ?? m.platform} ${m.id}`;
                                return url ? (
                                  <a key={m.platform + m.id} href={url} target="_blank" rel="noreferrer"
                                    className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary">{label}</a>
                                ) : (
                                  <span key={m.platform + m.id} className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">{label}</span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : proposed ? (
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
                      {c.confidence != null && c.confidence >= 0.7 ? (
                        <span className="rounded border border-green-500/50 px-1.5 py-0.5 text-[10px] font-medium text-green-600">{t("review.tierAuto")}</span>
                      ) : (
                        <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{t("review.tierReview")}</span>
                      )}
                      {c.reason && <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={c.reason}>{c.reason}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {proposed && (
                          <Button variant="outline" size="sm" className="h-7 gap-1 px-2" disabled={busy}
                            title={t("review.moveSavedConfirm")} onClick={() => confirm(c, proposed.id)}>
                            <Check className="size-3.5 text-green-600" /> {t("review.toSaved")}
                          </Button>
                        )}
                        <Button variant="outline" size="sm" className="h-7 gap-1 px-2" disabled={busy}
                          title={t("review.moveSavedCreate")} onClick={() => setCreateFor(c)}>
                          <Plus className="size-3.5 text-green-600" /> {t("review.toSaved")}
                        </Button>
                        <Button variant="outline" size="icon" className="size-7" disabled={busy}
                          title={t("review.matchExistingTitle")} onClick={() => setMatchFor({ c, alias: false })}>
                          <Search className="size-3.5" />
                        </Button>
                        {cfg.rpcAlias && (
                          <Button variant="outline" size="sm" className="h-7 gap-1 px-2" disabled={busy}
                            title={t("review.toAliasTitle")} onClick={() => setMatchFor({ c, alias: true })}>
                            <Link2 className="size-3.5" /> {t("review.toAlias")}
                          </Button>
                        )}
                        {bucket !== "nonexistant" && (
                          <Button variant="outline" size="sm" className="h-7 gap-1 px-2" disabled={busy}
                            title={t("review.toNonexistTitle")} onClick={() => reject(c)}>
                            <X className="size-3.5 text-destructive" /> {t("review.toNonexist")}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && candidates.length < total && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            {t("review.loadMore").replace("{n}", String(Math.min(PAGE_SIZE, total - candidates.length)))}
          </Button>
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

  // Start with an empty search: the default results are the cards you already have
  // for this candidate's exact set + card number, so you can see (and match/alias to)
  // your existing variants immediately instead of hunting by name.
  if (candidate && seeded !== candidate.candidate_id) {
    setSearch("");
    setSeeded(candidate.candidate_id);
    setError(null);
  }

  useEffect(() => {
    if (!candidate) { setResults([]); return; }
    const q = search.trim();
    const f = candidate.source_fields ?? {};
    const setc = f.set_code ?? "";
    const num = f.card_number ?? "";
    const h = setTimeout(async () => {
      const client = createClient();
      let query = client.from(cfg.catalogTable).select(cfg.catalogSelect);
      if (q) {
        // Free search across name + set code + card number, plus the card's
        // uid (full or displayed 8-hex prefix) and an exact platform external
        // id - shared semantics with the Card Index (lib/card-search).
        const safe = q.replace(/[%,]/g, " ");
        const extIds = await externalIdMatches(client, cfg.extIdsTable, cfg.idCol, q);
        const parts = [`${cfg.nameCol}.ilike.%${safe}%`, `set_code.ilike.%${safe}%`];
        if (cfg.numberCol) parts.push(`${cfg.numberCol}.ilike.%${safe}%`);
        query = query.or(searchOrFilter(parts, q, cfg.uidCol, cfg.idCol, extIds));
      } else if (setc) {
        // Default: your existing cards for this exact set (+ number), i.e. "what you already have".
        query = query.eq("set_code", setc);
        if (cfg.numberCol && num) query = query.eq(cfg.numberCol, num);
      } else {
        setResults([]);
        return;
      }
      const { data } = await query.limit(20);
      setResults(((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r[cfg.idCol] as number, name: (r[cfg.nameCol] as string) ?? "", subtitle: cfg.subtitle(r),
      })));
    }, 300);
    return () => clearTimeout(h);
  }, [search, cfg, candidate]);

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
          <p className="text-xs text-muted-foreground">
            {t("review.matchFrom").replace("{name}", candidate.source_name)}{" "}
            <span className="font-mono text-foreground">
              {[candidate.source_fields?.set_code, candidate.source_fields?.card_number, candidate.source_fields?.misc_info]
                .filter((v) => v && v !== "UNKNOWN").join(" · ")}
            </span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t("review.matchExistingHint")}</p>
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Check, X, Plus, Search, ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { Badge } from "@/components/ui/badge";
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

// Match review queue (docs/match_review_pipeline.md): the curator empties the
// cloud candidate table the backend fills. Each row stores only the source side
// plus a pointer to the proposed product; the catalog side rendered here is
// resolved from that pointer, never duplicated onto the candidate.

interface ProductLink {
  platform_name: string;
  external_reference_id: string;
}
interface ProductLite {
  product_id: number;
  product_uid: string;
  name: string;
  english_name: string | null;
  set_code: string;
  product_type: string;
  language: string;
  misc_info: string;
  variant_edition: string;
  sealed_condition: string;
  links: ProductLink[];
}
interface Candidate {
  candidate_id: number;
  source_platform: string;
  source_key: string;
  source_name: string;
  source_raw: string | null;
  source_fields: Record<string, string> | null;
  source_image_url: string | null;
  proposed_product_id: number | null;
  candidate_product_ids: number[] | null;
  confidence: number | null;
  reason: string | null;
}

const PRODUCT_COLS =
  "product_id, product_uid, name, english_name, set_code, product_type, language, misc_info, variant_edition, sealed_condition";
const PLATFORM_SHORT: Record<string, string> = {
  pricecharting: "PC",
  tcgplayer: "TCG",
  snkrdunk: "SNKR",
  collectr: "COLL",
};
function anchorURL(platform: string, id: string): string | null {
  switch (platform) {
    case "pricecharting":
      return `https://www.pricecharting.com/game/${id}`;
    case "snkrdunk":
      return `https://snkrdunk.com/apparels/${id}`;
    case "tcgplayer":
      return `https://www.tcgplayer.com/product/${id}`;
    default:
      return null;
  }
}

interface QueueData {
  candidates: Candidate[];
  products: Map<number, ProductLite>;
}

async function fetchQueue(): Promise<QueueData> {
  const supabase = createClient();
  const { data: rows, error } = await supabase
    .from("pokemon_sealed_match_candidates")
    .select(
      "candidate_id, source_platform, source_key, source_name, source_raw, source_fields, source_image_url, proposed_product_id, candidate_product_ids, confidence, reason",
    )
    .eq("status", "pending")
    .order("confidence", { ascending: false, nullsFirst: false })
    .order("candidate_id", { ascending: true })
    .limit(200);
  if (error) throw error;
  const candidates = (rows ?? []) as Candidate[];

  const pids = new Set<number>();
  for (const c of candidates) {
    if (c.proposed_product_id) pids.add(c.proposed_product_id);
    for (const id of c.candidate_product_ids ?? []) pids.add(id);
  }
  const products = new Map<number, ProductLite>();
  if (pids.size) {
    const ids = [...pids];
    const { data: prows, error: perr } = await supabase
      .from("pokemon_sealed_products")
      .select(PRODUCT_COLS)
      .in("product_id", ids);
    if (perr) throw perr;
    const { data: links, error: lerr } = await supabase
      .from("pokemon_sealed_external_identifiers")
      .select("product_id, platform_name, external_reference_id")
      .in("product_id", ids);
    if (lerr) throw lerr;
    const linkMap = new Map<number, ProductLink[]>();
    for (const l of (links ?? []) as ({ product_id: number } & ProductLink)[]) {
      const arr = linkMap.get(l.product_id) ?? [];
      arr.push({ platform_name: l.platform_name, external_reference_id: l.external_reference_id });
      linkMap.set(l.product_id, arr);
    }
    for (const p of (prows ?? []) as Omit<ProductLite, "links">[]) {
      products.set(p.product_id, {
        ...p,
        links: (linkMap.get(p.product_id) ?? []).sort((a, b) =>
          a.platform_name.localeCompare(b.platform_name),
        ),
      });
    }
  }
  return { candidates, products };
}

function Anchors({ links }: { links: ProductLink[] }) {
  if (!links.length) return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {links.map((l) => {
        const url = anchorURL(l.platform_name, l.external_reference_id);
        const label = `${PLATFORM_SHORT[l.platform_name] ?? l.platform_name} ${l.external_reference_id}`;
        return url ? (
          <a
            key={l.platform_name + l.external_reference_id}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            {label}
          </a>
        ) : (
          <span
            key={l.platform_name + l.external_reference_id}
            className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground"
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

export default function MatchReviewView() {
  const { t } = useTranslation();
  const { data, error, isLoading, retry } = useSupabaseQuery(["match-review"], fetchQueue);
  const candidates = data?.candidates ?? [];
  const products = data?.products ?? new Map<number, ProductLite>();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [createFor, setCreateFor] = useState<Candidate | null>(null);
  const [matchFor, setMatchFor] = useState<Candidate | null>(null);

  const platforms = useMemo(
    () => Array.from(new Set(candidates.map((c) => c.source_platform))).sort(),
    [candidates],
  );

  async function confirm(c: Candidate, productId: number) {
    setBusyId(c.candidate_id);
    setErr(null);
    const supabase = createClient();
    const { error: e } = await supabase.rpc("card_index_resolve_candidate_confirm", {
      p_candidate_id: c.candidate_id,
      p_product_id: productId,
    });
    setBusyId(null);
    if (e) setErr(e.message);
    else retry();
  }
  async function reject(c: Candidate) {
    setBusyId(c.candidate_id);
    setErr(null);
    const supabase = createClient();
    const { error: e } = await supabase.rpc("card_index_resolve_candidate_reject", {
      p_candidate_id: c.candidate_id,
    });
    setBusyId(null);
    if (e) setErr(e.message);
    else retry();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{t("review.title")}</h1>
        <Badge variant="outline">{t("game.pokemon_sealed")}</Badge>
        {!isLoading && (
          <span className="text-sm text-muted-foreground">
            {t("review.count").replace("{n}", String(candidates.length))}
            {platforms.length > 0 && ` · ${platforms.join(", ")}`}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("review.hint")}</p>
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
                <th className="w-[26%] px-3 py-2 font-medium">{t("review.colSource")}</th>
                <th className="w-[30%] px-3 py-2 font-medium">{t("review.colMatch")}</th>
                <th className="w-[22%] px-3 py-2 font-medium">{t("review.colAnchors")}</th>
                <th className="w-[10%] px-3 py-2 font-medium">{t("review.colConfidence")}</th>
                <th className="w-[12%] px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const proposed = c.proposed_product_id ? products.get(c.proposed_product_id) : null;
                const picks = (c.candidate_product_ids ?? [])
                  .map((id) => products.get(id))
                  .filter(Boolean) as ProductLite[];
                const busy = busyId === c.candidate_id;
                const fields = c.source_fields ?? {};
                return (
                  <tr key={c.candidate_id} className="border-b align-top last:border-0">
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-2">
                        {c.source_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.source_image_url}
                            alt=""
                            className="h-10 w-7 shrink-0 rounded border object-cover"
                          />
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
                            {[fields.set_code, fields.product_type, fields.language]
                              .filter((v) => v && v !== "UNKNOWN" && v !== "UNKNOWN_PRODUCT_TYPE")
                              .join(" · ")}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {proposed ? (
                        <div className="min-w-0">
                          <div className="truncate font-medium">{proposed.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[
                              proposed.product_type,
                              proposed.language,
                              proposed.set_code !== "UNKNOWN" ? proposed.set_code : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}{" "}
                            <span className="font-mono">{proposed.product_uid.slice(0, 8)}</span>
                          </div>
                        </div>
                      ) : picks.length > 0 ? (
                        <div className="space-y-1">
                          {picks.map((p) => (
                            <button
                              key={p.product_id}
                              type="button"
                              disabled={busy}
                              onClick={() => confirm(c, p.product_id)}
                              className="block w-full truncate rounded border px-1.5 py-0.5 text-left text-xs hover:border-primary hover:bg-muted"
                            >
                              {p.name}{" "}
                              <span className="text-muted-foreground">{p.product_type}</span>
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
                      {c.reason && (
                        <div className="truncate text-[10px] text-muted-foreground">{c.reason}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {proposed && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="size-7"
                            disabled={busy}
                            title={t("review.confirm")}
                            onClick={() => confirm(c, proposed.product_id)}
                          >
                            <Check className="size-3.5 text-green-600" />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-7"
                          disabled={busy}
                          title={t("review.match")}
                          onClick={() => setMatchFor(c)}
                        >
                          <Search className="size-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-7"
                          disabled={busy}
                          title={t("review.create")}
                          onClick={() => setCreateFor(c)}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="size-7"
                          disabled={busy}
                          title={t("review.reject")}
                          onClick={() => reject(c)}
                        >
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

      <CreateFromCandidate
        candidate={createFor}
        open={!!createFor}
        onOpenChange={(o) => {
          if (!o) setCreateFor(null);
        }}
        onCreated={() => {
          setCreateFor(null);
          retry();
        }}
      />
      <MatchToExisting
        candidate={matchFor}
        open={!!matchFor}
        onOpenChange={(o) => {
          if (!o) setMatchFor(null);
        }}
        onMatched={() => {
          setMatchFor(null);
          retry();
        }}
      />
    </div>
  );
}

// MatchToExisting confirms the candidate onto an EXISTING product the curator
// finds by search - the "this box already exists, don't create a duplicate" path.
function MatchToExisting({
  candidate,
  open,
  onOpenChange,
  onMatched,
}: {
  candidate: Candidate | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onMatched: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ product_id: number; name: string; set_code: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<number | null>(null);

  // Seed the search box with the candidate's name when it opens.
  if (candidate && seeded !== candidate.candidate_id) {
    setSearch(candidate.source_name);
    setSeeded(candidate.candidate_id);
    setError(null);
  }

  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const h = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("pokemon_sealed_products")
        .select("product_id, name, set_code")
        .ilike("name", `%${q.replace(/[%,]/g, " ")}%`)
        .limit(8);
      setResults((data as { product_id: number; name: string; set_code: string }[]) ?? []);
    }, 300);
    return () => clearTimeout(h);
  }, [search]);

  async function matchTo(productId: number) {
    if (!candidate) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.rpc("card_index_resolve_candidate_confirm", {
      p_candidate_id: candidate.candidate_id,
      p_product_id: productId,
    });
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    onMatched();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("review.matchTitle")}</DialogTitle>
        </DialogHeader>
        {candidate && (
          <p className="text-xs text-muted-foreground">
            {t("review.matchFrom").replace("{name}", candidate.source_name)}
          </p>
        )}
        <Input
          placeholder={t("review.matchSearch")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {results.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("review.noResults")}</p>
          ) : (
            results.map((r) => (
              <button
                key={r.product_id}
                type="button"
                disabled={busy}
                onClick={() => matchTo(r.product_id)}
                className="flex w-full items-center justify-between rounded border px-2 py-1.5 text-left text-sm hover:border-primary hover:bg-muted"
              >
                <span className="truncate">{r.name}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                  {r.set_code !== "UNKNOWN" ? r.set_code : ""}
                </span>
              </button>
            ))
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PRODUCT_TYPES = [
  "booster_box",
  "booster_bundle",
  "booster_pack",
  "elite_trainer_box",
  "premium_collection",
  "build_battle_box",
  "special_collection",
  "tin",
  "pokecenter_exclusive",
  "vintage_box",
  "other",
];
const EDITIONS = ["standard", "1ed", "unlimited"];
const CONDITIONS = ["standard", "shrink", "no_shrink"];
const selectClass =
  "h-9 w-full rounded-md border bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

// CreateFromCandidate mints a new product from a candidate's source identity and
// links the source in one transaction (card_index_resolve_candidate_create) - the
// single-source path (a snkrdunk-only / collectr-only product). Prefilled from
// the candidate; the curator tunes and confirms.
function CreateFromCandidate({
  candidate,
  open,
  onOpenChange,
  onCreated,
}: {
  candidate: Candidate | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const f = candidate?.source_fields ?? {};
  const [form, setForm] = useState({
    name: "",
    english_name: "",
    set_code: "",
    product_type: "booster_box",
    language: "jp",
    misc_info: "",
    variant_edition: "standard",
    sealed_condition: "standard",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<number | null>(null);

  // Seed the form once per candidate (cheap, avoids a useEffect).
  if (candidate && seeded !== candidate.candidate_id) {
    const norm = (v?: string) => (v && !v.startsWith("UNKNOWN") ? v : "");
    setForm({
      name: candidate.source_name,
      english_name: "",
      set_code: norm(f.set_code) || "UNKNOWN",
      product_type: norm(f.product_type) || "booster_box",
      language: f.language || "jp",
      misc_info: norm(f.misc_info) || "UNKNOWN",
      variant_edition: f.variant_edition || "standard",
      sealed_condition: "standard",
    });
    setSeeded(candidate.candidate_id);
    setError(null);
  }

  const set = (k: keyof typeof form, v: string) => setForm((p) => ({ ...p, [k]: v }));

  async function create() {
    if (!candidate) return;
    if (!form.name.trim()) {
      setError(t("cardIndex.nameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.rpc("card_index_resolve_candidate_create", {
      p_candidate_id: candidate.candidate_id,
      p_name: form.name,
      p_english_name: form.english_name,
      p_set_code: form.set_code,
      p_product_type: form.product_type,
      p_language: form.language,
      p_misc_info: form.misc_info,
      p_variant_edition: form.variant_edition,
      p_sealed_condition: form.sealed_condition,
      p_image_url: candidate.source_image_url ?? "",
    });
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("review.createTitle")}</DialogTitle>
        </DialogHeader>
        {candidate && (
          <p className="text-xs text-muted-foreground">
            {t("review.createFrom")
              .replace("{platform}", candidate.source_platform)
              .replace("{key}", candidate.source_key)}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label>{t("cardIndex.fName")}</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
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
            <Label>{t("cardIndex.fLanguage")}</Label>
            <Input value={form.language} onChange={(e) => set("language", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("cardIndex.fType")}</Label>
            <select
              className={selectClass}
              value={form.product_type}
              onChange={(e) => set("product_type", e.target.value)}
            >
              {PRODUCT_TYPES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t("cardIndex.fEdition")}</Label>
            <select
              className={selectClass}
              value={form.variant_edition}
              onChange={(e) => set("variant_edition", e.target.value)}
            >
              {EDITIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t("cardIndex.fCondition")}</Label>
            <select
              className={selectClass}
              value={form.sealed_condition}
              onChange={(e) => set("sealed_condition", e.target.value)}
            >
              {CONDITIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>{t("cardIndex.fMisc")}</Label>
            <Input value={form.misc_info} onChange={(e) => set("misc_info", e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={create} disabled={busy || !form.name.trim()}>
            {busy ? t("common.saving") : t("review.createConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

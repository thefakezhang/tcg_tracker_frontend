"use client";

import { useState } from "react";
import { Library, Search, ImageOff, Pencil, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { externalIdMatches, smartSearchFilters } from "@/lib/card-search";
import { selectAll } from "@/lib/supabase/select-all";
import { platformUrl } from "@/lib/platform-url";
import { ZoomableImage } from "@/components/ui/zoomable-image";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useDebouncedValue } from "./use-card-data";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import CardIndexEditModal from "./CardIndexEditModal";
import CardIndexCreateModal from "./CardIndexCreateModal";
import PokemonCardIndex from "./PokemonCardIndex";
import MtgCardIndex from "./MtgCardIndex";

type Catalog = "pokemon_sealed" | "pokemon" | "mtg";

// Read-only browser over the owned sealed-product identity (Stage 3 of the
// card-index refactor). Each row shows the durable product_uid, the identity
// attributes, the platform links, and the image source. Editing, link, and
// merge/split land in follow-ups; this is the catalog surface they build on.

interface ProductLink {
  platform_name: string;
  external_reference_id: string;
}

interface IndexProduct {
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
  image_url: string | null;
  links: ProductLink[];
}

const PRODUCT_COLS =
  "product_id, product_uid, name, english_name, set_code, product_type, language, misc_info, variant_edition, sealed_condition, image_url";

const CATALOG_PAGE = 500;

// The set of platforms sealed products can carry an external ID on. Also
// drives the chip filter above the results table - pinned here so
// PLATFORM_SHORT and the filter list can't drift.
const SEALED_PLATFORMS = ["pricecharting", "tcgplayer", "snkrdunk", "collectr"] as const;

async function fetchIndex(
  search: string,
  limit: number,
  platforms: string[],
): Promise<{ products: IndexProduct[]; total: number }> {
  const supabase = createClient();
  const s = search.trim();
  // Text term + product_uid (full or displayed 8-hex prefix) + exact platform
  // external id - shared semantics with the curation pickers (lib/card-search).
  // Multi-word terms AND together via one chained or() per token.
  const extIds = await externalIdMatches(supabase, "pokemon_sealed_external_identifiers", "product_id", s);
  const orFilters = smartSearchFilters(
    s,
    ["name", "english_name", "set_code"],
    "product_uid",
    "product_id",
    extIds,
  );

  // When the operator selected one or more source chips, gate every product
  // query on the products carrying an ID for at least one of those platforms.
  // Empty selection = no gate (show everything).
  //
  // Expressed as an inner join in Postgres. The previous approach read the id
  // list into the client, which PostgREST truncates at 1000 rows with no error:
  // sealed is small enough that a single chip stays under the cap today, but
  // pricecharting + snkrdunk + tcgplayer together already select 1,007 rows, so
  // products silently disappeared from multi-chip filters - and the same
  // truncated list gated the count, so nothing looked wrong. Same bug as the
  // singles indexes, only masked by a smaller catalog. See lib/supabase/select-all.ts.
  const gated = platforms.length > 0;
  const gateSelect = gated ? ", pokemon_sealed_external_identifiers!inner(platform_name)" : "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyGate = (q: any) =>
    gated ? q.in("pokemon_sealed_external_identifiers.platform_name", platforms) : q;

  let cq = supabase.from("pokemon_sealed_products").select(`product_id${gateSelect}`, { count: "exact", head: true });
  if (s) for (const f of orFilters) cq = cq.or(f);
  cq = applyGate(cq);
  const { count: total } = await cq;
  let q = supabase
    .from("pokemon_sealed_products")
    .select(`${PRODUCT_COLS}${gateSelect}`)
    .order("name", { ascending: true })
    .limit(limit);
  if (s) {
    for (const f of orFilters) q = q.or(f);
  }
  q = applyGate(q);
  const { data, error } = await q;
  if (error) throw error;
  // Drop the join-only embed so it can't leak into the rendered product object.
  const rows = ((data ?? []) as Record<string, unknown>[]).map(
    ({ pokemon_sealed_external_identifiers: _gate, ...r }) => r,
  ) as unknown as Omit<IndexProduct, "links">[];

  // Batch-fetch the platform links for these products (avoids an N+1 join).
  const ids = rows.map((r) => r.product_id);
  const linkMap = new Map<number, ProductLink[]>();
  if (ids.length) {
    // Fans out ~1 row per platform per product, so a full page outgrows the
    // PostgREST 1000-row cap and anchors vanish silently. See selectAll.
    const links = await selectAll<{ product_id: number } & ProductLink>(
      () => supabase
        .from("pokemon_sealed_external_identifiers")
        .select("product_id, platform_name, external_reference_id")
        .in("product_id", ids),
      ["product_id", "platform_name"],
    );
    for (const l of links) {
      const arr = linkMap.get(l.product_id) ?? [];
      arr.push({
        platform_name: l.platform_name,
        external_reference_id: l.external_reference_id,
      });
      linkMap.set(l.product_id, arr);
    }
  }

  return {
    products: rows.map((r) => ({
      ...r,
      links: (linkMap.get(r.product_id) ?? []).sort((a, b) =>
        a.platform_name.localeCompare(b.platform_name),
      ),
    })),
    total: total ?? rows.length,
  };
}

// platformLabel keeps the badges compact and stable in width.
const PLATFORM_SHORT: Record<string, string> = {
  pricecharting: "PC",
  tcgplayer: "TCG",
  snkrdunk: "SNKR",
  collectr: "COLL",
};


// CardIndexView is the dispatcher: a shared header + a per-catalog selector
// (independent of the global game switcher, which scopes the price browser).
// pokemon_sealed and pokemon (singles) are the migrated catalogs; mtg lands when
// it migrates.
export default function CardIndexView() {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<Catalog>("pokemon_sealed");
  return (
    <div className="min-w-0 space-y-4">
      <div data-testid="catalog-index-header" className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Library className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t("catalog.index")}</h1>
        </div>
        <div data-testid="catalog-index-selector" className="grid w-full grid-cols-1 gap-1 sm:ml-2 sm:flex sm:w-auto">
          {(["pokemon_sealed", "pokemon", "mtg"] as const).map((c) => (
            <Button key={c} size="sm" className="w-full sm:w-auto" variant={catalog === c ? "default" : "outline"} onClick={() => setCatalog(c)}>
              {t(`game.${c}` as "game.pokemon_sealed")}
            </Button>
          ))}
        </div>
      </div>
      {catalog === "pokemon_sealed" ? <SealedCardIndex /> : catalog === "pokemon" ? <PokemonCardIndex /> : <MtgCardIndex />}
    </div>
  );
}

function SealedCardIndex() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(CATALOG_PAGE);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const debounced = useDebouncedValue(search, 300);
  // Sorted key so a Set with the same members produces a stable query key
  // regardless of insertion order.
  const platformsKey = Array.from(selectedPlatforms).sort().join(",");

  const { data, error, isLoading, retry } = useSupabaseQuery(
    ["card-index", debounced, String(limit), platformsKey],
    () => fetchIndex(debounced, limit, Array.from(selectedPlatforms)),
  );
  const products = data?.products ?? [];
  const total = data?.total ?? 0;
  const [editing, setEditing] = useState<IndexProduct | null>(null);
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
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-center gap-2">
          {!isLoading && (
            <span className="text-sm text-muted-foreground">
              {t("cardIndex.countOf").replace("{shown}", String(products.length)).replace("{total}", String(total))}
            </span>
          )}
        </div>
        <div className="grid min-w-0 w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:items-center">
          <div className="relative min-w-0 w-full sm:w-72">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-11 pl-8 sm:h-8"
              placeholder={t("cardIndex.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button className="h-11 w-full sm:h-8 sm:w-auto" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> {t("cardIndex.newProduct")}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <MultiSelectFilter
          options={SEALED_PLATFORMS}
          labels={PLATFORM_SHORT}
          selected={selectedPlatforms}
          onToggle={togglePlatform}
          onClear={() => setSelectedPlatforms(new Set())}
          allLabel={t("cardIndex.sourceAll")}
          clearLabel={t("cardIndex.clearFilter")}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t("cardIndex.hint")}</p>

      {error ? (
        <QueryError onRetry={retry} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : products.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("cardIndex.empty")}</p>
      ) : (
        <div data-testid="sealed-index-results" className="overflow-hidden rounded-md border">
          <table className="w-full table-fixed text-sm">
            <thead className="hidden border-b bg-muted/40 text-left text-xs text-muted-foreground sm:table-header-group">
              <tr>
                <th className="w-[42%] px-3 py-2 font-medium">{t("cardIndex.colCard")}</th>
                <th className="w-[16%] px-3 py-2 font-medium">{t("cardIndex.colVariant")}</th>
                <th className="w-[30%] px-3 py-2 font-medium">{t("cardIndex.colLinks")}</th>
                <th className="w-[12%] px-3 py-2 font-medium">{t("cardIndex.colUid")}</th>
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {products.map((p) => (
                <tr key={p.product_uid} className="block border-b p-3 last:border-0 sm:table-row sm:p-0">
                  <td className="block p-0 pb-2 sm:table-cell sm:px-3 sm:py-2">
                    <div className="flex items-center gap-3">
                      {p.image_url ? (
                        <ZoomableImage src={p.image_url} className="h-10 w-7 rounded border object-cover" />
                      ) : (
                        <div className="flex h-10 w-7 items-center justify-center rounded border bg-muted">
                          <ImageOff className="size-3 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[
                            p.english_name,
                            p.set_code !== "UNKNOWN" ? p.set_code : null,
                            p.product_type,
                            p.language,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="block p-0 py-1 sm:table-cell sm:px-3 sm:py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {p.sealed_condition !== "standard" && (
                        <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                          {p.sealed_condition}
                        </Badge>
                      )}
                      {p.variant_edition !== "standard" && (
                        <Badge variant="outline">{p.variant_edition}</Badge>
                      )}
                      {p.misc_info && p.misc_info !== "UNKNOWN" && (
                        <Badge variant="outline">{p.misc_info}</Badge>
                      )}
                      {p.sealed_condition === "standard" &&
                        p.variant_edition === "standard" &&
                        (!p.misc_info || p.misc_info === "UNKNOWN") && (
                          <span className="hidden text-xs text-muted-foreground sm:inline">-</span>
                        )}
                    </div>
                  </td>
                  <td className="block min-w-0 p-0 py-1 sm:table-cell sm:px-3 sm:py-2">
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {p.links.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {t("cardIndex.noLinks")}
                        </span>
                      ) : (
                        p.links.map((l) => {
                          const url = platformUrl(l.platform_name, l.external_reference_id, "sealed");
                          const label = `${PLATFORM_SHORT[l.platform_name] ?? l.platform_name} ${l.external_reference_id}`;
                          return url ? (
                            <a
                              key={l.platform_name + l.external_reference_id}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
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
                        })
                      )}
                    </div>
                  </td>
                  <td className="mt-2 block border-t p-0 pt-2 sm:mt-0 sm:table-cell sm:border-0 sm:px-3 sm:py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.product_uid.slice(0, 8)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        onClick={() => setEditing(p)}
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

      {!isLoading && products.length < total && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setLimit((n) => n + CATALOG_PAGE)}>
            {t("cardIndex.loadMore").replace("{n}", String(Math.min(CATALOG_PAGE, total - products.length)))}
          </Button>
        </div>
      )}

      <CardIndexEditModal
        product={editing}
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        onSaved={retry}
      />
      <CardIndexCreateModal open={creating} onOpenChange={setCreating} onCreated={retry} />
    </div>
  );
}

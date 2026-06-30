"use client";

import { useState } from "react";
import { Library, Search, ImageOff, Pencil, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useDebouncedValue } from "./use-card-data";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import CardIndexEditModal from "./CardIndexEditModal";
import CardIndexCreateModal from "./CardIndexCreateModal";
import CatalogNotMigrated from "./CatalogNotMigrated";
import { useGame } from "./GameContext";

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

async function fetchIndex(search: string): Promise<IndexProduct[]> {
  const supabase = createClient();
  let q = supabase
    .from("pokemon_sealed_products")
    .select(PRODUCT_COLS)
    .order("name", { ascending: true })
    .limit(500);
  const s = search.trim();
  if (s) {
    const safe = s.replace(/[%,]/g, " ");
    q = q.or(
      `name.ilike.%${safe}%,english_name.ilike.%${safe}%,set_code.ilike.%${safe}%`,
    );
  }
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Omit<IndexProduct, "links">[];

  // Batch-fetch the platform links for these products (avoids an N+1 join).
  const ids = rows.map((r) => r.product_id);
  const linkMap = new Map<number, ProductLink[]>();
  if (ids.length) {
    const { data: links, error: lerr } = await supabase
      .from("pokemon_sealed_external_identifiers")
      .select("product_id, platform_name, external_reference_id")
      .in("product_id", ids);
    if (lerr) throw lerr;
    for (const l of (links ?? []) as ({ product_id: number } & ProductLink)[]) {
      const arr = linkMap.get(l.product_id) ?? [];
      arr.push({
        platform_name: l.platform_name,
        external_reference_id: l.external_reference_id,
      });
      linkMap.set(l.product_id, arr);
    }
  }

  return rows.map((r) => ({
    ...r,
    links: (linkMap.get(r.product_id) ?? []).sort((a, b) =>
      a.platform_name.localeCompare(b.platform_name),
    ),
  }));
}

// platformLabel keeps the badges compact and stable in width.
const PLATFORM_SHORT: Record<string, string> = {
  pricecharting: "PC",
  tcgplayer: "TCG",
  snkrdunk: "SNKR",
  collectr: "COLL",
};

function platformLinkURL(platform: string, id: string): string | null {
  switch (platform) {
    case "pricecharting":
      return `https://www.pricecharting.com/game/${id}`;
    case "snkrdunk":
      return `https://snkrdunk.com/apparels/${id}`;
    default:
      return null;
  }
}

export default function CardIndexView() {
  const { t } = useTranslation();
  const { activeGame } = useGame();
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);

  const { data, error, isLoading, retry } = useSupabaseQuery(
    ["card-index", debounced],
    () => fetchIndex(debounced),
  );
  const products = data ?? [];
  const [editing, setEditing] = useState<IndexProduct | null>(null);
  const [creating, setCreating] = useState(false);

  // Only pokemon_sealed has been through the owned-identity refactor so far.
  if (activeGame !== "pokemon_sealed") {
    return <CatalogNotMigrated game={activeGame} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Library className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t("catalog.index")}</h1>
          {!isLoading && (
            <span className="text-sm text-muted-foreground">
              {t("cardIndex.count").replace("{n}", String(products.length))}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-72">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={t("cardIndex.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> {t("cardIndex.newProduct")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("cardIndex.hint")}</p>

      {error ? (
        <QueryError onRetry={retry} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : products.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("cardIndex.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-[42%] px-3 py-2 font-medium">{t("cardIndex.colCard")}</th>
                <th className="w-[16%] px-3 py-2 font-medium">{t("cardIndex.colVariant")}</th>
                <th className="w-[30%] px-3 py-2 font-medium">{t("cardIndex.colLinks")}</th>
                <th className="w-[12%] px-3 py-2 font-medium">{t("cardIndex.colUid")}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.product_uid} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image_url}
                          alt=""
                          className="h-10 w-7 rounded border object-cover"
                        />
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
                  <td className="px-3 py-2">
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
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {p.links.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {t("cardIndex.noLinks")}
                        </span>
                      ) : (
                        p.links.map((l) => {
                          const url = platformLinkURL(l.platform_name, l.external_reference_id);
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
                  <td className="px-3 py-2">
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

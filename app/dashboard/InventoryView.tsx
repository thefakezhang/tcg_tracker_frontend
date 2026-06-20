"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useLanguage } from "./LanguageContext";
import { getCardDisplayName } from "./use-card-data";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// Master inventory = everything currently on hand, across all trips and both
// legs. inventory_holdings_v aggregates qty_remaining by SKU+leg; image_url and
// english_name aren't in the view, so we batch-fetch them by id.
interface Holding {
  game: string;
  item_type: "single" | "sealed";
  leg: string;
  card_id: number | null;
  product_id: number | null;
  name: string;
  set_code: string;
  condition_id: number | null;
  psa_grade: number | null;
  sealed_condition: string | null;
  variant_edition: string | null;
  qty_on_hand: number;
  avg_cost_usd: number;
  total_cost_usd: number;
  imageUrl: string | null;
  englishName: string | null;
}

export default function InventoryView() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [leg, setLeg] = useState<"all" | "import" | "export">("all");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  const fetchHoldings = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("inventory_holdings_v")
      .select("game, item_type, leg, card_id, product_id, name, set_code, condition_id, psa_grade, sealed_condition, variant_edition, qty_on_hand, avg_cost_usd, total_cost_usd")
      .order("total_cost_usd", { ascending: false });
    const rows = ((data as Omit<Holding, "imageUrl" | "englishName">[]) ?? []).map(
      (h) => ({ ...h, imageUrl: null as string | null, englishName: null as string | null })
    );

    // batch-fetch image_url (+ english_name for pokemon) by id, per source table
    const byGame = (g: string) => rows.filter((r) => r.game === g);
    const fetchDefs = async (table: string, idCol: string, ids: number[], cols: string) => {
      if (ids.length === 0) return new Map<number, { image_url: string | null; english_name?: string | null }>();
      const { data: defs } = await supabase.from(table).select(cols).in(idCol, ids);
      const m = new Map<number, { image_url: string | null; english_name?: string | null }>();
      for (const d of (defs as unknown as Record<string, unknown>[]) ?? []) m.set(d[idCol] as number, { image_url: (d.image_url as string) ?? null, english_name: (d.english_name as string) ?? null });
      return m;
    };
    const [pkm, mtg, sealed] = await Promise.all([
      fetchDefs("pokemon_card_definitions", "card_id", byGame("pokemon").map((r) => r.card_id!).filter(Boolean), "card_id, image_url, english_name"),
      fetchDefs("mtg_card_definitions_v", "card_id", byGame("mtg").map((r) => r.card_id!).filter(Boolean), "card_id, image_url"),
      fetchDefs("pokemon_sealed_products", "product_id", byGame("pokemon_sealed").map((r) => r.product_id!).filter(Boolean), "product_id, image_url"),
    ]);
    for (const r of rows) {
      const hit = r.game === "pokemon" ? pkm.get(r.card_id!) : r.game === "mtg" ? mtg.get(r.card_id!) : sealed.get(r.product_id!);
      if (hit) { r.imageUrl = hit.image_url; r.englishName = hit.english_name ?? null; }
    }
    setHoldings(rows);
    setLoading(false);
  }, []);

  useEffect(() => { fetchHoldings(); }, [fetchHoldings]);

  const label = useCallback(
    (h: Holding) => getCardDisplayName({ regional_name: h.name, english_name: h.englishName }, language),
    [language]
  );

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return holdings.filter((h) =>
      (leg === "all" || h.leg === leg) &&
      (!s || h.name.toLowerCase().includes(s) || (h.englishName ?? "").toLowerCase().includes(s) || h.set_code.toLowerCase().includes(s))
    );
  }, [holdings, search, leg]);

  const totals = useMemo(() => ({
    qty: rows.reduce((a, h) => a + h.qty_on_hand, 0),
    cost: rows.reduce((a, h) => a + Number(h.total_cost_usd), 0),
  }), [rows]);

  const detail = (h: Holding) =>
    h.item_type === "sealed" ? `${h.sealed_condition}/${h.variant_edition}` : h.psa_grade ? `PSA ${h.psa_grade}` : t("inventory.raw");
  const keyOf = (h: Holding) => `${h.game}-${h.card_id ?? h.product_id}-${h.condition_id ?? h.sealed_condition}-${h.psa_grade ?? h.variant_edition}-${h.leg}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="text-lg font-semibold">{t("inventory.title")}</h2>
        <div className="ml-auto flex items-end gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(String(v) as "list" | "grid")}>
            <TabsList>
              <TabsTrigger value="list">{t("cardBrowser.list")}</TabsTrigger>
              <TabsTrigger value="grid">{t("cardBrowser.grid")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div>
            <Label className="text-xs">{t("inventory.leg")}</Label>
            <select value={leg} onChange={(e) => setLeg(e.target.value as typeof leg)}
              className="h-9 w-28 rounded-md border bg-background px-2 text-sm">
              <option value="all">{t("inventory.allLegs")}</option>
              <option value="import">{t("trips.legImport")}</option>
              <option value="export">{t("trips.legExport")}</option>
            </select>
          </div>
          <Input placeholder={t("inventory.search")} value={search}
            onChange={(e) => setSearch(e.target.value)} className="h-9 w-56" />
        </div>
      </div>

      <div className="flex gap-3 text-sm text-muted-foreground">
        <span>{t("inventory.distinct", { n: rows.length })}</span>
        <span>{t("inventory.totalQty", { n: totals.qty })}</span>
        <span>{t("inventory.totalCost", { usd: totals.cost.toFixed(2) })}</span>
      </div>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {rows.map((h) => (
            <Card key={keyOf(h)} size="sm" className="gap-0 overflow-hidden !py-0">
              {h.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={h.imageUrl} alt={label(h)} loading="lazy" className="aspect-[5/7] w-full object-cover" />
              ) : (
                <div className="flex aspect-[5/7] w-full items-center justify-center bg-muted"><ImageOff className="size-8 text-muted-foreground" /></div>
              )}
              <CardContent className="space-y-1 p-2">
                <div className="truncate text-xs font-medium">{label(h)}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-[10px]">{t(h.leg === "export" ? "trips.legExport" : "trips.legImport")}</Badge>
                  <span className="truncate">{detail(h)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>×{h.qty_on_hand}</span>
                  <span>${Number(h.total_cost_usd).toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
          {!loading && rows.length === 0 && <p className="col-span-full text-sm text-muted-foreground">{t("inventory.empty")}</p>}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("trips.item")}</TableHead>
              <TableHead className="w-20">{t("trips.leg")}</TableHead>
              <TableHead className="w-28">{t("inventory.detail")}</TableHead>
              <TableHead className="w-16">{t("trips.qty")}</TableHead>
              <TableHead className="w-24">{t("trips.avgCost")}</TableHead>
              <TableHead className="w-28">{t("inventory.totalCostCol")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((h) => (
              <TableRow key={keyOf(h)}>
                <TableCell className="truncate max-w-[320px]">{label(h)} · {h.set_code}</TableCell>
                <TableCell><Badge variant="secondary" className="text-[10px]">{t(h.leg === "export" ? "trips.legExport" : "trips.legImport")}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{detail(h)}</TableCell>
                <TableCell>{h.qty_on_hand}</TableCell>
                <TableCell>${h.avg_cost_usd}</TableCell>
                <TableCell>${Number(h.total_cost_usd).toFixed(2)}</TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">{t("inventory.empty")}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

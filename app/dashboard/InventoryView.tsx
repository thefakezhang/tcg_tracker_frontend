"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// Master inventory = everything currently on hand, across all trips and both
// legs. inventory_holdings_v already aggregates qty_remaining by SKU+leg.
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
}

export default function InventoryView() {
  const { t } = useTranslation();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [leg, setLeg] = useState<"all" | "import" | "export">("all");

  const fetchHoldings = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("inventory_holdings_v")
      .select("game, item_type, leg, card_id, product_id, name, set_code, condition_id, psa_grade, sealed_condition, variant_edition, qty_on_hand, avg_cost_usd, total_cost_usd")
      .order("total_cost_usd", { ascending: false });
    setHoldings((data as Holding[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchHoldings(); }, [fetchHoldings]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return holdings.filter((h) =>
      (leg === "all" || h.leg === leg) &&
      (!s || h.name.toLowerCase().includes(s) || h.set_code.toLowerCase().includes(s))
    );
  }, [holdings, search, leg]);

  const totals = useMemo(() => ({
    qty: rows.reduce((a, h) => a + h.qty_on_hand, 0),
    cost: rows.reduce((a, h) => a + Number(h.total_cost_usd), 0),
  }), [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="text-lg font-semibold">{t("inventory.title")}</h2>
        <div className="ml-auto flex items-end gap-2">
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
            <TableRow key={`${h.game}-${h.card_id ?? h.product_id}-${h.condition_id ?? h.sealed_condition}-${h.psa_grade ?? h.variant_edition}-${h.leg}`}>
              <TableCell className="truncate max-w-[320px]">{h.name} · {h.set_code}</TableCell>
              <TableCell><Badge variant="secondary" className="text-[10px]">{t(h.leg === "export" ? "trips.legExport" : "trips.legImport")}</Badge></TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {h.item_type === "sealed"
                  ? `${h.sealed_condition}/${h.variant_edition}`
                  : h.psa_grade ? `PSA ${h.psa_grade}` : t("inventory.raw")}
              </TableCell>
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
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { selectAll, selectAllByIds } from "@/lib/supabase/select-all";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useLanguage } from "./LanguageContext";
import { getCardDisplayName, cardMeta } from "./use-card-data";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { holdingExposureKey, type InventoryExposure } from "./market-events";
import {
  fetchRoiLines, rollupRoi, rollupRoiBy, roiHoldingKey, formatRoiPct, roiToneClass,
  type RoiLine, type RoiSummary,
} from "./theoretical-roi";
import TheoreticalRoiSummary from "./TheoreticalRoiSummary";
import { bumpOwnedInventory } from "./owned-inventory";
import {
  inventoryConsignmentCounts,
  inventoryConsignmentLinesByHolding,
  setInventoryLineConsignment,
  consignInventoryLine,
  recordInventoryLineSale,
  clearInventoryLineConsignment,
} from "./inventory-consignment";
import InventoryConsignmentSheet, { type RecordSaleInput } from "./InventoryConsignmentSheet";
import { formatUsd } from "@/lib/money";
import {
  buildPokemonInventoryShortageArgs,
  type InventoryReconciliationInput,
} from "./inventory-reconciliation";

// Master inventory = everything currently on hand, across all trips and both
// legs. inventory_holdings_v aggregates qty_remaining by SKU+leg; image_url and
// english_name aren't in the view, so we batch-fetch them by id.
interface Holding {
  game: string;
  item_type: "single" | "sealed";
  leg: "import" | "export";
  card_id: number | null;
  product_id: number | null;
  name: string;
  set_code: string;
  card_number: string | null;
  misc_info: string | null;
  condition_id: number | null;
  psa_grade: number | null;
  sealed_condition: string | null;
  variant_edition: string | null;
  qty_on_hand: number;
  avg_cost_usd: number;
  total_cost_usd: number;
  imageUrl: string | null;
  englishName: string | null;
  uid: string | null;
  reprintEvents: InventoryExposure[];
}

interface InventoryHolding extends Holding {
  qty_consigned: number;
  qty_available: number;
}

export default function InventoryView() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [search, setSearch] = useState("");
  const [leg, setLeg] = useState<"all" | "import" | "export">("all");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (window.matchMedia?.("(max-width: 639px)").matches) setViewMode("grid");
  }, []);

  // Holdings and their theoretical ROI load together and are returned together:
  // the leg rollup is computed from the RAW roi lines, never by summing the
  // per-row figures, so a line whose identity has no holdings row still counts
  // toward the leg total instead of vanishing from it.
  const fetchHoldings = useCallback(async (): Promise<{ holdings: Holding[]; roiLines: RoiLine[] }> => {
    const supabase = createClient();
    const holdingsData = await selectAll<Omit<Holding, "imageUrl" | "englishName" | "uid" | "reprintEvents">>(
      () => supabase.from("inventory_holdings_v").select("game, item_type, leg, card_id, product_id, name, set_code, card_number, misc_info, condition_id, psa_grade, sealed_condition, variant_edition, qty_on_hand, avg_cost_usd, total_cost_usd"),
      ["game", "item_type", "leg", "card_id", "product_id", "condition_id", "psa_grade", "sealed_condition", "variant_edition"],
    );
    const rows = holdingsData.map(
      (h) => ({ ...h, imageUrl: null as string | null, englishName: null as string | null, uid: null as string | null, reprintEvents: [] as InventoryExposure[] })
    ).sort((a, b) => Number(b.total_cost_usd) - Number(a.total_cost_usd));

    const exposures = await selectAll<InventoryExposure>(
      () => supabase.from("inventory_reprint_exposure_v").select("game, item_type, leg, card_id, product_id, condition_id, psa_grade, sealed_condition, variant_edition, event_id, event_title, event_kind, starts_on, ends_on, confidence, source_url"),
      ["game", "leg", "card_id", "product_id", "condition_id", "psa_grade", "sealed_condition", "variant_edition", "event_id"],
    );
    const exposureMap = new Map<string, InventoryExposure[]>();
    for (const exposure of exposures) {
      const key = holdingExposureKey(exposure);
      exposureMap.set(key, [...(exposureMap.get(key) ?? []), exposure]);
    }
    for (const row of rows) row.reprintEvents = exposureMap.get(holdingExposureKey(row)) ?? [];

    // batch-fetch image_url (+ english_name for pokemon) by id, per source table
    const byGame = (g: string) => rows.filter((r) => r.game === g);
    const fetchDefs = async (table: string, idCol: string, uidCol: string, ids: number[], cols: string) => {
      if (ids.length === 0) return new Map<number, { image_url: string | null; english_name?: string | null; uid: string | null }>();
      const defs = await selectAllByIds<Record<string, unknown>>(
        ids,
        [idCol],
        (chunk) => supabase.from(table).select(cols).in(idCol, chunk),
      );
      const m = new Map<number, { image_url: string | null; english_name?: string | null; uid: string | null }>();
      for (const d of defs) m.set(d[idCol] as number, { image_url: (d.image_url as string) ?? null, english_name: (d.english_name as string) ?? null, uid: (d[uidCol] as string) ?? null });
      return m;
    };
    const [pkm, mtg, sealed] = await Promise.all([
      fetchDefs("pokemon_card_definitions", "card_id", "card_uid", byGame("pokemon").map((r) => r.card_id!).filter(Boolean), "card_id, card_uid, image_url, english_name"),
      fetchDefs("mtg_card_definitions_v", "card_id", "card_uid", byGame("mtg").map((r) => r.card_id!).filter(Boolean), "card_id, card_uid, image_url"),
      fetchDefs("pokemon_sealed_products", "product_id", "product_uid", byGame("pokemon_sealed").map((r) => r.product_id!).filter(Boolean), "product_id, product_uid, image_url"),
    ]);
    for (const r of rows) {
      const hit = r.game === "pokemon" ? pkm.get(r.card_id!) : r.game === "mtg" ? mtg.get(r.card_id!) : sealed.get(r.product_id!);
      if (hit) { r.imageUrl = hit.image_url; r.englishName = hit.english_name ?? null; r.uid = hit.uid; }
    }
    return { holdings: rows, roiLines: await fetchRoiLines() };
  }, []);

  const { data, error, isLoading, retry } = useSupabaseQuery("inventory-holdings", fetchHoldings);
  const rawHoldings = useMemo(() => data?.holdings ?? [], [data]);
  const roiLines = useMemo(() => data?.roiLines ?? [], [data]);
  const sourceLinesByHolding = useMemo(
    () => inventoryConsignmentLinesByHolding(roiLines),
    [roiLines],
  );
  const holdings = useMemo<InventoryHolding[]>(
    () => rawHoldings.map((holding) => {
      const counts = inventoryConsignmentCounts(
        holding.qty_on_hand,
        sourceLinesByHolding.get(roiHoldingKey(holding)) ?? [],
      );
      return {
        ...holding,
        qty_consigned: counts.consigned,
        qty_available: counts.available,
      };
    }),
    [rawHoldings, sourceLinesByHolding],
  );
  // Card level: one summary per holdings identity, so a row shows the return on
  // exactly the copies it is reporting.
  const roiByHolding = useMemo(
    () => rollupRoiBy(roiLines, (l) => roiHoldingKey(l)),
    [roiLines],
  );
  const holdingRoi = useCallback(
    (h: Holding): RoiSummary | null => roiByHolding.get(roiHoldingKey(h)) ?? null,
    [roiByHolding],
  );

  const label = useCallback(
    (h: Holding) => getCardDisplayName({ regional_name: h.name, english_name: h.englishName }, language),
    [language]
  );

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    // The term also matches the durable uid (full or any prefix, H3) and the
    // card number, so "looking up the card" works with whatever identifier
    // the operator is holding.
    return holdings.filter((h) =>
      (leg === "all" || h.leg === leg) &&
      (!s
        || h.name.toLowerCase().includes(s)
        || (h.englishName ?? "").toLowerCase().includes(s)
        || h.set_code.toLowerCase().includes(s)
        || (h.card_number ?? "").toLowerCase().includes(s)
        || (h.uid ?? "").toLowerCase().startsWith(s))
    );
  }, [holdings, search, leg]);

  // Leg level. Follows the leg selector ONLY - not the search box - because a
  // leg total that moves while you type is not a leg total. The label always
  // names the grain it is reporting, so the two can't be confused.
  const legRoi = useMemo(
    () => rollupRoi(leg === "all" ? roiLines : roiLines.filter((l) => l.leg === leg)),
    [roiLines, leg],
  );

  const totals = useMemo(() => ({
    qty: rows.reduce((a, h) => a + h.qty_on_hand, 0),
    consigned: rows.reduce((a, h) => a + h.qty_consigned, 0),
    available: rows.reduce((a, h) => a + h.qty_available, 0),
    cost: rows.reduce((a, h) => a + Number(h.total_cost_usd), 0),
  }), [rows]);

  const selected = useMemo(
    () => holdings.find((holding) => roiHoldingKey(holding) === selectedKey) ?? null,
    [holdings, selectedKey],
  );
  const selectedLines = useMemo(
    () => selected ? sourceLinesByHolding.get(roiHoldingKey(selected)) ?? [] : [],
    [selected, sourceLinesByHolding],
  );

  // After any consignment write the row is durable; a follow-up read failure is
  // surfaced by the view's QueryError and must not be reported as a failed
  // mutation, so the refresh is best-effort.
  const refreshAfterWrite = useCallback(async () => {
    bumpOwnedInventory();
    await retry().catch(() => undefined);
  }, [retry]);

  // A consignee names WHO the copies are out with (consign_line); with no
  // consignee it is a quantity-only consignment (set_line_consignment).
  const saveConsignment = useCallback(async (line: RoiLine, qty: number, consignee: string) => {
    if (consignee.trim() === "") {
      await setInventoryLineConsignment(line, qty, (args) => createClient().rpc("set_line_consignment", args));
    } else {
      await consignInventoryLine(line, qty, consignee, (args) => createClient().rpc("consign_line", args));
    }
    await refreshAfterWrite();
  }, [refreshAfterWrite]);

  const recordSale = useCallback(async (line: RoiLine, input: RecordSaleInput) => {
    await recordInventoryLineSale(line, input, (args) => createClient().rpc("record_line_consignment_sale", args));
    await refreshAfterWrite();
  }, [refreshAfterWrite]);

  const clearConsignment = useCallback(async (line: RoiLine) => {
    await clearInventoryLineConsignment(line, (args) => createClient().rpc("clear_line_consignment", args));
    await refreshAfterWrite();
  }, [refreshAfterWrite]);

  const reconcileCount = useCallback(async (input: InventoryReconciliationInput) => {
    if (!selected || selected.game !== "pokemon" || selected.item_type !== "single" || selected.card_id == null) {
      throw new Error("Only Pokemon singles can be reconciled from this inventory surface");
    }
    const args = buildPokemonInventoryShortageArgs({
      cardId: selected.card_id,
      conditionId: selected.condition_id,
      psaGrade: selected.psa_grade,
      leg: selected.leg,
      ledgerQuantity: selected.qty_on_hand,
    }, input, new Date().toISOString());
    const { error: mutationError } = await createClient().rpc("record_pokemon_inventory_shortage", args);
    if (mutationError) throw mutationError;
    await refreshAfterWrite();
    setSelectedKey(null);
  }, [refreshAfterWrite, selected]);

  // A holdings row whose lines are all unpriced says so rather than showing a
  // zero, which would read as "worthless" instead of "unknown".
  const renderRoiCell = (r: RoiSummary | null) => {
    if (!r || r.lines === 0) return <span className="text-xs text-muted-foreground">-</span>;
    if (r.priced === 0) return <span className="text-xs text-muted-foreground">{t("roi.unpriced")}</span>;
    return (
      <div className="text-xs">
        <div className="tabular-nums">{formatUsd(r.netUsd)}</div>
        <div className={`tabular-nums ${roiToneClass(r.roiPct)}`}>{formatRoiPct(r.roiPct)}</div>
        {/* The gross market value behind the net, so the column can't be read
            as what the card sells for. */}
        <div className="text-muted-foreground">
          {t("roi.marketGross", { usd: formatUsd(r.grossUsd) })}
          {r.netPct != null && <> · {t("roi.netBasis", { pct: Math.round(r.netPct * 100) })}</>}
        </div>
        {r.unpriced > 0 && (
          <div className="text-muted-foreground">{t("roi.coverage", { priced: r.priced, total: r.lines })}</div>
        )}
        {r.belowCost > 0 && (
          <div className="text-amber-600 dark:text-amber-400">{t("roi.belowCost")}</div>
        )}
      </div>
    );
  };

  const detail = (h: Holding) =>
    h.item_type === "sealed" ? `${h.sealed_condition}/${h.variant_edition}` : h.psa_grade ? `PSA ${h.psa_grade}` : t("inventory.raw");
  const keyOf = (h: Holding) => roiHoldingKey(h);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <h2 className="text-lg font-semibold">{t("inventory.title")}</h2>
        <div className="flex w-full min-w-0 flex-wrap items-end gap-2 sm:ml-auto sm:w-auto">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(String(v) as "list" | "grid")}>
            <TabsList>
              <TabsTrigger value="list">{t("cardBrowser.list")}</TabsTrigger>
              <TabsTrigger value="grid">{t("cardBrowser.grid")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div>
            <Label className="text-xs">{t("inventory.leg")}</Label>
            <select value={leg} onChange={(e) => setLeg(e.target.value as typeof leg)}
              className="min-h-11 w-28 rounded-md border bg-background px-2 text-sm sm:min-h-9">
              <option value="all">{t("inventory.allLegs")}</option>
              <option value="import">{t("trips.legImport")}</option>
              <option value="export">{t("trips.legExport")}</option>
            </select>
          </div>
          <Input placeholder={t("inventory.search")} value={search}
            onChange={(e) => setSearch(e.target.value)} className="min-h-11 min-w-0 flex-1 sm:h-9 sm:min-h-9 sm:w-56 sm:flex-none" />
        </div>
      </div>

      {error && <QueryError error={error} onRetry={retry} />}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{t("inventory.distinct", { n: rows.length })}</span>
        <span>{t("inventory.totalQty", { n: totals.qty })}</span>
        <span>{t("inventory.totalConsigned", { n: totals.consigned })}</span>
        <span>{t("inventory.totalAvailable", { n: totals.available })}</span>
        <span>{t("inventory.totalCost", { usd: formatUsd(totals.cost) })}</span>
      </div>

      <TheoreticalRoiSummary
        summary={legRoi}
        label={t(leg === "import" ? "roi.legImport" : leg === "export" ? "roi.legExport" : "roi.allInventory")}
      />

      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {rows.map((h) => (
            <button
              key={keyOf(h)}
              type="button"
              aria-label={t("inventory.manageInventoryFor", { item: label(h) })}
              className="min-w-0 rounded-xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => setSelectedKey(keyOf(h))}
            >
            <Card size="sm" className="h-full gap-0 overflow-hidden !py-0 transition-colors hover:bg-muted/30">
              {h.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={h.imageUrl} alt={label(h)} loading="lazy" className="aspect-[5/7] w-full object-cover" />
              ) : (
                <div className="flex aspect-[5/7] w-full items-center justify-center bg-muted"><ImageOff className="size-8 text-muted-foreground" /></div>
              )}
              <CardContent className="space-y-1 p-2">
                <div className="truncate text-xs font-medium">{label(h)}</div>
                {h.item_type !== "sealed" && <div className="truncate text-[10px] text-muted-foreground">{cardMeta(h.set_code, h.card_number, h.misc_info)}</div>}
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="text-[10px]">{t(h.leg === "export" ? "trips.legExport" : "trips.legImport")}</Badge>
                  <span className="truncate">{detail(h)}</span>
                </div>
                {h.reprintEvents.length > 0 && <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-300" title={h.reprintEvents.map((event) => event.event_title).join("; ")}><AlertTriangle className="size-3" />{t("inventory.reprintRisk", { n: h.reprintEvents.length })}</Badge>}
                <div className="grid grid-cols-3 gap-1 border-t pt-1 text-center text-[10px]">
                  <span><span className="block font-semibold tabular-nums">{h.qty_on_hand}</span><span className="text-muted-foreground">{t("inventory.ownedQty")}</span></span>
                  <span><span className="block font-semibold tabular-nums text-violet-500">{h.qty_consigned}</span><span className="text-muted-foreground">{t("inventory.consigned")}</span></span>
                  <span><span className="block font-semibold tabular-nums">{h.qty_available}</span><span className="text-muted-foreground">{t("inventory.available")}</span></span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t("inventory.totalCostCol")}</span>
                  <span>{formatUsd(Number(h.total_cost_usd))}</span>
                </div>
                {holdingRoi(h)?.priced ? (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">{t("roi.theoretical")}</span>
                    <span className="tabular-nums">
                      {formatUsd(holdingRoi(h)!.netUsd)}{" "}
                      <span className={roiToneClass(holdingRoi(h)!.roiPct)}>
                        {formatRoiPct(holdingRoi(h)!.roiPct)}
                      </span>
                    </span>
                  </div>
                ) : null}
                <div className="pt-1 text-center text-[11px] font-medium text-primary">{t("inventory.manageInventory")}</div>
              </CardContent>
            </Card>
            </button>
          ))}
          {!isLoading && rows.length === 0 && <p className="col-span-full text-sm text-muted-foreground">{t("inventory.empty")}</p>}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("trips.item")}</TableHead>
              <TableHead className="w-20">{t("trips.leg")}</TableHead>
              <TableHead className="w-28">{t("inventory.detail")}</TableHead>
              <TableHead className="w-32">{t("inventory.eventRisk")}</TableHead>
              <TableHead className="w-16">{t("inventory.ownedQty")}</TableHead>
              <TableHead className="w-20">{t("inventory.consigned")}</TableHead>
              <TableHead className="w-20">{t("inventory.available")}</TableHead>
              <TableHead className="w-24">{t("trips.avgCost")}</TableHead>
              <TableHead className="w-28">{t("inventory.totalCostCol")}</TableHead>
              <TableHead className="w-32">{t("roi.col")}</TableHead>
              <TableHead className="w-28"><span className="sr-only">{t("inventory.manageInventory")}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((h) => (
              <TableRow key={keyOf(h)}>
                <TableCell className="truncate max-w-[320px]">{label(h)} <span className="text-muted-foreground">· {cardMeta(h.set_code, h.card_number, h.misc_info)}</span></TableCell>
                <TableCell><Badge variant="secondary" className="text-[10px]">{t(h.leg === "export" ? "trips.legExport" : "trips.legImport")}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">{detail(h)}</TableCell>
                <TableCell>{h.reprintEvents.length > 0 ? <Badge variant="outline" className="border-amber-500/50 text-amber-300" title={h.reprintEvents.map((event) => `${event.starts_on}: ${event.event_title}`).join("; ")}><AlertTriangle className="size-3" />{t("inventory.reprintRisk", { n: h.reprintEvents.length })}</Badge> : <span className="text-xs text-muted-foreground">{t("inventory.noEventRisk")}</span>}</TableCell>
                <TableCell>{h.qty_on_hand}</TableCell>
                <TableCell className="text-violet-500">{h.qty_consigned}</TableCell>
                <TableCell>{h.qty_available}</TableCell>
                <TableCell>{formatUsd(Number(h.avg_cost_usd))}</TableCell>
                <TableCell>{formatUsd(Number(h.total_cost_usd))}</TableCell>
                <TableCell>{renderRoiCell(holdingRoi(h))}</TableCell>
                <TableCell>
                  <Button variant="outline" size="sm" className="min-h-11 sm:min-h-7" onClick={() => setSelectedKey(keyOf(h))}>
                    {t("inventory.manage")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={11} className="text-muted-foreground">{t("inventory.empty")}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {selected && (
        <InventoryConsignmentSheet
          open
          onOpenChange={(open) => { if (!open) setSelectedKey(null); }}
          itemLabel={label(selected)}
          itemMeta={[
            selected.item_type === "sealed"
              ? selected.set_code
              : cardMeta(selected.set_code, selected.card_number, selected.misc_info),
            detail(selected),
            t(selected.leg === "export" ? "trips.legExport" : "trips.legImport"),
          ].filter(Boolean).join(" · ")}
          owned={selected.qty_on_hand}
          consigned={selected.qty_consigned}
          available={selected.qty_available}
          lines={selectedLines}
          onSave={saveConsignment}
          onRecordSale={recordSale}
          onClear={clearConsignment}
          onReconcile={selected.game === "pokemon" && selected.item_type === "single" ? reconcileCount : undefined}
        />
      )}
    </div>
  );
}

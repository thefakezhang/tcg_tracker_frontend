"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Check, Pencil, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useCardData, getCardDisplayName } from "../use-card-data";
import { useLanguage } from "../LanguageContext";
import { useLotPicker } from "../LotPickerContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CollectrImportDialog } from "./CollectrImportDialog";

type CardGame = "pokemon" | "mtg";

interface Lot {
  lot_id: number;
  leg: string;
  acquired_at: string;
  shop_label: string | null;
  orig_currency: string;
  total_cost_orig: number;
  fx_rate_used: number;
  total_cost_usd: number;
  lines_imported: boolean;
}

interface Cond {
  condition_id: number;
  code: string;
  display_name: string | null;
}

// One row unifies card singles and sealed products; `table` says where to write.
interface LotLine {
  line_id: number;
  table: string;
  kind: "single" | "sealed";
  quantity: number;
  condition_id?: number;
  sealedLabel?: string;
  price_override_usd: number | null;
  allocated_cost_usd: number;
  name: string;
}

const LINE_TABLE: Record<CardGame, string> = {
  pokemon: "pokemon_lot_lines",
  mtg: "mtg_lot_lines",
};
const SEALED_TABLE = "pokemon_sealed_lot_lines";

export default function ImportTab({ tripId }: { tripId: number }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { refresh: refreshOpenLots } = useLotPicker();
  const [lots, setLots] = useState<Lot[]>([]);
  const [selectedLot, setSelectedLot] = useState<number | null>(null);
  const [lines, setLines] = useState<LotLine[]>([]);
  const [conditions, setConditions] = useState<Cond[]>([]);
  const [csvOpen, setCsvOpen] = useState(false);

  // lot-header dialog (create + edit share fields; editingLotId === null => create)
  const [lotDialogOpen, setLotDialogOpen] = useState(false);
  const [editingLotId, setEditingLotId] = useState<number | null>(null);
  const [cDate, setCDate] = useState(new Date().toISOString().slice(0, 10));
  const [cShop, setCShop] = useState("");
  const [cCurrency, setCCurrency] = useState("JPY");
  const [cTotal, setCTotal] = useState("");
  const [cFx, setCFx] = useState("0.0067");
  const [cLeg, setCLeg] = useState("import");

  // add-card search state
  const [searchGame, setSearchGame] = useState<CardGame>("pokemon");
  const [search, setSearch] = useState("");

  const fetchLots = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("acquisition_lots")
      .select("lot_id, leg, acquired_at, shop_label, orig_currency, total_cost_orig, fx_rate_used, total_cost_usd, lines_imported")
      .eq("trip_id", tripId)
      .order("acquired_at", { ascending: true });
    setLots((data as Lot[]) ?? []);
  }, [tripId]);

  const fetchConditions = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("conditions")
      .select("condition_id, code, display_name, standard")
      .eq("standard", "tcgplayer")
      .order("tier", { ascending: true });
    setConditions((data as Cond[]) ?? []);
  }, []);

  const fetchLines = useCallback(async (lotId: number) => {
    const supabase = createClient();
    const out: LotLine[] = [];
    // card singles
    for (const game of ["pokemon", "mtg"] as CardGame[]) {
      const { data } = await supabase
        .from(LINE_TABLE[game])
        .select("line_id, card_id, condition_id, quantity, price_override_usd, allocated_cost_usd")
        .eq("lot_id", lotId);
      const rows = (data as { line_id: number; card_id: number; condition_id: number; quantity: number; price_override_usd: number | null; allocated_cost_usd: number }[]) ?? [];
      if (rows.length === 0) continue;
      const nameTable = game === "pokemon" ? "pokemon_card_definitions" : "mtg_card_definitions_v";
      const { data: defs } = await supabase
        .from(nameTable).select("card_id, regional_name, set_code, card_number").in("card_id", rows.map((r) => r.card_id));
      const nameMap = new Map<number, string>();
      for (const d of (defs as { card_id: number; regional_name: string; set_code: string; card_number: string | null }[]) ?? []) {
        nameMap.set(d.card_id, `${d.regional_name} · ${d.set_code} ${d.card_number ?? ""}`.trim());
      }
      for (const r of rows) {
        out.push({
          line_id: r.line_id, table: LINE_TABLE[game], kind: "single", quantity: r.quantity,
          condition_id: r.condition_id, price_override_usd: r.price_override_usd,
          allocated_cost_usd: r.allocated_cost_usd, name: nameMap.get(r.card_id) ?? `#${r.card_id}`,
        });
      }
    }
    // sealed products
    const { data: sealedRows } = await supabase
      .from(SEALED_TABLE)
      .select("line_id, product_id, sealed_condition, variant_edition, quantity, price_override_usd, allocated_cost_usd")
      .eq("lot_id", lotId);
    const srows = (sealedRows as { line_id: number; product_id: number; sealed_condition: string; variant_edition: string; quantity: number; price_override_usd: number | null; allocated_cost_usd: number }[]) ?? [];
    if (srows.length > 0) {
      const { data: prods } = await supabase
        .from("pokemon_sealed_products").select("product_id, name, set_code").in("product_id", srows.map((r) => r.product_id));
      const pMap = new Map<number, string>();
      for (const p of (prods as { product_id: number; name: string; set_code: string }[]) ?? []) {
        pMap.set(p.product_id, `${p.name} · ${p.set_code}`);
      }
      for (const r of srows) {
        out.push({
          line_id: r.line_id, table: SEALED_TABLE, kind: "sealed", quantity: r.quantity,
          sealedLabel: `${r.sealed_condition}/${r.variant_edition}`, price_override_usd: r.price_override_usd,
          allocated_cost_usd: r.allocated_cost_usd, name: pMap.get(r.product_id) ?? `#${r.product_id}`,
        });
      }
    }
    setLines(out);
  }, []);

  const reloadLot = useCallback(async (lotId: number) => {
    await fetchLines(lotId);
    await refreshOpenLots();
  }, [fetchLines, refreshOpenLots]);

  useEffect(() => { fetchLots(); fetchConditions(); }, [fetchLots, fetchConditions]);
  useEffect(() => { if (selectedLot) fetchLines(selectedLot); else setLines([]); }, [selectedLot, fetchLines]);

  useEffect(() => {
    if (selectedLot === null && lots.length > 0) {
      const draft = lots.find((l) => !l.lines_imported);
      setSelectedLot((draft ?? lots[lots.length - 1]).lot_id);
    }
  }, [lots, selectedLot]);

  const lot = lots.find((l) => l.lot_id === selectedLot) ?? null;
  const defaultCondition = conditions.find((c) => c.code === "NM")?.condition_id ?? conditions[0]?.condition_id;

  const { data: searchResults } = useCardData({
    activeGame: searchGame, psaMode: "non-psa", search, searchCardNumber: "", searchSetCode: "",
    selectedTier: 1, sellRegion: "all", minBuyPrice: null, minSellPrice: null,
    roiFloor: null, roiCeiling: null, sortColumn: "roi", sortAsc: false, page: 0, pageSize: 20,
  });

  function openCreate() {
    setEditingLotId(null);
    setCDate(new Date().toISOString().slice(0, 10));
    setCShop(""); setCCurrency("JPY"); setCTotal(""); setCFx("0.0067"); setCLeg("import");
    setLotDialogOpen(true);
  }
  function openEditLot(l: Lot) {
    setEditingLotId(l.lot_id);
    setCDate(l.acquired_at);
    setCShop(l.shop_label ?? "");
    setCCurrency(l.orig_currency);
    setCTotal(String(l.total_cost_orig));
    setCFx(String(l.fx_rate_used));
    setCLeg(l.leg);
    setLotDialogOpen(true);
  }

  async function saveLot() {
    const supabase = createClient();
    const fx = Number(cFx) || 1;
    const totalOrig = Number(cTotal) || 0;
    const payload = {
      leg: cLeg, acquired_at: cDate, shop_label: cShop || null,
      orig_currency: cCurrency.toUpperCase(), total_cost_orig: totalOrig,
      fx_rate_used: fx, total_cost_usd: Math.round(totalOrig * fx * 100) / 100,
    };
    if (editingLotId) {
      await supabase.from("acquisition_lots").update(payload).eq("lot_id", editingLotId);
      setLotDialogOpen(false);
      await fetchLots();
    } else {
      const { data } = await supabase
        .from("acquisition_lots").insert({ trip_id: tripId, ...payload }).select("lot_id").single();
      setLotDialogOpen(false);
      await fetchLots();
      await refreshOpenLots();
      if (data) setSelectedLot((data as { lot_id: number }).lot_id);
    }
  }

  async function addLine(cardId: number) {
    if (!selectedLot || !defaultCondition) return;
    const supabase = createClient();
    await supabase.from(LINE_TABLE[searchGame]).insert({
      lot_id: selectedLot, card_id: cardId, condition_id: defaultCondition, psa_grade: 0, quantity: 1,
    });
    await reloadLot(selectedLot);
  }

  async function updateLine(line: LotLine, patch: Partial<Pick<LotLine, "quantity" | "condition_id" | "price_override_usd">>) {
    const supabase = createClient();
    await supabase.from(line.table).update(patch).eq("line_id", line.line_id);
    if (selectedLot) await reloadLot(selectedLot);
  }

  async function removeLine(line: LotLine) {
    const supabase = createClient();
    await supabase.from(line.table).delete().eq("line_id", line.line_id);
    if (selectedLot) await reloadLot(selectedLot);
  }

  async function finalize() {
    if (!selectedLot) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("finalize_acquisition_lot", { p_lot_id: selectedLot });
    if (error) { alert(error.message); return; }
    await fetchLots();
    await reloadLot(selectedLot);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("trips.importLots")}</h2>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4 mr-1" />{t("trips.newLot")}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {lots.map((l) => (
          <button
            key={l.lot_id}
            onClick={() => setSelectedLot(l.lot_id)}
            className={`rounded-md border px-3 py-2 text-left text-sm ${selectedLot === l.lot_id ? "border-primary bg-accent" : "hover:bg-accent/50"}`}
          >
            <div className="flex items-center gap-1.5 font-medium">
              {l.shop_label || l.acquired_at}
              <Badge variant="secondary" className="text-[10px]">{t(l.leg === "export" ? "trips.legExport" : "trips.legImport")}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {l.orig_currency} {l.total_cost_orig} → ${l.total_cost_usd}
              {l.lines_imported ? ` · ${t("trips.finalized")}` : ""}
            </div>
          </button>
        ))}
        {lots.length === 0 && <p className="text-sm text-muted-foreground">{t("trips.noLots")}</p>}
      </div>

      {lots.length > 0 && !lot && (
        <p className="text-sm text-muted-foreground">{t("trips.selectLotHint")}</p>
      )}

      {lot && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">{lot.shop_label || lot.acquired_at}</div>
            {!lot.lines_imported && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setCsvOpen(true)}>
                  <Upload className="size-4 mr-1" />{t("trips.importCsv")}
                </Button>
                <Button variant="outline" size="sm" onClick={() => openEditLot(lot)}>
                  <Pencil className="size-4 mr-1" />{t("trips.editLot")}
                </Button>
              </div>
            )}
          </div>

          {!lot.lines_imported ? (
            <div className="space-y-2 rounded-md bg-muted/40 p-3">
              <Label className="text-sm font-semibold">{t("trips.addCardsHeading")}</Label>
              <div className="flex gap-2">
                <select
                  value={searchGame}
                  onChange={(e) => setSearchGame(e.target.value as CardGame)}
                  className="rounded-md border bg-background px-2 text-sm"
                >
                  <option value="pokemon">Pokémon</option>
                  <option value="mtg">MTG</option>
                </select>
                <Input
                  placeholder={t("trips.searchCards")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1"
                />
              </div>
              {!search && <p className="text-xs text-muted-foreground">{t("trips.searchHint")}</p>}
              {search && searchResults.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("trips.noResults")}</p>
              )}
              {search && searchResults.length > 0 && (
                <div className="max-h-56 overflow-auto rounded-md border bg-background">
                  {searchResults.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => addLine(Number(r.card.card_id))}
                      className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span className="truncate">{getCardDisplayName(r.card, language)} · {r.card.set_code}</span>
                      <Plus className="size-4 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("trips.lotFinalizedNote")}</p>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("trips.lotLines")}</TableHead>
                <TableHead className="w-20">{t("trips.qty")}</TableHead>
                <TableHead className="w-32">{t("trips.condition")}</TableHead>
                <TableHead className="w-32">{t("trips.override")}</TableHead>
                {lot.lines_imported && <TableHead className="w-28">{t("trips.allocatedCost")}</TableHead>}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((ln) => (
                <TableRow key={`${ln.table}-${ln.line_id}`}>
                  <TableCell className="truncate max-w-[280px]">{ln.name}</TableCell>
                  <TableCell>
                    {lot.lines_imported ? ln.quantity : (
                      <Input type="number" defaultValue={ln.quantity} className="h-8 w-16"
                        onBlur={(e) => updateLine(ln, { quantity: Number(e.target.value) })} />
                    )}
                  </TableCell>
                  <TableCell>
                    {ln.kind === "sealed"
                      ? <span className="text-xs text-muted-foreground">{ln.sealedLabel}</span>
                      : lot.lines_imported
                        ? (conditions.find((c) => c.condition_id === ln.condition_id)?.code ?? ln.condition_id)
                        : (
                          <select defaultValue={ln.condition_id} className="h-8 rounded-md border bg-background px-1 text-sm"
                            onChange={(e) => updateLine(ln, { condition_id: Number(e.target.value) })}>
                            {conditions.map((c) => <option key={c.condition_id} value={c.condition_id}>{c.code}</option>)}
                          </select>
                        )}
                  </TableCell>
                  <TableCell>
                    {lot.lines_imported ? (ln.price_override_usd ?? "—") : (
                      <Input type="number" defaultValue={ln.price_override_usd ?? ""} placeholder="—" className="h-8 w-20"
                        onBlur={(e) => updateLine(ln, { price_override_usd: e.target.value === "" ? null : Number(e.target.value) })} />
                    )}
                  </TableCell>
                  {lot.lines_imported && <TableCell>${ln.allocated_cost_usd}</TableCell>}
                  <TableCell>
                    {!lot.lines_imported && (
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => removeLine(ln)}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {lines.length === 0 && (
                <TableRow><TableCell colSpan={lot.lines_imported ? 6 : 5} className="text-muted-foreground">{t("trips.empty")}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          {!lot.lines_imported && lines.length > 0 && (
            <Button onClick={finalize}>
              <Check className="size-4 mr-1" />{t("trips.finalize")}
            </Button>
          )}
        </div>
      )}

      <Dialog open={lotDialogOpen} onOpenChange={setLotDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{editingLotId ? t("trips.editLot") : t("trips.newLot")}</DialogTitle></DialogHeader>
          <FieldGroup>
            <Field><Label>{t("trips.leg")}</Label>
              <select value={cLeg} onChange={(e) => setCLeg(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="import">{t("trips.legImport")}</option>
                <option value="export">{t("trips.legExport")}</option>
              </select></Field>
            <Field><Label>{t("trips.lotDate")}</Label>
              <Input type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} /></Field>
            <Field><Label>{t("trips.lotShop")}</Label>
              <Input value={cShop} onChange={(e) => setCShop(e.target.value)} /></Field>
            <Field><Label>{t("trips.lotCurrency")}</Label>
              <Input value={cCurrency} onChange={(e) => setCCurrency(e.target.value)} /></Field>
            <Field><Label>{t("trips.lotTotal")}</Label>
              <Input type="number" value={cTotal} onChange={(e) => setCTotal(e.target.value)} /></Field>
            <Field><Label>{t("trips.fxRate")}</Label>
              <Input type="number" value={cFx} onChange={(e) => setCFx(e.target.value)} /></Field>
            <p className="text-xs text-muted-foreground">
              {t("trips.usdComputed", { usd: (Number(cTotal) * Number(cFx) || 0).toFixed(2) })}
            </p>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLotDialogOpen(false)}>{t("trips.cancel")}</Button>
            <Button disabled={!cTotal} onClick={saveLot}>{editingLotId ? t("trips.saveChanges") : t("trips.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {lot && !lot.lines_imported && (
        <CollectrImportDialog
          open={csvOpen}
          onClose={() => setCsvOpen(false)}
          lotId={lot.lot_id}
          onImported={() => reloadLot(lot.lot_id)}
        />
      )}
    </div>
  );
}

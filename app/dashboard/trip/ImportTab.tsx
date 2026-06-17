"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useCardData, getCardDisplayName } from "../use-card-data";
import { type Game } from "../GameContext";
import { useLanguage } from "../LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface Lot {
  lot_id: number;
  acquired_at: string;
  shop_label: string | null;
  orig_currency: string;
  total_cost_orig: number;
  total_cost_usd: number;
  lines_imported: boolean;
}

interface Cond {
  condition_id: number;
  code: string;
  display_name: string | null;
}

interface LotLine {
  line_id: number;
  game: Game;
  card_id: number;
  condition_id: number;
  psa_grade: number;
  quantity: number;
  price_override_usd: number | null;
  allocated_cost_usd: number;
  name: string;
}

const LINE_TABLE: Record<Game, string> = {
  pokemon: "pokemon_lot_lines",
  mtg: "mtg_lot_lines",
};

export default function ImportTab({ tripId }: { tripId: number }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [lots, setLots] = useState<Lot[]>([]);
  const [selectedLot, setSelectedLot] = useState<number | null>(null);
  const [lines, setLines] = useState<LotLine[]>([]);
  const [conditions, setConditions] = useState<Cond[]>([]);

  // create-lot dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [cDate, setCDate] = useState(new Date().toISOString().slice(0, 10));
  const [cShop, setCShop] = useState("");
  const [cCurrency, setCCurrency] = useState("JPY");
  const [cTotal, setCTotal] = useState("");
  const [cFx, setCFx] = useState("0.0067");

  // add-card search state
  const [searchGame, setSearchGame] = useState<Game>("pokemon");
  const [search, setSearch] = useState("");

  const fetchLots = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("acquisition_lots")
      .select("lot_id, acquired_at, shop_label, orig_currency, total_cost_orig, total_cost_usd, lines_imported")
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
    for (const game of ["pokemon", "mtg"] as Game[]) {
      const { data } = await supabase
        .from(LINE_TABLE[game])
        .select("line_id, card_id, condition_id, psa_grade, quantity, price_override_usd, allocated_cost_usd")
        .eq("lot_id", lotId);
      const rows = (data as Omit<LotLine, "game" | "name">[]) ?? [];
      if (rows.length === 0) continue;
      // resolve names
      const ids = rows.map((r) => r.card_id);
      const nameTable = game === "pokemon" ? "pokemon_card_definitions" : "mtg_card_definitions_v";
      const { data: defs } = await supabase
        .from(nameTable)
        .select("card_id, regional_name, set_code, card_number")
        .in("card_id", ids);
      const nameMap = new Map<number, string>();
      for (const d of (defs as { card_id: number; regional_name: string; set_code: string; card_number: string | null }[]) ?? []) {
        nameMap.set(d.card_id, `${d.regional_name} · ${d.set_code} ${d.card_number ?? ""}`.trim());
      }
      for (const r of rows) {
        out.push({ ...r, game, name: nameMap.get(r.card_id) ?? `#${r.card_id}` });
      }
    }
    setLines(out);
  }, []);

  useEffect(() => { fetchLots(); fetchConditions(); }, [fetchLots, fetchConditions]);
  useEffect(() => { if (selectedLot) fetchLines(selectedLot); else setLines([]); }, [selectedLot, fetchLines]);

  const lot = lots.find((l) => l.lot_id === selectedLot) ?? null;
  const defaultCondition = conditions.find((c) => c.code === "NM")?.condition_id ?? conditions[0]?.condition_id;

  const { data: searchResults } = useCardData({
    activeGame: searchGame, psaMode: "non-psa", search, searchCardNumber: "", searchSetCode: "",
    selectedTier: 1, sellRegion: "all", minBuyPrice: null, minSellPrice: null,
    roiFloor: null, roiCeiling: null, sortColumn: "roi", sortAsc: false, page: 0, pageSize: 20,
  });

  async function createLot() {
    const supabase = createClient();
    const fx = Number(cFx) || 1;
    const totalOrig = Number(cTotal) || 0;
    const { data } = await supabase
      .from("acquisition_lots")
      .insert({
        trip_id: tripId, acquired_at: cDate, shop_label: cShop || null,
        orig_currency: cCurrency.toUpperCase(), total_cost_orig: totalOrig,
        fx_rate_used: fx, total_cost_usd: Math.round(totalOrig * fx * 100) / 100,
      })
      .select("lot_id")
      .single();
    setCreateOpen(false);
    setCShop(""); setCTotal("");
    await fetchLots();
    if (data) setSelectedLot((data as { lot_id: number }).lot_id);
  }

  async function addLine(cardId: number) {
    if (!selectedLot || !defaultCondition) return;
    const supabase = createClient();
    await supabase.from(LINE_TABLE[searchGame]).insert({
      lot_id: selectedLot, card_id: cardId, condition_id: defaultCondition,
      psa_grade: 0, quantity: 1,
    });
    await fetchLines(selectedLot);
  }

  async function updateLine(line: LotLine, patch: Partial<Pick<LotLine, "quantity" | "condition_id" | "price_override_usd">>) {
    const supabase = createClient();
    await supabase.from(LINE_TABLE[line.game]).update(patch).eq("line_id", line.line_id);
    if (selectedLot) await fetchLines(selectedLot);
  }

  async function removeLine(line: LotLine) {
    const supabase = createClient();
    await supabase.from(LINE_TABLE[line.game]).delete().eq("line_id", line.line_id);
    if (selectedLot) await fetchLines(selectedLot);
  }

  async function finalize() {
    if (!selectedLot) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("finalize_acquisition_lot", { p_lot_id: selectedLot });
    if (error) { alert(error.message); return; }
    await fetchLots();
    await fetchLines(selectedLot);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("trips.importLots")}</h2>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
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
            <div className="font-medium">{l.shop_label || l.acquired_at}</div>
            <div className="text-xs text-muted-foreground">
              {l.orig_currency} {l.total_cost_orig} → ${l.total_cost_usd}
              {l.lines_imported ? ` · ${t("trips.finalized")}` : ""}
            </div>
          </button>
        ))}
        {lots.length === 0 && <p className="text-sm text-muted-foreground">{t("trips.noLots")}</p>}
      </div>

      {lot && (
        <div className="space-y-3 rounded-md border p-3">
          {!lot.lines_imported && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <select
                  value={searchGame}
                  onChange={(e) => setSearchGame(e.target.value as Game)}
                  className="rounded-md border bg-background px-2 text-sm"
                >
                  <option value="pokemon">Pokémon</option>
                  <option value="mtg">MTG</option>
                </select>
                <Input
                  placeholder={t("trips.searchCards")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {search && (
                <div className="max-h-48 overflow-auto rounded-md border">
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
                <TableRow key={`${ln.game}-${ln.line_id}`}>
                  <TableCell className="truncate max-w-[280px]">{ln.name}</TableCell>
                  <TableCell>
                    {lot.lines_imported ? ln.quantity : (
                      <Input type="number" defaultValue={ln.quantity} className="h-8 w-16"
                        onBlur={(e) => updateLine(ln, { quantity: Number(e.target.value) })} />
                    )}
                  </TableCell>
                  <TableCell>
                    {lot.lines_imported ? (conditions.find((c) => c.condition_id === ln.condition_id)?.code ?? ln.condition_id) : (
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
            </TableBody>
          </Table>

          {!lot.lines_imported && lines.length > 0 && (
            <Button onClick={finalize}>
              <Check className="size-4 mr-1" />{t("trips.finalize")}
            </Button>
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("trips.newLot")}</DialogTitle></DialogHeader>
          <FieldGroup>
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
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("trips.cancel")}</Button>
            <Button disabled={!cTotal} onClick={createLot}>{t("trips.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

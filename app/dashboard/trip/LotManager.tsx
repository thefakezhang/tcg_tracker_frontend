"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Check, Pencil, Upload, ImageOff, RotateCcw, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { getCardDisplayName, cardMeta, useDebouncedValue } from "../use-card-data";
import { useLanguage } from "../LanguageContext";
import { useLotPicker } from "../LotPickerContext";
import { useSaving } from "@/lib/use-saving";
import { useFxRate, fmtRate } from "@/lib/use-fx-rate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { CollectrImportDialog } from "./CollectrImportDialog";
import LotReceipts from "./LotReceipts";

type CardGame = "pokemon" | "mtg";
type Leg = "import" | "export";

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
  regionalName: string;
  englishName: string | null;
  setCode: string;
  cardNumber: string | null;
  miscInfo: string | null;
  imageUrl: string | null;
}

const LINE_TABLE: Record<CardGame, string> = {
  pokemon: "pokemon_lot_lines",
  mtg: "mtg_lot_lines",
};
const SEALED_TABLE = "pokemon_sealed_lot_lines";

// Buying-side defaults differ by leg: import lots are bought in Japan (JPY),
// export lots are bought in the US (USD) to carry over and sell in Japan.
const LEG_DEFAULTS: Record<Leg, { currency: string; fx: string }> = {
  import: { currency: "JPY", fx: "0.0067" },
  export: { currency: "USD", fx: "1" },
};

export default function LotManager({ tripId, leg }: { tripId: number; leg: Leg }) {
  const { t } = useTranslation();
  const { saving, save } = useSaving();
  const { language } = useLanguage();
  const { refresh: refreshOpenLots } = useLotPicker();
  const [lots, setLots] = useState<Lot[]>([]);
  const [selectedLot, setSelectedLot] = useState<number | null>(null);
  const [lines, setLines] = useState<LotLine[]>([]);
  const [conditions, setConditions] = useState<Cond[]>([]);
  const [csvOpen, setCsvOpen] = useState(false);
  const [delLotOpen, setDelLotOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  // lot-header dialog (create + edit share fields; editingLotId === null => create)
  const [lotDialogOpen, setLotDialogOpen] = useState(false);
  const [editingLotId, setEditingLotId] = useState<number | null>(null);
  const [cDate, setCDate] = useState(new Date().toISOString().slice(0, 10));
  const [cShop, setCShop] = useState("");
  const [cCurrency, setCCurrency] = useState(LEG_DEFAULTS[leg].currency);
  const [cTotal, setCTotal] = useState("");
  const [cFx, setCFx] = useState(LEG_DEFAULTS[leg].fx);
  const { rateFor } = useFxRate();

  // For a NEW lot, default the FX field to the live market rate for the chosen
  // currency. Skip when editing (editingLotId set) so an existing lot keeps the
  // rate it was recorded at.
  useEffect(() => {
    if (editingLotId !== null) return;
    const r = rateFor(cCurrency);
    if (r !== null) setCFx(fmtRate(r));
  }, [cCurrency, editingLotId, rateFor]);

  // add-card search state
  const [searchGame, setSearchGame] = useState<CardGame>("pokemon");
  const [search, setSearch] = useState("");
  const [searchGrade, setSearchGrade] = useState("0"); // PSA grade for added lines (0 = raw)

  const fetchLots = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("acquisition_lots")
      .select("lot_id, leg, acquired_at, shop_label, orig_currency, total_cost_orig, fx_rate_used, total_cost_usd, lines_imported")
      .eq("trip_id", tripId)
      .eq("leg", leg)
      .order("acquired_at", { ascending: true });
    setLots((data as Lot[]) ?? []);
  }, [tripId, leg]);

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
    for (const game of ["pokemon", "mtg"] as CardGame[]) {
      const { data } = await supabase
        .from(LINE_TABLE[game])
        .select("line_id, card_id, condition_id, quantity, price_override_usd, allocated_cost_usd")
        .eq("lot_id", lotId);
      const rows = (data as { line_id: number; card_id: number; condition_id: number; quantity: number; price_override_usd: number | null; allocated_cost_usd: number }[]) ?? [];
      if (rows.length === 0) continue;
      const nameTable = game === "pokemon" ? "pokemon_card_definitions" : "mtg_card_definitions_v";
      const cols = game === "pokemon"
        ? "card_id, regional_name, english_name, set_code, card_number, misc_info, image_url"
        : "card_id, regional_name, set_code, card_number, image_url";
      const { data: defs } = await supabase.from(nameTable).select(cols).in("card_id", rows.map((r) => r.card_id));
      const defMap = new Map<number, { regionalName: string; englishName: string | null; setCode: string; cardNumber: string | null; miscInfo: string | null; imageUrl: string | null }>();
      for (const d of (defs as unknown as { card_id: number; regional_name: string; english_name?: string | null; set_code: string; card_number: string | null; misc_info?: string | null; image_url: string | null }[]) ?? []) {
        defMap.set(d.card_id, { regionalName: d.regional_name, englishName: d.english_name ?? null, setCode: d.set_code, cardNumber: d.card_number, miscInfo: d.misc_info ?? null, imageUrl: d.image_url });
      }
      for (const r of rows) {
        const d = defMap.get(r.card_id);
        out.push({
          line_id: r.line_id, table: LINE_TABLE[game], kind: "single", quantity: r.quantity,
          condition_id: r.condition_id, price_override_usd: r.price_override_usd, allocated_cost_usd: r.allocated_cost_usd,
          regionalName: d?.regionalName ?? `#${r.card_id}`, englishName: d?.englishName ?? null,
          setCode: d?.setCode ?? "", cardNumber: d?.cardNumber ?? null, miscInfo: d?.miscInfo ?? null, imageUrl: d?.imageUrl ?? null,
        });
      }
    }
    const { data: sealedRows } = await supabase
      .from(SEALED_TABLE)
      .select("line_id, product_id, sealed_condition, variant_edition, quantity, price_override_usd, allocated_cost_usd")
      .eq("lot_id", lotId);
    const srows = (sealedRows as { line_id: number; product_id: number; sealed_condition: string; variant_edition: string; quantity: number; price_override_usd: number | null; allocated_cost_usd: number }[]) ?? [];
    if (srows.length > 0) {
      const { data: prods } = await supabase
        .from("pokemon_sealed_products").select("product_id, name, set_code, image_url").in("product_id", srows.map((r) => r.product_id));
      const pMap = new Map<number, { name: string; setCode: string; imageUrl: string | null }>();
      for (const p of (prods as { product_id: number; name: string; set_code: string; image_url: string | null }[]) ?? []) {
        pMap.set(p.product_id, { name: p.name, setCode: p.set_code, imageUrl: p.image_url });
      }
      for (const r of srows) {
        const p = pMap.get(r.product_id);
        out.push({
          line_id: r.line_id, table: SEALED_TABLE, kind: "sealed", quantity: r.quantity,
          sealedLabel: `${r.sealed_condition}/${r.variant_edition}`, price_override_usd: r.price_override_usd,
          allocated_cost_usd: r.allocated_cost_usd, regionalName: p?.name ?? `#${r.product_id}`, englishName: null,
          setCode: p?.setCode ?? "", cardNumber: null, miscInfo: null, imageUrl: p?.imageUrl ?? null,
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
  useEffect(() => { setSelectedLot(null); }, [leg]);
  useEffect(() => { if (selectedLot) fetchLines(selectedLot); else setLines([]); }, [selectedLot, fetchLines]);

  useEffect(() => {
    if (selectedLot === null && lots.length > 0) {
      const draft = lots.find((l) => !l.lines_imported);
      setSelectedLot((draft ?? lots[lots.length - 1]).lot_id);
    }
  }, [lots, selectedLot]);

  const lot = lots.find((l) => l.lot_id === selectedLot) ?? null;
  const defaultCondition = conditions.find((c) => c.code === "NM")?.condition_id ?? conditions[0]?.condition_id;

  // Language-aware display name (English when set + available, else regional).
  const lineLabel = (ln: LotLine) =>
    getCardDisplayName({ regional_name: ln.regionalName, english_name: ln.englishName }, language);

  // Per-line cost override is stored in USD, but entered in the lot's buying
  // currency (e.g. JPY for a JP import lot), converted via the lot's FX rate.
  const lotCcy = lot?.orig_currency ?? "USD";
  const lotFx = lot?.fx_rate_used || 1;
  const toNative = (usd: number) => {
    const n = usd / lotFx;
    return lotCcy === "JPY" ? Math.round(n) : Math.round(n * 100) / 100;
  };
  // Keep 6 decimals so the native->USD->native round-trip is exact (the stored
  // column is NUMERIC(18,6)); finalize still rounds allocation to cents.
  const fromNative = (native: number) => Math.round(native * lotFx * 1e6) / 1e6;

  // Search the card CATALOG directly (not price summaries), so every card is
  // findable — cards you buy in Japan often have no price-summary row.
  interface SearchHit { card_id: number; regional_name: string; english_name: string | null; set_code: string; card_number: string | null; misc_info: string | null; }
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const dSearch = useDebouncedValue(search, 300);
  useEffect(() => {
    const s = dSearch.trim();
    if (!s) { setSearchResults([]); return; }
    const supabase = createClient();
    const safe = s.replace(/[,()*]/g, " ");
    const ac = new AbortController();
    (async () => {
      let hits: SearchHit[] = [];
      if (searchGame === "pokemon") {
        const { data } = await supabase.from("pokemon_card_definitions")
          .select("card_id, regional_name, english_name, set_code, card_number, misc_info")
          .or(`regional_name.ilike.%${safe}%,english_name.ilike.%${safe}%,card_number.ilike.%${safe}%`)
          .limit(25).abortSignal(ac.signal);
        hits = (data as SearchHit[]) ?? [];
      } else {
        const { data } = await supabase.from("mtg_card_definitions_v")
          .select("card_id, regional_name, set_code, card_number")
          .or(`regional_name.ilike.%${safe}%,card_number.ilike.%${safe}%`)
          .limit(25).abortSignal(ac.signal);
        hits = ((data as Omit<SearchHit, "english_name" | "misc_info">[]) ?? []).map((d) => ({ ...d, english_name: null, misc_info: null }));
      }
      setSearchResults(hits);
    })().catch(() => { /* aborted / superseded */ });
    return () => ac.abort();
  }, [dSearch, searchGame]);

  function openCreate() {
    setEditingLotId(null);
    setCDate(new Date().toISOString().slice(0, 10));
    setCShop(""); setCCurrency(LEG_DEFAULTS[leg].currency); setCTotal(""); setCFx(LEG_DEFAULTS[leg].fx);
    setLotDialogOpen(true);
  }
  function openEditLot(l: Lot) {
    setEditingLotId(l.lot_id);
    setCDate(l.acquired_at);
    setCShop(l.shop_label ?? "");
    setCCurrency(l.orig_currency);
    setCTotal(String(l.total_cost_orig));
    setCFx(String(l.fx_rate_used));
    setLotDialogOpen(true);
  }

  async function saveLot() {
    const supabase = createClient();
    const fx = Number(cFx) || 1;
    const totalOrig = Number(cTotal) || 0;
    const payload = {
      leg, acquired_at: cDate, shop_label: cShop || null,
      orig_currency: cCurrency.toUpperCase(), total_cost_orig: totalOrig,
      fx_rate_used: fx, total_cost_usd: Math.round(totalOrig * fx * 100) / 100,
    };
    if (editingLotId) {
      const ok = await save(() => supabase.from("acquisition_lots").update(payload).eq("lot_id", editingLotId));
      if (!ok) return;
      setLotDialogOpen(false);
      await fetchLots();
    } else {
      let newId: number | undefined;
      const ok = await save(async () => {
        const { data, error } = await supabase
          .from("acquisition_lots").insert({ trip_id: tripId, ...payload }).select("lot_id").single();
        if (data) newId = (data as { lot_id: number }).lot_id;
        return { error };
      });
      if (!ok) return;
      setLotDialogOpen(false);
      await fetchLots();
      await refreshOpenLots();
      if (newId) setSelectedLot(newId);
    }
  }

  async function addLine(cardId: number) {
    if (!selectedLot || !defaultCondition) return;
    const supabase = createClient();
    await supabase.from(LINE_TABLE[searchGame]).insert({
      lot_id: selectedLot, card_id: cardId, condition_id: defaultCondition,
      psa_grade: Math.max(0, Math.floor(Number(searchGrade) || 0)), quantity: 1,
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
    const isNet = (m?: string) => !!m && /networkerror|failed to fetch|load failed/i.test(m);
    let { error } = await supabase.rpc("finalize_acquisition_lot", { p_lot_id: selectedLot });
    if (error && isNet(error.message)) {
      // Transient network failure — finalize is safe to re-run (it errors
      // harmlessly if the first attempt actually committed).
      ({ error } = await supabase.rpc("finalize_acquisition_lot", { p_lot_id: selectedLot }));
      if (error && /already finalized/i.test(error.message)) error = null;
    }
    if (error) { alert(error.message); return; }
    await fetchLots();
    await reloadLot(selectedLot);
  }

  async function unfinalize() {
    if (!selectedLot) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("unfinalize_acquisition_lot", { p_lot_id: selectedLot });
    if (error) { alert(error.message); return; } // e.g. "void those sales first"
    await fetchLots();
    await reloadLot(selectedLot);
  }

  async function deleteLot(lotId: number) {
    // Close the confirm dialog before the async work: deleting clears the
    // selection, which unmounts this panel (and the dialog) — closing first
    // lets base-ui release the pointer-events lock so the page stays clickable.
    setDelLotOpen(false);
    const supabase = createClient();
    // Lot lines cascade on delete; the DB blocks deletion of a lot whose lines
    // have already been sold (sale layers reference them), surfaced here.
    const { error } = await supabase.from("acquisition_lots").delete().eq("lot_id", lotId);
    if (error) { alert(error.message); return; }
    setSelectedLot(null);
    await fetchLots();
    await refreshOpenLots();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t((leg === "export" ? "trips.exportLots" : "trips.importLots") as TranslationKey)}</h2>
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
            <div className="font-medium">{l.shop_label || l.acquired_at}</div>
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
            <div className="flex gap-2">
              {lot.lines_imported ? (
                <Button variant="outline" size="sm" onClick={unfinalize}>
                  <RotateCcw className="size-4 mr-1" />{t("trips.undoFinalize")}
                </Button>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setCsvOpen(true)}>
                    <Upload className="size-4 mr-1" />{t("trips.importCsv")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEditLot(lot)}>
                    <Pencil className="size-4 mr-1" />{t("trips.editLot")}
                  </Button>
                </>
              )}
              <AlertDialog open={delLotOpen} onOpenChange={setDelLotOpen}>
                <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
                  <Trash2 className="size-4" />
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("trips.deleteLot")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("trips.deleteLotConfirm")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("trips.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteLot(lot.lot_id)}>{t("trips.delete")}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <LotReceipts lotId={lot.lot_id} />

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
                <div className="flex items-center gap-1">
                  <Label className="text-xs text-muted-foreground">{t("trips.psaGrade")}</Label>
                  <Input type="number" min={0} max={10} value={searchGrade}
                    onChange={(e) => setSearchGrade(e.target.value)} className="h-9 w-14"
                    title={t("trips.psaGradeHint")} />
                </div>
              </div>
              {Number(searchGrade) > 0 && (
                <p className="text-xs text-muted-foreground">{t("trips.addingAsGrade", { grade: searchGrade })}</p>
              )}
              {!search && <p className="text-xs text-muted-foreground">{t("trips.searchHint")}</p>}
              {search && searchResults.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("trips.noResults")}</p>
              )}
              {search && searchResults.length > 0 && (
                <div className="max-h-56 overflow-auto rounded-md border bg-background">
                  {searchResults.map((r) => (
                    <button
                      key={r.card_id}
                      onClick={() => addLine(r.card_id)}
                      className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <span className="truncate">
                        {getCardDisplayName({ regional_name: r.regional_name, english_name: r.english_name }, language)} · {cardMeta(r.set_code, r.card_number, r.misc_info)}
                      </span>
                      <Plus className="size-4 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("trips.lotFinalizedNote")}</p>
          )}

          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">{t("trips.lotLines")}</Label>
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(String(v) as "list" | "grid")}>
              <TabsList>
                <TabsTrigger value="list">{t("cardBrowser.list")}</TabsTrigger>
                <TabsTrigger value="grid">{t("cardBrowser.grid")}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {viewMode === "grid" ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {lines.map((ln) => (
                <Card key={`${ln.table}-${ln.line_id}`} size="sm" className="gap-0 overflow-hidden !py-0">
                  {ln.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ln.imageUrl} alt={lineLabel(ln)} loading="lazy" className="aspect-[5/7] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[5/7] w-full items-center justify-center bg-muted">
                      <ImageOff className="size-8 text-muted-foreground" />
                    </div>
                  )}
                  <CardContent className="space-y-1 p-2">
                    <div className="truncate text-xs font-medium">{lineLabel(ln)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {ln.kind === "sealed" ? `${ln.setCode} · ${ln.sealedLabel}` : cardMeta(ln.setCode, ln.cardNumber, ln.miscInfo)}
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span>×{ln.quantity}</span>
                      <span>{lot.lines_imported ? `$${ln.allocated_cost_usd}` : (ln.price_override_usd != null ? `${toNative(ln.price_override_usd)} ${lotCcy}` : "—")}</span>
                    </div>
                    {!lot.lines_imported && (
                      <Button variant="ghost" size="sm" className="h-6 w-full" onClick={() => removeLine(ln)}>
                        <Trash2 className="size-3" />
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
              {lines.length === 0 && <p className="col-span-full text-sm text-muted-foreground">{t("trips.empty")}</p>}
            </div>
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("trips.lotLines")}</TableHead>
                <TableHead className="w-20">{t("trips.qty")}</TableHead>
                <TableHead className="w-32">{t("trips.condition")}</TableHead>
                <TableHead className="w-32">{t("trips.overrideCcy", { ccy: lotCcy })}</TableHead>
                {lot.lines_imported && <TableHead className="w-28">{t("trips.allocatedCost")}</TableHead>}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((ln) => (
                <TableRow key={`${ln.table}-${ln.line_id}`}>
                  <TableCell className="truncate max-w-[280px]">{lineLabel(ln)} <span className="text-muted-foreground">· {ln.kind === "sealed" ? `${ln.setCode} · ${ln.sealedLabel}` : cardMeta(ln.setCode, ln.cardNumber, ln.miscInfo)}</span></TableCell>
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
                    {lot.lines_imported ? (ln.price_override_usd != null ? toNative(ln.price_override_usd) : "—") : (
                      <Input type="number" defaultValue={ln.price_override_usd != null ? toNative(ln.price_override_usd) : ""} placeholder="—" className="h-8 w-20"
                        onBlur={(e) => updateLine(ln, { price_override_usd: e.target.value === "" ? null : fromNative(Number(e.target.value)) })} />
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
          )}

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
            <Button disabled={!cTotal || saving} onClick={saveLot}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : (editingLotId ? t("trips.saveChanges") : t("trips.save"))}
            </Button>
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

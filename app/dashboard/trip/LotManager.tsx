"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Check, Pencil, Upload, ImageOff, RotateCcw, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { selectAll, selectAllByIds } from "@/lib/supabase/select-all";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { getCardDisplayName, cardMeta, useDebouncedValue } from "../use-card-data";
import { externalIdMatches, smartSearchFilters } from "@/lib/card-search";
import { bumpOwnedInventory } from "../owned-inventory";
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
import {
  lotLineGradeLabel,
  mapSealedLotLine,
  mapSingleLotLine,
  sealedLotLineInsert,
  type SealedLotLineRow,
  type SingleLotLineRow,
} from "./lot-line-model";

type CardGame = "pokemon" | "mtg";
type LotItemCatalog = CardGame | "pokemon_sealed";
type Leg = "import" | "export";

interface Lot {
  lot_id: number;
  leg: string;
  acquired_at: string;
  shop_label: string | null;
  orig_currency: string;
  total_cost_orig: number | null;
  fx_rate_used: number;
  total_cost_usd: number | null;
  lines_imported: boolean;
}

interface Cond {
  condition_id: number;
  code: string;
  display_name: string | null;
}

type AcquisitionCostCategory =
  | "shipping"
  | "handling"
  | "travel"
  | "food"
  | "tax_duty"
  | "insurance"
  | "discount_refund"
  | "custom";

interface AcquisitionCost {
  cost_id: number;
  category: AcquisitionCostCategory;
  custom_type: string | null;
  amount_orig: number;
  orig_currency: string;
  fx_rate_used: number;
  amount_usd: number;
  note: string | null;
}

// One row unifies card singles and sealed products; `table` says where to write.
interface LotLine {
  line_id: number;
  table: string;
  kind: "single" | "sealed";
  product_id?: number;
  quantity: number;
  condition_id?: number;
  psa_grade?: number;
  sealed_condition?: string;
  variant_edition?: string;
  sealedLabel?: string;
  price_override_usd: number | null;
  direct_purchase_cost_usd: number;
  acquisition_cost_alloc_usd: number;
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
const ACQUISITION_COST_CATEGORIES: AcquisitionCostCategory[] = [
  "shipping",
  "handling",
  "travel",
  "food",
  "tax_duty",
  "insurance",
  "discount_refund",
  "custom",
];

export default function LotManager({ tripId, leg }: { tripId: number; leg: Leg }) {
  const { t } = useTranslation();
  const { saving, save } = useSaving();
  const { language } = useLanguage();
  const { refresh: refreshOpenLots } = useLotPicker();
  const [lots, setLots] = useState<Lot[]>([]);
  const [selectedLot, setSelectedLot] = useState<number | null>(null);
  const [lines, setLines] = useState<LotLine[]>([]);
  const [costs, setCosts] = useState<AcquisitionCost[]>([]);
  const [conditions, setConditions] = useState<Cond[]>([]);
  const [csvOpen, setCsvOpen] = useState(false);
  const [delLotOpen, setDelLotOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) {
      setViewMode("grid");
    }
  }, []);

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
  const [searchGame, setSearchGame] = useState<LotItemCatalog>("pokemon");
  const [search, setSearch] = useState("");
  const [searchGrade, setSearchGrade] = useState("0"); // PSA grade for added lines (0 = raw)
  const [costCategory, setCostCategory] =
    useState<AcquisitionCostCategory>("shipping");
  const [costCustomType, setCostCustomType] = useState("");
  const [costAmount, setCostAmount] = useState("");
  const [costCurrency, setCostCurrency] = useState("");
  const [costFx, setCostFx] = useState("");
  const [costNote, setCostNote] = useState("");

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
      // A lot has no fixed line count, so page the lines instead of letting
      // PostgREST cap them at 1000 (a dropped line = a card silently missing
      // from the lot). Key: line_id.
      const rows = await selectAll<SingleLotLineRow>(
        () => supabase.from(LINE_TABLE[game]).select("line_id, card_id, condition_id, psa_grade, quantity, price_override_usd, direct_purchase_cost_usd, acquisition_cost_alloc_usd, allocated_cost_usd").eq("lot_id", lotId),
        ["line_id"],
      );
      if (rows.length === 0) continue;
      const nameTable = game === "pokemon" ? "pokemon_card_definitions" : "mtg_card_definitions_v";
      const cols = game === "pokemon"
        ? "card_id, regional_name, english_name, set_code, card_number, misc_info, image_url"
        : "card_id, regional_name, set_code, card_number, image_url";
      // Def lookup is 1 row per id, but a big lot's id list would overflow the
      // .in() URL and a >1000 result would truncate; chunk + page it.
      const defs = await selectAllByIds<{ card_id: number; regional_name: string; english_name?: string | null; set_code: string; card_number: string | null; misc_info?: string | null; image_url: string | null }>(
        rows.map((r) => r.card_id),
        ["card_id"],
        (chunk) => supabase.from(nameTable).select(cols).in("card_id", chunk),
      );
      const defMap = new Map<number, { regionalName: string; englishName: string | null; setCode: string; cardNumber: string | null; miscInfo: string | null; imageUrl: string | null }>();
      for (const d of defs) {
        defMap.set(d.card_id, { regionalName: d.regional_name, englishName: d.english_name ?? null, setCode: d.set_code, cardNumber: d.card_number, miscInfo: d.misc_info ?? null, imageUrl: d.image_url });
      }
      for (const r of rows) {
        const d = defMap.get(r.card_id);
        out.push(mapSingleLotLine(r, LINE_TABLE[game], d));
      }
    }
    const srows = await selectAll<SealedLotLineRow>(
      () => supabase.from(SEALED_TABLE).select("line_id, product_id, sealed_condition, variant_edition, quantity, price_override_usd, direct_purchase_cost_usd, acquisition_cost_alloc_usd, allocated_cost_usd").eq("lot_id", lotId),
      ["line_id"],
    );
    if (srows.length > 0) {
      const prods = await selectAllByIds<{ product_id: number; name: string; set_code: string; image_url: string | null }>(
        srows.map((r) => r.product_id),
        ["product_id"],
        (chunk) => supabase.from("pokemon_sealed_products").select("product_id, name, set_code, image_url").in("product_id", chunk),
      );
      const pMap = new Map<number, { name: string; setCode: string; imageUrl: string | null }>();
      for (const p of prods) {
        pMap.set(p.product_id, { name: p.name, setCode: p.set_code, imageUrl: p.image_url });
      }
      for (const r of srows) {
        const p = pMap.get(r.product_id);
        out.push(mapSealedLotLine(r, SEALED_TABLE, p));
      }
    }
    setLines(out);
  }, []);

  const fetchCosts = useCallback(async (lotId: number) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("acquisition_costs")
      .select("cost_id, category, custom_type, amount_orig, orig_currency, fx_rate_used, amount_usd, note")
      .eq("lot_id", lotId)
      .order("cost_id");
    if (error) {
      setCosts([]);
      return;
    }
    setCosts((data as AcquisitionCost[]) ?? []);
  }, []);

  const reloadLot = useCallback(async (lotId: number) => {
    await Promise.all([fetchLines(lotId), fetchCosts(lotId)]);
    await refreshOpenLots();
  }, [fetchCosts, fetchLines, refreshOpenLots]);

  useEffect(() => { fetchLots(); fetchConditions(); }, [fetchLots, fetchConditions]);
  useEffect(() => { setSelectedLot(null); }, [leg]);
  useEffect(() => {
    if (selectedLot) {
      void Promise.all([fetchLines(selectedLot), fetchCosts(selectedLot)]);
    } else {
      setLines([]);
      setCosts([]);
    }
  }, [selectedLot, fetchCosts, fetchLines]);

  useEffect(() => {
    if (selectedLot === null && lots.length > 0) {
      const draft = lots.find((l) => !l.lines_imported);
      setSelectedLot((draft ?? lots[lots.length - 1]).lot_id);
    }
  }, [lots, selectedLot]);

  const lot = lots.find((l) => l.lot_id === selectedLot) ?? null;
  const defaultCondition = conditions.find((c) => c.code === "NM")?.condition_id ?? conditions[0]?.condition_id;
  useEffect(() => {
    if (!lot) return;
    setCostCurrency(lot.orig_currency);
    setCostFx(String(lot.fx_rate_used));
  }, [lot?.lot_id, lot?.orig_currency, lot?.fx_rate_used]);
  const acquisitionCostUsd = costs.reduce(
    (sum, cost) => sum + Number(cost.amount_usd),
    0,
  );
  const landedLotUsd = Number(lot?.total_cost_usd ?? 0) + acquisitionCostUsd;
  const totalUnits = lines.reduce((sum, l) => sum + Number(l.quantity), 0);
  const landedPerUnitUsd = totalUnits > 0 ? landedLotUsd / totalUnits : null;
  // A line with no price override needs a lot total to derive its basis. When
  // the lot has neither, finalize will block; warn before the operator tries.
  const blankLineCount = lines.filter((l) => l.price_override_usd == null).length;
  const needsTotalForBlanks =
    lot != null && lot.total_cost_usd == null && blankLineCount > 0;

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
  // findable - cards you buy in Japan often have no price-summary row.
  interface SearchHit {
    kind: "single" | "sealed";
    item_id: number;
    regional_name: string;
    english_name: string | null;
    set_code: string;
    card_number: string | null;
    misc_info: string | null;
    image_url: string | null;
    sealed_condition?: string;
    variant_edition?: string;
    product_type?: string | null;
  }
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const dSearch = useDebouncedValue(search, 300);
  useEffect(() => {
    const s = dSearch.trim();
    if (!s) { setSearchResults([]); return; }
    const supabase = createClient();
    const ac = new AbortController();
    (async () => {
      // Shared smart semantics (lib/card-search): a pasted uid (full or 8-hex
      // prefix) or exact platform external id lands the item; otherwise
      // whitespace tokens AND together, each against any identity column -
      // "blastoise 009" finds the one printing instead of nothing.
      let hits: SearchHit[] = [];
      if (searchGame === "pokemon") {
        const extIds = await externalIdMatches(supabase, "pokemon_external_identifiers", "card_id", s);
        let q = supabase.from("pokemon_card_definitions")
          .select("card_id, regional_name, english_name, set_code, card_number, misc_info, image_url");
        for (const f of smartSearchFilters(
          s,
          ["regional_name", "english_name", "set_code", "card_number", "misc_info"],
          "card_uid", "card_id", extIds,
        )) q = q.or(f);
        const { data } = await q.limit(25).abortSignal(ac.signal);
        hits = ((data as Array<Omit<SearchHit, "kind" | "item_id"> & { card_id: number }>) ?? [])
          .map(({ card_id, ...row }) => ({ ...row, kind: "single", item_id: card_id }));
      } else if (searchGame === "mtg") {
        const extIds = await externalIdMatches(supabase, "mtg_external_identifiers", "card_id", s);
        let q = supabase.from("mtg_card_definitions_v")
          .select("card_id, regional_name, set_code, card_number, image_url");
        for (const f of smartSearchFilters(
          s,
          ["regional_name", "local_name", "set_code", "card_number", "misc_info"],
          "card_uid", "card_id", extIds,
        )) q = q.or(f);
        const { data } = await q.limit(25).abortSignal(ac.signal);
        hits = ((data as Array<{ card_id: number; regional_name: string; set_code: string; card_number: string | null; image_url: string | null }>) ?? [])
          .map(({ card_id, ...row }) => ({
            ...row,
            kind: "single",
            item_id: card_id,
            english_name: null,
            misc_info: null,
          }));
      } else {
        const extIds = await externalIdMatches(supabase, "pokemon_sealed_external_identifiers", "product_id", s);
        let q = supabase.from("pokemon_sealed_products")
          .select("product_id, name, english_name, set_code, misc_info, sealed_condition, variant_edition, product_type, image_url");
        for (const f of smartSearchFilters(
          s,
          ["name", "english_name", "set_code", "misc_info"],
          "product_uid", "product_id", extIds,
        )) q = q.or(f);
        const { data } = await q.limit(25).abortSignal(ac.signal);
        hits = ((data as Array<{
          product_id: number;
          name: string;
          english_name: string | null;
          set_code: string;
          misc_info: string | null;
          sealed_condition: string;
          variant_edition: string;
          product_type: string | null;
          image_url: string | null;
        }>) ?? []).map(({ product_id, name, ...row }) => ({
          ...row,
          kind: "sealed",
          item_id: product_id,
          regional_name: name,
          card_number: null,
        }));
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
    setCTotal(l.total_cost_orig == null ? "" : String(l.total_cost_orig));
    setCFx(String(l.fx_rate_used));
    setLotDialogOpen(true);
  }

  async function saveLot() {
    const supabase = createClient();
    const fx = Number(cFx) || 1;
    // The lot total is optional: a blank stays null (finalize derives it from
    // the priced lines, or blocks if any line is blank). Only a typed value is
    // stored as the direct-purchase source fact.
    const hasTotal = cTotal.trim() !== "";
    const totalOrig = hasTotal ? Number(cTotal) : null;
    const payload = {
      leg, acquired_at: cDate, shop_label: cShop || null,
      orig_currency: cCurrency.toUpperCase(), total_cost_orig: totalOrig,
      fx_rate_used: fx,
      total_cost_usd: totalOrig == null ? null : Math.round(totalOrig * fx * 100) / 100,
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

  async function addLine(hit: SearchHit) {
    if (!selectedLot) return;
    const supabase = createClient();
    const { error } = hit.kind === "sealed"
      ? await supabase.from(SEALED_TABLE).insert(sealedLotLineInsert({
        lotId: selectedLot,
        productId: hit.item_id,
        sealedCondition: hit.sealed_condition ?? "standard",
        variantEdition: hit.variant_edition ?? "standard",
        quantity: 1,
      }))
      : !defaultCondition || searchGame === "pokemon_sealed"
        ? { error: new Error("A card condition is required") }
        : await supabase.from(LINE_TABLE[searchGame]).insert({
          lot_id: selectedLot,
          card_id: hit.item_id,
          condition_id: defaultCondition,
          psa_grade: Math.max(0, Math.min(10, Math.floor(Number(searchGrade) || 0))),
          quantity: 1,
        });
    if (error) {
      alert(error.message);
      return;
    }
    await reloadLot(selectedLot);
    bumpOwnedInventory();
  }

  async function updateLine(line: LotLine, patch: Partial<Pick<LotLine, "quantity" | "condition_id" | "psa_grade" | "sealed_condition" | "variant_edition" | "price_override_usd">>) {
    const supabase = createClient();
    await supabase.from(line.table).update(patch).eq("line_id", line.line_id);
    if (selectedLot) await reloadLot(selectedLot);
    bumpOwnedInventory();
  }

  async function removeLine(line: LotLine) {
    const supabase = createClient();
    await supabase.from(line.table).delete().eq("line_id", line.line_id);
    if (selectedLot) await reloadLot(selectedLot);
    bumpOwnedInventory();
  }

  async function addCost() {
    if (!selectedLot || !lot) return;
    const rawAmount = Math.abs(Number(costAmount) || 0);
    const amountOrig =
      costCategory === "discount_refund" ? -rawAmount : rawAmount;
    if (
      !rawAmount
      || !costCurrency.trim()
      || !(Number(costFx) > 0)
      || (costCategory === "custom" && !costCustomType.trim())
    ) return;
    const supabase = createClient();
    const { error } = await supabase.from("acquisition_costs").insert({
      lot_id: selectedLot,
      category: costCategory,
      custom_type: costCategory === "custom" ? costCustomType.trim() : null,
      amount_orig: amountOrig,
      orig_currency: costCurrency.trim().toUpperCase(),
      fx_rate_used: Number(costFx),
      note: costNote.trim() || null,
    });
    if (error) {
      alert(error.message);
      return;
    }
    setCostAmount("");
    setCostCustomType("");
    setCostNote("");
    await fetchCosts(selectedLot);
  }

  async function updateCost(
    cost: AcquisitionCost,
    patch: Partial<Pick<
      AcquisitionCost,
      "category" | "custom_type" | "amount_orig" | "orig_currency"
      | "fx_rate_used" | "note"
    >>,
  ) {
    if (!selectedLot) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("acquisition_costs")
      .update(patch)
      .eq("cost_id", cost.cost_id);
    if (error) {
      alert(error.message);
      await fetchCosts(selectedLot);
      return;
    }
    await fetchCosts(selectedLot);
  }

  async function removeCost(costId: number) {
    if (!selectedLot) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("acquisition_costs")
      .delete()
      .eq("cost_id", costId);
    if (error) {
      alert(error.message);
      return;
    }
    await fetchCosts(selectedLot);
  }

  async function finalize() {
    if (!selectedLot) return;
    const supabase = createClient();
    const isNet = (m?: string) => !!m && /networkerror|failed to fetch|load failed/i.test(m);
    let { error } = await supabase.rpc("finalize_acquisition_lot", { p_lot_id: selectedLot });
    if (error && isNet(error.message)) {
      // Transient network failure - finalize is safe to re-run (it errors
      // harmlessly if the first attempt actually committed).
      ({ error } = await supabase.rpc("finalize_acquisition_lot", { p_lot_id: selectedLot }));
      if (error && /already finalized/i.test(error.message)) error = null;
    }
    if (error) {
      // The server blocks a blank-line lot with no total; show the friendly,
      // translated guidance instead of the raw SQL exception.
      alert(/have no price and the lot has no total/.test(error.message)
        ? t("trips.finalizeNeedsPrices", { count: blankLineCount })
        : error.message);
      return;
    }
    await fetchLots();
    await reloadLot(selectedLot);
    bumpOwnedInventory();
  }

  async function unfinalize() {
    if (!selectedLot) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("unfinalize_acquisition_lot", { p_lot_id: selectedLot });
    if (error) { alert(error.message); return; } // e.g. "void those sales first"
    await fetchLots();
    await reloadLot(selectedLot);
    bumpOwnedInventory();
  }

  async function deleteLot(lotId: number) {
    // Close the confirm dialog before the async work: deleting clears the
    // selection, which unmounts this panel (and the dialog) - closing first
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
    bumpOwnedInventory();
  }

  return (
    <div className="min-w-0 space-y-4">
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
            className={`min-h-11 rounded-md border px-3 py-2 text-left text-sm ${selectedLot === l.lot_id ? "border-primary bg-accent" : "hover:bg-accent/50"}`}
          >
            <div className="font-medium">{l.shop_label || l.acquired_at}</div>
            <div className="text-xs text-muted-foreground">
              {l.total_cost_usd == null
                ? t("trips.lotTotalFromItems")
                : `${l.orig_currency} ${l.total_cost_orig} → $${l.total_cost_usd}`}
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium">{lot.shop_label || lot.acquired_at}</div>
              <div className="text-xs text-muted-foreground">
                {t("trips.directPurchase")}{" "}
                {lot.total_cost_usd == null
                  ? t("trips.lotTotalFromItems")
                  : `$${Number(lot.total_cost_usd).toFixed(2)}`}
                {" · "}
                {t("trips.acquisitionCosts")} ${acquisitionCostUsd.toFixed(2)}
                {" · "}
                {t("trips.landedCost")} ${landedLotUsd.toFixed(2)}
                {landedPerUnitUsd != null && (
                  <>
                    {" · "}
                    ${landedPerUnitUsd.toFixed(2)} {t("trips.landedCostPerUnit")}
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
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

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <Label className="text-sm font-semibold">
                  {t("trips.acquisitionCosts")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("trips.acquisitionCostsHelp")}
                </p>
              </div>
              <span className="text-sm tabular-nums">
                ${acquisitionCostUsd.toFixed(2)}
              </span>
            </div>

            <div className="space-y-1">
              {costs.map((cost) => (
                <div
                  key={cost.cost_id}
                  className="grid grid-cols-[minmax(0,1fr)_5.5rem_4.5rem_5.5rem_2.5rem] items-center gap-1 rounded-md bg-muted/40 p-1.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {cost.category === "custom"
                        ? cost.custom_type
                        : t(`trips.costCategory.${cost.category}` as TranslationKey)}
                    </div>
                    {lot.lines_imported ? (
                      cost.note && (
                        <div className="truncate text-muted-foreground">
                          {cost.note}
                        </div>
                      )
                    ) : (
                      <Input
                        defaultValue={cost.note ?? ""}
                        aria-label={t("trips.costNote")}
                        placeholder={t("trips.costNote")}
                        className="mt-1 min-h-11 text-xs sm:min-h-8"
                        onBlur={(event) => updateCost(cost, {
                          note: event.target.value.trim() || null,
                        })}
                      />
                    )}
                  </div>
                  {lot.lines_imported ? (
                    <span className="text-right tabular-nums">
                      {Number(cost.amount_orig).toFixed(2)}
                    </span>
                  ) : (
                    <Input
                      type="number"
                      step="0.01"
                      defaultValue={Math.abs(Number(cost.amount_orig))}
                      aria-label={t("trips.costAmount")}
                      className="min-h-11 text-right text-xs sm:min-h-8"
                      onBlur={(event) => {
                        const amount = Math.abs(Number(event.target.value) || 0);
                        void updateCost(cost, {
                          amount_orig:
                            cost.category === "discount_refund"
                              ? -amount
                              : amount,
                        });
                      }}
                    />
                  )}
                  {lot.lines_imported ? (
                    <span>{cost.orig_currency}</span>
                  ) : (
                    <Input
                      defaultValue={cost.orig_currency}
                      aria-label={t("trips.lotCurrency")}
                      className="min-h-11 px-1 text-xs uppercase sm:min-h-8"
                      onBlur={(event) => updateCost(cost, {
                        orig_currency: event.target.value.trim().toUpperCase(),
                      })}
                    />
                  )}
                  <span className="text-right tabular-nums">
                    ${Number(cost.amount_usd).toFixed(2)}
                  </span>
                  {!lot.lines_imported && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 sm:size-7"
                      onClick={() => removeCost(cost.cost_id)}
                      aria-label={t("trips.delete")}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
              {costs.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("trips.noAcquisitionCosts")}
                </p>
              )}
            </div>

            {!lot.lines_imported && (
              <div className="grid gap-2 border-t pt-2 sm:grid-cols-6">
                <select
                  value={costCategory}
                  onChange={(event) =>
                    setCostCategory(
                      event.target.value as AcquisitionCostCategory,
                    )
                  }
                  aria-label={t("trips.costCategory")}
                  className="min-h-11 rounded-md border bg-background px-2 text-sm sm:col-span-2 sm:min-h-9"
                >
                  {ACQUISITION_COST_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {t(`trips.costCategory.${category}` as TranslationKey)}
                    </option>
                  ))}
                </select>
                {costCategory === "custom" && (
                  <Input
                    value={costCustomType}
                    onChange={(event) => setCostCustomType(event.target.value)}
                    placeholder={t("trips.costCustomType")}
                    className="min-h-11 sm:min-h-9"
                  />
                )}
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={costAmount}
                  onChange={(event) => setCostAmount(event.target.value)}
                  placeholder={t("trips.costAmount")}
                  className="min-h-11 sm:min-h-9"
                />
                <Input
                  value={costCurrency}
                  onChange={(event) => setCostCurrency(event.target.value)}
                  placeholder={t("trips.lotCurrency")}
                  className="min-h-11 uppercase sm:min-h-9"
                />
                <Input
                  type="number"
                  step="0.000001"
                  min="0"
                  value={costFx}
                  onChange={(event) => setCostFx(event.target.value)}
                  placeholder={t("trips.fxRate")}
                  className="min-h-11 sm:min-h-9"
                />
                <Input
                  value={costNote}
                  onChange={(event) => setCostNote(event.target.value)}
                  placeholder={t("trips.costNote")}
                  className="min-h-11 sm:min-h-9"
                />
                <Button
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  onClick={addCost}
                  disabled={
                    !costAmount
                    || !costCurrency
                    || !(Number(costFx) > 0)
                    || (
                      costCategory === "custom"
                      && !costCustomType.trim()
                    )
                  }
                >
                  <Plus className="mr-1 size-4" />
                  {t("trips.addCost")}
                </Button>
                <p className="text-xs text-muted-foreground sm:col-span-6">
                  {t("trips.costUsdPreview", {
                    usd: (
                      (
                        costCategory === "discount_refund" ? -1 : 1
                      )
                      * (Number(costAmount) || 0)
                      * (Number(costFx) || 0)
                    ).toFixed(2),
                  })}
                </p>
              </div>
            )}
          </div>

          {!lot.lines_imported ? (
            <div className="space-y-2 rounded-md bg-muted/40 p-3">
              <Label className="text-sm font-semibold">{t("trips.addCardsHeading")}</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={searchGame}
                  onChange={(e) => setSearchGame(e.target.value as LotItemCatalog)}
                  aria-label={t("trips.itemType")}
                  className="min-h-11 rounded-md border bg-background px-2 text-sm sm:min-h-9"
                >
                  <option value="pokemon">Pokémon</option>
                  <option value="mtg">MTG</option>
                  <option value="pokemon_sealed">{t("game.pokemon_sealed")}</option>
                </select>
                <Input
                  placeholder={t("trips.searchCards")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-h-11 flex-1 sm:min-h-8"
                />
                {searchGame !== "pokemon_sealed" && <div className="flex min-h-11 items-center gap-2 sm:min-h-9">
                  <Label className="text-xs text-muted-foreground">{t("trips.psaGrade")}</Label>
                  <Input type="number" min={0} max={10} value={searchGrade}
                    onChange={(e) => setSearchGrade(e.target.value)} className="min-h-11 w-20 sm:min-h-9 sm:w-14"
                    title={t("trips.psaGradeHint")} />
                </div>}
              </div>
              {searchGame !== "pokemon_sealed" && Number(searchGrade) > 0 && (
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
                      key={`${r.kind}-${r.item_id}`}
                      onClick={() => addLine(r)}
                      className="flex min-h-11 w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      {r.image_url ? (
                        <img
                          src={r.image_url}
                          alt=""
                          loading="lazy"
                          className="h-10 w-8 shrink-0 rounded-sm object-contain"
                        />
                      ) : (
                        <span className="flex h-10 w-8 shrink-0 items-center justify-center rounded-sm bg-muted">
                          <ImageOff className="size-3.5 text-muted-foreground" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {getCardDisplayName({ regional_name: r.regional_name, english_name: r.english_name }, language)}
                        {" · "}
                        {r.kind === "sealed"
                          ? [r.set_code, r.product_type, `${r.sealed_condition}/${r.variant_edition}`].filter(Boolean).join(" · ")
                          : cardMeta(r.set_code, r.card_number, r.misc_info)}
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
                      {ln.kind === "sealed" ? `${ln.setCode} · ${ln.sealedLabel}` : `${cardMeta(ln.setCode, ln.cardNumber, ln.miscInfo)} · ${lotLineGradeLabel(ln.psa_grade ?? 0)}`}
                    </div>
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <span>×{ln.quantity}</span>
                      <span className="text-right font-medium">
                        {lot.lines_imported
                          ? `${t("trips.landedCost")} $${Number(ln.allocated_cost_usd).toFixed(2)}`
                          : (ln.price_override_usd != null
                              ? `${toNative(ln.price_override_usd)} ${lotCcy}`
                              : "-")}
                      </span>
                    </div>
                    {lot.lines_imported && (
                      <div className="text-right text-[11px] tabular-nums text-muted-foreground">
                        ${Number(ln.direct_purchase_cost_usd).toFixed(2)}
                        {" + "}
                        ${Number(ln.acquisition_cost_alloc_usd).toFixed(2)}
                      </div>
                    )}
                    {!lot.lines_imported && (
                      <Button variant="ghost" size="sm" className="min-h-11 w-full sm:min-h-7" onClick={() => removeLine(ln)}>
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
                <TableHead className="w-24">{t("trips.psaGrade")}</TableHead>
                <TableHead className="w-32">{t("trips.overrideCcy", { ccy: lotCcy })}</TableHead>
                {lot.lines_imported && (
                  <>
                    <TableHead className="w-28">{t("trips.directPurchase")}</TableHead>
                    <TableHead className="w-28">{t("trips.acquisitionCosts")}</TableHead>
                    <TableHead className="w-28">{t("trips.landedCost")}</TableHead>
                  </>
                )}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((ln) => (
                <TableRow key={`${ln.table}-${ln.line_id}`}>
                  <TableCell className="truncate max-w-[280px]">{lineLabel(ln)} <span className="text-muted-foreground">· {ln.kind === "sealed" ? `${ln.setCode} · ${ln.sealedLabel}` : cardMeta(ln.setCode, ln.cardNumber, ln.miscInfo)}</span></TableCell>
                  <TableCell>
                    {lot.lines_imported ? ln.quantity : (
                      <Input type="number" defaultValue={ln.quantity} className="min-h-11 w-16 sm:min-h-8"
                        onBlur={(e) => updateLine(ln, { quantity: Number(e.target.value) })} />
                    )}
                  </TableCell>
                  <TableCell>
                    {ln.kind === "sealed"
                      ? lot.lines_imported
                        ? <span className="text-xs text-muted-foreground">{ln.sealedLabel}</span>
                        : (
                          <div className="flex flex-col gap-1">
                            <select
                              value={ln.sealed_condition}
                              aria-label={t("sealedBrowser.conditionPrefix")}
                              className="min-h-11 rounded-md border bg-background px-1 text-sm sm:min-h-8"
                              onChange={(e) => updateLine(ln, { sealed_condition: e.target.value })}
                            >
                              <option value="standard">{t("sealedBrowser.conditionStandard")}</option>
                              <option value="shrink">{t("sealedBrowser.conditionShrink")}</option>
                              <option value="no_shrink">{t("sealedBrowser.conditionNoShrink")}</option>
                            </select>
                            <select
                              value={ln.variant_edition}
                              aria-label={t("sealedBrowser.editionPrefix")}
                              className="min-h-11 rounded-md border bg-background px-1 text-sm sm:min-h-8"
                              onChange={(e) => updateLine(ln, { variant_edition: e.target.value })}
                            >
                              <option value="standard">{t("sealedBrowser.editionStandard")}</option>
                              <option value="1ed">{t("sealedBrowser.edition1ed")}</option>
                              <option value="unlimited">{t("sealedBrowser.editionUnlimited")}</option>
                            </select>
                          </div>
                        )
                      : lot.lines_imported
                        ? (conditions.find((c) => c.condition_id === ln.condition_id)?.code ?? ln.condition_id)
                        : (
                          <select value={ln.condition_id} className="min-h-11 rounded-md border bg-background px-1 text-sm sm:min-h-8"
                            onChange={(e) => updateLine(ln, { condition_id: Number(e.target.value) })}>
                            {conditions.map((c) => <option key={c.condition_id} value={c.condition_id}>{c.code}</option>)}
                          </select>
                        )}
                  </TableCell>
                  <TableCell>
                    {ln.kind === "sealed"
                      ? "-"
                      : lot.lines_imported
                        ? lotLineGradeLabel(ln.psa_grade ?? 0)
                        : (
                          <Input
                            type="number"
                            min={0}
                            max={10}
                            value={ln.psa_grade ?? 0}
                            className="min-h-11 w-16 sm:min-h-8"
                            aria-label={t("trips.psaGrade")}
                            onChange={(e) => {
                              const grade = Math.max(0, Math.min(10, Math.floor(Number(e.target.value) || 0)));
                              setLines((current) => current.map((item) =>
                                item.table === ln.table && item.line_id === ln.line_id
                                  ? { ...item, psa_grade: grade }
                                  : item
                              ));
                            }}
                            onBlur={(e) => updateLine(ln, {
                              psa_grade: Math.max(0, Math.min(10, Math.floor(Number(e.target.value) || 0))),
                            })}
                          />
                        )}
                  </TableCell>
                  <TableCell>
                    {lot.lines_imported ? (ln.price_override_usd != null ? toNative(ln.price_override_usd) : "-") : (
                      <Input type="number" defaultValue={ln.price_override_usd != null ? toNative(ln.price_override_usd) : ""} placeholder="-"
                        className={`min-h-11 w-20 sm:min-h-8 ${needsTotalForBlanks && ln.price_override_usd == null ? "ring-1 ring-amber-500" : ""}`}
                        onBlur={(e) => updateLine(ln, { price_override_usd: e.target.value === "" ? null : fromNative(Number(e.target.value)) })} />
                    )}
                  </TableCell>
                  {lot.lines_imported && (
                    <>
                      <TableCell>${Number(ln.direct_purchase_cost_usd).toFixed(2)}</TableCell>
                      <TableCell>${Number(ln.acquisition_cost_alloc_usd).toFixed(2)}</TableCell>
                      <TableCell>
                        ${Number(ln.allocated_cost_usd).toFixed(2)}
                        {ln.quantity > 1 && (
                          <div className="text-xs text-muted-foreground">
                            ${(Number(ln.allocated_cost_usd) / ln.quantity).toFixed(2)} {t("trips.landedCostPerUnit")}
                          </div>
                        )}
                      </TableCell>
                    </>
                  )}
                  <TableCell>
                    {!lot.lines_imported && (
                      <Button variant="ghost" size="icon" className="size-11 sm:size-7" onClick={() => removeLine(ln)}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {lines.length === 0 && (
                <TableRow><TableCell colSpan={lot.lines_imported ? 9 : 6} className="text-muted-foreground">{t("trips.empty")}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          )}

          {!lot.lines_imported && lines.length > 0 && (
            <div className="space-y-1">
              {needsTotalForBlanks && (
                <p className="text-xs text-amber-500">
                  {t("trips.finalizeNeedsPrices", { count: blankLineCount })}
                </p>
              )}
              <Button onClick={finalize} disabled={needsTotalForBlanks}>
                <Check className="size-4 mr-1" />{t("trips.finalize")}
              </Button>
            </div>
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
            <Field><Label>{t("trips.lotTotalOptional")}</Label>
              <Input type="number" value={cTotal} onChange={(e) => setCTotal(e.target.value)} /></Field>
            <Field><Label>{t("trips.fxRate")}</Label>
              <Input type="number" value={cFx} onChange={(e) => setCFx(e.target.value)} /></Field>
            <p className="text-xs text-muted-foreground">
              {cTotal.trim() === ""
                ? t("trips.lotTotalOptionalHint")
                : t("trips.usdComputed", { usd: (Number(cTotal) * Number(cFx) || 0).toFixed(2) })}
            </p>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLotDialogOpen(false)}>{t("trips.cancel")}</Button>
            <Button disabled={saving} onClick={saveLot}>
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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Flag } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useLanguage } from "../LanguageContext";
import { getCardDisplayName, fetchCardRowById, fetchCardRowsByIds, type CardRowData } from "../use-card-data";
import { useOwnedInventoryCounts, ownedInventoryKey } from "../owned-inventory";
import { OwnedCountLine } from "../OwnedCountLine";
import CardDetailModal from "../CardDetailModal";
import { useTrips } from "../TripContext";
import { useSaving } from "@/lib/use-saving";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// One observed card on this trip's watchlist, from trip_deal_watchlist_v.
interface WatchRow {
  rule_id: number;
  card_id: number;
  psa_grade: number;
  regional_name: string;
  english_name: string | null;
  set_code: string;
  card_number: string | null;
  observed_store: string | null;
  observed_price_orig: number | null;
  observed_currency: string | null;
  observed_price_usd: number | null;
  us_bid_usd: number | null;
  us_bid_region: string | null;
  gross_roi_pct: number | null;
}

export default function TripWatchlistTab({ tripId }: { tripId: number }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { trips, closeTrip } = useTrips();
  const { saving, save } = useSaving();
  const [rows, setRows] = useState<WatchRow[] | null>(null);
  const [selectedCard, setSelectedCard] = useState<CardRowData | null>(null);
  // Market data (ROI + the row for the detail modal) per watched card, and the
  // owned-inventory counts, so the watchlist carries the same info as the browser.
  const [cardData, setCardData] = useState<Map<string, CardRowData>>(new Map());

  const trip = trips.find((tr) => tr.trip_id === tripId);
  const closed = trip?.status === "closed";

  const ownedIdentities = useMemo(
    () => (rows ?? []).map((r) => ({ game: "pokemon" as const, cardId: r.card_id })),
    [rows],
  );
  const ownedCounts = useOwnedInventoryCounts("pokemon", ownedIdentities);
  // Sort/filter by how much of each card you already hold: low stock (0/1) to
  // the top so you know what still needs buying, and an optional max-owned cap.
  const [lowStockFirst, setLowStockFirst] = useState(false);
  const [maxOwned, setMaxOwned] = useState("");
  const ownedQtyFor = useCallback(
    (r: WatchRow) => ownedCounts.get(ownedInventoryKey({ game: "pokemon", cardId: r.card_id }))?.owned ?? 0,
    [ownedCounts],
  );
  const displayRows = useMemo(() => {
    if (!rows) return rows;
    const cap = maxOwned.trim() === "" ? null : Number(maxOwned);
    let out = cap == null || Number.isNaN(cap) ? rows : rows.filter((r) => ownedQtyFor(r) <= cap);
    if (lowStockFirst) {
      out = [...out].sort((a, b) => ownedQtyFor(a) - ownedQtyFor(b) || (b.gross_roi_pct ?? -Infinity) - (a.gross_roi_pct ?? -Infinity));
    }
    return out;
  }, [rows, maxOwned, lowStockFirst, ownedQtyFor]);

  const fetchRows = useCallback(async () => {
    const supabase = createClient();
    // Highest theoretical return first; unpriced (no US bid) sink to the bottom.
    const { data } = await supabase
      .from("trip_deal_watchlist_v")
      .select(
        "rule_id, card_id, psa_grade, regional_name, english_name, set_code, card_number, observed_store, observed_price_orig, observed_currency, observed_price_usd, us_bid_usd, us_bid_region, gross_roi_pct"
      )
      .eq("trip_id", tripId)
      .order("gross_roi_pct", { ascending: false, nullsFirst: false });
    setRows((data as WatchRow[]) ?? []);
  }, [tripId]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  // Load the market summary (ROI + prices) for the watched cards.
  useEffect(() => {
    if (!rows || rows.length === 0) { setCardData(new Map()); return; }
    const supabase = createClient();
    let cancelled = false;
    void fetchCardRowsByIds(supabase, "pokemon", rows.map((r) => r.card_id)).then((m) => {
      if (!cancelled) setCardData(m);
    });
    return () => { cancelled = true; };
  }, [rows]);

  const finishTrip = async () => {
    await save(async () => {
      const retired = await closeTrip(tripId);
      await fetchRows();
      return retired;
    });
  };

  // Tap a card -> open its detail modal (the store-sighting form lives there),
  // so a card already on the watchlist is one tap from adding a new listing.
  const openCard = async (r: WatchRow) => {
    const cached = cardData.get(String(r.card_id));
    if (cached) { setSelectedCard(cached); return; }
    const supabase = createClient();
    const card = await fetchCardRowById(supabase, "pokemon", r.card_id, r.psa_grade);
    if (card) setSelectedCard(card);
  };

  const roiClass = (roi: number | null) =>
    roi == null ? "" : roi >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive";
  const fmtRoi = (roi: number | null | undefined) =>
    roi == null ? "-" : `${Math.round(roi * 100) / 100}%`;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-prose text-sm text-muted-foreground">{t("trips.watchlistHelp")}</p>
        {!closed && (rows?.length ?? 0) > 0 && (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
              <Flag className="size-4 mr-1" />{t("trips.finishTrip")}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("trips.finishTrip")}</AlertDialogTitle>
                <AlertDialogDescription>{t("trips.finishTripConfirm")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("trips.cancel")}</AlertDialogCancel>
                <AlertDialogAction disabled={saving} onClick={finishTrip}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : t("trips.finishTrip")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {(rows?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button variant={lowStockFirst ? "default" : "outline"} size="sm" onClick={() => setLowStockFirst((v) => !v)}>
            {t("trips.lowStockFirst")}
          </Button>
          <label className="flex items-center gap-1 text-muted-foreground">
            {t("trips.maxOwned")}
            <Input type="number" min={0} value={maxOwned} onChange={(e) => setMaxOwned(e.target.value)} placeholder="—" className="h-8 w-16" />
          </label>
        </div>
      )}

      {rows === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />{t("common.loading")}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {closed ? t("trips.watchlistClosedEmpty") : t("trips.watchlistEmpty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("trips.watchlistCard")}</TableHead>
                <TableHead className="w-40">{t("trips.watchlistObserved")}</TableHead>
                <TableHead className="w-28">{t("trips.watchlistUsBid")}</TableHead>
                <TableHead className="w-24 text-right">{t("trips.watchlistRoi")}</TableHead>
                <TableHead className="w-20 text-right">{t("column.roi")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(displayRows ?? []).map((r) => (
                <TableRow
                  key={r.rule_id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => void openCard(r)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void openCard(r); } }}
                >
                  <TableCell className="max-w-[260px]">
                    <div className="truncate">
                      {getCardDisplayName({ regional_name: r.regional_name, english_name: r.english_name }, language)}
                      <span className="text-muted-foreground"> · {r.set_code}{r.card_number ? ` ${r.card_number}` : ""}{r.psa_grade > 0 ? ` · PSA ${r.psa_grade}` : ""}</span>
                    </div>
                    {(() => {
                      const c = ownedCounts.get(ownedInventoryKey({ game: "pokemon", cardId: r.card_id }));
                      return <OwnedCountLine owned={c?.owned} incoming={c?.incoming} avgCost={c?.avgCost} totalCost={c?.costBasis} />;
                    })()}
                  </TableCell>
                  <TableCell>
                    {r.observed_price_usd != null ? (
                      <div>
                        <div>${Number(r.observed_price_usd).toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.observed_currency} {Number(r.observed_price_orig).toLocaleString()}{r.observed_store ? ` · ${r.observed_store}` : ""}
                        </div>
                      </div>
                    ) : "-"}
                  </TableCell>
                  <TableCell>
                    {r.us_bid_usd != null ? `$${Number(r.us_bid_usd).toFixed(2)}` : "-"}
                  </TableCell>
                  <TableCell className={`text-right font-medium ${roiClass(r.gross_roi_pct)}`}>
                    {r.gross_roi_pct != null ? `${r.gross_roi_pct > 0 ? "+" : ""}${Number(r.gross_roi_pct).toFixed(1)}%` : "-"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {fmtRoi(cardData.get(String(r.card_id))?.roi)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CardDetailModal
        card={selectedCard}
        open={!!selectedCard}
        onClose={() => { setSelectedCard(null); void fetchRows(); }}
        initialPsaMode={selectedCard?.psaGrade ? "psa" : "non-psa"}
      />
    </div>
  );
}

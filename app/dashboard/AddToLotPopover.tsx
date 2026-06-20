"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useTrips } from "./TripContext";
import { useLotPicker, type OpenLot } from "./LotPickerContext";

interface Cond {
  condition_id: number;
  code: string;
}

type AddToLotProps =
  | { mode: "single"; game: "pokemon" | "mtg"; cardId: string | number; psaGrade: number }
  | { mode: "sealed"; productId: string | number; sealedCondition: string; variantEdition: string };

// Mirrors the "Add to Buy List" popover, but a lot line also needs a quantity
// (and a condition for singles) plus an optional per-unit cost override.
export function AddToLotPopover(props: AddToLotProps) {
  const { t } = useTranslation();
  const { trips } = useTrips();
  const { openLots, addCardLine, addSealedLine, refresh } = useLotPicker();

  const [qty, setQty] = useState("1");
  const [override, setOverride] = useState("");
  const [conditions, setConditions] = useState<Cond[]>([]);
  const [conditionId, setConditionId] = useState<number | null>(null);
  const [grade, setGrade] = useState(String(props.mode === "single" ? props.psaGrade : 0));
  const [addedTo, setAddedTo] = useState<string | null>(null);

  useEffect(() => {
    if (props.mode !== "single") return;
    const supabase = createClient();
    supabase
      .from("conditions")
      .select("condition_id, code, standard")
      .eq("standard", "tcgplayer")
      .then(({ data }) => {
        const rows = (data as (Cond & { standard: string })[]) ?? [];
        setConditions(rows);
        setConditionId(rows.find((c) => c.code === "NM")?.condition_id ?? rows[0]?.condition_id ?? null);
      });
  }, [props.mode]);

  const lotLabel = useCallback(
    (lotId: number, tripId: number | null, leg: string, shop: string | null) => {
      const tripName = tripId ? trips.find((tr) => tr.trip_id === tripId)?.name : null;
      const legLabel = t(`trips.leg${leg === "export" ? "Export" : "Import"}` as "trips.legImport");
      return [tripName ?? `Lot #${lotId}`, legLabel, shop].filter(Boolean).join(" · ");
    },
    [trips, t]
  );

  async function add(lot: OpenLot, label: string) {
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    // The override is entered in the chosen lot's currency; convert to the
    // stored USD via that lot's FX rate (USD lots pass through unchanged).
    const ovNative = override.trim() === "" ? null : Number(override);
    const ov = ovNative == null ? null
      : lot.orig_currency === "USD" ? ovNative
      : Math.round(ovNative * (lot.fx_rate_used || 1) * 100) / 100;
    if (props.mode === "single") {
      if (!conditionId) return;
      await addCardLine({
        lotId: lot.lot_id, game: props.game, cardId: props.cardId, conditionId,
        psaGrade: Math.max(0, Math.floor(Number(grade) || 0)), quantity: n, overrideUsd: ov,
      });
    } else {
      await addSealedLine({
        lotId: lot.lot_id, productId: props.productId, sealedCondition: props.sealedCondition,
        variantEdition: props.variantEdition, quantity: n, overrideUsd: ov,
      });
    }
    await refresh();
    setAddedTo(label);
    setTimeout(() => setAddedTo(null), 2000);
  }

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        {addedTo ? <Check className="size-4" /> : <Plus className="size-4" />}
        {addedTo ? t("trips.addedToLot", { lot: addedTo }) : t("trips.addToLot")}
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-3" align="end">
        <div className="flex gap-2">
          <div className="flex-1">
            <Label className="text-xs">{t("trips.qty")}</Label>
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="h-8" />
          </div>
          {props.mode === "single" && (
            <>
              <div className="flex-1">
                <Label className="text-xs">{t("trips.condition")}</Label>
                <select
                  value={conditionId ?? ""}
                  onChange={(e) => setConditionId(Number(e.target.value))}
                  className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                >
                  {conditions.map((c) => (
                    <option key={c.condition_id} value={c.condition_id}>{c.code}</option>
                  ))}
                </select>
              </div>
              <div className="w-16">
                <Label className="text-xs">{t("trips.psaGrade")}</Label>
                <Input type="number" min={0} max={10} value={grade}
                  onChange={(e) => setGrade(e.target.value)} className="h-8" />
              </div>
            </>
          )}
        </div>
        <div>
          <Label className="text-xs">{t("trips.overrideOptional")}</Label>
          <Input
            type="number" placeholder={t("trips.overrideLotCcy")} value={override}
            onChange={(e) => setOverride(e.target.value)} className="h-8"
          />
        </div>

        <div className="border-t pt-2">
          {openLots.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">{t("trips.noOpenLots")}</p>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {openLots.map((l) => {
                const label = lotLabel(l.lot_id, l.trip_id, l.leg, l.shop_label);
                return (
                  <button
                    key={l.lot_id}
                    className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent text-left"
                    onClick={() => add(l, label)}
                  >
                    <span className="truncate">{label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{l.orig_currency}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

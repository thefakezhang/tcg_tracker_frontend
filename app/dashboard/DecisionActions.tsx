"use client";

import { useState } from "react";
import { Check, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import type { CardRowData } from "./use-card-data";
import type { GradeSignal } from "./grade-signals";

export function decisionSnapshot(row: CardRowData, signal: GradeSignal | null | undefined) {
  return {
    signal: signal ?? {},
    browser: {
      lowest_buy: row.prices.lowestSell,
      highest_sell: row.prices.highestBuy,
      roi: row.roi,
    },
    no_signals_at_decision_time: !signal,
  };
}

export function DecisionActions({ row, grade, signal, compact = false }: {
  row: CardRowData;
  grade?: number;
  signal?: GradeSignal | null;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"dismissed" | "watched" | null>(null);
  const activeSignal = signal === undefined ? row.signal : signal;
  const snapshot = decisionSnapshot(row, activeSignal);

  async function watch() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("record_deal_decision", {
      p_card_id: Number(row.card.card_id),
      p_psa_grade: grade ?? row.psaGrade ?? 0,
      p_action: "watched",
      p_signals_snapshot: snapshot,
      p_entry_price: row.prices.lowestSell?.normalizedPrice ?? null,
      p_entry_currency: row.prices.lowestSell ? "USD" : null,
      p_location_id: null,
      p_reason: null,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSaved("watched");
  }

  async function dismiss() {
    if (busy || reason.trim() === "") return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("dismiss_deal_opportunity", {
      p_card_id: Number(row.card.card_id),
      p_psa_grade: grade ?? row.psaGrade ?? 0,
      p_reason: reason.trim(),
      p_signals_snapshot: snapshot,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSaved("dismissed");
    setReason("");
    setDismissOpen(false);
  }

  return (
    <div className="flex max-w-full flex-wrap items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={busy} className={compact ? "h-11 px-3 text-sm sm:h-7 sm:px-2 sm:text-xs" : "h-11 px-3 text-sm sm:h-7 sm:px-2.5 sm:text-[0.8rem]"} onClick={watch}>
          {saved === "watched" ? <Check className="size-3.5" /> : <Eye className="size-3.5" />}
          {saved === "watched" ? t("decision.watching") : t("decision.watch")}
        </Button>
        <Popover open={dismissOpen} onOpenChange={setDismissOpen}>
          <PopoverTrigger render={<Button variant="ghost" size="icon" className="size-11 sm:size-7" aria-label={saved === "dismissed" ? t("decision.dismissed") : t("decision.dismissOpportunity")} />}>
            {saved === "dismissed" ? <Check className="size-3.5" /> : <X className="size-3.5" />}
          </PopoverTrigger>
          <PopoverContent className="w-[calc(100vw-2rem)] max-w-72 p-3" align="end">
            <div className="text-sm font-medium">{t("decision.dismissOpportunity")}</div>
            <p className="text-xs text-muted-foreground">{t("decision.dismissHelp")}</p>
            <label className="text-xs text-muted-foreground">{t("decision.dismissReason")}</label>
            <Input className="h-11 sm:h-8" required value={reason} placeholder={t("decision.dismissReasonPlaceholder")} onChange={(event) => setReason(event.target.value)} />
            <Button className="min-h-11 w-full whitespace-normal sm:min-h-8" variant="outline" disabled={busy || reason.trim() === ""} onClick={dismiss}>
              <X className="size-4" />
              {busy ? t("decision.dismissing") : t("decision.dismiss")}
            </Button>
          </PopoverContent>
        </Popover>
      </div>
      {error ? <p role="alert" className="basis-full text-right text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

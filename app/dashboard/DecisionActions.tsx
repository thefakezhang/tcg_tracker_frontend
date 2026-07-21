"use client";

import { useState } from "react";
import { Check, Eye, MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import type { CardRowData } from "./use-card-data";
import type { GradeSignal } from "./grade-signals";
import StoreSightingAction from "./StoreSightingAction";

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

export function DecisionActions({ row, grade, signal, compact = false, defaultStorePrice = "", defaultStoreCurrency = "JPY" }: {
  row: CardRowData;
  grade?: number;
  signal?: GradeSignal | null;
  compact?: boolean;
  defaultStorePrice?: string;
  defaultStoreCurrency?: "JPY" | "USD";
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<"passed" | "watched" | null>(null);
  const activeSignal = signal === undefined ? row.signal : signal;
  const snapshot = decisionSnapshot(row, activeSignal);

  async function record(action: "passed" | "watched") {
    if (busy) return;
    setBusy(true);
    const { error } = await createClient().rpc("record_deal_decision", {
      p_card_id: Number(row.card.card_id),
      p_psa_grade: grade ?? row.psaGrade ?? 0,
      p_action: action,
      p_signals_snapshot: snapshot,
      p_entry_price: row.prices.lowestSell?.normalizedPrice ?? null,
      p_entry_currency: row.prices.lowestSell ? "USD" : null,
      p_location_id: null,
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (!error) setSaved(action);
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
      <Button variant="outline" size="sm" disabled={busy} className={compact ? "h-7 px-2 text-xs" : undefined} onClick={() => record("passed")}>
        {saved === "passed" ? <Check className="size-3.5" /> : <X className="size-3.5" />}
        {saved === "passed" ? t("decision.passed") : t("decision.pass")}
      </Button>
      <Button variant="outline" size="sm" disabled={busy} className={compact ? "h-7 px-2 text-xs" : undefined} onClick={() => record("watched")}>
        {saved === "watched" ? <Check className="size-3.5" /> : <Eye className="size-3.5" />}
        {saved === "watched" ? t("decision.watching") : t("decision.watch")}
      </Button>
      <StoreSightingAction
        cardId={Number(row.card.card_id)}
        psaGrade={grade ?? row.psaGrade ?? 0}
        signalsSnapshot={snapshot}
        defaultPrice={defaultStorePrice}
        defaultCurrency={defaultStoreCurrency}
        compact={compact}
      />
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="icon" className="size-7" aria-label={t("decision.reason")} />}>
          <MessageSquare className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="end">
          <label className="text-xs text-muted-foreground">{t("decision.reasonOptional")}</label>
          <Input className="mt-2 h-8" value={reason} onChange={(event) => setReason(event.target.value)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

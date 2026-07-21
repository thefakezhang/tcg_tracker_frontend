"use client";

import { useEffect, useState } from "react";
import { Check, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";

interface StoreSightingActionProps {
  cardId: number;
  psaGrade: number;
  signalsSnapshot: object;
  defaultPrice?: string;
  defaultCurrency?: "JPY" | "USD";
  compact?: boolean;
}

export default function StoreSightingAction({
  cardId,
  psaGrade,
  signalsSnapshot,
  defaultPrice = "",
  defaultCurrency = "JPY",
  compact = false,
}: StoreSightingActionProps) {
  const { t } = useTranslation();
  const [storeName, setStoreName] = useState("");
  const [observedPrice, setObservedPrice] = useState(defaultPrice);
  const [currency, setCurrency] = useState<"JPY" | "USD">(defaultCurrency);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (observedPrice === "" && defaultPrice !== "") setObservedPrice(defaultPrice);
  }, [defaultPrice, observedPrice]);

  useEffect(() => {
    if (observedPrice === "") setCurrency(defaultCurrency);
  }, [defaultCurrency, observedPrice]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const price = Number(observedPrice);
    if (storeName.trim() === "" || !Number.isFinite(price) || price <= 0 || busy) return;

    setBusy(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc("record_deal_store_sighting", {
      p_card_id: cardId,
      p_psa_grade: psaGrade,
      p_store_name: storeName.trim(),
      p_observed_price: price,
      p_currency: currency,
      p_signals_snapshot: signalsSnapshot,
      p_observed_at: new Date().toISOString(),
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSaved(true);
    setStoreName("");
    setNote("");
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size={compact ? "icon-sm" : "sm"}
            disabled={busy}
            className={compact ? "size-7" : undefined}
            aria-label={t("decision.recordStorePrice")}
          />
        }
      >
        {saved ? <Check className="size-3.5" /> : <Store className="size-3.5" />}
        {compact ? null : saved ? t("decision.sightingSaved") : t("decision.recordStorePrice")}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="end">
        <form className="space-y-3" onSubmit={save}>
          <div>
            <div className="font-medium">{t("decision.storeSighting")}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("decision.storeSightingHelp")}</p>
          </div>
          <label className="block text-xs text-muted-foreground">
            {t("decision.storeName")}
            <Input className="mt-1" required value={storeName} onChange={(event) => setStoreName(event.target.value)} />
          </label>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label className="block text-xs text-muted-foreground">
              {t("decision.observedPrice")}
              <Input className="mt-1" type="number" min="0" step="any" inputMode="decimal" required value={observedPrice} onChange={(event) => setObservedPrice(event.target.value)} />
            </label>
            <label className="block text-xs text-muted-foreground">
              {t("decision.currency")}
              <select className="mt-1 h-9 rounded-md border bg-background px-3 text-sm text-foreground" value={currency} onChange={(event) => setCurrency(event.target.value as "JPY" | "USD")}>
                <option value="JPY">JPY</option>
                <option value="USD">USD</option>
              </select>
            </label>
          </div>
          <label className="block text-xs text-muted-foreground">
            {t("decision.sightingNote")}
            <Input className="mt-1" value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
          <Button className="w-full" type="submit" disabled={busy || storeName.trim() === "" || Number(observedPrice) <= 0}>
            {busy ? t("decision.savingSighting") : t("decision.saveSighting")}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

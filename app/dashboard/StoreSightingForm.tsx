"use client";

import { useState } from "react";
import { Check, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";

interface StoreSightingFormProps {
  cardId: number;
  psaGrade: number;
  signalsSnapshot: object;
  price: string;
  currency: "JPY" | "USD";
  onPsaGradeChange: (value: number) => void;
  onPriceChange: (value: string) => void;
  onCurrencyChange: (value: "JPY" | "USD") => void;
  entryDescription: string;
  fxDescription: string;
}

export default function StoreSightingForm({
  cardId,
  psaGrade,
  signalsSnapshot,
  price,
  currency,
  onPsaGradeChange,
  onPriceChange,
  onCurrencyChange,
  entryDescription,
  fxDescription,
}: StoreSightingFormProps) {
  const { t } = useTranslation();
  const [storeName, setStoreName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const observedPrice = Number(price);
    if (storeName.trim() === "" || !Number.isFinite(observedPrice) || observedPrice <= 0 || busy) return;

    setBusy(true);
    setSaved(false);
    setError(null);
    const { error: rpcError } = await createClient().rpc("record_deal_store_sighting", {
      p_card_id: cardId,
      p_psa_grade: psaGrade,
      p_store_name: storeName.trim(),
      p_observed_price: observedPrice,
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
    <form className="min-w-0 rounded-lg border bg-card p-3" onSubmit={save}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-semibold"><Store className="size-4" />{t("decision.storeSighting")}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{t("decision.storeSightingHelp")}</p>
        </div>
        <label className="text-xs text-muted-foreground">
          {t("decision.recordAs")}
          <select
            className="mt-1 h-11 w-full min-w-28 rounded-md border bg-background px-3 text-sm text-foreground sm:h-8"
            value={psaGrade}
            onChange={(event) => { onPsaGradeChange(Number(event.target.value)); setSaved(false); }}
          >
            <option value={0}>{t("evidence.raw")}</option>
            {Array.from({ length: 10 }, (_, index) => 10 - index).map((grade) => (
              <option key={grade} value={grade}>PSA {grade}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.2fr_1fr_auto_1.2fr_auto] xl:items-end">
        <label className="text-xs text-muted-foreground">
          {t("decision.storeName")}
          <Input className="mt-1 h-11 sm:h-8" required value={storeName} onChange={(event) => { setStoreName(event.target.value); setSaved(false); }} />
        </label>
        <label className="text-xs text-muted-foreground">
          {t("economics.askingPrice")}
          <Input className="mt-1 h-11 sm:h-8" type="number" min="0" step="any" inputMode="decimal" required value={price} onChange={(event) => { onPriceChange(event.target.value); setSaved(false); }} placeholder={t("economics.askingPlaceholder")} />
        </label>
        <label className="text-xs text-muted-foreground">
          {t("decision.currency")}
          <select className="mt-1 h-11 w-full rounded-md border bg-background px-3 text-sm text-foreground sm:h-8" value={currency} onChange={(event) => { onCurrencyChange(event.target.value as "JPY" | "USD"); setSaved(false); }}>
            <option value="JPY">JPY</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          {t("decision.sightingNote")}
          <Input className="mt-1 h-11 sm:h-8" value={note} onChange={(event) => { setNote(event.target.value); setSaved(false); }} />
        </label>
        <Button className="min-h-11 whitespace-normal sm:min-h-8" type="submit" disabled={busy || storeName.trim() === "" || Number(price) <= 0}>
          {saved ? <Check className="size-4" /> : <Store className="size-4" />}
          {busy ? t("decision.savingSighting") : saved ? t("decision.sightingSaved") : t("decision.saveSighting")}
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{entryDescription}</span>
        <span>{fxDescription}</span>
      </div>
      {saved ? <p className="mt-2 text-xs text-emerald-600">{t("decision.sightingSavedHelp")}</p> : null}
      {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
    </form>
  );
}

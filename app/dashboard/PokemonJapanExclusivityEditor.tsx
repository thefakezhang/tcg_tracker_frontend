"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import type { JapanExclusivityDimension } from "./japan-exclusivity";

export interface PokemonJapanExclusivityValues {
  japan_exclusive_artwork: boolean;
  japan_exclusive_artwork_reason: string;
  japan_exclusive_artwork_evidence_url: string;
  japan_exclusive_stamps: boolean;
  japan_exclusive_stamps_reason: string;
  japan_exclusive_stamps_evidence_url: string;
}

type PartialCard = Partial<Record<keyof PokemonJapanExclusivityValues, boolean | string | null>>;

export function pokemonJapanExclusivityValues(card: PartialCard | null | undefined): PokemonJapanExclusivityValues {
  return {
    japan_exclusive_artwork: card?.japan_exclusive_artwork === true,
    japan_exclusive_artwork_reason: String(card?.japan_exclusive_artwork_reason ?? ""),
    japan_exclusive_artwork_evidence_url: String(card?.japan_exclusive_artwork_evidence_url ?? ""),
    japan_exclusive_stamps: card?.japan_exclusive_stamps === true,
    japan_exclusive_stamps_reason: String(card?.japan_exclusive_stamps_reason ?? ""),
    japan_exclusive_stamps_evidence_url: String(card?.japan_exclusive_stamps_evidence_url ?? ""),
  };
}

export async function setPokemonJapanExclusivityDimension(
  cardId: number,
  dimension: JapanExclusivityDimension,
  value: boolean,
  reason: string,
  evidenceURL: string,
): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase.rpc("set_pokemon_japan_exclusivity_dimension", {
    p_card_id: cardId,
    p_dimension: dimension,
    p_value: value,
    p_reason: value ? reason.trim() : null,
    p_evidence_url: value ? evidenceURL.trim() : null,
  });
  return error ? error.message : null;
}

function keys(dimension: JapanExclusivityDimension) {
  return dimension === "artwork"
    ? {
        value: "japan_exclusive_artwork" as const,
        reason: "japan_exclusive_artwork_reason" as const,
        url: "japan_exclusive_artwork_evidence_url" as const,
      }
    : {
        value: "japan_exclusive_stamps" as const,
        reason: "japan_exclusive_stamps_reason" as const,
        url: "japan_exclusive_stamps_evidence_url" as const,
      };
}

export function PokemonJapanExclusivityEditor({
  cardId,
  values,
  onChange,
}: {
  cardId: number;
  values: PokemonJapanExclusivityValues;
  onChange: (values: PokemonJapanExclusivityValues) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(values);
  const [saving, setSaving] = useState<JapanExclusivityDimension | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(values), [values]);

  async function persist(dimension: JapanExclusivityDimension, enabled: boolean) {
    const field = keys(dimension);
    const reason = enabled ? draft[field.reason].trim() : "";
    const url = enabled ? draft[field.url].trim() : "";
    if (enabled && (!reason || !url)) {
      setError(t("cardIndex.exclusivityEvidenceRequired"));
      return;
    }
    setSaving(dimension);
    setError(null);
    const message = await setPokemonJapanExclusivityDimension(cardId, dimension, enabled, reason, url);
    setSaving(null);
    if (message) {
      setError(message);
      setDraft(values);
      return;
    }
    const next = {
      ...draft,
      [field.value]: enabled,
      [field.reason]: enabled ? reason : "",
      [field.url]: enabled ? url : "",
    };
    setDraft(next);
    onChange(next);
  }

  function toggle(dimension: JapanExclusivityDimension, enabled: boolean) {
    const field = keys(dimension);
    if (!enabled && values[field.value]) {
      void persist(dimension, false);
      return;
    }
    setError(null);
    setDraft((current) => ({
      ...current,
      [field.value]: enabled,
      [field.reason]: enabled ? current[field.reason] : values[field.reason],
      [field.url]: enabled ? current[field.url] : values[field.url],
    }));
  }

  return (
    <div className="space-y-3" data-testid="pokemon-japan-exclusivity-editor">
      <div>
        <Label>{t("cardIndex.exclusivityTitle")}</Label>
        <p className="text-xs text-muted-foreground">{t("cardIndex.exclusivityHint")}</p>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {(["artwork", "stamps"] as const).map((dimension) => {
          const field = keys(dimension);
          const enabled = draft[field.value];
          const changed = enabled !== values[field.value]
            || draft[field.reason].trim() !== values[field.reason]
            || draft[field.url].trim() !== values[field.url];
          return (
            <div key={dimension} className="min-w-0 space-y-2 rounded-md border p-3">
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 sm:min-h-0">
                <span className="text-sm font-medium">
                  {t(dimension === "artwork" ? "japanExclusive.artwork" : "japanExclusive.stamps")}
                </span>
                <Switch
                  checked={enabled}
                  disabled={saving !== null}
                  onCheckedChange={(checked) => toggle(dimension, checked)}
                />
              </label>
              {enabled && (
                <>
                  <Textarea
                    value={draft[field.reason]}
                    maxLength={160}
                    rows={2}
                    placeholder={t("cardIndex.exclusivityReason")}
                    aria-label={`${t(dimension === "artwork" ? "japanExclusive.artwork" : "japanExclusive.stamps")} ${t("cardIndex.exclusivityReason")}`}
                    onChange={(event) => setDraft((current) => ({ ...current, [field.reason]: event.target.value }))}
                  />
                  <Input
                    type="url"
                    value={draft[field.url]}
                    maxLength={500}
                    placeholder="https://..."
                    aria-label={`${t(dimension === "artwork" ? "japanExclusive.artwork" : "japanExclusive.stamps")} ${t("cardIndex.exclusivityEvidenceUrl")}`}
                    onChange={(event) => setDraft((current) => ({ ...current, [field.url]: event.target.value }))}
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={saving !== null || !changed}
                    onClick={() => void persist(dimension, true)}
                  >
                    {saving === dimension ? t("common.saving") : t("common.save")}
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

// The manual Cute curator flag on Pokémon cards is independent of the
// evidence-backed artwork and stamp classification. It is written through a
// narrow SECURITY DEFINER RPC, so any authenticated surface that knows a
// card_id can flip it. Two surfaces do: the Card Detail Modal (reached
// from the Card Browser, which only lists cards that HAVE a price summary) and
// the Card Index editor (the whole catalog, including the ~quarter of cards with
// no comp data that the browser can never show). Both render the same switches
// from this one definition so the flags cannot drift apart between surfaces.
export const POKEMON_CURATOR_FLAGS = [
  {
    key: "is_cute",
    rpc: "set_pokemon_cute",
    emoji: "🩷",
    labelKey: "modal.cute",
    chipKey: "cardIndex.flagCute",
  },
] as const satisfies readonly {
  key: string;
  rpc: string;
  emoji: string;
  labelKey: TranslationKey;
  chipKey: TranslationKey;
}[];

export type PokemonCuratorFlagKey = (typeof POKEMON_CURATOR_FLAGS)[number]["key"];
export type PokemonCuratorFlagValues = Record<PokemonCuratorFlagKey, boolean>;

// Normalise a card row (flags may be null/undefined on older rows or partial
// selects) into the boolean map the switches render from.
export function pokemonCuratorFlagValues(
  card: Partial<Record<PokemonCuratorFlagKey, boolean | null>> | null | undefined,
): PokemonCuratorFlagValues {
  return {
    is_cute: !!card?.is_cute,
  };
}

// Persist one flag through its RPC. Resolves to the error message (null on
// success) so each surface decides how to show it.
export async function setPokemonCuratorFlag(
  flag: PokemonCuratorFlagKey,
  cardId: number,
  value: boolean,
): Promise<string | null> {
  const def = POKEMON_CURATOR_FLAGS.find((f) => f.key === flag);
  if (!def) return `unknown curator flag: ${flag}`;
  const supabase = createClient();
  const { error } = await supabase.rpc(def.rpc, { p_card_id: cardId, p_value: value });
  return error ? error.message : null;
}

// The labelled switch saves the moment it is toggled (there is no
// form to submit - the flag IS the whole write), reports success through
// `onChange` so the caller can keep its own row in sync, and shows the RPC's
// error inline instead of silently leaving the switch where it was.
export function PokemonCuratorFlagSwitches({
  cardId,
  values,
  onChange,
  labelClassName = "",
}: {
  cardId: number;
  values: PokemonCuratorFlagValues;
  onChange: (flag: PokemonCuratorFlagKey, value: boolean) => void;
  labelClassName?: string;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState<PokemonCuratorFlagKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(flag: PokemonCuratorFlagKey) {
    if (saving) return;
    const next = !values[flag];
    setSaving(flag);
    setError(null);
    const message = await setPokemonCuratorFlag(flag, cardId, next);
    setSaving(null);
    if (message) {
      setError(message);
      return;
    }
    onChange(flag, next);
  }

  return (
    <>
      {POKEMON_CURATOR_FLAGS.map((f) => (
        <label
          key={f.key}
          className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs sm:min-h-0 ${labelClassName}`.trim()}
        >
          <Switch
            size="sm"
            checked={values[f.key]}
            disabled={saving === f.key}
            onCheckedChange={() => toggle(f.key)}
          />
          <span className="select-none">{f.emoji} {t(f.labelKey)}</span>
        </label>
      ))}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </>
  );
}

// Read-only chips for list rows: one compact badge per flag that is set, with
// the full label on the tooltip. Renders nothing when the flag is unset so
// unflagged rows carry no extra weight.
export function PokemonCuratorFlagChips({
  card,
}: {
  card: Partial<Record<PokemonCuratorFlagKey, boolean | null>>;
}) {
  const { t } = useTranslation();
  const set = POKEMON_CURATOR_FLAGS.filter((f) => !!card[f.key]);
  if (set.length === 0) return null;
  return (
    <>
      {set.map((f) => (
        <Badge key={f.key} variant="outline" title={t(f.labelKey)} data-testid={`curator-flag-${f.key}`}>
          <span aria-hidden="true">{f.emoji}</span> {t(f.chipKey)}
        </Badge>
      ))}
    </>
  );
}

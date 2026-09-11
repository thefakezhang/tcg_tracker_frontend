export type PokemonEdition = "unknown" | "not_applicable" | "first" | "unlimited";

export type PokemonFoilTreatment =
  | "unknown"
  | "normal"
  | "mirror"
  | "reverse"
  | "master_ball_mirror"
  | "monster_ball_mirror"
  | "energy_mark_mirror"
  | "rocket_mark_mirror"
  | "dark_ball_mirror"
  | "love_ball_mirror"
  | "friend_ball_mirror"
  | "quick_ball_mirror"
  | "rocket_team_mirror"
  | "break_mirror"
  | "other";

export interface PokemonVariantProjection {
  misc_info?: string | null;
  edition?: PokemonEdition | string | null;
  foil_treatment?: PokemonFoilTreatment | string | null;
  variant_attrs?: readonly string[] | null;
}

const FOIL_LABELS: Record<string, string | null> = {
  unknown: null,
  normal: null,
  mirror: "ミラー",
  reverse: "リバース",
  master_ball_mirror: "マスターボールミラー",
  monster_ball_mirror: "モンスターボールミラー",
  energy_mark_mirror: "エネルギーマークミラー",
  rocket_mark_mirror: "ロケット団マークミラー",
  dark_ball_mirror: "ダークボールミラー",
  love_ball_mirror: "ラブラブボールミラー",
  friend_ball_mirror: "フレンドボールミラー",
  quick_ball_mirror: "クイックボールミラー",
  rocket_team_mirror: "R団ミラー",
  break_mirror: "BREAKミラー",
  other: "other",
};

function legacyLabel(miscInfo?: string | null): string | null {
  const value = (miscInfo ?? "").trim();
  return value && value.toUpperCase() !== "UNKNOWN" ? value : null;
}

function pushUnique(parts: string[], seen: Set<string>, value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  parts.push(trimmed);
}

function legacyMentionsEdition(value: string, edition: string): boolean {
  if (edition === "first") {
    return /(?:^|[^a-z0-9])(?:1\s*(?:st)?\s*(?:ed(?:ition)?\.?)|first\s+edition)(?:[^a-z0-9]|$)/i.test(value);
  }
  if (edition === "unlimited") {
    return /(アンリミ|unlimited)/i.test(value);
  }
  return false;
}

function legacyMentionsFoil(value: string, foil: string, label: string): boolean {
  if (value.toLowerCase().includes(label.toLowerCase())) return true;
  if (foil === "reverse") return /reverse\s+(?:holo|foil)/i.test(value);
  if (foil.endsWith("mirror")) return /mirror/i.test(value) || value.includes("ミラー");
  return false;
}

// Compose the operator-visible Pokemon variant label from typed axes and the
// Phase 1 residual projection. variant_attrs is authoritative when present,
// which makes a pre-cutover compound misc_info and a post-cutover residual-only
// misc_info render identically. Older API payloads that do not select the typed
// projection retain their legacy misc_info label unchanged.
export function pokemonVariantLabel(card: PokemonVariantProjection): string | null {
  const fallback = legacyLabel(card.misc_info);
  const hasResidualProjection = Array.isArray(card.variant_attrs);
  const parts: string[] = [];
  const seen = new Set<string>();

  if (hasResidualProjection) {
    for (const attribute of card.variant_attrs ?? []) {
      pushUnique(parts, seen, attribute);
    }
  } else {
    pushUnique(parts, seen, fallback);
  }

  const foil = (card.foil_treatment ?? "").trim().toLowerCase();
  const foilLabel = FOIL_LABELS[foil] ?? (foil && foil !== "unknown" && foil !== "normal" ? foil : null);
  if (foilLabel && (hasResidualProjection || !fallback || !legacyMentionsFoil(fallback, foil, foilLabel))) {
    pushUnique(parts, seen, foilLabel);
  }

  const edition = (card.edition ?? "").trim().toLowerCase();
  const editionLabel = edition === "first" ? "1ED" : edition === "unlimited" ? "アンリミ" : null;
  if (editionLabel && (hasResidualProjection || !fallback || !legacyMentionsEdition(fallback, edition))) {
    pushUnique(parts, seen, editionLabel);
  }

  return parts.length > 0 ? parts.join(",") : null;
}

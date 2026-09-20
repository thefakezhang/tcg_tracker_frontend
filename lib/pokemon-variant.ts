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

function pushUnique(parts: string[], seen: Set<string>, value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  parts.push(trimmed);
}

// Compose the operator-visible Pokemon variant label from the two typed axes
// and the residue.
//
// This used to read variant_attrs, a Phase 1 column the backend derived from
// misc_info so that a pre-cutover compound string and a post-cutover residual
// one rendered identically. Both halves of that are gone: the cutover rewrote
// the strings, 000502 stops the catalog accepting a compound one, and the
// column is being dropped. misc_info is the residue now, so it is read as the
// projection directly.
export function pokemonVariantLabel(card: PokemonVariantProjection): string | null {
  const parts: string[] = [];
  const seen = new Set<string>();

  // misc_info IS the residue, so it is the residual projection variant_attrs
  // used to carry - the backend derived that column from this string, and
  // stores it sorted with a bare comma between tokens. Splitting it here gives
  // the same per-token parts the array gave, which is what keeps a token from
  // being deduplicated against a foil or edition label as a whole string.
  //
  // The dedup that used to guard those two labels is gone with the column. It
  // existed because a pre-cutover misc_info could name an axis itself, and
  // pushing the label would have repeated it. Since the backend's 000502 the
  // catalog refuses a misc_info that names an axis, so the residue cannot
  // mention one and there is nothing left to collide with.
  for (const token of residualTokens(card.misc_info)) {
    pushUnique(parts, seen, token);
  }

  const foil = (card.foil_treatment ?? "").trim().toLowerCase();
  const foilLabel = FOIL_LABELS[foil] ?? (foil && foil !== "unknown" && foil !== "normal" ? foil : null);
  pushUnique(parts, seen, foilLabel);

  const edition = (card.edition ?? "").trim().toLowerCase();
  pushUnique(parts, seen, EDITION_LABELS[edition] ?? null);

  return parts.length > 0 ? parts.join(",") : null;
}

// The residue as its tokens. The empty string and the retired UNKNOWN sentinel
// are both a residue of nothing.
function residualTokens(miscInfo?: string | null): string[] {
  const value = (miscInfo ?? "").trim();
  if (!value || value.toUpperCase() === "UNKNOWN") return [];
  return value.split(",").map((token) => token.trim()).filter(Boolean);
}

const EDITION_LABELS: Record<string, string> = {
  first: "1ED",
  unlimited: "アンリミ",
};

// PostgREST `or` fragments that match a search word against the typed Pokemon
// variant axes, for use beside `misc_info.ilike`.
//
// A word used to find a card by substring of its compound misc_info, so "1ED"
// or "ミラー" found every first edition or mirror. The backend's Phase 3
// (docs/variant_axes_separation.md) rewrites misc_info into the residue, and
// those words would then find nothing. This matches the word against the same
// labels pokemonVariantLabel renders, so a word finds the cards whose label
// contains it, before and after the rewrite. "ミラー" therefore finds every
// named mirror too, as the substring did.
export function pokemonVariantSearchFilters(word: string): string[] {
  const needle = word.trim().toLowerCase();
  if (!needle) return [];
  const editions = Object.entries(EDITION_LABELS)
    .filter(([, label]) => label.toLowerCase().includes(needle))
    .map(([edition]) => edition);
  const foils = Object.entries(FOIL_LABELS)
    .filter(([foil, label]) => label !== null && foil !== "other" && label.toLowerCase().includes(needle))
    .map(([foil]) => foil);
  const filters: string[] = [];
  if (editions.length > 0) filters.push(`edition.in.(${editions.join(",")})`);
  if (foils.length > 0) filters.push(`foil_treatment.in.(${foils.join(",")})`);
  return filters;
}

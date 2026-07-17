// Collectr CSV row -> catalog card resolution. Pure logic, no React, so it can
// be tested directly (collectr-match.test.ts).
//
// INVARIANT: a Collectr export is always English. Names arrive like
// "Pikachu & Zekrom GX" or "Mew (JP)" - never Japanese. So the catalog's
// english_name is the ONLY side worth comparing against; matching the CSV name
// against the Japanese regional_name could never produce a true hit, only a
// false one (see norm below for how that played out).
//
// Collectr is also SET-LESS, so per docs/matching.md the card_number narrows but
// does not identify (a number averages 2.47 defs), and the NAME is what
// confirms. Every tier therefore requires a UNIQUE hit, and there is
// deliberately no "just take the first candidate" fallback: it fires exactly
// when the name evidence is weakest, and a wrong card_id on a lot line silently
// misprices it with nothing downstream to catch it.

export interface CandidateDef {
  card_id: number;
  regional_name: string;
  english_name: string | null;
}

// confirmed = the name agrees and pins exactly one card; safe to import by default.
// review    = we have a suggestion, but nothing confirmed it; the curator opts in.
// none      = ambiguous or unknown; never guess.
export type MatchStatus = "confirmed" | "review" | "none";

// Fold an English name to a comparable key: NFKC (so fullwidth ＧＸ meets GX),
// drop the "(JP)" marker Collectr appends to Japanese-print cards, lowercase,
// then strip punctuation and spacing.
//
// Keys can come back EMPTY (a def with no english_name, a row named only in
// punctuation), and empty keys are the hazard this module exists to contain:
// `"blastoise".includes("")` is always true in JS. The old matcher fed
// regional_name through this same fold - which deletes every Japanese character,
// so 86% of the catalog folded to "" - and then asked exactly that question, so
// its containment tier silently returned the FIRST candidate for any row whose
// English name didn't match exactly. Callers must drop empty keys before
// comparing; emptyKey() is why every filter below guards on length.
export const norm = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/\(jp\)/g, "").replace(/[^a-z0-9]/g, "");

// Names shorter than this cannot carry a containment match: "mew" inside
// "shiningmew" would attach Mew to a Shining Mew row.
const MIN_CONTAINMENT = 3;

/** Resolve one CSV row against the candidates its card_number pulled back. */
export function resolveCard(
  cands: CandidateDef[],
  collectrName: string,
): { card: CandidateDef | null; status: MatchStatus } {
  const n = norm(collectrName);
  // english_name only (see INVARIANT), and never an empty key.
  const keyOf = (c: CandidateDef) => norm(c.english_name ?? "");

  if (n) {
    const exact = cands.filter((c) => {
      const k = keyOf(c);
      return k.length > 0 && k === n;
    });
    if (exact.length === 1) return { card: exact[0], status: "confirmed" };
    if (exact.length > 1) return { card: null, status: "none" }; // two defs, one name: cannot choose

    // Containment only SUGGESTS. It is the tier that would attach "Mew" to a
    // row named "Shining Mew", so it never auto-includes.
    const partial = cands.filter((c) => {
      const k = keyOf(c);
      return k.length >= MIN_CONTAINMENT && n.length >= MIN_CONTAINMENT && (k.includes(n) || n.includes(k));
    });
    if (partial.length === 1) return { card: partial[0], status: "review" };
    if (partial.length > 1) return { card: null, status: "none" };
  }

  // Nothing agreed on the name (no english_name to compare, or no overlap). If
  // the number happens to pin exactly one card we surface it as a suggestion,
  // but the curator confirms: a number alone is not identity without a set_code
  // to pair it with.
  if (cands.length === 1) return { card: cands[0], status: "review" };
  return { card: null, status: "none" };
}

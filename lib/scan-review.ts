// Pure logic for the scanner batch review screen (backend #1016).
//
// Everything here is deliberately free of React and Supabase so the parts that
// can be silently wrong - which band a capture lands in, and whether a proposal
// is still available after somebody else's decision took the last copy - are
// unit-testable. See lib/scan-review.test.ts.
//
// The surrounding design is docs/scanner_review_screen.md in the backend repo.

export type ParkReason =
  | "no_candidates"
  | "below_min_score"
  | "ambiguous"
  | "inventory_exhausted";

export type Decision = "confirmed" | "corrected";

// Bands run safe -> doubtful, the same high-to-low walk the image-curation
// console uses, so attention lands on the captures that need eyes. `decided`
// leads rather than hides: a confident-but-wrong assignment is the expensive
// failure, and it can only be corrected if it is still on screen.
export type ScanBand = "decided" | "high" | "medium" | "low" | "parked";

export const SCAN_BANDS: readonly ScanBand[] = [
  "decided",
  "high",
  "medium",
  "low",
  "parked",
] as const;

export interface Candidate {
  cardUid: string;
  score: number;
}

export interface ScanCapture {
  captureId: string;
  ordinal: number;
  frontObjectKey: string | null;
  backObjectKey: string | null;
  mimeType: string | null;
  candidates: Candidate[];
  proposedCardUid: string | null;
  proposedScore: number | null;
  topMargin: number | null;
  parkReason: ParkReason | null;
  parkDetail: string | null;
  decision: Decision | null;
  decidedCardUid: string | null;
  decidedConditionId: number | null;
}

const PARK_REASONS: readonly string[] = [
  "no_candidates",
  "below_min_score",
  "ambiguous",
  "inventory_exhausted",
];

export function asParkReason(raw: unknown): ParkReason | null {
  return typeof raw === "string" && PARK_REASONS.includes(raw)
    ? (raw as ParkReason)
    : null;
}

// The staged `candidates` column is jsonb the backend wrote, so it is trusted
// but not typed. A malformed entry is dropped rather than rendered as a card
// with no identity: a candidate you cannot pick is worse than one absent.
export function parseCandidates(raw: unknown): Candidate[] {
  if (!Array.isArray(raw)) return [];
  const out: Candidate[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { card_uid?: unknown; score?: unknown };
    const cardUid = record.card_uid;
    const score = record.score;
    if (typeof cardUid !== "string" || cardUid.length === 0) continue;
    out.push({
      cardUid,
      score: typeof score === "number" && Number.isFinite(score) ? score : 0,
    });
  }
  // Strongest first. The backend already orders these, but the screen leads
  // with candidates[0] as the shortlist head, so it re-establishes the
  // invariant rather than trusting it.
  return out.sort((a, b) => b.score - a.score);
}

// Thresholds match the image-curation console (95 / 80 / 45) so an operator
// reading both surfaces reads one scale, not two.
export function bandOf(capture: ScanCapture): ScanBand {
  if (capture.decision != null) return "decided";
  if (capture.parkReason != null || capture.proposedCardUid == null) return "parked";
  const score = capture.proposedScore;
  if (score == null) return "parked";
  const pct = score * 100;
  if (pct >= 95) return "high";
  if (pct >= 80) return "medium";
  if (pct >= 45) return "low";
  return "parked";
}

export function groupByBand(captures: ScanCapture[]): Record<ScanBand, ScanCapture[]> {
  const grouped: Record<ScanBand, ScanCapture[]> = {
    decided: [],
    high: [],
    medium: [],
    low: [],
    parked: [],
  };
  // Scan order inside every band. The operator holds the physical cards in
  // that order, so locating card 47 in a box is the real cost of a park and
  // no cleverer sort is worth paying it.
  for (const capture of [...captures].sort((a, b) => a.ordinal - b.ordinal)) {
    grouped[bandOf(capture)].push(capture);
  }
  return grouped;
}

// Band order, then scan order within a band. Keyboard navigation walks this.
export function flattenBands(grouped: Record<ScanBand, ScanCapture[]>): ScanCapture[] {
  return SCAN_BANDS.flatMap((band) => grouped[band]);
}

// A listing group is (card, condition): one eBay listing's worth. Quantity is
// consumed per group, so that pair is the unit a claim is counted against.
export function claimKey(cardUid: string, conditionId: number): string {
  return `${cardUid}:${conditionId}`;
}

// How many copies of each listing group this batch has already spoken for.
// Re-derived from the captures after every decision rather than decremented,
// so an undo cannot leave the count drifting.
export function countClaims(captures: ScanCapture[]): Map<string, number> {
  const claims = new Map<string, number>();
  for (const capture of captures) {
    if (capture.decision == null) continue;
    if (capture.decidedCardUid == null || capture.decidedConditionId == null) continue;
    const key = claimKey(capture.decidedCardUid, capture.decidedConditionId);
    claims.set(key, (claims.get(key) ?? 0) + 1);
  }
  return claims;
}

// Copies still available in a listing group, or null when we have not been
// told the inventory quantity for it yet.
//
// `availability` is populated from decide_scanner_batch_capture's reported
// available_quantity, which is the quantity BEFORE this batch's claims are
// applied, so the claims are subtracted here.
export function remainingFor(
  cardUid: string,
  conditionId: number,
  availability: Map<string, number>,
  claims: Map<string, number>,
): number | null {
  const key = claimKey(cardUid, conditionId);
  const available = availability.get(key);
  if (available == null) return null;
  return available - (claims.get(key) ?? 0);
}

// Whether confirming this capture's proposal would take a copy the batch has
// already spent. An undecided capture whose card is exhausted is a stale
// proposal, and the screen must say so rather than invite a decision that is
// no longer available.
export function isProposalContested(
  capture: ScanCapture,
  conditionId: number,
  availability: Map<string, number>,
  claims: Map<string, number>,
): boolean {
  if (capture.decision != null) return false;
  if (capture.proposedCardUid == null) return false;
  const remaining = remainingFor(capture.proposedCardUid, conditionId, availability, claims);
  return remaining != null && remaining <= 0;
}

export interface BatchProgress {
  total: number;
  decided: number;
  confirmed: number;
  corrected: number;
  parked: number;
  remaining: number;
  /** Share of decisions that overrode the proposal, or null before any decision.
   *  A rising correction rate is the earliest signal recognition has drifted. */
  correctionRate: number | null;
}

export function batchProgress(captures: ScanCapture[]): BatchProgress {
  let confirmed = 0;
  let corrected = 0;
  let parked = 0;
  for (const capture of captures) {
    if (capture.decision === "confirmed") confirmed += 1;
    else if (capture.decision === "corrected") corrected += 1;
    else if (bandOf(capture) === "parked") parked += 1;
  }
  const decided = confirmed + corrected;
  return {
    total: captures.length,
    decided,
    confirmed,
    corrected,
    parked,
    remaining: captures.length - decided,
    correctionRate: decided === 0 ? null : corrected / decided,
  };
}

// A batch is a box, not the whole holding, so leftover inventory is normal and
// is never reported as a defect. The audit only runs one way: every capture
// must end with a card.
export function isBatchComplete(captures: ScanCapture[]): boolean {
  return captures.length > 0 && captures.every((capture) => capture.decision != null);
}

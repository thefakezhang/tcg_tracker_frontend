export interface CardEvidenceState {
  enrichmentStatus?: "loading" | "ready" | "unavailable";
}

export function isCardEvidenceUnresolved(row: CardEvidenceState): boolean {
  return row.enrichmentStatus === "loading"
    || row.enrichmentStatus === "unavailable";
}

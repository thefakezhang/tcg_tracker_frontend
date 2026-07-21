export const MARKET_EVENT_KINDS = [
  "set_release",
  "reprint_announce",
  "reprint_release",
  "ban_errata",
  "anniversary",
  "tournament",
  "media",
  "collab",
  "grading_change",
  "other",
] as const;

export const MARKET_EVENT_SCOPES = ["global", "era", "set", "character", "card_list"] as const;

export type MarketEventKind = typeof MARKET_EVENT_KINDS[number];
export type MarketEventScope = typeof MARKET_EVENT_SCOPES[number];
export type EventConfidence = "confirmed" | "rumored";

export interface MarketEventRow {
  event_id: number;
  starts_on: string;
  ends_on: string | null;
  kind: MarketEventKind;
  scope: MarketEventScope;
  scope_ref: string | null;
  card_ids: number[] | null;
  title: string;
  note: string;
  source_url: string | null;
  confidence: EventConfidence;
  source_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChangepointAnnotation {
  cohort: string;
  detected_on: string;
  direction: "up" | "down";
  magnitude: number;
  model_version: string;
  event_id: number | null;
  event_title: string | null;
  event_kind: MarketEventKind | null;
  event_starts_on: string | null;
  event_ends_on: string | null;
  event_confidence: EventConfidence | null;
  unexplained: boolean;
}

export interface InventoryExposure {
  game: string;
  item_type: "single" | "sealed";
  leg: string;
  card_id: number | null;
  product_id: number | null;
  condition_id: number | null;
  psa_grade: number | null;
  sealed_condition: string | null;
  variant_edition: string | null;
  event_id: number;
  event_title: string;
  event_kind: "reprint_announce" | "reprint_release";
  starts_on: string;
  ends_on: string | null;
  confidence: EventConfidence;
  source_url: string | null;
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function eventsForDay(events: MarketEventRow[], day: string): MarketEventRow[] {
  return events.filter((event) => event.starts_on <= day && (event.ends_on ?? event.starts_on) >= day);
}

export function holdingExposureKey(value: {
  game: string;
  leg: string;
  card_id: number | null;
  product_id: number | null;
  condition_id: number | null;
  psa_grade: number | null;
  sealed_condition: string | null;
  variant_edition: string | null;
}): string {
  return [
    value.game,
    value.card_id ?? value.product_id,
    value.condition_id ?? value.sealed_condition,
    value.psa_grade ?? value.variant_edition,
    value.leg,
  ].join("-");
}

export function eventTone(kind: MarketEventKind): string {
  if (kind === "reprint_announce" || kind === "reprint_release") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (kind === "ban_errata") return "border-red-500/40 bg-red-500/10 text-red-200";
  if (kind === "set_release") return "border-sky-500/40 bg-sky-500/10 text-sky-200";
  return "border-violet-500/40 bg-violet-500/10 text-violet-200";
}

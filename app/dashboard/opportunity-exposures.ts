import { createClient } from "@/lib/supabase/client";
import { decisionSnapshot } from "./DecisionActions";
import type { CardRowData, LocationInfo, MarketListing } from "./use-card-data";

export interface OpportunityExposurePayload {
  candidate_key: string;
  card_id: number;
  psa_grade: number;
  surface: "browser_list" | "browser_grid" | "card_detail";
  source_location_id?: number | null;
  source_name?: string | null;
  entry_price: number;
  entry_currency: string;
  candidate_snapshot: object;
}

const INDICATOR_SOURCES = new Set(["cardladder", "collectr", "pricecharting"]);

export function isPurchasableOpportunitySource(sourceName: string | null | undefined): boolean {
  return !INDICATOR_SOURCES.has((sourceName ?? "").trim().toLowerCase());
}

function stableCandidateHash(parts: Array<string | number | null | undefined>): string {
  const value = JSON.stringify(parts);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function browserOpportunityPayloads(
  rows: CardRowData[],
  surface: "browser_list" | "browser_grid",
  observedDay = new Date().toISOString().slice(0, 10),
): OpportunityExposurePayload[] {
  return rows.flatMap((row) => {
    const listing = row.prices.lowestSell;
    if (!listing || listing.price <= 0 || !isPurchasableOpportunitySource(listing.locationName)) return [];
    const grade = row.psaGrade ?? 0;
    return [{
      candidate_key: `browser:${row.card.card_id}:${grade}:${observedDay}:${stableCandidateHash([
        listing.locationName, listing.currencyCode, listing.price,
      ])}`,
      card_id: Number(row.card.card_id),
      psa_grade: grade,
      surface,
      source_name: listing.locationName,
      entry_price: listing.price,
      entry_currency: listing.currencyCode,
      candidate_snapshot: decisionSnapshot(row, row.signal),
    }];
  }).slice(0, 200);
}

export function detailOpportunityPayloads(
  card: CardRowData,
  listings: MarketListing[],
  locations: Map<number, LocationInfo>,
): OpportunityExposurePayload[] {
  return listings.flatMap((listing) => {
    const sourceName = locations.get(listing.location_id)?.name ?? null;
    if (listing.price_type !== "Sell" || listing.price <= 0 || !isPurchasableOpportunitySource(sourceName)) return [];
    const grade = listing.psa_grade ?? 0;
    const exactSignal = grade === (card.psaGrade ?? 0) ? card.signal : null;
    return [{
      candidate_key: `detail:${listing.card_id}:${grade}:${listing.location_id}:${stableCandidateHash([
        listing.condition, listing.currency, listing.price, listing.listing_url, listing.last_updated,
      ])}`,
      card_id: listing.card_id,
      psa_grade: grade,
      surface: "card_detail" as const,
      source_location_id: listing.location_id,
      source_name: sourceName,
      entry_price: listing.price,
      entry_currency: listing.currency,
      candidate_snapshot: {
        ...decisionSnapshot(card, exactSignal),
        listing: {
          price_type: listing.price_type,
          price: listing.price,
          currency: listing.currency,
          condition: listing.condition,
          location_id: listing.location_id,
          listing_url: listing.listing_url,
          last_updated: listing.last_updated,
        },
      },
    }];
  }).slice(0, 200);
}

export async function recordOpportunityExposures(exposures: OpportunityExposurePayload[]): Promise<void> {
  if (exposures.length === 0) return;
  const { error } = await createClient().rpc("record_deal_opportunity_exposures", {
    p_exposures: exposures,
  });
  if (error) throw error;
}

import type { Game } from "./GameContext";

export type SourceSide = "buy" | "sell";

export const SOURCE_OPTIONS_VIEW = "card_browser_source_options_v";

const BASE_SUMMARY_TABLES: Record<Game, string> = {
  pokemon: "pokemon_price_summaries",
  mtg: "mtg_price_summaries",
  pokemon_sealed: "pokemon_sealed_summaries_v",
};

const SOURCE_SUMMARY_VIEWS: Partial<Record<Game, string>> = {
  pokemon: "pokemon_price_summaries_by_source_v",
  mtg: "mtg_price_summaries_by_source_v",
};

export function summaryTableForSource(game: Game, source: string): string {
  if (!source) return BASE_SUMMARY_TABLES[game];
  return SOURCE_SUMMARY_VIEWS[game] ?? BASE_SUMMARY_TABLES[game];
}

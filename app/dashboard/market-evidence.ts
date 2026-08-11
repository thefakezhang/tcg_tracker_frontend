export const MARKET_DISCREPANCY_THRESHOLD = 0.2;

export type MarketEvidenceStatus =
  | "unavailable"
  | "collectr_only"
  | "aligned"
  | "discrepant";

export interface MarketEvidence {
  collectrUsd: number | null;
  tcgplayerUsd: number | null;
  differencePct: number | null;
  status: MarketEvidenceStatus;
}

export interface MarketPriceRow {
  card_id: number | string;
  price?: number | string | null;
  market_usd?: number | string | null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function compareMarketEstimates(
  collectrValue: number | string | null | undefined,
  tcgplayerValue: number | string | null | undefined,
  threshold = MARKET_DISCREPANCY_THRESHOLD,
): MarketEvidence {
  const collectrUsd = positiveNumber(collectrValue);
  const tcgplayerUsd = positiveNumber(tcgplayerValue);

  if (collectrUsd == null) {
    return {
      collectrUsd: null,
      tcgplayerUsd,
      differencePct: null,
      status: "unavailable",
    };
  }

  if (tcgplayerUsd == null) {
    return {
      collectrUsd,
      tcgplayerUsd: null,
      differencePct: null,
      status: "collectr_only",
    };
  }

  const differencePct = (collectrUsd - tcgplayerUsd) / tcgplayerUsd;
  return {
    collectrUsd,
    tcgplayerUsd,
    differencePct,
    status: Math.abs(differencePct) >= threshold ? "discrepant" : "aligned",
  };
}

function lowestPriceByCard(
  rows: MarketPriceRow[],
  value: (row: MarketPriceRow) => unknown,
): Map<number, number> {
  const prices = new Map<number, number>();
  for (const row of rows) {
    const cardId = Number(row.card_id);
    const price = positiveNumber(value(row));
    if (!Number.isFinite(cardId) || price == null) continue;
    const current = prices.get(cardId);
    if (current == null || price < current) prices.set(cardId, price);
  }
  return prices;
}

export function buildTcgMarketMap(rows: MarketPriceRow[]): Map<number, number> {
  return lowestPriceByCard(rows, (row) => row.market_usd);
}

/**
 * Build the page-level maps only after both upstream queries have succeeded.
 * Choosing the lowest positive duplicate makes the result deterministic and
 * conservative if a source unexpectedly exposes more than one raw row.
 */
export function buildMarketEvidenceMaps(
  cardIds: number[],
  tcgplayerRows: MarketPriceRow[],
  collectrRows: MarketPriceRow[],
): {
  tcgMarket: Map<number, number>;
  evidence: Map<number, MarketEvidence>;
} {
  const tcgMarket = buildTcgMarketMap(tcgplayerRows);
  const collectrMarket = lowestPriceByCard(collectrRows, (row) => row.price);
  const evidence = new Map<number, MarketEvidence>();

  for (const cardId of new Set(cardIds)) {
    const comparison = compareMarketEstimates(
      collectrMarket.get(cardId),
      tcgMarket.get(cardId),
    );
    if (comparison.status !== "unavailable") evidence.set(cardId, comparison);
  }

  return { tcgMarket, evidence };
}

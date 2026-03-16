import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const GAMES = ["pokemon", "mtg"] as const;

serve(async () => {
  const pool = new Pool(Deno.env.get("SUPABASE_DB_URL")!, 1, true);

  try {
    const conn = await pool.connect();

    try {
      const results: Record<string, number> = {};

      for (const game of GAMES) {
        const listingsTable = `${game}_market_listings`;
        const summariesTable = `${game}_price_summaries`;

        // Get all distinct tiers
        const tierResult = await conn.queryObject<{ tier: number }>(
          "SELECT DISTINCT tier FROM conditions ORDER BY tier"
        );
        const tiers = tierResult.rows.map((r) => r.tier);

        // Truncate the summaries table before repopulating
        await conn.queryObject(`TRUNCATE ${summariesTable}`);

        let totalRows = 0;

        // For each tier, compute non-PSA summaries
        for (const tier of tiers) {
          const count = await computeAndInsert(
            conn,
            listingsTable,
            summariesTable,
            "non-psa",
            [tier],
            tier
          );
          totalRows += count;
        }

        // Compute PSA summaries (no tier filter, tier = -1)
        const psaCount = await computeAndInsert(
          conn,
          listingsTable,
          summariesTable,
          "psa",
          null,
          -1
        );
        totalRows += psaCount;

        results[game] = totalRows;
      }

      return new Response(
        JSON.stringify({ success: true, rows: results }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("aggregate-prices error:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  } finally {
    await pool.end();
  }
});

async function computeAndInsert(
  // deno-lint-ignore no-explicit-any
  conn: any,
  listingsTable: string,
  summariesTable: string,
  psaMode: "non-psa" | "psa",
  tiers: number[] | null,
  outputTier: number
): Promise<number> {
  const query = `
    WITH filtered_listings AS (
      SELECT
        ml.card_id,
        ml.price_type,
        ml.price,
        ml.currency,
        c.symbol AS currency_symbol,
        ml.psa_grade,
        ml.condition,
        ml.location_id,
        l.name AS location_name,
        l.market_region,
        ml.price * COALESCE(er.rate, 1) AS normalized_price
      FROM ${listingsTable} ml
      JOIN currencies c ON c.code = ml.currency
      JOIN locations l ON l.location_id = ml.location_id
      LEFT JOIN exchange_rates er ON er.from_currency = ml.currency AND er.to_currency = 'USD'
      WHERE
        CASE
          WHEN '${psaMode}' = 'non-psa' THEN ml.psa_grade = 0
          ELSE ml.psa_grade > 0
        END
        AND CASE
          WHEN '${psaMode}' = 'non-psa' AND $1::int[] IS NOT NULL THEN
            ml.condition IS NULL OR EXISTS (
              SELECT 1 FROM conditions cond
              WHERE cond.condition_id = ml.condition
                AND cond.tier = ANY($1::int[])
            )
          ELSE TRUE
        END
    ),
    buys AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY card_id, CASE WHEN '${psaMode}' = 'non-psa' THEN 0 ELSE psa_grade END
          ORDER BY normalized_price DESC
        ) AS buy_rank
      FROM filtered_listings
      WHERE price_type = 'Buy'
    ),
    sells AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY card_id, CASE WHEN '${psaMode}' = 'non-psa' THEN 0 ELSE psa_grade END
          ORDER BY normalized_price ASC
        ) AS sell_rank
      FROM filtered_listings
      WHERE price_type = 'Sell'
    ),
    cross_region_pairs AS (
      SELECT DISTINCT ON (
        b.card_id,
        CASE WHEN '${psaMode}' = 'non-psa' THEN 0 ELSE b.psa_grade END
      )
        b.card_id,
        CASE WHEN '${psaMode}' = 'non-psa' THEN 0 ELSE b.psa_grade END AS group_grade,
        b.price AS buy_price,
        b.currency AS buy_currency,
        b.currency_symbol AS buy_symbol,
        b.location_name AS buy_location,
        b.market_region AS buy_region,
        b.normalized_price AS buy_normalized,
        s.price AS sell_price,
        s.currency AS sell_currency,
        s.currency_symbol AS sell_symbol,
        s.location_name AS sell_location,
        s.market_region AS sell_region,
        s.normalized_price AS sell_normalized
      FROM buys b
      JOIN sells s ON s.card_id = b.card_id
        AND (CASE WHEN '${psaMode}' = 'non-psa' THEN 0 ELSE s.psa_grade END) =
            (CASE WHEN '${psaMode}' = 'non-psa' THEN 0 ELSE b.psa_grade END)
      WHERE b.market_region IS DISTINCT FROM s.market_region
        AND s.normalized_price > 0
      ORDER BY
        b.card_id,
        CASE WHEN '${psaMode}' = 'non-psa' THEN 0 ELSE b.psa_grade END,
        (b.normalized_price - s.normalized_price) / s.normalized_price DESC
    ),
    best_buys AS (
      SELECT * FROM buys WHERE buy_rank = 1
    ),
    best_sells AS (
      SELECT * FROM sells WHERE sell_rank = 1
    ),
    all_groups AS (
      SELECT DISTINCT
        card_id,
        CASE WHEN '${psaMode}' = 'non-psa' THEN 0 ELSE psa_grade END AS group_grade
      FROM filtered_listings
    ),
    final AS (
      SELECT
        g.card_id,
        g.group_grade AS psa_grade,
        COALESCE(cr.buy_price, bb.price) AS best_buy_price,
        COALESCE(cr.buy_currency, bb.currency) AS best_buy_currency,
        COALESCE(cr.buy_symbol, bb.currency_symbol) AS best_buy_symbol,
        COALESCE(cr.buy_location, bb.location_name) AS best_buy_location,
        COALESCE(cr.buy_region, bb.market_region) AS best_buy_region,
        COALESCE(cr.buy_normalized, bb.normalized_price) AS best_buy_normalized,
        COALESCE(cr.sell_price, bs.price) AS best_sell_price,
        COALESCE(cr.sell_currency, bs.currency) AS best_sell_currency,
        COALESCE(cr.sell_symbol, bs.currency_symbol) AS best_sell_symbol,
        COALESCE(cr.sell_location, bs.location_name) AS best_sell_location,
        COALESCE(cr.sell_region, bs.market_region) AS best_sell_region,
        COALESCE(cr.sell_normalized, bs.normalized_price) AS best_sell_normalized
      FROM all_groups g
      LEFT JOIN cross_region_pairs cr ON cr.card_id = g.card_id AND cr.group_grade = g.group_grade
      LEFT JOIN best_buys bb ON bb.card_id = g.card_id
        AND (CASE WHEN '${psaMode}' = 'non-psa' THEN 0 ELSE bb.psa_grade END) = g.group_grade
      LEFT JOIN best_sells bs ON bs.card_id = g.card_id
        AND (CASE WHEN '${psaMode}' = 'non-psa' THEN 0 ELSE bs.psa_grade END) = g.group_grade
    )
    INSERT INTO ${summariesTable} (
      card_id, tier, psa_grade,
      best_buy_price, best_buy_currency, best_buy_symbol, best_buy_location, best_buy_region, best_buy_normalized,
      best_sell_price, best_sell_currency, best_sell_symbol, best_sell_location, best_sell_region, best_sell_normalized,
      roi, updated_at
    )
    SELECT
      f.card_id,
      ${outputTier},
      f.psa_grade,
      f.best_buy_price,
      f.best_buy_currency,
      f.best_buy_symbol,
      f.best_buy_location,
      f.best_buy_region,
      f.best_buy_normalized,
      f.best_sell_price,
      f.best_sell_currency,
      f.best_sell_symbol,
      f.best_sell_location,
      f.best_sell_region,
      f.best_sell_normalized,
      CASE
        WHEN f.best_buy_normalized IS NOT NULL
          AND f.best_sell_normalized IS NOT NULL
          AND f.best_sell_normalized > 0
          AND COALESCE(f.best_buy_region, '') IS DISTINCT FROM COALESCE(f.best_sell_region, '')
        THEN (f.best_buy_normalized - f.best_sell_normalized) / f.best_sell_normalized * 100
        ELSE NULL
      END,
      now()
    FROM final f
    ON CONFLICT (card_id, tier, psa_grade) DO UPDATE SET
      best_buy_price = EXCLUDED.best_buy_price,
      best_buy_currency = EXCLUDED.best_buy_currency,
      best_buy_symbol = EXCLUDED.best_buy_symbol,
      best_buy_location = EXCLUDED.best_buy_location,
      best_buy_region = EXCLUDED.best_buy_region,
      best_buy_normalized = EXCLUDED.best_buy_normalized,
      best_sell_price = EXCLUDED.best_sell_price,
      best_sell_currency = EXCLUDED.best_sell_currency,
      best_sell_symbol = EXCLUDED.best_sell_symbol,
      best_sell_location = EXCLUDED.best_sell_location,
      best_sell_region = EXCLUDED.best_sell_region,
      best_sell_normalized = EXCLUDED.best_sell_normalized,
      roi = EXCLUDED.roi,
      updated_at = EXCLUDED.updated_at;
  `;

  const result = await conn.queryObject(query, [tiers]);
  return result.rowCount ?? 0;
}

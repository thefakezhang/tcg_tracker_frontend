import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const GAMES = ["pokemon", "mtg"] as const;

// Every summary row carries exactly ONE lane: an entry (the cheapest live ask
// in one region) and an exit (the best realizable price in the OTHER region),
// with the ROI of that trade. Both directions are scored for every card and
// the better ROI is kept; the row's best_sell_region -> best_buy_region says
// which way it runs (JP->NA for the import trade, NA->JP for the export trade
// the operator runs on old-back cards). Only one direction is ever shown
// because an arbitrage that exists one way is a wash the other way, so a
// second lane per card could only display a non-opportunity.
//
// The exit on each side is ranked by what the number IS
// (market_listings.price_kind, derived per source by the backend's
// price_kind_for_source()): a completed sale beats a standing offer beats a
// third-party estimate; an unclassified source (NULL) ranks last so a new feed
// is visible rather than silently winning. Within one kind the highest price
// wins. Before 2026-08-27 estimates were excluded outright and the exit was
// simply the highest Buy row; for a card whose only US exit evidence was an
// estimate that left no US exit at all, so the only pair left was the export
// trade scored against a Japanese buylist bid - 201/SV-P read -86.8% while
// importing it worked. See docs/realized_sale_comps.md in the backend repo.
const EXIT_KIND_RANK =
  "CASE price_kind WHEN 'sold' THEN 0 WHEN 'bid' THEN 1 WHEN 'valuation' THEN 2 ELSE 3 END";

// Indicator sources: price guides and sold-comp trackers, not shops the
// operator can transact with. They no longer need excluding from the summary
// itself - an estimate can only ever be an EXIT (they write no asks the lane
// would use as an entry), it ranks below every transacted price, and
// best_buy_kind labels it. The per-source availability snapshot still leaves
// them out: its Buylist / For-sale toggle answers "which shops carry this",
// and an estimate is not a shop. Widening that filter to price kinds is the
// next increment. SQL fragment.
const INDICATOR_LOCATIONS = "'collectr', 'cardladder', 'pricecharting'";

serve(async () => {
  const pool = new Pool(Deno.env.get("SUPABASE_DB_URL")!, 1, true);

  try {
    const conn = await pool.connect();

    try {
      const results: Record<string, number> = {};

      for (const game of GAMES) {
        const listingsTable = `${game}_market_listings`;
        const summariesTable = `${game}_price_summaries`;
        const bySourceTable = `${game}_summary_by_source`;

        // Get all distinct tiers
        const tierResult = await conn.queryObject<{ tier: number }>(
          "SELECT DISTINCT tier FROM conditions ORDER BY tier"
        );
        const tiers = tierResult.rows.map((r) => r.tier);

        // Truncate the summaries + by_source tables before repopulating. Both
        // are derived data - a full rebuild is cheaper than a diff on a table
        // this size and guarantees that a source removed from market_listings
        // stops appearing in the summaries after this run.
        await conn.queryObject(`TRUNCATE ${summariesTable}`);
        await conn.queryObject(`TRUNCATE ${bySourceTable}`);

        let totalRows = 0;

        // For each tier, compute non-PSA summaries + per-source snapshot
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
          await insertBySourceCards(
            conn, listingsTable, bySourceTable, "non-psa", [tier], tier,
          );
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
        await insertBySourceCards(
          conn, listingsTable, bySourceTable, "psa", null, -1,
        );

        results[game] = totalRows;
      }

      // Sealed Pokémon products: one summary row per
      // (product_id, sealed_condition, variant_edition). Distinct from cards
      // (no PSA grade, no condition tier), so it uses its own compute path.
      await conn.queryObject(`TRUNCATE pokemon_sealed_summary_by_source`);
      results["pokemon_sealed"] = await computeAndInsertSealed(
        conn,
        "pokemon_sealed_market_listings",
        "pokemon_sealed_price_summaries"
      );
      await insertBySourceSealed(
        conn,
        "pokemon_sealed_market_listings",
        "pokemon_sealed_summary_by_source",
      );

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

// computeAndInsert writes one summary row per (card, grade group) that has any
// listing in this slice:
//   best_sell_* - the ENTRY: the cheapest live ask in the lane's entry region
//   best_buy_*  - the EXIT:  the best realizable price in the other region,
//                 ranked by EXIT_KIND_RANK and then by price
//   roi         - (exit - entry) / entry for the better of the two directions
//
// A card with no cross-region lane at all still gets a row, because the
// browser lists summary rows: it shows the best entry and the best exit from
// anywhere (so the operator still sees what the card costs and fetches) with
// roi NULL, exactly as it did before.
//
// The column names read backwards because price_type is named from the SHOP's
// point of view: a shop's "Buy" price is what it pays you, i.e. your exit.
// best_buy_kind / best_sell_kind record what each side actually is so the UI
// can label an estimate as one.
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
        CASE WHEN '${psaMode}' = 'non-psa' THEN 0 ELSE ml.psa_grade END AS group_grade,
        ml.price_type,
        ml.price_kind,
        ${EXIT_KIND_RANK} AS kind_rank,
        ml.price,
        ml.currency,
        c.symbol AS currency_symbol,
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
    -- Best exit PER REGION: best kind first, then the highest price.
    exits AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY card_id, group_grade, market_region
          ORDER BY kind_rank, normalized_price DESC
        ) AS rn
      FROM filtered_listings
      WHERE price_type = 'Buy' AND market_region IS NOT NULL
    ),
    -- Best entry PER REGION: the cheapest live ask.
    entries AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY card_id, group_grade, market_region
          ORDER BY normalized_price ASC
        ) AS rn
      FROM filtered_listings
      WHERE price_type = 'Sell' AND market_region IS NOT NULL
        AND normalized_price > 0
        -- Only a live ask can be an entry. Indicator sources write their one
        -- estimate to BOTH sides (collectr, pricecharting) and cardladder
        -- writes its sold median to both, so without this a "Sell" row that
        -- nobody can buy at would become the cheapest way in. An unclassified
        -- source (NULL kind) on the Sell side is a shop listing until told
        -- otherwise.
        AND COALESCE(price_kind::text, 'ask') = 'ask'
    ),
    -- Every cross-region lane (entry region -> a different exit region),
    -- keeping the best ROI per card. Ties go to the better exit kind, then
    -- to the import direction.
    lanes AS (
      SELECT DISTINCT ON (e.card_id, e.group_grade)
        e.card_id,
        e.group_grade,
        x.price AS buy_price,
        x.currency AS buy_currency,
        x.currency_symbol AS buy_symbol,
        x.location_name AS buy_location,
        x.market_region AS buy_region,
        x.normalized_price AS buy_normalized,
        x.price_kind AS buy_kind,
        e.price AS sell_price,
        e.currency AS sell_currency,
        e.currency_symbol AS sell_symbol,
        e.location_name AS sell_location,
        e.market_region AS sell_region,
        e.normalized_price AS sell_normalized,
        e.price_kind AS sell_kind,
        (x.normalized_price - e.normalized_price) / e.normalized_price * 100 AS roi
      FROM entries e
      JOIN exits x
        ON x.card_id = e.card_id
        AND x.group_grade = e.group_grade
        AND x.market_region <> e.market_region
        AND x.rn = 1
      WHERE e.rn = 1
      ORDER BY
        e.card_id,
        e.group_grade,
        (x.normalized_price - e.normalized_price) / e.normalized_price DESC,
        x.kind_rank ASC,
        (e.market_region = 'JP') DESC
    ),
    -- Fallbacks for a card with no cross-region lane: best exit and best
    -- entry from anywhere, shown without an ROI.
    any_exit AS (
      SELECT DISTINCT ON (card_id, group_grade) *
      FROM exits
      WHERE rn = 1
      ORDER BY card_id, group_grade, kind_rank, normalized_price DESC
    ),
    any_entry AS (
      SELECT DISTINCT ON (card_id, group_grade) *
      FROM entries
      WHERE rn = 1
      ORDER BY card_id, group_grade, normalized_price ASC
    ),
    all_groups AS (
      SELECT DISTINCT card_id, group_grade FROM filtered_listings
    )
    INSERT INTO ${summariesTable} (
      card_id, tier, psa_grade,
      best_buy_price, best_buy_currency, best_buy_symbol, best_buy_location, best_buy_region, best_buy_normalized, best_buy_kind,
      best_sell_price, best_sell_currency, best_sell_symbol, best_sell_location, best_sell_region, best_sell_normalized, best_sell_kind,
      roi, updated_at
    )
    SELECT
      g.card_id,
      ${outputTier},
      g.group_grade,
      COALESCE(ln.buy_price, ax.price),
      COALESCE(ln.buy_currency, ax.currency),
      COALESCE(ln.buy_symbol, ax.currency_symbol),
      COALESCE(ln.buy_location, ax.location_name),
      COALESCE(ln.buy_region, ax.market_region),
      COALESCE(ln.buy_normalized, ax.normalized_price),
      COALESCE(ln.buy_kind, ax.price_kind),
      COALESCE(ln.sell_price, ae.price),
      COALESCE(ln.sell_currency, ae.currency),
      COALESCE(ln.sell_symbol, ae.currency_symbol),
      COALESCE(ln.sell_location, ae.location_name),
      COALESCE(ln.sell_region, ae.market_region),
      COALESCE(ln.sell_normalized, ae.normalized_price),
      COALESCE(ln.sell_kind, ae.price_kind),
      ln.roi,
      now()
    FROM all_groups g
    LEFT JOIN lanes ln
      ON ln.card_id = g.card_id AND ln.group_grade = g.group_grade
    LEFT JOIN any_exit ax
      ON ax.card_id = g.card_id AND ax.group_grade = g.group_grade
    LEFT JOIN any_entry ae
      ON ae.card_id = g.card_id AND ae.group_grade = g.group_grade
    ON CONFLICT (card_id, tier, psa_grade) DO UPDATE SET
      best_buy_price = EXCLUDED.best_buy_price,
      best_buy_currency = EXCLUDED.best_buy_currency,
      best_buy_symbol = EXCLUDED.best_buy_symbol,
      best_buy_location = EXCLUDED.best_buy_location,
      best_buy_region = EXCLUDED.best_buy_region,
      best_buy_normalized = EXCLUDED.best_buy_normalized,
      best_buy_kind = EXCLUDED.best_buy_kind,
      best_sell_price = EXCLUDED.best_sell_price,
      best_sell_currency = EXCLUDED.best_sell_currency,
      best_sell_symbol = EXCLUDED.best_sell_symbol,
      best_sell_location = EXCLUDED.best_sell_location,
      best_sell_region = EXCLUDED.best_sell_region,
      best_sell_normalized = EXCLUDED.best_sell_normalized,
      best_sell_kind = EXCLUDED.best_sell_kind,
      roi = EXCLUDED.roi,
      updated_at = EXCLUDED.updated_at;
  `;

  const result = await conn.queryObject(query, [tiers]);
  return result.rowCount ?? 0;
}

// computeAndInsertSealed is the same rule for sealed products. Identity is
// (product_id, sealed_condition, variant_edition); there is no PSA grade and no
// condition tier, so no slice filtering.
async function computeAndInsertSealed(
  // deno-lint-ignore no-explicit-any
  conn: any,
  listingsTable: string,
  summariesTable: string
): Promise<number> {
  await conn.queryObject(`TRUNCATE ${summariesTable}`);

  const query = `
    WITH filtered_listings AS (
      SELECT
        ml.product_id,
        ml.sealed_condition,
        ml.variant_edition,
        ml.price_type,
        ml.price_kind,
        ${EXIT_KIND_RANK} AS kind_rank,
        ml.price,
        ml.currency,
        c.symbol AS currency_symbol,
        l.name AS location_name,
        l.market_region,
        ml.price * COALESCE(er.rate, 1) AS normalized_price
      FROM ${listingsTable} ml
      JOIN currencies c ON c.code = ml.currency
      JOIN locations l ON l.location_id = ml.location_id
      LEFT JOIN exchange_rates er ON er.from_currency = ml.currency AND er.to_currency = 'USD'
    ),
    exits AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY product_id, sealed_condition, variant_edition, market_region
          ORDER BY kind_rank, normalized_price DESC
        ) AS rn
      FROM filtered_listings
      WHERE price_type = 'Buy' AND market_region IS NOT NULL
    ),
    entries AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY product_id, sealed_condition, variant_edition, market_region
          ORDER BY normalized_price ASC
        ) AS rn
      FROM filtered_listings
      WHERE price_type = 'Sell' AND market_region IS NOT NULL
        AND normalized_price > 0
        -- Only a live ask can be an entry. Indicator sources write their one
        -- estimate to BOTH sides (collectr, pricecharting) and cardladder
        -- writes its sold median to both, so without this a "Sell" row that
        -- nobody can buy at would become the cheapest way in. An unclassified
        -- source (NULL kind) on the Sell side is a shop listing until told
        -- otherwise.
        AND COALESCE(price_kind::text, 'ask') = 'ask'
    ),
    lanes AS (
      SELECT DISTINCT ON (e.product_id, e.sealed_condition, e.variant_edition)
        e.product_id,
        e.sealed_condition,
        e.variant_edition,
        x.price AS buy_price,
        x.currency AS buy_currency,
        x.currency_symbol AS buy_symbol,
        x.location_name AS buy_location,
        x.market_region AS buy_region,
        x.normalized_price AS buy_normalized,
        x.price_kind AS buy_kind,
        e.price AS sell_price,
        e.currency AS sell_currency,
        e.currency_symbol AS sell_symbol,
        e.location_name AS sell_location,
        e.market_region AS sell_region,
        e.normalized_price AS sell_normalized,
        e.price_kind AS sell_kind,
        (x.normalized_price - e.normalized_price) / e.normalized_price * 100 AS roi
      FROM entries e
      JOIN exits x
        ON x.product_id = e.product_id
        AND x.sealed_condition = e.sealed_condition
        AND x.variant_edition = e.variant_edition
        AND x.market_region <> e.market_region
        AND x.rn = 1
      WHERE e.rn = 1
      ORDER BY
        e.product_id,
        e.sealed_condition,
        e.variant_edition,
        (x.normalized_price - e.normalized_price) / e.normalized_price DESC,
        x.kind_rank ASC,
        (e.market_region = 'JP') DESC
    ),
    any_exit AS (
      SELECT DISTINCT ON (product_id, sealed_condition, variant_edition) *
      FROM exits
      WHERE rn = 1
      ORDER BY product_id, sealed_condition, variant_edition, kind_rank, normalized_price DESC
    ),
    any_entry AS (
      SELECT DISTINCT ON (product_id, sealed_condition, variant_edition) *
      FROM entries
      WHERE rn = 1
      ORDER BY product_id, sealed_condition, variant_edition, normalized_price ASC
    ),
    all_groups AS (
      SELECT DISTINCT product_id, sealed_condition, variant_edition
      FROM filtered_listings
    )
    INSERT INTO ${summariesTable} (
      product_id, sealed_condition, variant_edition,
      best_buy_price, best_buy_currency, best_buy_symbol, best_buy_location, best_buy_region, best_buy_normalized, best_buy_kind,
      best_sell_price, best_sell_currency, best_sell_symbol, best_sell_location, best_sell_region, best_sell_normalized, best_sell_kind,
      roi, updated_at
    )
    SELECT
      g.product_id,
      g.sealed_condition,
      g.variant_edition,
      COALESCE(ln.buy_price, ax.price),
      COALESCE(ln.buy_currency, ax.currency),
      COALESCE(ln.buy_symbol, ax.currency_symbol),
      COALESCE(ln.buy_location, ax.location_name),
      COALESCE(ln.buy_region, ax.market_region),
      COALESCE(ln.buy_normalized, ax.normalized_price),
      COALESCE(ln.buy_kind, ax.price_kind),
      COALESCE(ln.sell_price, ae.price),
      COALESCE(ln.sell_currency, ae.currency),
      COALESCE(ln.sell_symbol, ae.currency_symbol),
      COALESCE(ln.sell_location, ae.location_name),
      COALESCE(ln.sell_region, ae.market_region),
      COALESCE(ln.sell_normalized, ae.normalized_price),
      COALESCE(ln.sell_kind, ae.price_kind),
      ln.roi,
      now()
    FROM all_groups g
    LEFT JOIN lanes ln
      ON ln.product_id = g.product_id
      AND ln.sealed_condition = g.sealed_condition
      AND ln.variant_edition = g.variant_edition
    LEFT JOIN any_exit ax
      ON ax.product_id = g.product_id
      AND ax.sealed_condition = g.sealed_condition
      AND ax.variant_edition = g.variant_edition
    LEFT JOIN any_entry ae
      ON ae.product_id = g.product_id
      AND ae.sealed_condition = g.sealed_condition
      AND ae.variant_edition = g.variant_edition
    ON CONFLICT (product_id, sealed_condition, variant_edition) DO UPDATE SET
      best_buy_price = EXCLUDED.best_buy_price,
      best_buy_currency = EXCLUDED.best_buy_currency,
      best_buy_symbol = EXCLUDED.best_buy_symbol,
      best_buy_location = EXCLUDED.best_buy_location,
      best_buy_region = EXCLUDED.best_buy_region,
      best_buy_normalized = EXCLUDED.best_buy_normalized,
      best_buy_kind = EXCLUDED.best_buy_kind,
      best_sell_price = EXCLUDED.best_sell_price,
      best_sell_currency = EXCLUDED.best_sell_currency,
      best_sell_symbol = EXCLUDED.best_sell_symbol,
      best_sell_location = EXCLUDED.best_sell_location,
      best_sell_region = EXCLUDED.best_sell_region,
      best_sell_normalized = EXCLUDED.best_sell_normalized,
      best_sell_kind = EXCLUDED.best_sell_kind,
      roi = EXCLUDED.roi,
      updated_at = EXCLUDED.updated_at;
  `;

  const result = await conn.queryObject(query);
  return result.rowCount ?? 0;
}

// insertBySourceCards fills the per-source snapshot for a game (mtg / pokemon)
// at one (tier, psaMode) slice. One row per (card_id, tier, psa_grade, side,
// source), holding that source's best price for the group. Used by the source-
// toggle filter in the Card Browser (docs/frontend.md).
//
// "Best" per source:
//   - Buy  side: highest normalized_price (highest buylist bid)
//   - Sell side: lowest normalized_price (lowest live ask)
//
// The trick is DISTINCT ON + a signed sort key that flips direction per side:
// `CASE side WHEN 'buy' THEN -normalized_price ELSE normalized_price END ASC`
// so a single DISTINCT ON picks max for buy and min for sell without two passes.
//
// Dynamic: `source` is the location.name string, populated from whatever
// locations appear in market_listings for this slice. Adding / removing a
// source is a data change, not a migration.
async function insertBySourceCards(
  // deno-lint-ignore no-explicit-any
  conn: any,
  listingsTable: string,
  bySourceTable: string,
  psaMode: "non-psa" | "psa",
  tiers: number[] | null,
  outputTier: number,
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
        l.name AS location_name,
        l.market_region,
        ml.price * COALESCE(er.rate, 1) AS normalized_price
      FROM ${listingsTable} ml
      JOIN currencies c ON c.code = ml.currency
      JOIN locations l ON l.location_id = ml.location_id
      LEFT JOIN exchange_rates er ON er.from_currency = ml.currency AND er.to_currency = 'USD'
      WHERE
        -- The source toggle answers "which shops carry this"; an estimate is
        -- not a shop (see INDICATOR_LOCATIONS).
        l.name NOT IN (${INDICATOR_LOCATIONS})
        AND CASE
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
    labeled AS (
      SELECT
        card_id,
        CASE WHEN '${psaMode}' = 'non-psa' THEN 0 ELSE psa_grade END AS group_grade,
        CASE WHEN price_type = 'Buy' THEN 'buy' ELSE 'sell' END AS side,
        location_name AS source,
        price, currency, currency_symbol, location_name AS location,
        market_region AS region, normalized_price
      FROM filtered_listings
      WHERE price_type IN ('Buy','Sell') AND normalized_price IS NOT NULL
    ),
    best AS (
      SELECT DISTINCT ON (card_id, group_grade, side, source)
        card_id, group_grade, side, source,
        price, currency, currency_symbol, location, region, normalized_price
      FROM labeled
      ORDER BY card_id, group_grade, side, source,
        CASE side WHEN 'buy' THEN -normalized_price ELSE normalized_price END ASC
    )
    INSERT INTO ${bySourceTable}
      (card_id, tier, psa_grade, side, source, price, currency, currency_symbol,
       location, region, normalized_price, updated_at)
    SELECT
      card_id, ${outputTier}, group_grade, side, source,
      price, currency, currency_symbol, location, region, normalized_price, now()
    FROM best
    ON CONFLICT (card_id, tier, psa_grade, side, source) DO UPDATE SET
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      currency_symbol = EXCLUDED.currency_symbol,
      location = EXCLUDED.location,
      region = EXCLUDED.region,
      normalized_price = EXCLUDED.normalized_price,
      updated_at = EXCLUDED.updated_at;
  `;
  const result = await conn.queryObject(query, [tiers]);
  return result.rowCount ?? 0;
}

// insertBySourceSealed fills the per-source snapshot for sealed products. Grain
// mirrors pokemon_sealed_price_summaries: (product_id, sealed_condition,
// variant_edition, side, source). No PSA, no tier.
async function insertBySourceSealed(
  // deno-lint-ignore no-explicit-any
  conn: any,
  listingsTable: string,
  bySourceTable: string,
): Promise<number> {
  const query = `
    WITH filtered_listings AS (
      SELECT
        ml.product_id,
        ml.sealed_condition,
        ml.variant_edition,
        ml.price_type,
        ml.price,
        ml.currency,
        c.symbol AS currency_symbol,
        l.name AS location_name,
        l.market_region,
        ml.price * COALESCE(er.rate, 1) AS normalized_price
      FROM ${listingsTable} ml
      JOIN currencies c ON c.code = ml.currency
      JOIN locations l ON l.location_id = ml.location_id
      LEFT JOIN exchange_rates er ON er.from_currency = ml.currency AND er.to_currency = 'USD'
    ),
    labeled AS (
      SELECT
        product_id, sealed_condition, variant_edition,
        CASE WHEN price_type = 'Buy' THEN 'buy' ELSE 'sell' END AS side,
        location_name AS source,
        price, currency, currency_symbol, location_name AS location,
        market_region AS region, normalized_price
      FROM filtered_listings
      WHERE price_type IN ('Buy','Sell') AND normalized_price IS NOT NULL
    ),
    best AS (
      SELECT DISTINCT ON (product_id, sealed_condition, variant_edition, side, source)
        product_id, sealed_condition, variant_edition, side, source,
        price, currency, currency_symbol, location, region, normalized_price
      FROM labeled
      ORDER BY product_id, sealed_condition, variant_edition, side, source,
        CASE side WHEN 'buy' THEN -normalized_price ELSE normalized_price END ASC
    )
    INSERT INTO ${bySourceTable}
      (product_id, sealed_condition, variant_edition, side, source,
       price, currency, currency_symbol, location, region, normalized_price, updated_at)
    SELECT
      product_id, sealed_condition, variant_edition, side, source,
      price, currency, currency_symbol, location, region, normalized_price, now()
    FROM best
    ON CONFLICT (product_id, sealed_condition, variant_edition, side, source) DO UPDATE SET
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      currency_symbol = EXCLUDED.currency_symbol,
      location = EXCLUDED.location,
      region = EXCLUDED.region,
      normalized_price = EXCLUDED.normalized_price,
      updated_at = EXCLUDED.updated_at;
  `;
  const result = await conn.queryObject(query);
  return result.rowCount ?? 0;
}

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

type QueryConnection = Awaited<ReturnType<Pool["connect"]>>;

const GAMES = ["pokemon", "mtg"] as const;

// CARD LANES ARE CHOSEN IN THE DATABASE. Since backend migration 000678 the
// card summaries come from public.compute_price_lanes (backend
// docs/source_lanes.md), the one implementation of the lane choice, which the
// Card Browser also calls with the operator's entry and exit sources. The
// rules and their measured reasons moved there with it. The helpers below
// are what the SEALED pass still builds its own SQL from; moving sealed into
// the database as well is tracked separately, and until then a rule change
// must be made in both places.
//
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
// price_kind_for_source()), and - for a sold - by whether it carries EVIDENCE
// OF RECENT VOLUME. An unclassified source (NULL) ranks last so a new feed is
// visible rather than silently winning. Within one rank the highest price wins.
//
// Before 2026-08-27 estimates were excluded outright and the exit was simply
// the highest Buy row; for a card whose only US exit evidence was an estimate
// that left no US exit at all, so the only pair left was the export trade
// scored against a Japanese buylist bid - 201/SV-P read -86.8% while importing
// it worked. See docs/realized_sale_comps.md in the backend repo.
//
// WHY A SOLD MUST EARN ITS PLACE ABOVE A BID (2026-10-22). Until now every
// sold outranked every bid, so a historical sale beat a standing offer even
// when the offer was higher and the sale was old. Measured on cloud: 83.7% of
// MTG exits and 83.7% of Pokemon exits were sold-kind, and where a real USD
// bid also existed the displayed exit ran 1.69x that bid at the median and
// 54.5x at worst. The exit was claiming more than any actual buyer had
// offered.
//
// A bid needs no evidence - the quote IS the buyer, and its issuer will honour
// it. A sold is an observation, and an observation of unknown age and unknown
// volume is not an exit. docs/price_anchor_policy.md gates a sold-anchored
// exit on freshness and liquidity for exactly this reason, and rule 1 of that
// policy asks for a sold figure WITH a comp spread.
//
// THE SPREAD IS THE GATE, and it is available per row with no join. A sold row
// carries price_p25/price_p75 only when it was built from a measured window:
// Mana Pool writes a quantity-weighted median over 30 days requiring at least
// two sales, and all 119,339 of its sold rows carry the spread. TCGplayer's
// 278,444 sold rows carry none at all - its sold figure is a market statistic
// with no volume attached - so they now rank BELOW a bid rather than above it.
//
// Nothing is excluded. A spreadless sold still wins when there is no bid,
// which is rule 3 of the policy: no trusted anchor is not the same as no
// evidence. Measured effect on a 3,000-row sample of sold exits: 896 are
// volume-backed and keep their exit, 1,236 flip to a committed bid, and the
// rest keep an ungated sold because nothing better exists. Of the flips the
// exit falls 1.54x at the median - but 19% go UP, because a buylist was
// already paying more than the historical sale and the old ranking hid it.
//
// Takes the lane-adjusted spread expressions, not ml.price_p25 directly: a
// lane that suppresses a spread (see laneSpread) has no evidence in that lane,
// and must be ranked as such.
// `liquid` is the second, independent way a sold can show volume, and it is
// what keeps TCGplayer in the game. Its sold figure is a market statistic with
// no percentiles, so the spread test alone would demote all 278,444 of its
// sold rows forever - not because they lack volume, but because TCGplayer does
// not publish quartiles. The evidence it DOES publish (quantity_sold,
// transaction_count, listing depth) is precomputed per card by backend
// migration 000595 into mtg_card_liquidity.
//
// A LEFT JOIN that misses yields NULL, and `false OR NULL` is NULL, which no
// WHEN clause matches - so a card with no liquidity row falls through to the
// ungated rank. Missing evidence gates a sold exit OFF, never on.
//
// The measured test is factored out and shared with exitEvidence below, so the
// rank and the label it is recorded under CANNOT disagree. They are the same
// predicate written once; a second copy would be a bug waiting for someone to
// edit one of them.
const soldIsMeasured = (p25: string, p75: string, liquid: string) =>
  `((${p25} IS NOT NULL AND ${p75} IS NOT NULL) OR ${liquid})`;

const exitKindRank = (p25: string, p75: string, liquid: string) =>
  `CASE
     WHEN ml.price_kind = 'sold'
          AND ${soldIsMeasured(p25, p75, liquid)} THEN 0
     WHEN ml.price_kind = 'bid' THEN 1
     WHEN ml.price_kind = 'sold' THEN 2
     WHEN ml.price_kind = 'valuation' THEN 3
     ELSE 4
   END`;

// WHY the exit is the number it is, written to best_buy_evidence (backend
// 000597). The ranking decides; this records the decision, because until now
// it decided and then threw the reason away - best_buy_kind read 'sold' for
// the 88,410 exits that passed the volume test and the 22,607 that did not.
//
// sale_unmeasured is the value worth screening on. It is still the best
// available figure for that card, per rule 3 of
// docs/price_anchor_policy.md - it is simply no longer wearing the same face
// as a committed bid or a measured sale.
const exitEvidence = (p25: string, p75: string, liquid: string) =>
  `CASE
     WHEN ml.price_kind = 'bid' THEN 'bid'
     WHEN ml.price_kind = 'sold'
          AND ${soldIsMeasured(p25, p75, liquid)} THEN 'sale_measured'
     WHEN ml.price_kind = 'sold' THEN 'sale_unmeasured'
     WHEN ml.price_kind = 'valuation' THEN 'estimate'
     ELSE 'unclassified'
   END::exit_evidence_enum`;

// The per-source snapshot leaves out estimates, by price kind (#3000). A
// valuation (a price guide's figure) can only ever be an exit, it ranks below
// every transacted price, and the snapshot's readers ask what a source
// actually offered or sold: the MTG shop menu, and the Mercari lead screen,
// which screens a title against every source's evidence at its grade.
//
// It used to leave out a list of names - collectr, cardladder, pricecharting -
// written when all three were price guides. Card Ladder publishes sold comps
// with a measured spread since #2913, the evidence 130point publishes, and the
// name list was then excluding nothing else: on 2026-11-26 neither Collectr
// nor PriceCharting held a Pokemon listing and no listing was a valuation. So
// the snapshot held 130point's graded sales and not Card Ladder's, and the
// Mercari screen judged a slab without them. SQL fragment.
const SNAPSHOT_KIND_FILTER = "COALESCE(ml.price_kind::text, 'ask') <> 'valuation'";

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
          totalRows += await computeAndInsert(conn, game, summariesTable, "non-psa", tier);
          await insertBySourceCards(
            conn, listingsTable, bySourceTable, "non-psa", [tier], tier,
          );
        }

        // Compute PSA summaries (no tier filter, tier = -1)
        totalRows += await computeAndInsert(conn, game, summariesTable, "psa", null);
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

// The sealed pass still prices its own lanes from these (see the header);
// the card lanes use the same rules inside compute_price_lanes.
// netExit is what selling at an exit returns. A US exit loses the platform's
// fee, per-order fee and postage (backend migrations 000549/000550 and
// docs/net_exit_roi.md): raw copies sell on TCGplayer, graded ones on eBay.
// A Japanese exit is a shop buylist paying cash, so it stays gross. Gross ROI
// hid this: a Jirachi GX bought for $70.52 against a ~$90 market showed +28%
// and returned +1.6%.
//
// The lane joins its exit's exit_cost_profiles row (exitCostJoin) and applies
// public.exit_net_from_costs, a pure function PostgreSQL inlines. Calling
// exit_net_unit_usd per row instead costs ~18us a call, measured 2026-10-13,
// which is tens of seconds over the MTG lanes.
//
// A US copy can also go to a vendor, who pays a flat share of market with no
// fees or postage (the 'vendor' profile, 80%; backend 000553). The net is the
// better of the two channels, matching exit_net_best_unit_usd: with vendors at
// 80%, TCGplayer wins only from about $20 to $50 and above about $100.
function exitCostJoin(gradeExpr: string): string {
  return `LEFT JOIN exit_cost_profiles xf
        ON xf.platform = CASE WHEN x.market_region = 'NA'
                              THEN CASE WHEN ${gradeExpr} > 0 THEN 'ebay' ELSE 'tcgplayer' END
                         END
      LEFT JOIN exit_cost_profiles vf
        ON vf.platform = 'vendor' AND x.market_region = 'NA'`;
}
function netFrom(alias: string): string {
  return `public.exit_net_from_costs(x.normalized_price::numeric, ${alias}.fee_pct, ${alias}.fixed_fee,
                    ${alias}.postage_usd, ${alias}.tracked_postage_usd, ${alias}.tracked_from_usd,
                    ${alias}.signature_postage_usd, ${alias}.signature_from_usd)`;
}
const NET_EXIT = `CASE WHEN xf.platform IS NULL THEN x.normalized_price::numeric
             ELSE GREATEST(${netFrom("xf")}, ${netFrom("vf")})
           END`;

// computeAndInsert writes one slice of a game's card summaries: a raw
// condition tier, or graded copies at tier -1. The lane choice is the
// backend's compute_price_lanes (migration 000678), called with every source
// (NULL entry and exit sets). Its SQL is this function's former query, moved
// unchanged apart from the source filters, which are no-ops when NULL; the
// parity check that proved it is in backend docs/source_lanes.md.
async function computeAndInsert(
  conn: QueryConnection,
  game: (typeof GAMES)[number],
  summariesTable: string,
  psaMode: "non-psa" | "psa",
  tier: number | null,
): Promise<number> {
  const query = `
    INSERT INTO ${summariesTable} (
      card_id, tier, psa_grade,
      best_buy_price, best_buy_currency, best_buy_symbol, best_buy_location, best_buy_region, best_buy_normalized, best_buy_kind,
      best_buy_evidence, best_buy_last_sale_date, best_buy_qty_30d,
      best_buy_p25, best_buy_p75,
      best_sell_price, best_sell_currency, best_sell_symbol, best_sell_location, best_sell_region, best_sell_normalized, best_sell_kind,
      roi, net_roi, updated_at
    )
    SELECT
      card_id, tier, psa_grade,
      best_buy_price, best_buy_currency, best_buy_symbol, best_buy_location, best_buy_region, best_buy_normalized, best_buy_kind,
      best_buy_evidence, best_buy_last_sale_date, best_buy_qty_30d,
      best_buy_p25, best_buy_p75,
      best_sell_price, best_sell_currency, best_sell_symbol, best_sell_location, best_sell_region, best_sell_normalized, best_sell_kind,
      roi, net_roi, now()
    FROM public.compute_price_lanes($1::text, $2::boolean, $3::integer, NULL, NULL)
    ON CONFLICT (card_id, tier, psa_grade) DO UPDATE SET
      best_buy_price = EXCLUDED.best_buy_price,
      best_buy_currency = EXCLUDED.best_buy_currency,
      best_buy_symbol = EXCLUDED.best_buy_symbol,
      best_buy_location = EXCLUDED.best_buy_location,
      best_buy_region = EXCLUDED.best_buy_region,
      best_buy_normalized = EXCLUDED.best_buy_normalized,
      best_buy_kind = EXCLUDED.best_buy_kind,
      best_buy_evidence = EXCLUDED.best_buy_evidence,
      best_buy_last_sale_date = EXCLUDED.best_buy_last_sale_date,
      best_buy_qty_30d = EXCLUDED.best_buy_qty_30d,
      best_buy_p25 = EXCLUDED.best_buy_p25,
      best_buy_p75 = EXCLUDED.best_buy_p75,
      best_sell_price = EXCLUDED.best_sell_price,
      best_sell_currency = EXCLUDED.best_sell_currency,
      best_sell_symbol = EXCLUDED.best_sell_symbol,
      best_sell_location = EXCLUDED.best_sell_location,
      best_sell_region = EXCLUDED.best_sell_region,
      best_sell_normalized = EXCLUDED.best_sell_normalized,
      best_sell_kind = EXCLUDED.best_sell_kind,
      roi = EXCLUDED.roi,
      net_roi = EXCLUDED.net_roi,
      updated_at = EXCLUDED.updated_at;
  `;
  const result = await conn.queryObject(query, [game, psaMode === "psa", tier]);
  return result.rowCount ?? 0;
}

// computeAndInsertSealed is the same rule for sealed products. Identity is
// (product_id, sealed_condition, variant_edition); there is no PSA grade and no
// condition tier, so no slice filtering.
async function computeAndInsertSealed(
  conn: QueryConnection,
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
        -- NULL spread, deliberately: pokemon_sealed_market_listings carries no
        -- price_p25/price_p75 at all, so a sealed sold can never show evidence
        -- of recent volume and therefore never outranks a committed bid. When
        -- sealed gains a windowed sold median, pass its spread here.
        ${exitKindRank("NULL", "NULL", "FALSE")} AS kind_rank,
        -- Structurally sale_unmeasured for every sold: sealed listings
        -- carry no percentiles and there is no sealed liquidity source.
        -- Recording that is better than leaving it indistinguishable
        -- from a measured one.
        ${exitEvidence("NULL", "NULL", "FALSE")} AS evidence,
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
    -- The central sold price per sealed group. Same reasoning as the card
    -- lane: a sold is an observation, so its middle is what a sale realises
    -- and its maximum is the highest anyone ever paid. Sealed carries the
    -- same defect because it shares the ranking, so it gets the same fix - the
    -- policy is unified across both games and both product shapes.
    sold_central AS (
      SELECT
        product_id,
        sealed_condition,
        variant_edition,
        market_region,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY normalized_price) AS central
      FROM filtered_listings
      WHERE price_type = 'Buy'
        AND market_region IS NOT NULL
        AND price_kind::text = 'sold'
      GROUP BY 1, 2, 3, 4
    ),
    exits AS (
      SELECT f.*,
        ROW_NUMBER() OVER (
          PARTITION BY f.product_id, f.sealed_condition, f.variant_edition, f.market_region
          ORDER BY f.kind_rank,
                   CASE WHEN f.price_kind::text = 'sold'
                        THEN abs(f.normalized_price - sc.central) END ASC NULLS LAST,
                   f.normalized_price DESC
        ) AS rn
      FROM filtered_listings f
      LEFT JOIN sold_central sc
        ON sc.product_id = f.product_id
       AND sc.sealed_condition = f.sealed_condition
       AND sc.variant_edition = f.variant_edition
       AND sc.market_region = f.market_region
      WHERE f.price_type = 'Buy' AND f.market_region IS NOT NULL
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
        x.evidence AS buy_evidence,
        e.price AS sell_price,
        e.currency AS sell_currency,
        e.currency_symbol AS sell_symbol,
        e.location_name AS sell_location,
        e.market_region AS sell_region,
        e.normalized_price AS sell_normalized,
        e.price_kind AS sell_kind,
        (x.normalized_price - e.normalized_price) / e.normalized_price * 100 AS roi,
        (${NET_EXIT} - e.normalized_price) / e.normalized_price * 100 AS net_roi
      FROM entries e
      JOIN exits x
        ON x.product_id = e.product_id
        AND x.sealed_condition = e.sealed_condition
        AND x.variant_edition = e.variant_edition
        AND x.market_region <> e.market_region
        AND x.rn = 1
      ${exitCostJoin("0")}
      WHERE e.rn = 1
      ORDER BY
        e.product_id,
        e.sealed_condition,
        e.variant_edition,
        (${NET_EXIT} - e.normalized_price) / e.normalized_price DESC,
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
      best_buy_evidence,
      best_sell_price, best_sell_currency, best_sell_symbol, best_sell_location, best_sell_region, best_sell_normalized, best_sell_kind,
      roi, net_roi, updated_at
    )
    SELECT
      g.product_id,
      g.sealed_condition,
      g.variant_edition,
      -- Same lane-presence switch as the card lane above: one listing per
      -- side, never a mix of two.
      CASE WHEN ln.product_id IS NOT NULL THEN ln.buy_price      ELSE ax.price            END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.buy_currency   ELSE ax.currency         END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.buy_symbol     ELSE ax.currency_symbol  END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.buy_location   ELSE ax.location_name    END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.buy_region     ELSE ax.market_region    END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.buy_normalized ELSE ax.normalized_price END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.buy_kind       ELSE ax.price_kind       END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.buy_evidence   ELSE ax.evidence         END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.sell_price      ELSE ae.price            END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.sell_currency   ELSE ae.currency         END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.sell_symbol     ELSE ae.currency_symbol  END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.sell_location   ELSE ae.location_name    END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.sell_region     ELSE ae.market_region    END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.sell_normalized ELSE ae.normalized_price END,
      CASE WHEN ln.product_id IS NOT NULL THEN ln.sell_kind       ELSE ae.price_kind       END,
      ln.roi,
      ln.net_roi,
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
      best_buy_evidence = EXCLUDED.best_buy_evidence,
      best_sell_price = EXCLUDED.best_sell_price,
      best_sell_currency = EXCLUDED.best_sell_currency,
      best_sell_symbol = EXCLUDED.best_sell_symbol,
      best_sell_location = EXCLUDED.best_sell_location,
      best_sell_region = EXCLUDED.best_sell_region,
      best_sell_normalized = EXCLUDED.best_sell_normalized,
      best_sell_kind = EXCLUDED.best_sell_kind,
      roi = EXCLUDED.roi,
      net_roi = EXCLUDED.net_roi,
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
  conn: QueryConnection,
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
        -- Evidence a source offered or sold; an estimate is left out (see
        -- SNAPSHOT_KIND_FILTER).
        ${SNAPSHOT_KIND_FILTER}
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
  conn: QueryConnection,
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

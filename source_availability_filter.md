# Card Browser shop filters

## Goal

The Card Browser answers two questions about shops, both from the operator's side:

- **Buy at X**: which cards can I buy at shop X and sell somewhere for a profit?
- **Sell to**: which cards can I sell at these sites (and not those)?

The first motivating case was showing only cards with Expedition Gaming buylist evidence; the second, from #2890 and #2927, was "the list of cards I can BUY at Surugaya and sell to make a profit, not cards I can buy anywhere and sell at Surugaya".

## The controls

| control | game | what it does |
|---|---|---|
| Buy in: region | Pokemon singles, MTG, sealed | keeps rows whose entry (the cheapest copy, `best_sell_region`) is in that region |
| Buy at: shop | Pokemon singles | recomputes each card's lane with that shop as the only entry source |
| Sell to: sites | Pokemon singles | recomputes each card's lane with only the ticked sites as exit sources |
| Shop: Buy at X or Sell to X | MTG | keeps cards with a current offer at X on that side; prices stay the global best |

"Buy at" offers only entry sources (shops with a live ask), and "Sell to" only exit sources.
Several shops are both, Suruga-ya among them, which is why the side is part of the choice and never a separate default.
To sell to exactly one site, untick every site and tick that one.

## Architecture

**Pokemon singles recompute the lane.**
A summary row carries one lane, an entry, an exit and the ROI between them, chosen from every source, so a filter over those rows cannot answer either question: restricting the sources changes which entry and which exit win.
With "Buy at" or "Sell to" set, the page reads the backend function `pokemon_price_lanes_browser(tier, psa, entry_sources, exit_sources)`, which chooses each card's lane again from the allowed sources by the same rules as the stored summaries (backend `docs/source_lanes.md`).
`lane-sources.ts` turns the two selectors into those source sets; with neither set, the browse reads the stored summaries.
The options come from `pokemon_lane_source_options_v`, which includes cardladder, a real exit that the per-source snapshot leaves out.
"Sell to" stores exclusions rather than inclusions, so a source that starts publishing later is included by default.

**MTG is a presence gate.**
The backend view `mtg_price_summaries_by_source_v` joins each global price summary to the per-source evidence row that proves the selected source and side exist, and the filter is applied by PostgreSQL before sorting, counting and pagination.
`card_browser_source_options_v` supplies the source and side combinations that currently contain rows, read once for both sides.
The price cells keep the global best buy and sell, so the filter does not silently change the meaning of the ROI columns.
An MTG per-request lane over about 750k summaries needs its own measurement first (#2890's non-goal).

## Justification

Fetching all matching card IDs and passing them back through an `IN` filter would be vulnerable to PostgREST response limits and URL-size limits, so both games filter in one server-side query, which keeps page counts and pagination correct.

The side is named from the operator's point of view because the shop's point of view read backwards.
Until #2927 the Pokemon toolbar had "Source type" (Buylist or For sale, defaulting to Buylist) and "Source": picking Suruga-ya left the default in place and listed 528 cards to sell to Suruga-ya's buylist (cloud, 2026-11-25, tier 1 raw), when the operator wanted the 491 cards bought there.

## What the lists rest on

A recomputed lane is only as good as the exits it can choose from.
On 2026-11-25, "Buy at Suruga-ya" (tier 1 raw) returned 491 cards, 196 with a positive net ROI, and 192 of those 196 exit on a 130point eBay sale, including a ¥900 trainer valued at a $473.50 sale: 130point's attribution of sales to cards is tracked in backend #2922, #2598 and #1716.
With 130point unticked in "Sell to", 52 cards remain positive, all on a TCGplayer market price with no recorded sales volume (`best_buy_evidence = 'sale_unmeasured'`), so they are leads to check by hand, not buys.

## Non-goals

- No pricing or lane rule lives here; the backend function owns them.
- The sealed browser has only the region control.
- Catalog external IDs are not read as availability, because an ID does not prove a current market entry exists.

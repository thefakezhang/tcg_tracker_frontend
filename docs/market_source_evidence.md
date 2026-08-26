# Raw market-source evidence

## Purpose

Collectr remains useful for Japanese promos and other sparse cards that do not currently have a populated TCGPlayer market value.
The dashboard must preserve those opportunities without presenting a portfolio estimate as if it were independently confirmed market evidence.

## Architecture

The card browser reads the visible page from `pokemon_tcgplayer_market` and reads raw USD Collectr sell rows from `pokemon_market_listings` in parallel.
The detail modal reuses its complete raw-listing read and adds one card-scoped `pokemon_tcgplayer_market` read.
Both surfaces pass their prices through the shared comparison functions in `app/dashboard/market-evidence.ts` and render the shared components in `app/dashboard/MarketEvidenceCallout.tsx`.

The comparison has four states.

| State | Meaning | UI behavior |
|---|---|---|
| `unavailable` | Collectr has no positive raw USD estimate. | No market-source label is shown. |
| `collectr_only` | Collectr has an estimate and TCGPlayer has no populated market value. | The card stays visible with a low-confidence Collectr-only warning. |
| `aligned` | Both estimates exist and differ by less than 20 percent of TCGPlayer. | The ordinary TCGPlayer value remains visible without extra noise. |
| `discrepant` | Both estimates exist and differ by at least 20 percent of TCGPlayer. | The UI shows Collectr's direction and percentage gap, and the detail view shows both prices. |

The percentage is `(Collectr - TCGPlayer) / TCGPlayer`.
The threshold is inclusive, so an exact 20 percent difference is significant.
If duplicate rows unexpectedly reach the browser, the lowest positive value wins deterministically and conservatively.

## Failure behavior

The browser classifies evidence only after both source queries succeed.
If either query fails, it clears comparison labels rather than interpreting missing response data as a missing market value.
A successful TCGPlayer query can still populate the existing TCGPlayer display when the Collectr query fails.
The modal also associates a completed comparison with the exact opened card so a warning from the previous card cannot flash while the next card loads.

## Goals

- Preserve sparse Collectr discoveries instead of hiding or deleting them.
- Make Collectr-only raw estimates visibly lower confidence.
- Call attention to material disagreement without cluttering aligned cards.
- Use the same threshold, labels, and arithmetic in list, grid, and detail surfaces.
- Keep query failures distinct from legitimate empty results.

## Non-goals

- This feature does not change the ranking, ROI, exit-signal, or source-selection algorithms.
- This feature does not claim that either source is correct when they disagree.
- This feature does not compare graded Collectr values with raw TCGPlayer values.
- This feature does not make Collectr target-refreshable because its input still comes from an exported portfolio file.

## English counterpart evidence

The Pokemon browser and detail modal add an exact-printing counterpart panel beside the existing raw market-source evidence.
It shows retained mapping evidence separately from price-source evidence, then compares only equal raw tiers or equal PSA grades.
Within each axis, normalized current-market asks and realized individual sold comps are different labeled signal classes and are never averaged or presented as one generic US price.
The current class exposes the selected ask source, same-row observation time, and eligible listing count.
The realized class exposes 130point or Card Ladder provenance, a 90-day window, latest-sale time, sample count, and explicit missing, insufficient, stale, or complete posture.
The panel also exposes the conservative decision basis, liquidity penalty, acquisition denominator, and profitability completeness so an operator can distinguish weak liquidity from missing data.
The dedicated Counterparts review queue shows name-only proposals as unresolved and requires printing-level evidence before an exact decision.
See [Pokemon English counterpart review](english_counterparts.md) for the complete operator contract.

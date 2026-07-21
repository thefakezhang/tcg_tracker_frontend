# Source Availability Filter

## Goal

The Card Browser can restrict results to cards with a current buylist or for-sale entry from one selected source.
The motivating case is showing only cards with Expedition Gaming buylist evidence.

## Architecture

The filter is applied by PostgreSQL before sorting, counting, and pagination.
The backend views `pokemon_price_summaries_by_source_v` and `mtg_price_summaries_by_source_v` join each global price summary to the per-source evidence row that proves the selected source and side exist.
The compact `card_browser_source_options_v` view supplies only source and side combinations that currently contain rows.
The frontend switches from the global summary table to the matching source-presence view only while a source is selected.

The selected source is a presence gate.
The price cells continue to display the global best buy and sell summaries so enabling a source filter does not silently change the meaning of the ROI columns.

## Justification

Fetching all matching card IDs and passing them back through an `IN` filter would be vulnerable to PostgREST response limits and URL-size limits.
Keeping the filter in one server-side query preserves correct page counts and stable pagination for both small and broad sources.

Buylist evidence and for-sale evidence are separate choices because a retailer can publish either or both.
For example, Expedition Gaming currently contributes buylist entries but no for-sale entries.

## Non-goals

- The filter does not recalculate global best prices using only the selected source.
- The filter does not include the separate Pokémon sealed browser in this increment.
- The filter does not infer availability from catalog external IDs because an ID does not prove a current market entry exists.

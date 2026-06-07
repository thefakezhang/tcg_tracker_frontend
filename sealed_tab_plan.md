# Sealed Products Tab — Implementation Plan (Shape A: parallel path)

## Context

The DB now has a `pokemon_sealed_*` table family for sealed Pokémon products (booster boxes,
bundles, ETBs, etc.). We want a new top-level **Sealed** tab beside Pokémon and MTG.

The sealed price-summary table shares the *exact* `best_buy_*` / `best_sell_*` / `roi` shape as the
existing card summaries, so the presentation layer (`DataTable`, `PriceCell`, `CurrencyContext`,
grid cards) is reusable. But sealed differs structurally from cards:

- Identity is `product_id` (bigint), not `card_id`.
- The variant axis is **`sealed_condition`** (`shrink` / `no_shrink` / `standard`) ×
  **`variant_edition`** (`1ed` / `unlimited` / `standard`) — there is **no PSA grade, no tier, no
  `conditions` table**.
- Product display fields differ: `name` (not `regional_name`), no `card_number`, plus
  `product_type` and `language`.
- It has its own buy-list entry table (`pokemon_sealed_buylist_entries`).
- **`pokemon_sealed_price_summaries` is currently empty (0 rows)** despite 1,015 listings across
  501 products — the `aggregate-prices` edge function has no sealed code path yet.

Because of these differences we build a **parallel sealed path** (a dedicated hook + browser +
detail modal + thin product→`CardRowData` adapter) that reuses every generic presentation
component, rather than overloading the card-centric `useCardData`.

## Decisions (confirmed with user)

- **Variant UI = two filter dropdowns.** One card per *product*; **Condition** and **Edition**
  dropdowns (plus the existing **Region** dropdown) pick which variant's price is shown. Default
  both dropdowns to **"Best"** (best-ROI variant per product) so every product appears on landing.
- **Scope = full parity.** Browse (list/grid) + detail modal with raw listings + add-to-buy-list,
  with sealed entries merged into the cross-game buy lists and flowing through the PDF export.

## Schema facts (verified)

- `pokemon_sealed_products` — PK `product_id`; cols `name, english_name, set_code, variant_edition,
  product_type, language, misc_info, image_url, original_release_date`.
- `pokemon_sealed_price_summaries` — **PK `(product_id, sealed_condition, variant_edition)`**; same
  `best_buy_* / best_sell_* / roi / updated_at` columns as card summaries (no `tier`, no `psa_grade`).
- `pokemon_sealed_market_listings` — `product_id, location_id, price_type ('Buy'/'Sell'), currency,
  price, sealed_condition, variant_edition, listing_url, seller_text, last_updated`. FK to
  `currencies(code)` and `locations(location_id)`; normalize via `exchange_rates` (same as cards).
- `pokemon_sealed_buylist_entries` — **already exists**: PK `entry_id`; FK `buylist_id → buylists`;
  `product_id, sealed_condition, variant_edition, target_price_usd, notes, added_at`; unique
  `(buylist_id, product_id, sealed_condition, variant_edition)`. No table creation needed.
- Enums: `sealed_condition_enum{shrink,no_shrink,standard}`, `sealed_edition_enum{1ed,unlimited,standard}`.

---

## Part 1 — Edge function: populate sealed summaries

**File:** `supabase/functions/aggregate-prices/index.ts`

The existing `computeAndInsert()` is card-specific (PSA-mode loop, `conditions`→tier join, partition
by `card_id, psa_grade`). Add a **sibling** `computeAndInsertSealed()` rather than parameterizing the
old one — the grouping key and absence of tier/PSA make a shared function messier than two clear ones.

After the existing `for (const game of GAMES)` loop, add:

```ts
// Sealed products: one summary row per (product_id, sealed_condition, variant_edition)
results["pokemon_sealed"] = await computeAndInsertSealed(
  conn,
  "pokemon_sealed_market_listings",
  "pokemon_sealed_price_summaries",
);
```

`computeAndInsertSealed()` mirrors the existing CTE pipeline
(`filtered_listings → buys → sells → cross_region_pairs → best_buys → best_sells → all_groups →
final → INSERT`) with these changes:

- **`filtered_listings`**: select `product_id, sealed_condition, variant_edition, price_type, price,
  currency, c.symbol, l.name, l.market_region, price * COALESCE(er.rate,1) AS normalized_price`.
  Same `currencies` / `locations` / `exchange_rates` joins. **No** psa/tier/condition `WHERE` filter.
- **Partition / join / DISTINCT ON key** everywhere becomes
  `(product_id, sealed_condition, variant_edition)` (replacing `card_id, psa_grade`).
- Keep the cross-region arbitrage + COALESCE(cross-region, single-region) logic and the ROI formula
  unchanged (ROI still only when buy/sell regions differ).
- `TRUNCATE pokemon_sealed_price_summaries` first (matches existing per-table truncate).
- `INSERT INTO pokemon_sealed_price_summaries (product_id, sealed_condition, variant_edition,
  best_buy_*, best_sell_*, roi, updated_at) ... ON CONFLICT (product_id, sealed_condition,
  variant_edition) DO UPDATE ...`.

**No change** to `app/api/aggregate-prices/route.ts` — it invokes the function generically, so the
frontend "refresh" button picks up sealed automatically.

## Part 2 — DB migration: two flat browse views

To get "one row per product" for the default **Best** mode (PostgREST can't express `DISTINCT ON`),
and to give the hook **card-compatible column names** so it mirrors `useCardData`, add two flat views
that pre-join products and alias columns to the `CardDefinition` shape.

**Migrations live in the backend repo `~/projects/tcg_tracker`** (not this frontend repo), following
its `NNNNNN_name.up.sql` / `.down.sql` convention (latest was `000058`, so these are `000059`).
**Written now but never run by us — the user pushes and runs them manually.**

| File | Purpose |
|------|---------|
| `internal/db/migrations/000059_pokemon_sealed_summaries_views.up.sql` | dev up |
| `internal/db/migrations/000059_pokemon_sealed_summaries_views.down.sql` | dev down (drops `_best_v` then `_v`) |
| `supabase/migrations/000059_pokemon_sealed_summaries_views.up.sql` | prod up (up-only dir; no prod down) |

- `pokemon_sealed_summaries_v` — `pokemon_sealed_price_summaries s JOIN pokemon_sealed_products p`,
  aliasing `s.product_id AS card_id`, `p.name AS regional_name`, `NULL::text AS card_number`, plus
  `english_name, set_code, misc_info, image_url, product_type, language, sealed_condition,
  variant_edition` and all `best_* / roi`. One row per (product, condition, edition).
- `pokemon_sealed_summaries_best_v` — `SELECT DISTINCT ON (card_id) * ... ORDER BY card_id,
  roi DESC NULLS LAST, best_sell_normalized DESC NULLS LAST, sealed_condition, variant_edition`.
  One row per product (highest-ROI variant; deterministic tiebreakers).
- Both views `GRANT SELECT ... TO anon, authenticated, service_role;` and the migration ends with
  `NOTIFY pgrst, 'reload schema';` (pattern from `000029` / `000058`) so PostgREST exposes them.

The hook targets `_best_v` when both dropdowns are "Best", else `_v` with `.eq` filters. (Known
simplification: pinning one dimension while the other stays "Best" can show a product once per
remaining variant; acceptable since products rarely span editions, and tightenable later via an RPC.)

## Part 3 — Frontend types & navigation

- **`app/dashboard/GameContext.tsx`**: extend the union to
  `export type Game = "pokemon" | "mtg" | "pokemon_sealed";`. This lets the buy-list `game`
  discriminant, sidebar picker, and modal routing reuse existing machinery. (`page.tsx` routes
  `pokemon_sealed` to `SealedBrowser`, so the PSA/tier code in `CardBrowser`/`useCardData` never runs
  for it.)
- **`app/dashboard/AppSidebar.tsx`**: add a `pokemon_sealed` entry to `GAME_ICONS` (e.g. `Package`
  from lucide) and to the `GAMES` array; label via `t("game.pokemon_sealed")`.
- **`app/dashboard/page.tsx`**: add one branch before the `CardBrowser` fallback:

  ```tsx
  if (activeBuylistId) return <BuyListView ... />;
  if (activeGame === "pokemon_sealed") return <SealedBrowser key="sealed" />;
  return <CardBrowser key="browser" />;
  ```

- **Exhaustiveness**: add `pokemon_sealed` entries to the `Record<Game, string>` maps that now
  require them — `LISTINGS_TABLE_MAP` (`use-card-data.ts`, used by the modal) and `ENTRY_TABLE_MAP`
  (`BuyListContext.tsx`) → `pokemon_sealed_market_listings` / `pokemon_sealed_buylist_entries`. Give
  `cardDefCols()` a `pokemon_sealed` branch too if referenced.

## Part 4 — Sealed data hook + browser

**New file `app/dashboard/use-sealed-data.ts`** — a trimmed parallel of `useCardData`:

- Query target: `both dropdowns === "best" ? pokemon_sealed_summaries_best_v : pokemon_sealed_summaries_v`.
- Filters: `name`/`set_code` search (flat `regional_name`/`english_name`/`misc_info` ilike — no
  `referencedTable` needed since the view is flat), `.eq("sealed_condition", …)` /
  `.eq("variant_edition", …)` when not "Best", `best_sell_region` region filter, price/ROI ranges —
  reuse the same option shape as `useCardData`.
- Sorting/pagination: identical to `useCardData` (`SORT_COLUMN_MAP`, `.range()`, `count: "exact"`).
- Adapter `sealedRowToCardRow(row)` → reuse the `summaryToPrice` logic from `use-card-data.ts`; map
  `card_id: String(product_id)`, `regional_name`, `english_name`, `set_code`, `card_number: null`,
  `misc_info`, `image_url`. Return a `SealedRowData extends CardRowData` that also carries
  `sealedCondition`, `variantEdition`, `productType`, `language` for the grid/modal.

**New file `app/dashboard/SealedBrowser.tsx`** — parallel of `CardBrowser.tsx`, reusing
`DataTable`, `PriceCell`, server pagination, list/grid toggle. Differences:

- **No PSA/non-PSA tabs, no tier dropdown.** Instead: **Condition** dropdown (Best / shrink /
  no_shrink / standard), **Edition** dropdown (Best / 1ed / unlimited / standard), plus the existing
  Region dropdown and price/ROI filters.
- `renderGridItem`: reuse the card grid layout but swap the `card_number` badge for a **product_type**
  badge and add a small **edition/condition** badge; keep set_code badge, image, name, prices, ROI.
- List columns: new `createSealedColumns(t, language)` in `columns.tsx` (name, product_type, edition,
  condition, lowestSell, highestBuy, roi) — reuse `PriceCell`. `createColumns` stays card-only.
- Opens **`SealedDetailModal`** on row/card click.

## Part 5 — Sealed detail modal

**New file `app/dashboard/SealedDetailModal.tsx`** — parallel of `CardDetailModal.tsx`, reusing its
`ListingTable` + `PriceCell` + the add-to-buy-list popover. Differences:

- Fetch from `pokemon_sealed_market_listings` selecting `product_id, price_type, price, currency,
  sealed_condition, variant_edition, location_id, listing_url, seller_text, currencies(symbol)` and
  the `locations` map for names — **no** `conditions`/PSA joins.
- Replace the PSA/non-PSA tabs + tier filter with **Condition + Edition** dropdowns (defaulting to the
  variant the user clicked from the browser). Buy/Sell `ListingTable`s filter by the selected
  condition/edition.
- "Add to Buy List" passes `product_id` + selected `sealed_condition` + `variant_edition`.

So `BuyListView` can open the right modal per entry, add a tiny picker:
`entry.game === "pokemon_sealed" ? <SealedDetailModal/> : <CardDetailModal/>`.

## Part 6 — Buy-list integration

- **`BuyListContext.tsx`**:
  - Extend `addToBuylist` to accept an optional sealed variant. Branch on game: for `pokemon_sealed`
    insert `{ buylist_id, product_id, sealed_condition, variant_edition, notes }`; else the existing
    `{ buylist_id, card_id, psa_grade, notes }`.
  - `removeFromBuylist(game, entryId)` already works via `ENTRY_TABLE_MAP[game]` + `entry_id`.
  - `deleteBuylist`: add a `.delete()` on `pokemon_sealed_buylist_entries` alongside the pokemon/mtg
    deletes.
- **`BuyListView.tsx`**: add a third branch to the `for (const game of …)` merge loop for
  `pokemon_sealed`:
  - Fetch entries `(entry_id, product_id, sealed_condition, variant_edition, target_price_usd)`.
  - Join `pokemon_sealed_summaries_v` keyed by
    `${product_id}:${sealed_condition}:${variant_edition}` (no `:0:1` tier fallback).
  - Map through `sealedRowToCardRow` into the existing `BuylistEntryRow` (game `pokemon_sealed`).
  - The shared `createBuylistColumns` grid/list and the PDF export consume `CardRowData`, so sealed
    entries render with no further change (card_number simply absent).
- **`ExportBuyListModal.tsx`**: no change required (consumes `CardRowData`).

## Part 7 — i18n (`lib/i18n/en.ts` + `lib/i18n/ja.ts`, keys must match)

Add: `game.pokemon_sealed`; `sealedBrowser.conditionAll/conditionShrink/conditionNoShrink/
conditionStandard`, `sealedBrowser.editionAll/edition1ed/editionUnlimited/editionStandard`;
`column.productType/edition/condition`; `modal.sealedCondition/edition` (+ reuse existing
buy/sell/price/location keys). Product-type labels: `sealed.type.booster_box` etc. for the badge.

---

## Files touched

| File | Change |
|------|--------|
| `supabase/functions/aggregate-prices/index.ts` | **+** `computeAndInsertSealed()` + call |
| `tcg_tracker` backend `000059_*` migrations | **+** `_v` / `_best_v` views (dev up+down, prod up-only) |
| `app/dashboard/GameContext.tsx` | extend `Game` union |
| `app/dashboard/AppSidebar.tsx` | sealed icon + `GAMES` entry |
| `app/dashboard/page.tsx` | route `pokemon_sealed` → `SealedBrowser` |
| `app/dashboard/use-card-data.ts` | sealed entries in reused `Record<Game,…>` maps / `cardDefCols` |
| `app/dashboard/use-sealed-data.ts` | **new** hook + adapter |
| `app/dashboard/SealedBrowser.tsx` | **new** browse view |
| `app/dashboard/SealedDetailModal.tsx` | **new** detail modal |
| `app/dashboard/columns.tsx` | **+** `createSealedColumns` |
| `app/dashboard/BuyListContext.tsx` | sealed in `ENTRY_TABLE_MAP`, `addToBuylist`, `deleteBuylist` |
| `app/dashboard/BuyListView.tsx` | sealed merge branch + modal picker |
| `lib/i18n/en.ts`, `lib/i18n/ja.ts` | new keys (both files) |
| `CLAUDE.md` | document sealed tables + tab |

**Reused unchanged:** `data-table.tsx`, `PriceCell`, `CurrencyContext`, `ExportBuyListModal`,
`HeaderContext`, provider stack.

## Verification

1. **Populate summaries:** run the edge function so `pokemon_sealed_price_summaries` fills from the
   1,015 listings — invoke `aggregate-prices` (Supabase MCP / `supabase functions invoke`, or the
   in-app refresh button after login). Confirm with
   `SELECT count(*) FROM pokemon_sealed_price_summaries;` (expect > 0) and spot-check a product's
   `best_buy_*/best_sell_*/roi`.
2. **User runs the `000059` views migration manually** in the backend repo (we never run it). Then
   `SELECT count(*) FROM pokemon_sealed_summaries_best_v;` (expect ≈ number of products with ≥1
   summary; one row per product).
3. `npx tsc --noEmit` and `npm run build` — no type/build errors.
4. `npm run dev` → open **Sealed** tab: grid + list render; Condition / Edition / Region dropdowns
   change the shown variant/price; search, sort, pagination, currency conversion work.
5. Open a product → **SealedDetailModal** shows buy/sell listings; "Add to Buy List" succeeds
   (verify RLS allows the insert) and writes to `pokemon_sealed_buylist_entries`.
6. Open that buy list → the sealed entry appears alongside card entries; target price edits persist;
   **Export PDF** includes the sealed product.
7. Switching Sealed ↔ Pokémon ↔ MTG and game ↔ buy list leaves no stale state.

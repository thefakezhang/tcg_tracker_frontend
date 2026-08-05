# Lot inventory and lifecycle economics

This document covers the operator workflow implemented by the trip lot manager, trip sales surface, quiet owned indicators, and Finances Economics drill-down.
The database contract is documented in `tcg_tracker/docs/inventory_subledger_contract.md`.

## Justification

Real buying trips and bulk sales often have one trustworthy total rather than a trustworthy price for every product.
The UI must preserve that source fact, make allocation choices explicit, and avoid presenting derived item values as observed prices.
Detailed accounting also belongs in the finance workflow rather than the opportunity browser.

## Lot total is optional

The lot total is not required when creating a lot.
It is left blank when every item will be priced individually, and finalize totals the item prices for the lot.
It is only needed to split a single lump sum across items that are not individually priced.
The create dialog no longer forces a total, a lot with no total displays "Total from items", and finalize is blocked with a per-count warning (with the unpriced price fields highlighted) until either every item is priced or a lot total is set.

## Goals

- Record raw cards, PSA slabs, and sealed products in the same acquisition workflow.
- Keep PSA grade and sealed identity visible through draft, reload, finalization, sale, and finance review.
- Record typed acquisition expenses separately from the purchase total.
- Record one sale total for several products without duplicate item entry.
- Record shared and item-specific selling expenses.
- Show a quiet `Owned N` indicator while browsing opportunities.
- Manage consigned quantities from the unified Inventory surface for Pokémon singles, MTG singles, and Pokémon sealed products.
- Show owned, consigned, and available quantities before editing a source lot.
- Show the full cost and profit bridge in Finances.
- Keep phone interactions at least 44px and avoid page-level horizontal overflow.
- Support English and Japanese labels for every new operator control.

## Non-goals

- Buying surfaces do not show landed cost or profit detail.
- The client does not invent item sale prices when the operator enters one bulk total.
- The client does not implement allocation math independently from the database.
- The workflow does not replace receipts, the general ledger, or exit-cost assumptions.
- Consignment marking does not track a consignee, commission, payout, or settlement, and it does not transfer ownership or remove inventory cost basis.

## Component architecture

`LotManager.tsx` owns draft acquisition lots.
It searches Pokémon cards, MTG cards, and Pokémon sealed products directly from their catalog tables.
Single-card searches keep a grade selector where `0` is raw and `1` through `10` is PSA.
The selected grade is written with the lot line and remains editable until finalization.
Sealed lines preserve `product_id`, sealed condition, and edition.

The acquisition-cost editor supports shipping, handling, travel, food, tax or duty, insurance, discount or refund, and custom types.
It freezes original currency, FX, USD value, and note for each cost.
Draft cost edits and deletes operate on the cost row, not the lot purchase total.
The finalized lot summary labels its analytical trip-overhead figure as "Fully loaded cost" and explains that it adds the lot's allocated share of every expense attached to the trip, including airfare, lodging, and food.

`SalesTab.tsx` reads the unified on-hand holdings view.
Several products can be selected and submitted to `record_lot_sale` with one total.
The operator chooses market value, landed cost, equal per unit, or explicit item proceeds.
The request contains one shared expense plus optional item expenses.
Mixed card and sealed source-fact rows share one global event key so the history renders one sale.

`owned-inventory.ts` performs one batched read from `owned_inventory_counts_v`.
`CardBrowser`, `SealedBrowser`, and list columns render only `Owned N`.
No per-row inventory query is allowed.

`InventoryView.tsx` is the sole consignment mutation surface.
It extends the existing paged `inventory_theoretical_roi_v` read so every finalized source lot includes its exact game, leg, condition or grade, sealed variant, shop, date, on-hand quantity, and consigned quantity.
The view groups those source rows with `roiHoldingKey`, which has the same identity grain as `inventory_holdings_v`.
It must not use `owned_inventory_counts_v` for Inventory rows because that read model deliberately collapses condition, grade, and leg for singles.
Owned quantity includes consigned copies, while available quantity is owned minus the effective consigned quantity.
Effective consignment is clamped to current on-hand quantity because a later sale can reduce the line without changing its stored consignment mark.

Selecting an Inventory list row or grid card opens `InventoryConsignmentSheet.tsx`.
The sheet shows owned, consigned, and available totals plus every source lot, then saves one integer quantity through `set_line_consignment(game, lot_line_id, quantity)`.
A successful mutation revalidates Inventory and refreshes shared owned counts.
Mutation failures remain visible in the sheet and never masquerade as a successful refresh.
The regular single-card and sealed detail modals show consignment status as read-only context so editing has one predictable home.

`InventoryEconomics.tsx` reads `inventory_economics_v` under Finances.
Desktop uses a table and phones use stacked item cards.
Selecting an item opens a full-width phone sheet or a bounded desktop sheet.
The sheet renders these bridges:

```text
direct purchase + acquisition costs = landed basis
gross proceeds - sale expenses = net proceeds
net proceeds - landed basis sold = realized profit
```

Bulk-sale proceeds and shared selling expenses are explicitly labeled as allocated estimates from the recorded lot totals.

## Responsive behavior

Global buttons and sidebar menu buttons have a 44px minimum phone target.
Tab triggers themselves, not only their container, have a 44px phone target.
Trip tab strips scroll internally and cannot widen the page.
Lot, sale, and master inventory default to card grids on phones.
The finance sheet uses the full 390px phone width.
The consignment sheet also uses the full phone width, and its quantity inputs and save buttons keep a 44px minimum phone target.
The Inventory toolbar wraps on narrow screens instead of widening the page.

## Local browser acceptance

Run the acceptance only against a local Supabase stack:

```bash
TCG_BACKEND_ROOT=/path/to/backend-worktree \
SUPABASE_BIN=/path/to/supabase \
npm run test:e2e:lot-economics
```

The runner acquires the shared Docker and browser lock.
It creates an isolated local GoTrue user and starts a loopback-only Next.js server.
The `/auth/e2e` seam returns 404 unless every local-only guard passes.
The guard requires development mode, an explicit enable flag, a strong matching secret, and a literal loopback HTTP Supabase URL.

The acceptance creates a fresh trip and validates the complete purchase-to-sale journey on desktop and phone.
Before selling, it manages one Pokémon single and one sealed product from Inventory, verifies exact source-lot saves, and checks the full-width phone sheet, 44px controls, and page overflow.
Screenshots and the Next.js log are written to a task-specific directory under `/tmp`.
The runner leaves production data untouched.

## Automated coverage

- `lot-line-model.test.ts` covers PSA and sealed line mapping.
- `sale-lot-model.test.ts` covers source-fact request shape, exact explicit totals, signed expenses, and mixed-lot grouping.
- `owned-inventory.test.ts` covers batch count keys and mapping.
- `inventory-economics.test.ts` covers finance totals.
- `inventory-consignment.test.ts` covers exact holding identity, source-lot ordering, and stale quantity clamping.
- `InventoryConsignmentSheet.test.tsx` covers summaries, integer range validation, exact source-line saves, structured mutation failures, and phone target sizing.
- `InventoryView.test.tsx` covers Inventory totals, exact RPC identity, shared-count refresh, and the phone card workflow.
- `e2e-auth-guard.test.ts` covers the local-only authentication boundary.
- `lot-economics-browser.mjs` covers the complete authenticated desktop and phone journey.

# Recording a trade

## What a trade is here

A trade is cards out, cards in, and cash closing the gap, settled as one event.
The money identity is the whole reason to record it as one event rather than two coincidental ones:

```
value_in = value_out + cash        cash signed: + we paid, - we received
```

Both sides are ordinary rows booked through the paths that already exist.
The outbound side is a lot sale with its own FIFO and COGS; the inbound side is an acquisition lot with its own landed cost.
A trade is the record that the two were one event, plus the assertion that they balance.

## Architecture

| Piece | Where | Does |
|---|---|---|
| `lib/trades.ts` | pure | the money identity: `signedCash`, `balanceOf`, `deriveValueIn`/`deriveValueOut` |
| `lib/trade-items.ts` | pure | the two baskets: payload shapes, per-row problems, `canRecordTrade` |
| `app/dashboard/TradesView.tsx` | client | the list, and the record dialog with a basket per side |
| `record_trade` | backend RPC (migration 000575) | one transaction: lot, lines, finalize, sale, link |

The dialog collects two baskets and **one** number, then calls `record_trade`.

### The operator types one value, not two

`value_out` is what the outgoing cards were credited at - the number actually negotiated.
`value_in` is **derived and displayed, never entered**: the backend computes it from the same `value_out` and `cash`, so the two halves cannot be entered inconsistently.
`link_trade` re-checks the identity inside the same transaction, so a drift fails the whole call rather than leaving two loose entries.

That failure mode is the justification for the feature, from backend issue #1447:

> Enter the sale at the $770 actually received and add the two items as a separate cheap or free acquisition, and the books carry a ~$1,200 loss today and a fabricated ~$1,200 profit when those items sell.

### Per-item value is not collected

`record_trade` hands the lot total to `finalize_acquisition_lot`, which splits it across the incoming lines weighted by market value, honouring a `price_override_usd` pin and the bulk rules.
So an incoming card needs only its identity.
The optional per-row value box is for a card the pricing engine cannot value - the operator proposing a number where the data has none.

This matters at scale: a trade of one card out for forty vintage singles in needs one value from the operator, not forty.

### The two baskets are deliberately asymmetric

The outgoing basket searches `inventory_holdings_v`, so it can only name stock we actually hold, and each row carries the condition, the grade and the quantity on hand.
The incoming basket searches the card catalogue, because we do not hold those cards yet, and the condition is a choice made in the picker beside the search box.

Flattening that asymmetry would let you "give away" a card you never had.
Both searches use `lib/card-search`'s shared semantics, so a pasted uid or platform id resolves the same way it does everywhere else, and both are bounded by `.limit()` rather than paging (see the PostgREST cap note in `AGENTS.md`).

### The customer is chosen, not typed

The outbound side is a sale, and every sale is attributed to a customer.
The dialog therefore picks one from `customers` (paged with `selectAll`) and sends it as `p_customer_id`, which `record_trade` passes to `set_lot_customer`; the customer's name also goes in `p_counterparty`, so the trade list keeps showing it.
A trade cannot be recorded without one.

The counterparty used to be a free-text box, and the dialog never sent a customer, so every trade recorded through it booked a sale with no customer: it appeared in the sales ledger and the trade list but under no customer (backend issue #2076, found on trade 6).

### Cash runs in both directions

`CashDirection` is `none | paid | received`, and `signedCash` turns it into the sign the backend wants.

- **Straight swap**: cards for cards, `cash = 0`, so `value_in = value_out`.
- **We paid cash too**: `cash > 0`, so `value_in > value_out` - we gave a card plus money and the cards coming back are worth more.
- **We took cash back**: `cash < 0`, so `value_in < value_out` - we gave a card and took money, so fewer cards come back.

Cash back larger than the outgoing value is refused in the UI and again in the RPC: it would leave nothing for the incoming cards, which makes it a sale, not a trade.

## Goals

- An operator records a trade without an engineer, including a forty-card side.
- The two halves cannot drift apart, by construction rather than by care.
- The outbound side keeps realising a real gain or loss against the cards given up.
- Cash in either direction, including none.
- Every trade's sale is attributed to a customer.

## Non-goals

- **Valuing the non-cash legs automatically.** Market data proposes; a person decides, and the decision is the single `value_out` figure.
- **Sealed product on the incoming side.** Rare enough that the lot screen is a better home than a half-built path here; sealed on the *outgoing* side works, because it comes from holdings.
- **Backdating trades recorded by hand.** `unlink_trade` exists to undo one, but migrating the two historical hand-entered trades is not attempted.
- **Replacing ordinary sales or acquisitions.** A card out for cash only belongs on the sale screen.

## What was retired

The dialog used to **link** rather than record: two dropdowns picking an already-finalized sale and an already-finalized lot.
That was a deliberate design - it kept the outbound side a real sale - but it left the operator unable to record a trade at all without four manual steps first, which for forty incoming cards is unusable.

`record_trade` keeps the principle intact, because it calls `record_lot_sale` and `finalize_acquisition_lot` rather than writing rows itself.
The link-only dialog, its sale/lot option query, and its `trades.pick*` / `trades.balance*` strings are gone.
`link_trade` remains as the backend primitive `record_trade` finishes with, and `unlink_trade` is still reachable from each row.

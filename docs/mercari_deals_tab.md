# Mercari deals (Mercari tab)

## Purpose

The Mercari tab lists the active Mercari JP listings that the Mercari pipeline has identified to a catalog card, newest first, so an operator can look at them the way the Arrivals tab shows shop posts: the listing, and the data for why it is worth a look.
Each card shows the catalog identity the pipeline proposed, the holder (raw, or PSA with the grade read from the label), the seller's own six-value condition, the ask in JPY and USD, the pipeline's conservative exit and net economics when they exist, how old the observation is, and the reasons the listing was projected.
Every card is explicitly a proposal, not a verified fact, and a listing may already be gone.

Backend tracking: tcg_tracker issue #2061, part of the Mercari sequence on #948.

## Goals

- One place to scan projected Mercari listings without opening the search pages by hand.
- Show the evidence beside the number: strict offer or candidate, confidence tier, reason codes, freshness, seller condition, exit basis, and an economics status that says why a number is missing instead of hiding the row.
- Keep the listing one click away, with the configured Mercari search as the second link.
- Let the operator dismiss a wrong or uninteresting listing with a reason, or request a recheck, through the existing backend action ledger.

## Non-goals

- No purchase or buy-list action from the tab.
- No condition inference from photos; the seller's condition is shown as the seller chose it.
- No scheduler or source control.
- No anchor comparison beyond what the backend view already computes; the sold-comp anchor work is tcg_tracker issue #2062.

## Architecture

The dashboard view `MercariDealsView` (slug `mercari`, sidebar group Catalog) loads `/api/mercari-deals` with a private no-store request.
The route requires the Supabase user session, asks the backend predicate `source_run_is_operator()` and answers 403 when it is false, then reads the backend view `mercari_published_deals_v` under that caller session.
That view sits on the cloud publication of the acquisition host's deal rows (backend migration `000596`, `cmd/util/publish-mercari-deals`), because the Mercari pipeline writes only to the acquisition host's local catalog and the operational view `mercari_deals_v` is therefore empty on cloud; see the backend `docs/mercari_published_deals.md`.
The view is `security_invoker`, so row-level security on the publication applies and only an active source-run operator sees rows; the explicit predicate call exists so a non-operator gets a clear refusal rather than an empty page.
`current_card_uid` is the cloud catalog uid when the publisher resolved one and the acquisition catalog's uid otherwise; the row's `card_resolution` says which, and an unresolved row carries the acquisition catalog's identity text.
Rows are ordered by `observed_at` descending then `external_item_id`, and the cursor is that pair, so tied timestamps are never skipped.
Filters: holder (`raw` or `graded`), evidence lane (`strict` or `candidate`), and whether dismissed listings are included; dismissed listings are hidden by default.

`/api/mercari-deals/action` records an operator action through the backend RPC `record_mercari_deal_item_action`.
The RPC enforces the operator role, the two allowed actions (`dismissed`, `recheck_requested`), and that a dismissal carries a reason; the route only bounds the input and maps refusals to 403, 404, and 409.

The row shape is parsed and validated on the client (`parseMercariDeals`): listing links must be `https://jp.mercari.com/item/...` or `.../shops/product/...`, search links must be `https://jp.mercari.com/search?...`, ids must match the Mercari id shapes, and holder and grade must agree.
Anything else fails closed rather than rendering.

Backend contract: `docs/mercari_source_discovery.md` in the backend repo, section "Market-listing evidence boundary", and migrations `000254` and `000255`.

## Operator journey

Open Mercari from the dashboard navigation.
The default request returns up to 100 newest listings across both holders and both evidence lanes, hiding dismissed listings; Load more listings appends the next cursor page.
Narrow to PSA graded only, strict offers only, or include dismissed listings, then select Show listings; a new filter resets the cursor.
Each card shows the ask with its USD conversion at the stored rate, the seller condition in Japanese with an English gloss, the catalog condition the pipeline mapped it to, the conservative exit and its basis, and the net after fees with ROI when the backend could compute them.
When the backend could not, the card says why: no exit reference for the card and grade yet, no FX rate, no exit profile, or no exit horizon.
Open listing goes to the exact Mercari item; Open Mercari search goes to the configured search page for the card, condition, and grade.
Dismiss asks for a reason and keeps the card visible, marked dismissed, until the next load; Request recheck records the request without a reason.

Observed time is shown in Japan Standard Time with the age in hours, and the freshness badge is fresh under 24 hours, aging under 72, and stale after that.

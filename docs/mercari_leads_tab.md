# Mercari leads (Mercari tab, Leads)

## Purpose

The Mercari tab opens on Leads: Mercari JP listings whose title names a catalog card by its printed number or set code, each shown with the evidence for buying it, the way the Arrivals tab shows shop posts.
Exhaustive photo recognition on the acquisition host checks a few hundred listings a day against hundreds of thousands staged, so the verified deal publication behind the Verified feed ([Mercari deals](mercari_deals_tab.md)) stays nearly empty.
Many titles identify the card, so the backend publishes them as leads now and the photo check becomes a confirmation rather than a gate.
A lead is therefore never a verified deal: the card comes from the seller's title, and the tab says so on every page.

Since backend migration 000617 the card is what the shared Pokemon matcher reads from the title (number first, then set code, edition and finish words, and the catalog names printed at that number).
A title with neither a printed number nor a set code, or one the matcher cannot settle on one card, is refused before it becomes a lead, so every lead names exactly one card.
Before 000617 the card came from the photo check's comparison set, which bound name-only titles to same-named old-back cards; that is why the first dry run was not published.

Since 2026-11-02 every lead comes from the fresh lead scan (`source_kind = 'lead_scan'`), which publishes newly listed items every 30 minutes, and the cold crawl's rows (`cold_crawl`) are retired; the tab still renders both kinds.
Since phase L4 a fresh lead is photo-checked against the card its title names, best leads first, and the tab says whether its check is queued and why.

Since tcg_tracker #2517 the feed is lighter: copies of one card at one holder or grade are one row with "+N more ¥X-¥Y" to expand them, the default shows only rows with a multiple from C2C sellers, unpriced rows that could never clear the bars are flagged and hidden, and every value says how old its newest sale is.

Tracking: tcg_tracker epic #2304, phases L1 and L4 (frontend), tcg_tracker #2340, #2517 and #2905.
Backend contract: migrations `000616_mercari_title_leads`, `000617_mercari_lead_title_identity`, `000620_mercari_lead_scan_publication`, `000623_mercari_lead_photo_check_publication`, `000633_mercari_lead_auctions`, `000634_mercari_lead_photo_checks_paused`, `000638_mercari_lighter_leads`, `000646`, `000648`, `000653_mercari_psa_grading_tiers_and_cardladder_values` and `000681_mercari_raw_eras_condition_ladder`, and `docs/mercari_title_leads.md` in the backend repo (sections "Fresh-lead photo checks (phase L4)" and "A lighter feed (#2517)").

## The operator's rules behind the feed

Set by the operator on 2026-11-01, revised on 2026-11-25 (#2905), and enforced by the publisher and the table's CHECKs; the tab shows them and never re-derives them:

- A lead with a multiple clears both a 1.0x multiple and $10 of profit (net value less landed ask). Evidence rows are held to the same bars at the value they show.
- A PSA lead needs 3 sales at its exact grade in 180 days for a multiple. On fewer, its value is still shown, at that grade, as evidence (`psa_thin_comps`).
- Since backend 000653 (#2756, operator 2026-11-17) a PSA lead is valued from Card Ladder only, never eBay comps: the median of the newest 10 Card Ladder sales at the title's grade in 180 days, labelled "Card Ladder PSA sales" (`value_basis = 'cardladder_psa_v0'`). A PSA title with no Card Ladder sale at its grade reads "no PSA G Card Ladder sales in the last 180 days", and a card whose Card Ladder profile stopped updating reads that its sales price nothing (`cardladder_comps_frozen`). Raw leads keep the provisional eBay value.
- Since backend 000681 (#2905, operator 2026-11-25) the raw lanes are three eras of the card's set, by its release date: `modern_raw` from Sun & Moon (SM0 and the SM promos, 2016-11-18), `mid_raw` from Diamond & Pearl (DP1 and the DP promos, 2006-11-30) until then, so all of XY including CP3-CP6, and `vintage_raw` before Diamond & Pearl or with no release date ("I think we need a mid era thing").
  Before 000681 there were two, cut at 2016-01-01, which put CP3 (ポケキュンコレクション, 2016-01-29) among the modern cards.
- A raw card's Near Mint value comes from TCGplayer or the eBay rule, whichever had more sales in the last 30 days; a tie goes to the newer sale, and when neither sold in 30 days the same test runs over 60, then 180 days ("We look at who has more sales and more recent sales. This should be true for everything").
  A TCGplayer value is the market price on the card's Near Mint SKU, labelled "TCGplayer market" (`value_basis = 'tcgplayer_market_v0'`), and its evidence line counts the copies sold in the window that decided, so its window is 30, 60 or 180 days and its count at least one; "1 sale in the last 30 days, on <date>" reads in the singular.
  The eBay value keeps the eBay rule's own 60 or 180 days and reads "Provisional eBay value".
  This replaces TCGplayer first (backend 000679 and 000680, #2895), which took a single TCGplayer sale over 25 eBay ones.
  The parser accepts the TCGplayer basis on every raw lane at every raw value condition, and fails closed on it anywhere else.
- A raw card the seller rates 3 to 6 is valued at a step of its Near Mint value, with a multiple, in every era ("We should be using tiers, not going from NM immediately to damaged"):

  | Seller condition | Step (`value_condition`) | Share of Near Mint |
  |---|---|---|
  | 1 新品、未使用, 2 未使用に近い | Near Mint (`nm`) | 1.00 |
  | 3 目立った傷や汚れなし | between Near Mint and Lightly Played (`nm_lp`) | 0.875 |
  | 4 やや傷や汚れあり | Lightly Played (`lp`) | 0.75 |
  | 5 傷や汚れあり | Moderately Played (`mp`) | 0.54 |
  | 6 全体的に状態が悪い | Damaged (`damaged`) | 0.30 |

  The shares are TCGplayer's played-condition sold prices against Near Mint on Japanese cards over $20, and the operator shifted the steps one place up because Japanese sellers rate strictly.
  The row names its step and the card shows its share and the Near Mint value beneath; the share is copy in the tab, never recomputed from the row.
- Publisher v18's two raw shapes are gone: a vintage card rated 3 to 6 priced as damaged at P25 of the eBay window (`damaged_p25`), with a multiple, and a modern one at its Near Mint value as evidence only (`seller_condition_3_6`).
  No published row carried either after publisher v19's first publication (2026-11-25), backend 000689 (#2916) dropped them from the table's CHECKs, and the parser refuses both in every lane, so a raw row never withholds its multiple.

## Goals

- One lane at a time (`modern_raw`, `mid_raw`, `vintage_raw`, `psa`, `unpriced`), so a raw value and a PSA value are never ranked against each other, and cards of different eras are not ranked together.
- Every lead shows its value with the basis, sample count, window and as-of date, the net value and the multiple of the landed ask, the listing's age, and its photo-check state.
- The card label carries its edition and finish, because a first edition or a mirror changes a vintage card's value, and says how the title was matched.
- A price below Near Mint (a ladder step) and a thin PSA value read as what they are, never as a Near Mint value or a market.
- A PSA lead shows its grade and a value at exactly that grade; a raw value or a neighbouring grade's value never appears on it.
- Unpriced listings are visible with the reason, never dropped; one that could never clear the bars even at twice its best price on file is flagged "Can't be a deal" and hidden by default, one toggle away (backend #2517).
- Copies of one card at one holder or grade are one row, the group's best under the sort, with "+N more ¥X-¥Y" to expand the others, so a page shows 50 cards rather than 50 copies of a few.
- By default the feed shows rows with a multiple (an auction with a maximum bid) from C2C sellers; evidence-only rows and Mercari Shops listings are each one toggle away.
- Every value says how old its newest sale is, amber past two weeks, and the page says when the values were computed (once a day).
- Leads that cannot be bought (no longer on sale, rejected by a photo check, dismissed) are hidden by default and one control away.
- Since backend 000658 (#2774) the acquisition host re-checks the deals the tab shows: a re-check that finds one sold or in a transaction makes it no longer on sale, and one that finds its page gone makes it photo-rejected, so both leave the default view.
  A re-check that finds it still on sale is shown under "Last seen" as "Still on sale at a re-check" with its time, and the row parser refuses a confirmation that is not newer than the scan's observation or sits on a cold-crawl row.
- The operator can dismiss a lead with a reason or ask for a photo check.
- A fresh lead says whether its photo check is queued and why, or why no check can confirm it, and a checked lead says when it was checked.
- While photo checks are paused on the acquisition host, no lead says a check is queued and none offers to request one (#2437).
- Auctions are a feed of their own, never ranked by a multiple: each is marked as an auction and leads with the highest bid that still clears 1.0x and $10 of profit, then its current bid, bid count and end (backend #2436, migration 000633).

## Non-goals

- No purchase or buy-list action.
- No repricing on the client: every number is the publisher's, read from `mercari_leads_v`.
- No condition inference: the seller's six-value condition is shown as the seller chose it.
- No counts per lane or photo state; the publication row carries them and a later change can show them.
- No re-pricing from the screen's evidence: it only hides a row that cannot be a deal, and never values one (the operator's rule of 2026-11-09).
- No change to the Verified feed: `MercariDealsView` renders exactly as before, behind the switch.

## Architecture

### The switch

`MercariTab` is what the `mercari` slug renders.
It holds a `Leads | Verified` switch: Leads is `MercariLeadsView` and the default, Verified is the unchanged `MercariDealsView`.
The two are separate publications with separate rules, so each keeps its own view, API route and parser, and the switch only chooses which one renders.
The header title is "Mercari"; each feed has its own heading.

### Read route

`MercariLeadsView` loads `/api/mercari-leads` with a private no-store request.
The route requires the Supabase user session, asks `source_run_is_operator()` and answers 403 when it is false, then reads under that caller session.
The backend objects are `security_invoker` over tables whose row-level security admits only an active source-run operator, so the predicate call exists to turn an empty page into a clear refusal.

Since backend 000638 the route reads in two steps.
The grouped feed, the backend function `mercari_lead_groups`, applies every filter below, groups the remaining rows by card and holder (`current_card_uid`, `holder_hint`), picks each group's best row under the sort, and keyset-pages on those representatives; it returns each group's row count, listing count, ask range, member ids and the representative's sort keys.
The route then reads the representatives in full from `mercari_leads_v` (`.in` on at most `limit` ids, so the PostgREST row cap never binds), attaches the group fields, and builds the next cursor from the last group's keys, so a representative a publication retired between the two reads is missing from the page without skipping a group.
With `ids` (a group's members, at most 100) it reads those rows in full in the order given, which is how the card expands a group.

Every parameter is bounded in `leads-query.ts` before the database is asked anything:

| parameter | values | default |
|---|---|---|
| `lane` | `modern_raw`, `mid_raw`, `vintage_raw`, `psa`, `unpriced`, `slab_play` | required, a request without one is a 400 |
| `format` | `fixed_price`, `auction`; `slab_play` is fixed price only | `fixed_price` |
| `sort` | fixed price: `multiple` (best multiple), `condition` (best condition), `newest`; slab plays: `profit`, `condition`, `newest`; auctions: `ending` (ending soonest), `newest`; any other pairing is a 400 | the feed's first |
| `conditions` | a comma list of distinct seller conditions `1` to `6` | all six |
| `include_unverified` | `1` or `true`, on `slab_play` only | only plays on a trusted card |
| `photo` | one photo-check state | every state except `rejected` |
| `include_unavailable` | `1` or `true` | only `source_status = 'ON_SALE'` and `auction_ended = false` |
| `include_dismissed` | `1` or `true` | dismissed leads hidden |
| `include_evidence` | `1` or `true` | only rows with a multiple (an auction with a maximum bid and no evidence reason) |
| `include_screened` | `1` or `true` | unpriced rows the screen calls `never_clears` hidden |
| `include_shops` | `1` or `true` | Mercari Shops listings (`source_item_type = 'beyond'`) hidden |
| `ids` | 1 to 100 distinct listing ids, never with a cursor | the feed |
| `after`, `after_key` | the keyset cursor, both or neither | first page |
| `after_seen` | the ending sort's second key, required with its cursor and refused with any other | first page |
| `after_condition` | the condition sort's first key, `1` to `6`, required with its cursor and refused with any other | first page |
| `limit` | 1 to 100 | 50 |

Every request is one lane and one format (`listing_format = format`), and every sort is a keyset on the representative of each group (before 000638, on the table's own indexes), with the lane as an equality:

| sort | order | index |
|---|---|---|
| Best multiple | `multiple DESC NULLS LAST, external_item_id` | `(lane, multiple DESC NULLS LAST, external_item_id)` |
| Newest | `first_seen_at DESC, external_item_id` | `(lane, first_seen_at DESC, external_item_id)` |
| Ending soonest (auctions) | `auction_ends_at ASC NULLS LAST, first_seen_at DESC, external_item_id` | `(lane, auction_ends_at, external_item_id) WHERE listing_format = 'auction'` |
| Best condition | `seller_condition_id ASC`, then the lane's value `DESC NULLS LAST` (the multiple, or the slab profit in the slab plays), `external_item_id` | none; the grouped feed sorts the lane |
| Slab profit | `slab_play_profit_usd DESC, external_item_id` | none; the grouped feed sorts the lane |

Rows without a multiple (thin PSA comps and a PSA title with no grade) sort last under Best multiple, so a page can end inside them.
The cursor spells that boundary `after=null`, and the next page reads `multiple IS NULL AND external_item_id > after_key`; after a priced row it reads the smaller multiples, the tie on the id, and then every row without a multiple.
The id and the cursor value are checked against their exact shape (`m` plus 9 to 11 digits or 20 to 32 alphanumerics; a `numeric(12,3)` decimal; an RFC 3339 timestamp) before they reach the database; the grouped feed takes the cursor as typed arguments (`p_after_multiple`, `p_after_time`, `p_after_seen`, `p_after_key`, `p_after_null`), and the ids are spliced into a PostgREST `in` filter.
The unpriced lane has no multiple at all, so the view asks it for Newest when Best multiple is chosen and disables Best multiple there; Best condition still applies.

### Slab plays and the seller's condition (backend 000646)

Operator, 2026-11-16: a raw card cheaper than what its PSA 1-6 copies sell for, after grading, is always worth picking up, and the slab side is priced from Card Ladder only.
The Slab plays lane (`lane=slab_play`) is every raw lane's leads whose `slab_play_state` is `play`, and with "Show plays whose card the title does not pin down" (`include_unverified`) also `unverified`, sorted by profit.
The route reads its representatives and a group's members with `slab_play_state IS NOT NULL` instead of a lane equality, because no row carries `slab_play` as its lane.
The evidence and screen toggles are hidden there, because the backend does not apply them: the Card Ladder floor is the evidence, and most plays are seller condition 3 to 6.
Its defaults note says so.
The backend's rules (the floor, the costs, which matcher tiers are trusted) are in the backend's `docs/mercari_title_leads.md` "Slab plays".
Since backend 000653 (#2755) grading is the cheapest PSA service level whose max insured value covers the floor (PSA US: Value $39.99 up to $500, Standard $59.99 up to $1,000, Priority $79.99 up to $1,500, and up), and the play's arithmetic names it: "$241.00 - $41.30 eBay costs - $39.99 PSA Value grading (90-100 business days) = $159.71, against $39.60 landed".
A play from a publication before that (publisher v14) still reads the flat grading cost and its days.
The parser refuses a service level that comes without its price and both turnaround bounds, or on a row with no floor.

Since backend 000648 (#2710) the publisher also keeps a raw row that misses the raw bars when it is a slab play, marked `kept_for = 'slab_play'`.
The grouped feed leaves such a row out of every ordinary lane, and the route's row reads for an ordinary lane add `kept_for IS NULL`, so expanding a group by id cannot bring one back.
In the Slab plays lane a kept row reads "Misses the raw bars, so it shows only here, for its slab play.", and when its raw value nets nothing it has neither a multiple nor a withheld reason, which the parser admits only on a kept row and the card states as "No raw multiple: the raw value nets ... after selling costs."
The parser refuses `kept_for` on anything but a priced raw fixed-price row, as the backend CHECK does.

The seller-condition filter is a row of toggles under the lane: "All" and the six conditions as Mercari spells them (the English gloss is each button's title).
Several can be on at once, and turning all six on is the same as "All".
It applies to every lane and format; Best condition is offered on every fixed-price feed.

An auction has no multiple either, because its shown price is a bid that rises, so the auction feed offers Ending soonest and Newest only.
Ending soonest because an auction's decision is due at its end, and its maximum bid stays right whatever the bid does until then; a multiple on the current bid, or the headroom under the maximum, would put the auctions nobody has bid on yet first, at prices nobody will pay.
Auctions whose end no lead scan read sort after those with one, newest first among them; the cursor spells that boundary `after=null` and carries the first sighting in `after_seen`.

### Action route

`/api/mercari-leads/action` records an operator action through the backend RPC `record_mercari_lead_action(p_external_item_id, p_action, p_reason)`.
The two actions are `dismissed`, which needs a reason, and `photo_check_requested`.
The route refuses a dismissal without a reason with a 400 before the RPC is called, and maps the RPC's own refusals: not an operator is 403, a listing that is not a published lead is 404, a CHECK violation is 409.
Actions key on the listing, so they survive republication, and the view reads the latest one: a photo-check request after a dismissal brings the lead back, and the card updates the same way locally.
On a fresh lead a request leads to a real check: the next lead-scan publication (every 30 minutes, at :10 and :40) queues it first (band 1), and the next lead-check turn checks it, usually within about an hour.
While photo checks are paused the button is not offered, because no check would come (#2437); a request made before the pause is kept and goes first when they resume.
On a cold-crawl lead a request is recorded only, because only fresh leads are queued.

### Parsing fails closed

`parseMercariLeads` holds every row to the lane rules the table's CHECKs enforce, and a row that breaks one fails the page rather than rendering:

- a raw lane row (`modern_raw`, `mid_raw` or `vintage_raw`) has no holder named, a raw value (`value_psa_grade = 0`), a `value_condition` and an `nm_value_usd`; a Near Mint row's value is its Near Mint value, and a value below Near Mint is never above it;
- the seller's condition decides the raw shapes: codes 1-2 are Near Mint with a multiple, and codes 3-6 are their ladder step (3 `nm_lp`, 4 `lp`, 5 `mp`, 6 `damaged`) with no withheld reason, in every era, and nothing else passes (a step another code gives, Near Mint on codes 3-6, or a withheld multiple is refused); publisher v18's `damaged_p25` and `seller_condition_3_6` are not values the parser knows (backend 000689, #2916);
- a TCGplayer value sits on a raw lane at any value condition, with a window of 30, 60 or 180 days and at least one sale; any other basis has a window of 60 or 180 days;
- a PSA lane row has no value condition and a value at exactly the title's grade, with a multiple or `psa_thin_comps`, or, when the title does not say the grade, no value, no multiple and `psa_grade_unread`;
- an unpriced row has no value, no value condition, no withheld reason and a reason of its own;
- a multiple exists only with a positive net value, and a priced lane row without a multiple says why;
- the listing URL is exactly the listing's own `jp.mercari.com` page, and the buyer-pays flag agrees with the shipping payer.

- `source_kind` is `lead_scan` or `cold_crawl`, and nothing else passes;
- as 000633's CHECKs hold, a fixed-price row carries no auction fact (and still has a multiple or says why it has none), and an auction row has no multiple, a last auction sighting no later than its newest observation, a maximum bid exactly when it is priced and at or above its current bid, an `auction_bid_within_max` that agrees with them, and `auction_ended` only with a stated end;
- `photo_check_priority` is NULL or an integer from 1 to 3, and, as 000623's queue CHECK holds, set only on an unchecked `lead_scan` row whose title card is in the photo scope, so a badge never says a check is on its way when none can come.
- `photo_checks_paused` (000634) is a boolean, true only on a `lead_scan` row, and a row whose publication was paused carries no band, as 000634's CHECK holds for the publication's queue counts.

The match tier is the one new field that does not fail closed: a tier the matcher adds later is shown by its code, because it says how the card was read, not what it is worth.

### Identified from photo (backend #2937)

Since publisher v22 a listing whose title names a card but not which printing (one the title rules refuse) can still be a lead: a lead check matched its photo 1 against every printing whose name contains the title's name, and the publisher named the printing it showed, at match tier `photo_identity`.
Printings with the same art (a reprint, an edition, a finish) are priced at the cheapest of them, and a lead is unpriced when one of them has no value.
Such a card carries a sky-blue "Identified from photo" badge beside the photo-check badge, whose hover text says how the card was named, and its match line reads "Card match: photo 1 (the title names no printing)" instead of "Title match: ...".
The row has no title set code or number (000686), and the parser needs nothing new: `match_tier` parses as any string.
The fresh-lead photo check and the status re-checks apply to these leads as to any other, so a full-gallery check can still confirm or contradict the card.

### What a lead card shows

- The listing title, linked to the listing.
- The listing's age as the first badge, toned fresh under 24 hours, aging under 72, and old after that, because Mercari listings sell within days; it is "Listed" when Mercari gave a creation time and "First seen" otherwise. A cold-crawl lead carries a muted "Cold crawl" badge beside it; a fresh lead, now every lead, carries none, because a "New" badge on every card would say nothing. The last observation time follows in JST.
- The photo-check badge, described below. On a conflict the card the photo check found is shown with its image, name, set, number and PSA grade.
- The holder: Raw, PSA with the grade, or "PSA, grade not read".
- The multiple of the landed ask (net value over landed ask), marked "priced as Lightly Played" (or the row's other step) for a ladder row, or the reason it is withheld: a thin PSA value reads "Only N PSA G sales; shown as evidence", and a PSA title without a grade has no value to compare.
- For an unpriced lead, the reason and, when the lead stands for its group, "+N other listings" still on sale for the same card, holder and seller condition.
- The ask in JPY, any buyer-paid shipping added, the landed ask in USD, and a "Buyer pays shipping" marker.
- The seller's condition, in Japanese with an English gloss.
- The card: catalog image, name, set and number, then the variant label `pokemonVariantLabel` composes from `misc_info`, `edition` and `foil_treatment` (`1ED`, `ミラー`, as everywhere else in the app), a "Title match" line naming the matcher tier, and a note when the card is not in the cloud catalog.
- Under the card, the set's release date ("Set released Sep 16, 2026", backend `set_release_date`), with a heads-up when the set is young.
A set under 13 weeks old adds, in amber, "new set (N wk): prices often keep falling for months after release"; a set under a year old adds, muted, "recent set (N mo): prices may still be settling"; an older set shows only the date, and a card with no catalog set row shows nothing.
The thresholds come from our own TCGplayer sales in October and November 2026: cards from sets a few weeks old fell 43-54% in the five weeks after we bought them, sets 3-12 months old fell 21-36%, and sets from 2022-2024 held within 15%.
It is a warning for the operator to weigh, not a price adjustment: the value, net and multiple are unchanged.
TCGplayer's own `volatility_label` is not used, because it is blank on all but a few dozen of roughly 457,000 SKUs.
- On a raw lead whose card has a Card Ladder PSA 1-6 floor: when it is a play, a green panel with the profit after grading ("+$466.81 profit even if it grades PSA 1-6 · 1.7x"), the floor ("Card Ladder PSA 1-6: $1,401.00, the lower quarter of 47 sales (newest date)") and the arithmetic (floor less eBay costs less grading, with the PSA service level and its turnaround in business days, or the grading days on an older publication, against the landed ask), and a "Slab play" badge; when only a set and name named the card, the panel is amber, the badge reads "Slab play: check the card" and the panel says to check the photos before buying; when the floor does not pay for grading, no grading cost is set, or the photos disagree, one muted line with the floor and the reason.
- The value with its basis, holder, sample count, window and newest-sale date, how old that sale is ("value as of 3 days ago", amber with "no newer sale" past 14 days, because a value with no recent sale may have moved; backend `value_age_days`), then the net after eBay fees and postage.
- On an unpriced row, the never-a-deal screen: a grey "Can't be a deal" badge and "Even at 2x its best price on file ($4.50, SNKRDUNK, date), this listing could not clear 1.0x and $10 of profit at its ask" (`never_clears`); the best price on file for a row that could clear (`may_clear`); or that nothing prices it (`no_evidence`). A sale is named by its platform ("eBay sale").
- When the row stands for a group of more than one, a "+N more ¥X-¥Y" button over the group's ask range; it expands the best 50 other copies, each on one line with its ask (linked to the listing), multiple or reason, seller condition, age and photo badge, and the number of listings in all when unpriced rows stand for more. A ladder row reads "priced as Lightly Played, 0.75 of Near Mint" (its own step and share), with "Near Mint $Y" beneath it. `value_basis = 'ebay_rule_v0'` reads "Provisional eBay value", never a final price; `cardladder_psa_v0` reads "Card Ladder PSA sales"; `tcgplayer_market_v0` reads "TCGplayer market"; an unknown basis is shown by its code.

An auction card differs in these places:

- A violet "Auction" badge leads the badges ("Auction ended", grey, once its stated end has passed, which only shows with "Show listings no longer on sale").
- Where a multiple would be, the maximum bid in large type with "max bid: the highest that still clears 1.0x and $10 of profit"; then "Current bid: ¥X · ¥Y below the max" (or "at the max"); a thin PSA auction adds its evidence reason, an unpriced one shows its reason instead of a maximum, and a PSA auction without a grade its withheld reason; then "N bids · Ends date JST (in N h)", each "not read yet" when no lead scan read it.
- An unpriced auction stands for the other auctions of its card, holder and seller condition, never for a fixed-price listing, and says it has the lowest current bid among them.
- The ask row reads "Current bid", and when the newest search no longer marks the listing as an auction a note under it says when it was last marked and that it has probably ended or been converted to a fixed price.
- No photo check is offered or queued: the badge is the grey "Not photo-checked" with "Auctions are not photo-checked.", because the backend never queues an auction.

### The photo-check badge

A fresh lead is checked once, against the card its title names, and `title_card_in_photo_scope` on a fresh lead says whether a check can compare its photos with that card: it is false only when the card has no reference image.
The publisher queues the checks in the operator's bands (`photo_check_priority`): 1 the operator requested it, 2 a lead with a multiple (by profit), 3 a PSA lead without a multiple.

| row | badge | note beneath | "Request photo check" |
|---|---|---|---|
| fresh, unchecked, requested or in band 1 | blue "Photo check requested: within about an hour" | none | no, it is first in line |
| fresh, unchecked, band 2 | blue "Photo check queued: best deal" | none | yes, to go first |
| fresh, unchecked, band 3 | blue "Photo check queued: PSA lead" | none | yes, to go first |
| fresh, unchecked, no band, title card in scope | amber "Not photo-checked" | "New listings are photo-checked best deals first. Request a check to put this one first." | yes |
| fresh, title card not in scope | grey "Photo check can't confirm this card" | "The title's card has no reference image, so no photo check can confirm it." | no |
| cold crawl, unchecked, title card not in scope | grey "Photo check can't confirm this card" | the frontier note: "The photo check compares this listing with other cards, so it cannot confirm the card the title names yet." | no |
| cold crawl, unchecked, in scope | amber "Not photo-checked" | none | yes, unless already requested |
| auction, unchecked | grey "Not photo-checked" | "Auctions are not photo-checked." | no |
| fresh, unchecked, photo checks paused | grey "Photo checks paused" | "Photo checks are turned off for now, so no listing is checked until they resume.", or, when the operator asked before the pause, "Photo checks are turned off for now. Your request is kept and goes first when they resume." | no |
| fresh, checked by the lead photo checker | green "Photo matches", red "Photo shows a different card" (the card, or the title's card in a slab of another grade, shown beneath), or orange "Photo unclear" | on a match, "A photo shows the title card's art. It cannot tell a reprint, the edition or the holder apart."; when unclear, "The photos may show another printing than the title names. Check them before buying." | no, a fresh lead is checked once |
| fresh, rejected (sold, page gone, not a single card) | struck-through "Rejected by the photo check" (shown only under that filter) | none | no |
| cold crawl, checked | green "Photo-checked", red "Photo disagrees with title", grey "Photo inconclusive", or struck-through "Rejected by the photo check" (shown only under that filter) | the scope note when the title card is not in scope | yes unless confirmed or already requested |

Two cases read the latest action rather than the band, because the band is the latest publication's and the action may be newer:

- A request the latest publication has not read yet reads as band 1 at once, since the next publication queues it first; the card updates the same way locally when the operator presses the button.
- A dismissed lead is never queued, so a band from before the dismissal is not shown; the lead reads "Not photo-checked" and offers a request, which brings it back.
- While photo checks are paused (`photo_checks_paused`, #2437) nothing reads as queued, whatever was asked: the operator found "Photo check queued: best deal" on `m84099025534` on 2026-11-07, two days after checks were turned off. The backend stops queueing while the acquisition host's `lead-check-chain/checks-off` marker exists; the tab shows the pause instead, in grey, and offers no request. A result from before the pause is still shown.

A fresh lead's check is the lead photo checker's (backend #2480, `docs/mercari_lead_photo_checker.md`): it asks only whether the listing's photos show the card the title names, and answers `confirmed`, `contradicted` or `undecided`, which the publisher maps to `confirmed`, `conflict` and `inconclusive`.
It confirms the art, not the printing, so a match says what it cannot tell, and a same-art reprint leaves it unclear.
"Photo unclear" reads orange, as a caution rather than a shrug: in the operator's review of 2026-11-08 the title was right on only 3 of the 10 galleries the checker could not decide, and on the other 7 the photos showed another printing (5) or a 30th Celebration reprint neither option named (2).
A cold-crawl lead's check was the sealed recognizer's, and keeps its words.

A checked lead says when: "Photo checked (JST): date (N h ago)".
The age is the check's age when the view read the row (`observed_age_hours` plus the gap between `observed_at` and `photo_checked_at`), so it agrees with the other ages on the card and does not depend on the viewer's clock.
On a fresh lead the request is the queued badge, so it is not named twice; a cold-crawl lead's request shows as a plain "Photo check requested" badge, with no promise of a check.

The "1 of N cards" ambiguity note of the first version is gone: a lead now names one card, and the table holds `candidate_count = 1` by CHECK, so the tab no longer reads `candidate_count` or `ambiguous`.

### URL state

The feed, lane, format and sort are leaf URL params owned by the view, written with `writeUrlParam` and carried by `UrlStateSync` while the view stays selected: `?view=mercari&feed=verified`, `?view=mercari&lane=psa&sort=newest`, `?view=mercari&format=auction`.
The defaults (Leads, Modern raw, Fixed price, and the format's first sort: Best multiple or Ending soonest) stay out of the URL; a sort the format does not offer reads as its first.
Photo state and the two include toggles are not in the URL, because they are momentary filters rather than places to return to.

### Page notes

Under the lane hint the page says what the defaults hide and that each is one toggle away; on the unpriced lane the hint adds the screen's rule at the publication's multiplier.
Under the feed it says when the values were computed, from the row's `value_refreshed_at` (the daily refresh the latest publication read), aged on the view's clock like every other age.

## Operator journey

Open Mercari from the dashboard navigation; it opens on Leads, Modern raw, Best multiple.
Pick a lane; the page reloads with only that lane, and the lane hint under the chips says what it holds and how it is valued.
Switch to Newest to see the most recently found listings first.
Switch the format to Auctions to see the lane's auctions ending soonest, each with the most to bid for it.
Narrow to one photo-check result, or show listings no longer on sale, dismissed leads, evidence-only rows, Mercari Shops listings, or on the unpriced lane the rows that can't be deals, and the page reloads at once.
Press "+N more" on a card to see the other copies of that card, and again to hide them.
Open a lead's title to go to the listing; dismiss it with a reason, or request a photo check.
Load more leads appends the next page; Refresh reloads the lane from the top.
Switch to Verified for the photo-checked deal publication.

## Known limits

- The route selects the columns 000617, 000623 and 000633 append to `mercari_leads_v`, and PostgREST answers a select naming a missing column with a 400, so each version must ship after its migration is applied; until then, and until the publisher has run, the route answers "Mercari leads are unavailable". It was built and tested against the migrations' column lists with fixtures, and `route.test.ts` pins the selected columns to the view's current list (000658's `on_sale_confirmed_at` last).
- An auction's current bid is as of its newest observation, so a bid placed since can already be over the maximum shown; and auctions observed before the lead scan read bid counts and ends show both as not read yet.
- The route calls `mercari_lead_groups` and selects 000638's columns, so this version ships after 000638 is applied; before it the route answers "Mercari leads are unavailable".
- A group's expansion shows its best 50 other copies; a larger group says how many it holds.
- The toggles are not in the URL, like the photo filter, because they are momentary filters.
- A fresh lead whose title card has no reference image stays unconfirmable; a catalog image for the card is the fix, not a request.
- "Within about an hour" is the backend's usual time for a requested check (the next publication at :10 or :40, then the next lead-check turn), not a promise; a busy recognizer or a stopped laptop delays it, and the result shows at the publication after the check.
- Listing ages are computed by the view at read time, so a page left open does not age; Refresh reads them again.

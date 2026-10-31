# Mercari leads (Mercari tab, Leads)

## Purpose

The Mercari tab opens on Leads: Mercari JP listings whose title already names a catalog card, each shown with the evidence for buying it, the way the Arrivals tab shows shop posts.
Exhaustive photo recognition on the acquisition host checks a few hundred listings a day against hundreds of thousands staged, so the verified deal publication behind the Verified feed ([Mercari deals](mercari_deals_tab.md)) stays nearly empty.
Titles identify most listings, so the backend publishes them as leads now and the photo check becomes a confirmation rather than a gate.
A lead is therefore never a verified deal: the card comes from the seller's title, and the tab says so on every page.

Tracking: tcg_tracker epic #2304, phase L1 (frontend).
Backend contract: migration `000616_mercari_title_leads` and `docs/mercari_title_leads.md` in the backend repo.

## Goals

- One lane at a time (`modern_raw`, `vintage_raw`, `psa`, `unpriced`), so a raw value and a PSA value are never ranked against each other.
- Every lead shows its value with the basis, sample count, window and as-of date, the net value and the multiple of the landed ask, the listing's age, and its photo-check state.
- A PSA lead shows its grade and a value at exactly that grade; a raw value or a neighbouring grade's value never appears on it.
- Unpriced listings are visible with the reason, never dropped.
- Leads that cannot be bought (no longer on sale, rejected by a photo check, dismissed) are hidden by default and one control away.
- The operator can dismiss a lead with a reason or ask for a photo check.

## Non-goals

- No purchase or buy-list action.
- No repricing on the client: every number is the publisher's, read from `mercari_leads_v`.
- No condition inference: the seller's six-value condition is shown as the seller chose it.
- No counts per lane or photo state; the publication row carries them and a later change can show them.
- No change to the Verified feed: `MercariDealsView` renders exactly as before, behind the switch.

## Architecture

### The switch

`MercariTab` is what the `mercari` slug renders.
It holds a `Leads | Verified` switch: Leads is `MercariLeadsView` and the default, Verified is the unchanged `MercariDealsView`.
The two are separate publications with separate rules, so each keeps its own view, API route and parser, and the switch only chooses which one renders.
The header title is "Mercari"; each feed has its own heading.

### Read route

`MercariLeadsView` loads `/api/mercari-leads` with a private no-store request.
The route requires the Supabase user session, asks `source_run_is_operator()` and answers 403 when it is false, then reads the backend view `mercari_leads_v` under that caller session.
The view is `security_invoker` over tables whose row-level security admits only an active source-run operator, so the predicate call exists to turn an empty page into a clear refusal.

Every parameter is bounded in `leads-query.ts` before the database is asked anything:

| parameter | values | default |
|---|---|---|
| `lane` | `modern_raw`, `vintage_raw`, `psa`, `unpriced` | required, a request without one is a 400 |
| `sort` | `multiple` (best multiple), `newest` | `multiple` |
| `photo` | one photo-check state | every state except `rejected` |
| `include_unavailable` | `1` or `true` | only `source_status = 'ON_SALE'` |
| `include_dismissed` | `1` or `true` | dismissed leads hidden |
| `after`, `after_key` | the keyset cursor, both or neither | first page |
| `limit` | 1 to 100 | 50 |

Both sorts are keysets on the table's own indexes, with the lane as an equality and the order exactly the index order:

| sort | order | index |
|---|---|---|
| Best multiple | `multiple DESC NULLS LAST, external_item_id` | `(lane, multiple DESC NULLS LAST, external_item_id)` |
| Newest | `first_seen_at DESC, external_item_id` | `(lane, first_seen_at DESC, external_item_id)` |

Rows without a multiple (a withheld multiple, a PSA title with no grade) sort last under Best multiple, so a page can end inside them.
The cursor spells that boundary `after=null`, and the next page reads `multiple IS NULL AND external_item_id > after_key`; after a priced row it reads the smaller multiples, the tie on the id, and then every row without a multiple.
The id and the cursor value are spliced into a PostgREST filter, so each is checked against its exact shape (`m` plus 9 to 11 digits or 20 to 32 alphanumerics; a `numeric(12,3)` decimal; an RFC 3339 timestamp) first.
The unpriced lane has no multiple at all, so the view always asks it for Newest and disables Best multiple there.

### Action route

`/api/mercari-leads/action` records an operator action through the backend RPC `record_mercari_lead_action(p_external_item_id, p_action, p_reason)`.
The two actions are `dismissed`, which needs a reason, and `photo_check_requested`.
The route refuses a dismissal without a reason with a 400 before the RPC is called, and maps the RPC's own refusals: not an operator is 403, a listing that is not a published lead is 404, a CHECK violation is 409.
Actions key on the listing, so they survive republication, and the view reads the latest one: a photo-check request after a dismissal brings the lead back, and the card updates the same way locally.
In L1 a photo-check request is recorded only; phase L2 makes photo checks follow these requests.

### Parsing fails closed

`parseMercariLeads` holds every row to the lane rules the table's CHECKs enforce, and a row that breaks one fails the page rather than rendering:

- a raw lane row has no holder named and a raw value (`value_psa_grade = 0`);
- a PSA lane row has a value at exactly the title's grade, or, when the title does not say the grade, no value and no multiple;
- an unpriced row has no value and a reason;
- a multiple exists only with a positive net value, and a priced lane row without a multiple says why;
- the listing URL is exactly the listing's own `jp.mercari.com` page, and the buyer-pays flag agrees with the shipping payer.

### What a lead card shows

- The listing title, linked to the listing.
- The listing's age as the first badge, toned fresh under 24 hours, aging under 72, and old after that, because the first leads come from a crawl several days old and many have sold; it is "Listed" when Mercari gave a creation time and "First seen" otherwise. The last observation time follows in JST.
- The photo-check badge: amber "Not photo-checked", green "Photo-checked", red "Photo disagrees with title", grey "Photo inconclusive", and a struck-through "Rejected by the photo check" when that filter is chosen. On a conflict the card the photo check found is shown with its image, name, set, number and PSA grade.
- The holder: Raw, PSA with the grade, or "PSA, grade not read".
- The multiple of the landed ask (net value over landed ask), or the reason it is withheld: a raw card the seller rates 3 to 6 keeps its value as evidence only, and a PSA title without a grade has no value to compare.
- For an unpriced lead, the reason and, when the lead stands for its group, "+N other listings" still on sale for the same card, holder and seller condition.
- The ask in JPY, any buyer-paid shipping added, the landed ask in USD, and a "Buyer pays shipping" marker.
- The seller's condition, in Japanese with an English gloss.
- The card: catalog image, name, set and number, a note when the title fits several catalog cards and the lead is priced at the lowest of them, and a note when the card is not in the cloud catalog.
- The value with its basis, holder, sample count, window and newest-sale date, then the net after eBay fees and postage. `value_basis = 'ebay_rule_v0'` reads "Provisional eBay value", never a final price; an unknown basis is shown by its code.

### URL state

The feed, lane and sort are leaf URL params owned by the view, written with `writeUrlParam` and carried by `UrlStateSync` while the view stays selected: `?view=mercari&feed=verified`, `?view=mercari&lane=psa&sort=newest`.
The defaults (Leads, Modern raw, Best multiple) stay out of the URL.
Photo state and the two include toggles are not in the URL, because they are momentary filters rather than places to return to.

## Operator journey

Open Mercari from the dashboard navigation; it opens on Leads, Modern raw, Best multiple.
Pick a lane; the page reloads with only that lane, and the lane hint under the chips says what it holds and how it is valued.
Switch to Newest to see the most recently found listings first.
Narrow to one photo-check result, or show listings no longer on sale or dismissed leads, and the page reloads at once.
Open a lead's title to go to the listing; dismiss it with a reason, or request a photo check.
Load more leads appends the next page; Refresh reloads the lane from the top.
Switch to Verified for the photo-checked deal publication.

## Known limits

- The cloud apply of migration 000616 waits on the operator and the publisher has not run, so the tab was built and tested against the migration's column list with fixtures; until both happen the route answers "Mercari leads are unavailable".
- `mercari_leads_v` carries `misc_info` but not the typed `edition` and `foil_treatment` axes, so a card label can lose `1ED` or mirror once the backend variant rewrite empties `misc_info`, the same limit the Verified feed has.
- Listing ages are computed by the view at read time, so a page left open does not age; Refresh reads them again.

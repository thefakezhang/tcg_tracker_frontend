# Scan review screen

The operator surface where a scanned card capture becomes a decided card.
Backend issue #1016, under the story in #1011 and the epic in #930.
The backend design this implements is `docs/scanner_review_screen.md` in `tcg_tracker`; this document covers the frontend architecture only.

## The standard it exists to meet

Whenever the pipeline is unsure what a card is, that card must reach a person, and that person must be able to pick the right one.

The failure this prevents is not a crash or an error page.
It is a wrong card, priced and listed, that nobody was ever asked about.

## Where it lives

Sidebar group **Trips**, immediately after Inventory, as sentinel `-19` / slug `scan-review` in `app/dashboard/views.tsx`.

That group already runs the arc this screen belongs to.
A trip is taken, stock is logged into inventory, and it is sold; scanning is what happens between logging and selling, so the group reads trips, inventory, scan review, sales.

It is deliberately **not** in the Curation group.
Image-buylist curation reviews someone else's cards observed in posters to extract market intelligence.
This screen decides the identity of our own stock, where being wrong means a wrong card sold, a return and a refund.
Data flowing in as intelligence and data flowing out as fulfilment are not one journey merely because both involve looking at a picture of a card.

## Files

| File | Responsibility |
|---|---|
| `lib/scan-review.ts` | Pure logic: band assignment, claim counting, contested-proposal detection, batch progress. No React, no Supabase. |
| `lib/scan-review.test.ts` | Regression guard for the two things that can be silently wrong (banding, and availability after earlier decisions consume copies). |
| `app/dashboard/use-scan-review.ts` | Data access: staged batches and captures, card hydration, signed capture URLs, TCGplayer conditions, the two decision RPCs. |
| `app/dashboard/CardCandidatePicker.tsx` | The one shared presentational component: an image plus a ranked candidate list, with search. |
| `app/dashboard/ScanReviewView.tsx` | The screen: batch list, confidence bands, capture rows, and the decision drawer. |

## Architecture

### Decisions go through RPCs, never through a table write

`decide_scanner_batch_capture(capture_id, card_uid, condition_id)` derives whether a decision was a **confirmation** or a **correction** by comparing the chosen card against the stored proposal.
A client that wrote the `decision` column itself could claim it confirmed something it actually overrode, and the correction rate would stop meaning anything.
Since a rising correction rate is the earliest evidence that recognition has drifted, that signal is worth protecting at the schema boundary.

`clear_scanner_batch_capture_decision(capture_id)` is the undo.
It refuses once the capture's imagery has been registered as listing media, because that row names the capture as its source.

### Quantity is a batch-level constraint, so the remainder is re-derived

Confirming one capture can consume the last copy of a card that another capture was proposed.
A screen that computed the remainder once would keep showing capture 47 as a comfortable high-confidence proposal that can no longer be fulfilled.

`countClaims()` therefore recomputes claims from the captures after every decision rather than decrementing a counter, so an undo restores the count exactly.
Availability itself is learned from the `available_quantity` each RPC call reports and is never assumed: `remainingFor()` returns `null` for a listing group we have not been told about, and the UI treats unknown as unknown rather than as zero.

### Confirming must not be the easiest thing to do

Only the `high` band (score at or above 95) gets a one-click confirm in the row.
Every other band has to be opened, and the drawer's action stays disabled until a card is actually chosen.
This is a direct guard against the failure TCG Automate names as its own worst habit: saving a result that is close enough.

### Images

Capture bytes live in the private `inventory-card-media` bucket, keyed `owner_id/sha256.ext`, so they are reachable only through a short-lived signed URL minted for the authenticated owner.
`/api/proxy-image` is deliberately not used: it is restricted to public http(s) hosts on purpose, and pointing it at private storage would make it an open proxy on our own origin.

Signed URLs are minted **once per batch** with `createSignedUrls`, not once per image.
A 200-capture batch is 400 objects, and per-image round trips would make the screen unusable before the operator saw anything.

A missing image is stated explicitly rather than left blank.
A candidate list that renders normally beside an absent scan looks decidable when it is not.

### Row-cap safety

Captures per batch and the card fan-in are both functions of the data, not of a page size we control, so both page through `selectAll` / `selectAllByIds`.
The catalog search is bounded by an explicit `.limit(40)`, which is a page size we do control and is therefore safe as a single read.

## What is shared, and the test for whether it stayed shared honestly

`CardCandidatePicker` takes its data as props and returns a chosen card.
It knows nothing about scanner batches, inventory, buylists or price observations.

If it ever needs to know which pipeline it serves, an `isScanBatch` branch or equivalent, it was shared too deeply and should be split rather than parameterised.

It is currently used only by this screen.
The image-buylist curation override picker is the anticipated second caller, and moving it over is a separate change: `CurationView` works today, and rewriting a working console to prove a sharing point is not worth the risk.

## Non-goals

- Not a catalog editor. A wrongly chosen card is fixed here; a wrong card record is fixed in the Card Index.
- Not a pricing screen. Price appears as evidence for the identity decision, not as something edited here.
- Not a publisher. Confirmation produces confirmed assignments; listing and publishing are #997.
- Not a bulk data editor. The rows are proposals to verify, not a spreadsheet to fill in.

## Known gaps

- **Seller-facing set names (#1045).** Candidates currently render `cardMeta()`, which is the internal `set_code` plus number and variant, the same subtitle every other surface in this app uses. `set_name` exists only on the link-coverage view, which is the wrong source. When #1045 lands, `CandidateCard.setCode` should become a resolved set name.
- **Keyboard navigation.** The image-curation console has a keyboard-navigable flat order across bands, and `flattenBands()` here exists to support the same thing. At a few hundred captures a batch this screen will want it; it is not wired up yet.
- **Pokemon only.** `useScanBatch` hydrates from `pokemon_card_definitions`, matching the backend recognizer's scope.

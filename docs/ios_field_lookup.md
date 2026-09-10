# iOS field lookup

## Goal

The first native increment lets a mapped administrator search a Pokemon card while standing in a shop and inspect the existing read-only buying signal on an iPhone.
The result presents the exact catalog printing, image, entry ask, exit signal and evidence kind, winning region direction, summary ROI, summary refresh time, and catalog-level owned quantity.
Network recovery can use a bounded cache only for the same signed-in user and normalized query, with offline and stale state shown beside the retained values.

## Non-goals

This increment does not recognize a camera image, upload a scan, record an acquisition, add inventory, publish a listing, change matching, scrape a shop, or modify a database role.
It does not ship production project values, a service-role key, a personal token, an App Store archive, or device-signing configuration.
It does not describe a summary refresh timestamp as the observation time of its underlying source quote.

## Architecture

The source-controlled project lives in `ios/FieldLookup` and uses XcodeGen to generate the Xcode project from `project.yml`.
The project has an iOS application target, a unit-test target, and an XCUITest target.
It targets iOS 17 and pins `supabase-swift` exactly at 2.54.1.

Supabase Swift owns the Google PKCE flow, token refresh, and session persistence.
The app supplies `KeychainLocalStorage` with the service `com.tztcg.fieldlookup.auth` and storage key `field-lookup.supabase.session`.
Sign-out removes the local Supabase session, the pending PKCE verifier, and the complete field-lookup cache even when the remote logout request fails.

The lookup repository makes read-only PostgREST requests with the public publishable key and the current user's bearer token.
It never holds a service-role credential.
Every lookup revalidates the user ID and requires the JWT role `administrator` before issuing a data request.
The UI gives separate denial messages to `buyer`, `unmapped`, legacy `authenticated`, and unknown roles because Google authentication alone is not operator authority.

Search first reads `pokemon_card_definitions_operator_v`, then reads raw tier-1 grade-0 rows from `pokemon_price_summaries_browser_v` for the returned card IDs.
Searching the definition view before the summary view keeps an exact printing visible when it has no price-summary row.
The native text subset mirrors the browser token rules in `lib/card-search.ts`: `[%,()*]` are scrubbed, whitespace creates tokens, and every token must match at least one of regional name, English name, variant, printed number, or set code.
The first native increment intentionally omits UID and external-platform identifier paste because its operator journey is name and printed-number lookup.
Identity remains the returned catalog `card_id`, `card_uid`, set code, and printed number rather than a name-only guess.

The summary contract uses `best_sell_*` as the entry ask and `best_buy_*` as the exit signal.
The app renders the returned entry and exit regions in their actual order, so a winning `NA -> JP` row is not relabeled as `JP -> NA`.
It labels the exit kind as sold comp, shop bid, valuation, ask, or unknown and explains when a number is not a current shop offer.
The API stores ROI in percentage points, so a returned value of `50` renders as `50%` rather than being multiplied by another 100.
ROI is displayed only when both summary legs exist.

`owned_inventory_counts_v` is read independently for the returned card IDs.
A successful inventory request with no row means a known zero.
A failed inventory request means unknown stock and remains visibly different from zero while the price result stays usable.
The displayed quantity is labeled as a catalog total across raw and graded holdings for the exact printing.

## Cache contract

The JSON cache lives under the app's Application Support directory with complete-unless-open file protection.
It stores at most 12 searches and 40 results per search.
Each record includes the normalized query, original query, user ID, save time, complete result, and original summary refresh timestamp.
A cached response becomes visibly stale after six hours and expires after seven days.
Expired records are removed instead of being presented as current data.
Only a network failure can fall back to cache.
HTTP authorization failures, an expired session, and a changed user clear local cached operator data and require sign-in.
Activating a different user or signing out clears the prior user's complete cache.

## Freshness language

`pokemon_price_summaries_browser_v.updated_at` is labeled `Summary refreshed`.
The current summary API does not expose the raw observation time for the winning source quote, so the detail view says `Source observation time is unavailable from the summary API`.
Cached results retain both their cache save time and the summary refresh time received with the original response.

## Local setup

The app requires macOS with Xcode 16.3 or newer and XcodeGen.

1. Copy `ios/FieldLookup/Config/Secrets.xcconfig.example` to `ios/FieldLookup/Config/Secrets.xcconfig`.
2. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the same public project values used by the browser.
3. Add `com.tztcg.fieldlookup://auth-callback` to the Supabase authentication redirect allowlist without changing the Google principal mapping.
4. Run `cd ios/FieldLookup && xcodegen generate --spec project.yml`.
5. Open `FieldLookup.xcodeproj` and run the `FieldLookup` scheme on an iPhone simulator.

`Secrets.xcconfig`, the generated Xcode project, test result bundles, and exported artifacts are ignored by Git.
The example writes URL separators as `:/$()/` because Xcode build settings would interpret a literal `//` as an inline comment; the expanded Info.plist contains the ordinary `://` URL.
The app presents a setup screen when a required public value is absent rather than attempting authentication with an invalid endpoint.

## Verification

The path-scoped `iOS Field Lookup` workflow runs on a macOS runner with `contents: read`, generates the project, resolves the exact package version, and runs the application, unit, and UI targets on an iPhone 16e simulator at exactly 390 by 844 logical points with signing disabled.
Its fixtures cover both region directions, sold, bid, and valuation exits, a missing exit quote, a card with no summary, known-zero and unknown inventory, Japanese token search, cache freshness and expiry, user change, sign-out clearing, session expiry, offline recovery, and retry.
XCUITests retain native phone screenshots for Japanese detail, freshness, stale offline data with unknown stock, retry recovery, expired-session recovery, and loading state.
The workflow uploads the screenshots and complete `.xcresult` as a short-lived artifact and does not receive repository secrets.

## Operational boundary

No migration, cloud write, local database mutation, live source request, scheduler change, device signing, or App Store action is part of this increment.
Before distributing to a real device, an operator still needs an Apple developer signing setup and the documented public Supabase configuration.

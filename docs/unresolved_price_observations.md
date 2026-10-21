# Unresolved price observations

## Purpose

The Source Health view lets an operator inspect verified buylist prices that recognition could not bind to a catalog identity.
The panel explains what the system saw without presenting the observation as a candidate, listing, valuation, or alert.

The goals are complete cell provenance, every verified price tier, explicit unknown identity, honest grade state, readable crop evidence, and usable desktop and phone layouts.
The non-goals are resolving the identity, editing evidence, lowering a match threshold, or triggering any financial action.

## Architecture

`lib/unresolved-buylist-observations.ts` is the strict browser-side parser for the operator RPC.
It rejects malformed identity, eligibility, digest, geometry, grade, and price evidence before the view renders it.
It also creates the complete two-part keyset cursor used for pagination.

`app/dashboard/UnresolvedPriceObservationsPanel.tsx` calls `list_unresolved_buylist_price_observations` through the authenticated Supabase client.
The first and later requests use a page size of 24.
The panel is embedded in `SourceHealthView`, so its stable app path is `/dashboard?view=health`.

Each evidence card shows the source account and time, image and cell ordinal, product kind, explicit unknown identity, grade state, variant, every price and tier, association method and OCR confidence, source and calibrated geometry, full content digest, policy and routing receipt, source-post link, and same-origin crop previews.
Raw singles may say that grade was not observed.
Observed singles name the grade, and sealed observations say that grade is not applicable.

The browser never reads `buylist_media_routing_outcomes` directly.
The database RPC enforces operator membership and returns only the bounded evidence projection.
Anonymous users are redirected by the dashboard guard, ordinary authenticated users receive an authorization error, and direct table reads remain denied.

## Responsive behavior

Cards use one column on narrow screens and two columns only at the extra-large breakpoint.
Long source digests, policies, geometry, and variants wrap within the card instead of widening the page.
The source link, reload control, and pagination control provide at least a 44px phone target.
Crop previews use the existing authenticated same-origin image proxy and the stored source dimensions and boxes.

## Acceptance

Component tests cover loading, empty, error, pagination, every price tier, crop URLs, grade absence, observed grade, sealed semantics, and operator-facing eligibility text.
Parser tests cover the complete contract and reject fabricated identity or financial eligibility, invalid geometry, bad digests, and inconsistent grade states.

The browser journey runs against isolated PostgreSQL, GoTrue, PostgREST, and Next.js processes.
It proves anonymous redirect, ordinary-user denial, operator sign-in, a 24-row first page, a sealed row on the next page, retained 110,000 JPY and 74,000 JPY tiers, crop rendering, provenance text, 390px phone behavior, 44px controls, and no page-level horizontal overflow.
The journey performs only test-fixture writes and removes its containers, network, volume, auth files, and `.next` output on exit.

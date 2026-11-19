# Card detail loading

`CardDetailModal` reads listings, holdings, incoming inventory, source lots, purchases, observations, ROI and market evidence for the opened card.
The result is published once, after any required location-cache refresh has completed.
Each result carries a request identity made from the card object, game, open state and owned-inventory version.
A result is rendered only while that exact identity is current, so changing cards, closing/reopening, returning through A -> B -> A, or refreshing inventory cannot reuse old holdings or source-lot sale controls beneath the current heading.
The inventory header shows a loading placeholder while its result is pending instead of claiming the previous card's holdings or zero stock.

The committed identity also fences asynchronous publication and exposure recording before passive-effect cleanup.
Cleanup aborts the effect's per-card PostgREST reads.
The rate, condition and location helpers keep their shared session-cache work; a card's cancellation never aborts those requests.
Cancellation guards remain necessary because responses can finish despite an aborted transport.

The resolved location map is used both for listing labels and `detailOpportunityPayloads`.
This applies the existing indicator-source exclusion policy to newly discovered locations, including Collectr and 130point.
Only a completed current Pokemon load records opportunities; MTG does not.
The price normalization, matching rules, currencies, source classification, accounting RPCs, sale writes and target-price writes are unchanged.
Grade-evidence requests have their own lifecycle and are outside this change.

## Regression evidence

`CardDetailModal-loading.test.tsx` renders the real modal and listing tables with deferred Supabase transport and controlled shared metadata responses.
It covers A -> B and A -> B -> A, obsolete metadata after the next card completes, close/reopen/unmount, inventory refresh, the same card ID across games, owned-request abortion, transports that ignore abort, shared metadata completion, current source labels and indicator exclusions.
The existing variant, target-price and opportunity-payload tests run alongside it.
The original source failed 12 of the initial 13 lifecycle cases; its normal MTG case passed.

The browser fixture uses the real modal and providers with a native close/open interaction while location and listing responses are held.
The initial desktop control displayed three old-card history nodes under the new heading.
Its ordinal location-request delay could target the separate grade panel, so that first run did not establish exposure timing.
The corrected fixture warms the real shared location cache before opening a card and verifies that no exposure exists while the missing-source refresh is held.
With that protocol, the original source cleared the next card's loader and recorded the old card exposure after its refresh was released.
The corrected source passed both 1440-by-900 desktop and 390-by-844 phone journeys, recording only the current card's exposure with its resolved shop and unchanged USD amount.
All Supabase traffic is intercepted dummy transport; this proves the client lifecycle, not hosted database or accounting acceptance.

Run the controlled desktop and phone journey with installed dependencies and Chromium:

```bash
E2E_HEADED=1 xvfb-run -a bash scripts/e2e/run-card-detail-load-fixture.sh
```

The runner uses the shared browser lock, a temporary loopback Next development server, bounded response gates and process-group cleanup.
The fixture returns 404 in production and without `E2E_FIXTURES_ENABLED=1`.
Unexpected external requests and mutation RPCs are rejected; only intercepted opportunity-exposure payloads are accepted for inspection.
Screenshots, diagnostics and results are written to the reported `/tmp/tcg-card-detail-browser-*` directory.

# Shared dashboard metadata

`fetchRateMap`, `fetchConditionsCache`, and `fetchLocationMap` in `app/dashboard/use-card-data.ts` supply exchange rates, condition tiers, and shop names/market regions to dashboard consumers.
They retain their existing public signatures and mappings.
The cache lifetime remains the loaded browser session.

## Recovery and request sharing

`lib/session-cache.ts` stores each successful value and shares one pending load among concurrent readers.
Successful empty tables are valid cached values.
A Supabase error still returns the existing empty map or empty condition result to current callers, avoiding new unhandled rejections in existing consumers.
That fallback is not cached, and the pending request clears on both success and failure, so a later caller can recover.
Unexpected thrown exceptions retain their rejection behavior and also release the pending request.
Recovery happens on the next call; this does not add background polling or automatically rerender a consumer that already received a fallback.

`refreshLocationMap` discards the previous value and supersedes an ordinary pending location load.
Concurrent refresh callers and ordinary readers arriving during the refresh share the replacement load.
An older request may still resolve for its original callers, but only the current request can write the cache or clear its pending state.
Shared metadata requests are never attached to a card or modal's abort controller.

This fixes session-long empty metadata after transient HTTP failures and duplicate simultaneous requests without changing exchange-rate conversion, condition-tier ordering, location normalization, authentication scope, or price policy.
No TTL, persistence, schema change, dependency change, or live database operation is involved.

## Verification

Run `npm test -- --maxWorkers=2 app/dashboard/use-card-data-metadata-cache.test.ts`.
The tests use the real configured Supabase browser client, its request wrapper, and PostgREST decoding with controlled HTTP responses at the fetch boundary.
They cover transient errors, ten concurrent consumers, valid empty results, unexpected rejection recovery, and location refreshes finishing out of order.
The original helpers failed 11 of the initial 14 regression cases, including ten GETs per table for ten concurrent callers and an old location response replacing a refreshed cache.
The fixed helpers need one GET per table for that same concurrent load.

A local Firefox run also exercised the real browser client through controlled loopback HTTP responses.
Seven original-behavior checks reproduced the three error-poisoned caches, three ten-request concurrent loads, and the stale location overwrite.
The same seven checks on the fixed helpers recovered on the next call, sent one read per table for ten concurrent callers, and retained the refreshed location.
All 14 browser checks completed with no skips or page errors; the temporary browser and HTTP server were closed afterward.
This is transport/cache acceptance, with no new user interface or live service mutation.

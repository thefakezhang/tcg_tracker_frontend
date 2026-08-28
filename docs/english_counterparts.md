# Pokemon English counterpart review

## Goal

The Pokemon catalog lets an operator understand whether a Japanese printing has one evidence-backed English counterpart and whether the cross-market raw or exact-PSA comparison is complete and profitable.
The interface keeps unknown data visible and routes ambiguous candidates to review without inventing a name-only mapping.

## Architecture

`app/dashboard/english-counterpart.tsx` defines the PostgREST read model, paginated loader, SWR hook, review RPC helper, and compact mapped-state panel.
The expanded mapped panel recognizes the immutable validated automatic evidence envelope and shows both productIds plus the release report, candidate artifact, automatic evidence, artwork-review, and row-proof digests.
An exact mapping with no current prices shows `refresh_required` and keeps profit unknown while its enrolled refresh is pending.
`CardBrowser.tsx` fetches counterpart rows for each visible page of Japanese Pokemon cards.
`columns.tsx` renders the compact panel in the desktop table, and `CardDetailModal.tsx` renders the complete panel in card detail.
`app/dashboard/EnglishCounterpartReviewView.tsx` paginates the unbounded review view and owns the operator form.
`views.tsx` exposes the review queue as the Pokemon Catalog `Counterparts` view.
`app/dashboard/EnglishCatalogReviewView.tsx` paginates catalog candidates and import receipts, renders exact coverage and load, and owns versioned catalog decisions.
`views.tsx` exposes that queue separately as `English catalog intake` so product admission is not confused with Japanese-to-English release mapping.
English definitions remain available to these counterpart surfaces without becoming ordinary Japanese match targets.
The Pokemon Match Review `Match existing` picker constrains results to the pending candidate's language, defaulting a missing Pokemon language to `jp`, so TCGCSV English definitions cannot be attached to Japanese source identities.

Both loaders use the shared PostgREST pagination helpers, so neither assumes the default response cap is the complete result set.
The browser never writes counterpart base tables directly.
Exact, no-counterpart, reject, and retry decisions call `review_pokemon_english_counterpart` with the candidate UID and current review version.
Catalog confirm and reject decisions call `review_pokemon_english_catalog_candidate` with the exact candidate key, current review version, HTTPS evidence, and note.

## Operator states

An exact mapping shows the English name, set code, card number, variant details, confidence, identity basis, evidence link, decision note, reviewer, and review time.
Raw comparison rows show the exact normalized tier, and slab rows show the exact PSA grade.
Each axis renders two non-blended US signal groups.
`Current market / ask` shows one deterministic normalized listing price with its source, same-row observation time, and eligible listing count.
`Realized sold comps` shows the 90-day individual-sale median, source provenance, latest sale time, and sample count only when at least three exact-printing sales exist and the newest is no older than 30 days.
130point supplies clean raw or exact integer-PSA sales, while Card Ladder supplies individual exact-PSA sales; non-PSA slabs are excluded.
Current Card Ladder, Collectr, and PriceCharting projections never enter either individual-sale evidence or the current-ask signal.
Each complete row also shows the conservative decision basis, liquidity penalty, net exit, net profit, ROI, and the Japanese acquisition denominator.
The decision uses the lower of current ask and complete realized median and never averages the two classes.

Missing mapping, Japanese price, current US ask, realized comps, FX, or cost profile displays an explicit `Unknown` message.
An insufficient or stale realized sample retains the current ask as a labeled display fallback but leaves profit and ROI unknown.
The interface does not substitute zero and does not label incomplete data unprofitable.
Review and failed states show their candidate counts and route the operator to the queue.
An unavailable read is distinguishable from a pending resolution.

The review queue shows both proposed physical printing tuples, retained evidence and provenance, confidence, optimistic version, failure code, and profitability completeness.
Artwork-exclusive cards carry a strong no-counterpart warning.
Stamp-only cards explain that an exact mapping remains possible when evidence proves the underlying English-art printing.
Exact and no-counterpart actions stay disabled until the operator supplies a valid HTTPS evidence URL and a decision note.
An exact action also requires an English card ID and cannot silently accept an alternate name-only guess.

## English catalog intake states

The catalog-intake surface presents imported, ambiguous, no-product, and rejected states separately.
Every row shows the reviewed TCGplayer group, canonical English set code, complete normalized collector number, raw source number, exact TCGplayer productId, imported card ID, reason, source and crosswalk evidence, and evidence digest.
The productId link is the canonical external identity.
SKU is deliberately absent because condition and finish SKUs are attached later by the existing registrar.

Ambiguous products stay in operator review for same-number siblings, reverse holos, stamps, multiple images, rarity or variant uncertainty, name disagreement, or other exact-product conflicts.
Confirm and reject actions remain disabled until a valid HTTPS evidence URL and note exist.
No-product rows explicitly say that a reviewed group has unknown retained coverage and is neither rejected nor unprofitable.
No durable import receipt displays coverage as unknown rather than zero.

The latest receipt panel keeps auto-import, review, and no-product counts separate.
It also displays source group and product counts, reviewed groups, external requests performed by import, estimated manual feed requests, retained bytes, and estimated definition, TCGplayer identifier, candidate, and event rows.
Both candidate and receipt reads page past the PostgREST cap.

## Responsive and accessibility contract

The mapped and unknown panels wrap long identity and evidence content without widening the page.
The review card switches from a two-column comparison to a stacked phone layout and keeps all controls at least 44 pixels high.
State buttons, evidence links, fields, and decision actions are keyboard focusable and have accessible labels.
The controlled browser fixture checks 1440 by 900 and 390 by 844 viewports, no horizontal overflow, zero page errors, and no database or external request.
It also checks 44-pixel catalog review actions on phone, exact product links, source/load labels, disabled actions without evidence, enabled actions with evidence, and explicit no-product unknown posture.

## Validation

Component tests cover exact mapping, separate current-ask and realized-sold-comparable panels, exact raw and PSA axes, missing or insufficient realized evidence as unknown, conservative decision basis, ambiguity without a guess, read failures, pagination past the PostgREST cap, versioned RPC arguments, artwork and stamp posture, failed retry, catalog partition and load, no-product unknown state, catalog pagination, catalog decision validation, and exclusion of English definitions from a Japanese Match Review picker.
The controlled browser journey is invoked with:

```bash
npm run test:e2e:english-counterparts
```

Durable result JSON and screenshots are stored under `docs/evidence/english-counterparts/` for desktop and phone mapped, unknown, counterpart review, catalog review, and catalog no-product states.
The retained mapping partition currently contains 64 validated mappings and 30,095 review-only rows.
The UI reads those rows through paginated PostgREST helpers so the server row cap cannot silently truncate either operator surface.
The fixture route is enabled only when `E2E_FIXTURES_ENABLED=1` and returns not found otherwise.

## Non-goals

- The frontend does not resolve identity itself.
- It does not compare non-PSA graders.
- It does not scrape or refresh a market source directly.
- It does not reclassify Japanese artwork or stamp exclusivity.
- It does not fabricate a profitability result from incomplete inputs.

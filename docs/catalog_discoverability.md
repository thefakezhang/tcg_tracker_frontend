# Catalog discoverability interaction contract

## Goals

The G8-G11 catalog discoverability flow lets an operator find one card by English name, regional name, card number, internal UID, or exact external platform identifier.
The same result must remain operable with a pointer or keyboard on desktop and phone layouts.
A temporary external-identifier lookup failure must preserve useful context and provide a safe recovery path.

## Architecture

`externalIdMatches` is the shared exact external-identifier resolver used by Card Browser and both Card Index game views.
It converts lookup service failures into a typed error with stable, operator-safe copy.
`QueryError` classifies that error, renders an accessible alert, and provides Retry without exposing database table names or raw service details.
Card Browser retains the last successfully loaded page while an external-identifier retry is available.
The SWR-backed Card Index views retain their previous successful result through `keepPreviousData` and render the same recovery alert beside it.

Desktop Card Browser results use the `DataTable` actionable-row contract.
Phone Card Browser results implement the same contract on their card container.
Both surfaces expose a meaningful accessible label, a visible focus state, and equivalent pointer, Enter, and Space activation.
Keyboard events from nested controls do not open card detail.

## Non-goals

This flow does not perform partial matching of opaque platform identifiers.
It does not hide authorization or generic query failures behind external-identifier copy.
It does not cache a failed external-identifier response or fabricate an empty result state.

## Verification and evidence

Component tests cover desktop row and phone card activation by pointer, Enter, and Space, including isolation of nested controls.
Query and card-search tests cover typed safe errors, accessible alerts, retained results, raw-cause suppression, and Retry.
The authenticated `scripts/e2e/g8-g11-catalog-discoverability.mjs` acceptance flow exercises these contracts at 1440-pixel desktop and 390-pixel phone widths.
It also intercepts the exact external-identifier request, proves the previous result remains visible, verifies the raw failure is absent, restores the route, and retries the same identifier successfully.

The remediation component suite passed locally with 43 tests and no skips on 2026-08-06.
The browser acceptance script was updated for the remediation but has not yet been run against a deployment containing this change.
Deployment screenshots and the authenticated browser result therefore remain a rollout gate, not completed evidence.

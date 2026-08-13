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
The authenticated `scripts/e2e/g8-g11-production-cdp.mjs` production acceptance flow attaches to a fresh app-scoped Edge session after interactive login.
The operator parks its sole anchor page at `about:blank` before launch so authentication cookies remain available without any live application hydration.
The runner refuses any other starting page state and installs its context-wide REST mutation firewall before the first application navigation, user-agent check, or revision check.
It records a per-surface and per-viewport matrix for Card Browser and Card Index at 1440x960 desktop and 390x844 phone viewports.
Each surface proves exact English name and number, Japanese name and number, full uid, and external-id lookup resolve to the same Iono identity.
Each surface exercises pointer, Enter, and Space activation, then forces the exact external-identifier request to fail and proves the prior result remains visible, the safe alert hides raw details, and Retry restores the same request and identity.
The flow captures pre-Retry and post-Retry screenshots, runtime viewport metadata, a runtime-observed deployed revision, assertion results, and artifact SHA-256 digests.
It intercepts opportunity-exposure RPCs with a mutation firewall and records the blocked request count so the acceptance journey cannot change production data.
The manifest derives its allowed-mutation count from every observed non-read REST request that was not handled by the firewall and fails if that count is nonzero.
The Card Index edit action is explicitly named and uses a 44x44 phone target while retaining its compact desktop size.

The remediation component suite passed locally with 43 tests and no skips on 2026-08-06.
The partial 2026-08-13 production run proved both exact-search surfaces and desktop recovery, but did not execute Card Index activation or phone recovery and exposed the undersized Card Index phone action.
Deployment of the corrected action followed by a complete run of the new matrix remains the rollout gate.

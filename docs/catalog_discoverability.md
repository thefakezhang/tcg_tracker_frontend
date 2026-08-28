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

`identifierOrParts` decides whether a term is an identifier paste (a full UUID, the displayed 8-hex uid prefix, or a term that resolved to exact external ids) rather than free text.
`smartSearchFilters` is built on it, so every surface classifies a term the same way instead of keeping a second copy of the rule.

An identifier paste must resolve to its card regardless of any catalog partition the surface would otherwise scope to.
The match review picker scopes its catalog to the candidate's language, which is correct for a text search: it keeps the `jp` and `en` partitions out of each other's picker so a curator cannot bind a Japanese candidate to an English counterpart definition by typing a name.
It is wrong for an identifier, which already names one specific card, so the scope can only hide the row the curator explicitly asked for.
It was also silently fatal for candidates in a language the catalog has no partition for: `kr` holds one card and `cn` and `tw` hold none, so those pickers returned nothing whatever was typed, a correct uid included, and an empty picker is indistinguishable from "no such card".
The language scope is therefore applied to text terms only.

Desktop Card Browser results use the `DataTable` actionable-row contract.
Phone Card Browser results implement the same contract on their card container.
Both surfaces expose a meaningful accessible label, a visible focus state, and equivalent pointer, Enter, and Space activation.
Keyboard events from nested controls do not open card detail.

## Non-goals

This flow does not perform partial matching of opaque platform identifiers.
It does not hide authorization or generic query failures behind external-identifier copy.
It does not cache a failed external-identifier response or fabricate an empty result state.
Exempting an identifier paste from a partition scope is not a general widening of that scope: a text search stays scoped, so the cross-partition guard the scope exists for is unchanged.

## Verification and evidence

Component tests cover desktop row and phone card activation by pointer, Enter, and Space, including isolation of nested controls.
`MatchReviewView.test.tsx` pins the identifier rule against the real failing case, a Card Ladder Korean slab: a uid prefix and a full uuid both resolve to a Japanese catalog row, while a text term on the same candidate stays scoped and does not.
Each of the two identifier assertions fails if the scope is reapplied to pastes.
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

The final harness and component suite passed locally with 54 files and 280 tests, with no skips, followed by successful TypeScript validation.
The authenticated 2026-08-13 production run passed the complete matrix at deployed frontend revision `61fca660c9c9831178f491c83e95ef500ab849b8`.
It covered Card Browser and Card Index at 1440x960 desktop and 390x844 phone viewports, all four exact identities, pointer plus Enter plus Space activation, retained-result failure recovery, touch sizing, alert fit, and no-overflow checks.
The pre-navigation firewall reconciled all 61 observed REST mutations to 61 blocked requests and zero allowed production mutations.
The credential-free result manifest is bound by SHA-256 `3e0704864dc80dca4b7ac2001e3a1050e5a2025ab3d694b7ecf0a91aca177744`.
Independent CUJ and operator-UX reviews passed with no remaining acceptance gate.

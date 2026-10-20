# Twitter designed-buylist review

The designed-buylist review flow lets a signed-in curator authorize one Pokemon singles or sealed BID candidate after inspecting the exact server-bound source crop and displayed values.
It does not rewrite the immutable Twitter routing outcome.
The resulting backend decision and listing effect provide a separate durable authority for matched-item alert admission.

## Goals

- Render the exact current server review document rather than rebuilding authority-bearing values from unrelated browser queries.
- Bind the displayed candidate, catalog identity, grade or condition, variants, BID price, source content, dimensions, geometry, and crop hashes to one server SHA-256.
- Let a curator affirm unchanged displayed values or submit explicit corrections through one single-item approval.
- Detect a stale document before mutation and require a visible reload and a second approval action.
- Keep singles and sealed behavior aligned on desktop keyboard and phone touch paths.

## Non-goals

- The flow does not turn blind batch promotion, auto-accept, service-role, or owner actions into alert authority.
- It does not make account configuration or tweet wording prove Pokemon identity.
- It does not activate an alert recipient, production schedule, live source poll, or migration rollout.
- It does not replace the strict automatic printed-identity path.

## Browser flow

`CurationView` and `SealedCurationView` request `get_twitter_buylist_review_document` for the selected candidate.
The response parser rejects an unknown schema, mismatched candidate, inconsistent projection, malformed source dimensions or geometry, and any source URL that does not bind the declared content SHA-256.
The views render the returned projection and source crop and keep the ordinary approval control disabled until the evidence is complete and renderable.

Approval calls `approve_twitter_buylist_review` with the candidate kind and ID, expected document SHA-256, a request ID, and nullable corrections.
Null values affirm the values in the displayed server document.
A stale-document response clears the approval attempt, reloads the current document, and asks the curator to review it again before another click or keyboard action.
The bulk acceptance flow remains on its existing tokenless RPC and cannot acquire reviewed alert authority.

## Verification

Focused component tests cover singles and sealed document loading, unchanged and corrected approvals, stale reload, geometry and dimension refusal, and keyboard gating.
The whole-journey browser fixture starts a labeled disposable PostgreSQL 17 container, applies the frozen backend migrations, and seeds two candidates retained from the ordinary Cardrush producer replay.
It serves the original retained JPEG only after verifying its pinned SHA-256, and the production review cards render that content-bound source through a loopback gateway.
The gateway is only an HTTP adapter: canonical review documents, stale digest rejection, authenticated approval, immutable decisions and listing effects, generated enqueue, due selection, and Claim all execute against PostgreSQL and the generated backend queries.

The desktop journey changes the current effective price after the first document is rendered, proves the first keyboard approval fails with PostgreSQL `40001`, reloads the new server document, and requires a second action.
It then proves that the alert keeps the original detector price separate from the curator-approved effective BID price.
The 390 pixel phone journey reviews a second candidate from the same retained sheet through touch input.
Both journeys audit external requests, minimum target size, horizontal overflow, and console or dialog failures, and stop at the claimed non-sending worker boundary.

The fixture requires an explicit coordinator reservation for its Docker and browser lane.
It asserts the exact backend and data revisions, overrides `.env.local` with loopback values, refuses a non-isolated data root, and never starts the shared Supabase stack or contacts a live source.
It also supplies local Next font responses so page compilation cannot contact Google Fonts.

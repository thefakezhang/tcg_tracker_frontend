# Shared review behavior and on-demand workspaces

The singles and sealed image-curation screens share one queue and review implementation.
The goal is to remove duplicate behavior while preserving the existing database contracts and operator controls.

`curation-workspace.tsx` owns queue loading, filters, selection, keyboard commands, mutations and batch results.
`curation-candidate-card.tsx` owns each candidate's editable review state.
`curation-images.tsx` owns crop previews and lightboxes.
`curation-model.ts` defines the shared presentation shape, while `curation-adapters.ts` supplies the game-specific tables, projections, search behavior, conditions and RPC names.
The original screen entry points and exported candidate-card callback shapes remain available to callers and tests.
Singles still starts in `needs_review`; sealed still starts in `pending`.
Approval, correction, geometry, rejection, undo and batch operations retain their original backend parameters.

Dashboard metadata stays in `views.tsx`, shared by routing, sidebar and header.
Its components load with `next/dynamic` when selected, as do the page's browse, trip and buylist surfaces.
`ViewLoading` provides a translated status while a workspace chunk loads.
URL hydration and view-selection precedence remain unchanged.

The image-export proxy uses `decideProxyUrl` for both the initial URL and each redirect destination.
The route preserves authentication, image response checks and private caching, while bounding redirects and sharing one request deadline.
Route-level tests exercise the handler rather than only the standalone policy.
Host validation is textual; this change does not introduce DNS resolution or rebinding protection.

This consolidation changes no schema, pricing, catalog identity, curation admission rule or live data.
It does not establish new source-accuracy or end-to-end production acceptance claims.

# Public want list page (`/wantlist`)

## What it is

A public, unauthenticated page rendering the standing JP singles want list - set, card number, Japanese and English name, rarity, condition wanted, and a card image.
It replaces an Artifact that could not be shared because it exceeded the sharing reviewer's size budget at 12.65 MB.

## Architecture

- `app/wantlist/page.tsx` - server component, `export const dynamic = "force-static"`.
  It imports `lib/wantlist/cards.json` at build time and renders the client component.
- `app/wantlist/WantList.tsx` - client component holding the three interactive pieces: search, the per-viewer check-off tracker, and the image lightbox.
- `app/wantlist/wantlist.module.css` - the page's own palette, scoped to its wrapper.
- `lib/wantlist/cards.json` - the data (688 rows). It carries **no set code**: that is an internal identifier, so it is stripped from the published data rather than merely hidden, and sets are grouped by name and year instead.
- `public/wantlist/wl-NNNN.webp` - a 420px rendition the lightbox opens on demand.
- `public/wantlist/wl-NNNN-t.webp` - a 128px thumbnail for the grid. 660 of these load on one page, so the grid never pays for the full-size copies.

The page makes **no runtime database call** and uses **no Supabase key**.
Everything is baked at build time, so an anonymous visitor gets static HTML plus static images and nothing else.

## Justification

The data plane is already closed to anonymous callers: every public table has RLS enabled and the `anon` role holds zero privileges on all 257 tables, 67 views and 6 partitioned tables.
A page that queried Supabase from the browser would therefore have needed new anon grants - widening the very surface that is currently shut.
Static generation avoids that entirely: no grant, no key, no query.

Three supporting changes ship with it, because a public page changes their risk:

- `app/api/proxy-image/route.ts` now requires an authenticated session.
  Middleware only guards `/dashboard`, so before this the route was an open proxy on a public origin - an arbitrary-URL `fetch` usable as an internal-port oracle and as free bandwidth serving arbitrary bytes from our domain.
  It also blocks private and link-local hosts, caps the body at 8 MB and times out at 10s.
- `next.config.ts` sets CSP `frame-ancestors 'none'`, `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy` and HSTS on every route.
- `middleware.ts` excludes `/wantlist` from the matcher, so an anonymous hit does not pay a Supabase `getUser()` round trip and static delivery is preserved.

## Goals

- Replicate the shared artifact faithfully, at better fidelity than the artifact managed.
  Serving images as files instead of inlined base64 removes the size ceiling, so the full-resolution images and the tap-to-zoom lightbox are both restored.
- Zero runtime coupling to the database.
- Swappable dataset: replacing `lib/wantlist/cards.json` and the matching files in `public/wantlist/` changes the list without touching page code.

## Non-goals

- **Not** a live view of the want list. It is a build-time snapshot; the `UPDATED` date in `page.tsx` states which.
- **Not** personalised. The check-off state is `localStorage` only, per viewer, per browser - it never reaches the server and is not shared between viewers.
- **Not** a source of pricing. No prices, ROI, margin, selection rationale or `card_uid` appears on the page, deliberately: `card_uid` is the argument the anon-executable `card_index_merge_pokemon_unlinked_refs` RPC needs, and publishing one would supply it.

## Regenerating the list

Replace `lib/wantlist/cards.json` (see the `Card` type in `WantList.tsx`) and the images in `public/wantlist/`, then update `UPDATED` in `app/wantlist/page.tsx`.
Image files are referenced by the `img` field on each row; a row with `img: null` renders the hatched placeholder.

## What the page publishes, and what it does not

The page carries a **subset** of the internal want list, not all of it.
The list is ranked on a combined score of realised margin percentage and liquidity (TCGplayer 60-day sales and listing counts, plus 130point realised US sales), pinned to the JP-acquire / US-exit leg.
The better-scoring half is withheld and never reaches the page; what publishes is the remainder, above a $4 minimum US sale value, plus the vintage `OLD-*` and Pokekyun `CP3` blocks in full.

This is deliberate. The full list encodes which cards are worth arbitraging and is competitively sensitive; the published subset is the part where a better acquisition price, not a private edge, decides the trade.
Regenerating the page from the full list is a one-file change, so the split has to be re-applied whenever the data is refreshed.

## Image pipeline

Images come from the R2 mirror of snkrdunk scans recorded on `pokemon_card_definitions.image_url`, refetched at source resolution (421-868px, median 437).
Two bugs shaped this pipeline and both are guarded against:

- **The identity key is ambiguous.** `(set_code, card_number, regional_name)` is not unique - foil and printing variants share it and differ only by `misc_info`, and 131 of 1,558 want-list keys resolved to multiple definitions with conflicting `image_url`s.
The fetch orders candidates so the base printing (`misc_info` NULL or `UNKNOWN`) is preferred, and falls through to the next candidate when one is unusable.
- **Some variant images are screenshot captures, not scans.** They arrive as 1000x730 landscape frames with 35-63% black padding, which `object-fit: cover` crops into a slab of black.
The fetch rejects any candidate that is landscape, more than 30% black, or near-uniform; 26 cards ended up with no usable candidate and render the hatched placeholder, which is the honest result rather than a black tile.

Do not reintroduce a single-size image set: an earlier cut inlined 118px thumbnails, which the lightbox then upscaled 2.5x.

## Known limitation

Vintage rows from the vending-machine series have no orderable card number - the series prints none, so the source list carries `旧裏` as a placeholder.
Those rows are identifiable by set, name and image only.

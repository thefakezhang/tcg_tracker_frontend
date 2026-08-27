# Public want list page (`/wantlist`)

## What it is

A public, unauthenticated page rendering the standing JP singles want list - set, card number, Japanese and English name, rarity, condition wanted, and a card image.
It replaces an Artifact that could not be shared because it exceeded the sharing reviewer's size budget at 12.65 MB.

## Architecture

- `app/wantlist/page.tsx` - server component, `export const dynamic = "force-static"`.
  It imports `lib/wantlist/cards.json` at build time and renders the client component.
- `app/wantlist/WantList.tsx` - client component holding the three interactive pieces: search, the per-viewer check-off tracker, and the image lightbox.
- `app/wantlist/wantlist.module.css` - the page's own palette, scoped to its wrapper.
- `lib/wantlist/cards.json` - the data (1,569 rows).
- `public/wantlist/wl-NNNN.webp` - one image per card, served as static files.

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

## Known limitation

176 vintage rows have no orderable card number - the vending-machine series prints none, so the source list carries `旧裏` as a placeholder.
Those rows are identifiable by set, name and image only.

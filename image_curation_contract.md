# Image Curation — Frontend Contract

This is the backend ↔ frontend contract for the **image-buylist curation** UI. It
is the source of truth for what the dashboard can read, write, and call.

The whole interface is **live on the Supabase project now**, against an **empty
schema**: every table, policy, and RPC below already exists, returns correct
empty results today, and starts producing real data once the backend pipeline
loads candidate rows. You can build the entire UI against it before any data
exists. Nothing here requires a Go service — it's all Supabase (PostgREST + RPC).

Backend migrations: `000051` (candidate tables), `000062–000064` (RLS/auth),
`000066` (buyer locations), `000067` (curation RPCs).

---

## 0. What this feature is

A buyer (JP card shop) tweets a grid screenshot of cards they're buying at listed
yen prices. The backend segments each cell, OCRs the price, and tries to match the
card, writing one **candidate** row per cell. A human **curator** reviews the
queue in this UI: confirm/fix the match, then **approve** (→ becomes a real buy
listing) or **reject**. Approved crops also feed the image matcher later (backend
job, not your concern).

Two product kinds, same shape:
- **Singles** → `pokemon_image_buylist_candidates` → promotes to `pokemon_market_listings`
- **Sealed** → `pokemon_sealed_image_buylist_candidates` → promotes to `pokemon_sealed_market_listings`

Both are in scope for v1.

---

## 1. Auth & access model

- The app is **login-gated** (it already is). Every request runs as the
  `authenticated` role; `anon` has **no access to anything** (revoked).
- All curation tables have RLS with permissive `USING(true)` for `authenticated`
  — **any logged-in user is a curator** (no per-user ownership in v1).
- **You may NOT write `status` or `promoted_listing_id` directly** — those columns
  are revoked. All status changes and promotion go through the RPCs in §4. The
  DB rejects a direct `.update({ status })`.

---

## 2. Reading the queue

Read candidates directly via PostgREST, filter by `status`, order by `created_at`,
paginate. Embed the matched card via the FK.

```ts
// Singles queue, pending first, with the matched card joined in
const { data, error } = await supabase
  .from("pokemon_image_buylist_candidates")
  .select(`
    candidate_id, cell_image_url, ocr_price_jpy, price_increased,
    candidate_card_id, match_method, confidence,
    match_score_features, match_score_embedding, match_score_text,
    card_grading, variant_attrs, variant_source,
    ocr_text, ocr_overlay_text, ocr_cell_label_text,
    source_author_handle, source_tweet_url, source_tweet_text, source_tweet_date,
    status, curator_notes, promoted_listing_id, created_at,
    pokemon_card_definitions:candidate_card_id (
      card_id, regional_name, english_name, set_code, card_number, image_url
    )
  `)
  .eq("status", "pending")
  .order("created_at", { ascending: true })
  .range(0, 49);
```

Sealed is identical with `pokemon_sealed_image_buylist_candidates`, embedding
`pokemon_sealed_products:candidate_product_id ( product_id, name, english_name, set_code, variant_edition, product_type, image_url )`,
and `candidate_product_id` / `sealed_condition` / `promoted_sealed_listing_id`
instead of the singles card columns.

**Images**: `cell_image_url` and `source_image_url` are public Cloudflare R2 URLs
— use directly in `<img src>`. The matched card's stock image is
`pokemon_card_definitions.image_url` (also public).

### Column reference (singles candidate)

| Column | Meaning |
|---|---|
| `candidate_id` (bigint, PK) | row id; pass to every RPC |
| `cell_image_url` | the cropped card image to show |
| `source_image_url`, `source_grid_bbox` (jsonb) | full tweet image + this cell's box |
| `ocr_price_jpy` (bigint) | OCR'd buy price in yen |
| `price_increased` (bool) | buyer flagged a price bump |
| `candidate_card_id` (int, FK) | best-guess matched card (nullable) |
| `match_method` | `features` \| `embedding` \| `name_text` \| `set_code` \| `hybrid` |
| `match_score_features/embedding/text` (real) | per-signal scores (nullable) |
| `confidence` (real) | overall match confidence 0–1 |
| `card_grading` | `raw` \| `psa_10` \| null |
| `variant_attrs` (jsonb), `variant_source` | variant info + where it came from |
| `ocr_text`, `ocr_overlay_text`, `ocr_cell_label_text` | raw OCR debug text |
| `source_author_handle` | canonical buyer id (maps to a location) |
| `source_tweet_url`, `source_tweet_text`, `source_tweet_date` | provenance |
| `status` | `pending` \| `needs_review` \| `approved` \| `rejected` (read-only here) |
| `curator_notes` | free text (editable) |
| `promoted_listing_id` (int) | set after approval (read-only here) |

Sealed differs: `candidate_product_id` (FK → products), `sealed_condition`
(`shrink` \| `no_shrink` \| `standard`), `promoted_sealed_listing_id`.

---

## 3. Editing a candidate before deciding

A curator can correct the match/metadata in place. You may **only** update these
columns (others, incl. `status`, are revoked):

- **Singles**: `candidate_card_id`, `card_grading`, `variant_attrs`, `curator_notes`
- **Sealed**: `candidate_product_id`, `sealed_condition`, `variant_attrs`, `curator_notes`

```ts
await supabase
  .from("pokemon_image_buylist_candidates")
  .update({ candidate_card_id: 12345, card_grading: "psa_10" })
  .eq("candidate_id", id);
```

You can also pass corrections inline to the promote RPC (§4) instead of a separate
update — either works; the RPC's params win.

A curator may **delete** a candidate (e.g. junk rows): `.delete()` is allowed.

---

## 4. Actions (RPCs) — the only way to change status / promote

Call via `supabase.rpc(name, params)`. All are `authenticated`-executable. They
enforce the state machine and return a clear error message on a bad transition.

### State machine
```
pending      → approved | rejected | needs_review
needs_review → approved | rejected
approved / rejected are terminal (no further actions)
```

### Singles

| RPC | Params | Returns |
|---|---|---|
| `promote_image_buylist_candidate` | `p_candidate_id bigint`, `p_card_id int = null`, `p_card_grading text = null`, `p_price_jpy bigint = null` | `bigint` (new `listing_id`) |
| `reject_image_buylist_candidate` | `p_candidate_id bigint`, `p_curator_notes text = null` | void |
| `mark_image_buylist_candidate_needs_review` | `p_candidate_id bigint`, `p_curator_notes text = null` | void |

```ts
// Approve → creates the buy listing and marks the candidate approved
const { data: listingId, error } = await supabase.rpc(
  "promote_image_buylist_candidate",
  { p_candidate_id: id, p_card_id: confirmedCardId, p_card_grading: "raw" }
);

await supabase.rpc("reject_image_buylist_candidate", {
  p_candidate_id: id, p_curator_notes: "blurry / unreadable",
});
```

`p_*` overrides are optional — omit to use the candidate's stored values. The
only hard requirement: **promote needs a card** (`p_card_id` or the candidate's
`candidate_card_id`). If there's no match, **reject** — there is no
create-a-new-card path in v1.

### Sealed (same semantics)

| RPC | Params | Returns |
|---|---|---|
| `promote_sealed_image_buylist_candidate` | `p_candidate_id bigint`, `p_product_id bigint = null`, `p_sealed_condition text = null`, `p_price_jpy bigint = null` | `bigint` (new `listing_id`) |
| `reject_sealed_image_buylist_candidate` | `p_candidate_id bigint`, `p_curator_notes text = null` | void |
| `mark_sealed_image_buylist_candidate_needs_review` | `p_candidate_id bigint`, `p_curator_notes text = null` | void |

### Errors
RPCs `RAISE` (surfaced as `error.message`) on: candidate not found; not in a
promotable/valid state for the action; promote with no `card_id`/`product_id`;
or no location mapped for the buyer handle. Show `error.message` to the curator.

---

## 5. What "approve" actually does (side effects)

`promote_*` runs server-side, atomically:
1. Resolves the buyer's **location** from `source_author_handle`.
2. Builds a **Buy / JPY** market-listing row: `price = ocr_price_jpy` (or
   `p_price_jpy`), `listing_url = source_tweet_url`; for singles, condition is
   `N/A` with `psa_grade = 0` for `raw` / `10` for `psa_10`; for sealed,
   `sealed_condition` from the candidate, edition `standard`.
3. Upserts it (re-approving the same buyer+card updates the price), returns
   `listing_id`.
4. Sets the candidate `status = 'approved'` and `promoted_listing_id`.

You don't need to write any of that — just call the RPC and use the returned
`listing_id` / refresh the row.

---

## 6. Suggested UI states

- **Queue tabs**: `pending`, `needs_review`, (read-only) `approved`, `rejected`.
  Counts via PostgREST `count`.
- **Card**: cell image, OCR price (¥), matched-card panel (image + name + set +
  number) with confidence + per-signal scores, variant chips from `variant_attrs`.
- **Actions**: Approve (+ optional grading/price override), Reject (+ notes),
  Needs review (+ notes), Edit match (search `pokemon_card_definitions` by
  name/number/set — it's readable), Delete.
- Show `price_increased` and `source_tweet_url` (link out to the tweet).

---

## 7. v1 scope (decided)

- All status changes go through RPCs (no direct status writes).
- Any authenticated user may curate (no per-user ownership).
- No-match → **reject only** (no create-card UI).
- **Singles and sealed both in v1.**
- Image *editing* is out of scope — curators approve/reject the crops the backend
  produced; the catalog/image feedback loop is a backend job.

# Plan: Fix MTG on the frontend (PostgREST view embedding)

## Context

Migration [000026_mtg_universal_rehaul.up.sql](internal/db/migrations/000026_mtg_universal_rehaul.up.sql) split the MTG card schema:

- **Before**: `mtg_card_definitions` owned `regional_name`, `set_code`, `card_number`, `misc_info`, `image_url`
- **After**: those columns moved to `mtg_universal_cards`; `mtg_card_definitions` is now just `(card_id, mtg_universal_id, language, is_foil, local_name)`

Migration [000029_mtg_card_definitions_view.up.sql](internal/db/migrations/000029_mtg_card_definitions_view.up.sql) then created a compatibility view `mtg_card_definitions_v` that re-exposes the old column shape (aliasing `uc.name AS regional_name`). Frontend commit `9a55978` switched the queries to point at the view.

**What's still broken:** PostgREST (Supabase) auto-discovers embeddable relationships from `pg_constraint` (real FKs). The FK that matters is `mtg_price_summaries.card_id → mtg_card_definitions.card_id` (on the **real table**), but the frontend joins against the **view** (`mtg_card_definitions_v`). Views don't have FKs. Without an explicit relationship declaration, PostgREST returns:

```
"Could not find a relationship between 'mtg_price_summaries' and
 'mtg_card_definitions_v' in the schema cache"
```

Pokemon still works because its card definitions are on a real table with a real FK — no view indirection.

Confirmed locally:
- `mtg_card_definitions_v` exists, defined as `SELECT cd.card_id, uc.name AS regional_name, uc.set_code, ...`
- View has **no comments and no FK metadata**
- Only FKs involving MTG tables: `mtg_card_definitions.mtg_universal_id → mtg_universal_cards.universal_id` and `mtg_price_summaries.card_id → mtg_card_definitions.card_id`

## Design

### Step 1 — Verify the break with a live query

Before changing anything, confirm PostgREST actually rejects the join. Call the Supabase REST endpoint directly:

```bash
curl -s "$SUPABASE_URL/rest/v1/mtg_price_summaries?select=*,mtg_card_definitions_v!inner(card_id,regional_name)&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" | jq
```

Expected failure: `PGRST200` / `PGRST103` error mentioning "relationship not found".

### Step 2 — Fix via PostgREST view-relationship hint

PostgREST 12+ (which Supabase uses) supports declaring view relationships via **computed relationships** defined by a SQL function. This is the canonical Supabase pattern and documented at https://postgrest.org/en/stable/references/api/resource_embedding.html#computed-relationships.

Add a migration `000041_mtg_view_relationships.up.sql` containing:

```sql
-- Tell PostgREST that mtg_card_definitions_v.card_id is the FK target for
-- mtg_price_summaries.card_id, so embedded joins work against the view.
--
-- PostgREST detects this via computed relationship functions (v11+). Each
-- function returns the SETOF the target view/table given the source row.

CREATE OR REPLACE FUNCTION mtg_price_summaries_card (mtg_price_summaries)
RETURNS SETOF mtg_card_definitions_v ROWS 1 LANGUAGE sql STABLE AS $$
  SELECT * FROM mtg_card_definitions_v WHERE card_id = $1.card_id
$$;

CREATE OR REPLACE FUNCTION mtg_buylist_entries_card (mtg_buylist_entries)
RETURNS SETOF mtg_card_definitions_v ROWS 1 LANGUAGE sql STABLE AS $$
  SELECT * FROM mtg_card_definitions_v WHERE card_id = $1.card_id
$$;

-- Optional but useful: grant select so anon/authenticated roles can embed
GRANT SELECT ON mtg_card_definitions_v TO anon, authenticated, service_role;
```

After applying, frontend queries like

```ts
supabase.from("mtg_price_summaries")
  .select("*, mtg_card_definitions_v!inner(card_id, regional_name, ...)")
```

can embed the view as a one-to-one relationship named `mtg_card_definitions_v` (PostgREST picks up the computed function automatically).

### Step 3 — Notify PostgREST of the schema change

Supabase's PostgREST caches schema metadata. After applying the migration, we need to nudge it:

```sql
NOTIFY pgrst, 'reload schema';
```

Include this as the last line of the migration so it runs on apply.

### Step 4 — Verify end-to-end

1. Re-run the `curl` probe from Step 1 — should return card data instead of a 400.
2. Load the frontend dashboard with `activeGame = mtg`. Expect the card browser to populate (after `mtg_price_summaries` has data; currently 0 rows because the `aggregate-prices` edge function hasn't been invoked against this DB).
3. Click into a card → `CardDetailModal` should render listings from `mtg_market_listings`.

## Critical files

**Create:**
- [internal/db/migrations/000041_mtg_view_relationships.up.sql](internal/db/migrations/000041_mtg_view_relationships.up.sql) — two computed-relationship functions + schema-reload NOTIFY
- [internal/db/migrations/000041_mtg_view_relationships.down.sql](internal/db/migrations/000041_mtg_view_relationships.down.sql) — `DROP FUNCTION mtg_price_summaries_card(mtg_price_summaries); DROP FUNCTION mtg_buylist_entries_card(mtg_buylist_entries);`
- [supabase/migrations/000041_mtg_view_relationships.up.sql](supabase/migrations/000041_mtg_view_relationships.up.sql) — up-only copy per convention

**No frontend changes needed.** The query shape in [use-card-data.ts:276](tcg_tracker_frontend/app/dashboard/use-card-data.ts#L276), [BuyListView.tsx:139](tcg_tracker_frontend/app/dashboard/BuyListView.tsx#L139), and [CardDetailModal.tsx:225](tcg_tracker_frontend/app/dashboard/CardDetailModal.tsx#L225) already uses `mtg_card_definitions_v` correctly.

## Why this approach over alternatives

- **Computed relationship function** (chosen): zero frontend churn, zero schema duplication, idiomatic PostgREST. The function is tiny and stable.
- **Denormalize columns onto `mtg_card_definitions`**: would work but duplicates data and requires triggers to keep in sync with `mtg_universal_cards`. Expensive.
- **Switch frontend to two-phase fetch** (summaries, then definitions by ID): works but adds a round trip and complicates pagination/sorting. Rejected.
- **Comment hint on the view** (`COMMENT ON VIEW ... IS '@foreignKey ...'`): PostgREST has no such well-defined syntax; the comment-based approach is for GraphQL/pg_graphql, not REST embedding.

## Reused utilities

- Migration pattern: same structure as [000039_hareruya_mtg_conditions.up.sql](internal/db/migrations/000039_hareruya_mtg_conditions.up.sql) we just applied — plain SQL, idempotent where possible.
- View: already exists, no modification.

## Verification

```bash
# 1. Apply migration locally
source .env
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME \
  -f internal/db/migrations/000041_mtg_view_relationships.up.sql

# 2. Sanity check the functions exist
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c \
  "\df+ mtg_price_summaries_card"

# 3. Probe via PostgREST (requires populated price summaries; if empty, expect []
#    rather than an error — the "relationship not found" message disappearing is
#    the signal that the fix landed).
curl -s "$SUPABASE_URL/rest/v1/mtg_price_summaries?select=*,mtg_card_definitions_v!inner(card_id,regional_name)&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY" | jq

# 4. End-to-end: boot the frontend, switch to MTG, confirm CardBrowser loads
#    without errors (even if empty). Any populated rows should render name/set.

# 5. Once verified, mirror to supabase/migrations/ (up-only per project convention).
```

## Risks & mitigations

- **Supabase may not be on a PostgREST version that supports computed relationships.** Lowest supported is PostgREST 11. Supabase Cloud is currently >= 12. Mitigation: the Step 1 curl probe will expose this upfront if the function-based approach fails.
- **Function name conventions** — PostgREST uses the function's `RETURNS SETOF <target>` parameter type to pick it up as a relationship. The `(mtg_price_summaries)` argument type tells PostgREST this is the "forward" direction from summaries. Naming pattern (`{source}_card`) is convention, not required.
- **`mtg_price_summaries` is currently empty locally.** That's orthogonal — the aggregate-prices edge function needs to run. Doesn't affect whether the fix works; only whether rows are visible. Frontend should also stop erroring in the empty case.
- **Buy lists also use the view** via [BuyListView.tsx:139](tcg_tracker_frontend/app/dashboard/BuyListView.tsx#L139). That's why the plan includes the `mtg_buylist_entries_card` function too.

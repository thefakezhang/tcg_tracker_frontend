# Pokemon variant axes in the Card Index

## What changed

A Pokemon card's printing used to be spelled into one free-text field, `misc_info`, as a compound string such as `SA,ミラー,1ED`.
Since the Phase 3 cutover in the backend (#1008) a card's identity lives in two typed columns - `edition` and `foil_treatment` - and `misc_info` holds only the residue, the notes neither axis can express.

The Card Index edit dialog now matches that.
`PokemonCardIndex.tsx` shows an **Edition** and a **Finish** selector, and the misc field is labelled as residual notes.

## Architecture

The edit path calls `card_index_edit_pokemon_card_typed` (migration 000499), passing `p_edition` and `p_foil_treatment` beside the residue.

An empty selection sends `null`, which the RPC reads as *leave this axis alone*: it falls back to the value the row already holds.
That is not a detail.
The misc field now carries the residue, so an edit made for any other reason - a rename, a card-number fix, an image upload - would otherwise be read as a request to clear the axes, and would silently reset the edition of the card being edited.

The vocabularies mirror the `CHECK` constraints on `pokemon_card_definitions`:

- `edition`: `unknown`, `not_applicable`, `first`, `unlimited`
- `foil_treatment`: `unknown`, `normal`, `mirror`, `reverse`, eleven named mirrors (`master_ball_mirror`, `monster_ball_mirror`, `energy_mark_mirror`, `rocket_mark_mirror`, `dark_ball_mirror`, `love_ball_mirror`, `friend_ball_mirror`, `quick_ball_mirror`, `rocket_team_mirror`, `break_mirror`) and `other`

## Justification

Several finishes have **no string token at all**.
`master_ball_mirror` and its siblings cannot be spelled into `misc_info`, so before this change a curator simply could not record one.
A typed write is the only way to express them, which is the reason the selectors exist rather than a richer text placeholder.

The wider reason is the backend's Phase 4 (#1009): `pokemon_card_variant_defaults` currently moves axis tokens out of the string and into the columns on every write, and that move is being tightened into a refusal.
The edit dialog was the last writer still relying on it.

## Goals

- A curator can record any printing the catalog can represent, including the tokenless finishes.
- An edit that does not mention the axes leaves them exactly as they were.
- The residue field stops carrying identity.

## Non-goals

- **The create dialog is unchanged.** `card_index_create_pokemon_card` has no typed parameters; it derives both axes from the string it is given (migration 000498), which works for every finish that has a token and silently cannot express the ones that do not. Offering the selectors on create would therefore drop a `master_ball_mirror` selection without saying so. A typed create is the follow-up.
- No backfill, and no change to how existing rows display.
- `variant_attrs` is gone from this repo. It was a Phase 1 column the backend derived from `misc_info` so that a pre-cutover compound string and a post-cutover residual one rendered the same label.
  Both halves of that reason have expired: the cutover rewrote every string, and the backend's 000502 refuses a `misc_info` that names an axis, so the compound shape is no longer a state the catalog can be in.
  `pokemonVariantLabel` reads the residue directly, splitting it on commas the way the database stored it.
  The frontend had to stop selecting the column **before** the backend drops it, because a select naming a dropped column is a PostgREST 400 rather than a quiet null.

## Retiring a column the frontend selects

Dropping `variant_attrs` took the dashboard down on 2026-09-20, and the shape of that failure is worth keeping.

`PokemonCardIndex.tsx` stopped selecting the column in #372, which read as the whole job.
It was not.
`POKEMON_VARIANT_COLS` in `use-card-data.ts` still named it, and that one constant is the card-definition projection for the **Card Browser, the Buy List and Scan Review**.
When the backend applied its drop, all three answered with a PostgREST 400 and rendered "Couldn't load data."
Service was restored by adding the column back, empty, rather than by rolling the frontend forward, because the deployed bundle is what was asking for it.

Three things follow.

- **The audit is over every reference in the repo, not over the files you expect.** The file that broke this was a shared hook, and no list of component names would have contained it. `grep -rn` over the whole tree, read whole.
- **The guard belongs on the constants, not on the call sites.** `use-card-data-variant.test.ts` asserts that no shared column constant names a dropped column. A test per surface would have passed on all three surfaces while the string they share was wrong.
- **The order is frontend first, and merged is not deployed.** Vercel builds on merge, and the gap is minutes wide. The backend's apply script reads the production deployment SHA and refuses while the deployed bundle still selects the column; a select naming a column that no longer exists is a 400, so the database change is only safe once the old bundle is gone.

`app/dashboard/CurationView.tsx` and `SealedCurationView.tsx` still select a `variant_attrs` column and are correct to.
It is a different column on a different table - a JSON blob of image-curation evidence on `pokemon_image_buylist_candidates` - which nothing in this refactor touches.

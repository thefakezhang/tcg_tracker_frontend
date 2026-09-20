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
- `variant_attrs` is still selected and still read; it is dropped in a later increment of the same backend phase.

# Japanese exclusivity

## Goal

The Japanese exclusivity surfaces let an operator filter and curate exact Pokémon printings by verified exclusive artwork and verified exclusive stamps or markings.

## Architecture

The Card Browser and Card Index expose two independent toggle buttons: Artwork and Stamp / marking.
With neither button selected, the surfaces show all cards.
With one selected, they show that category.
With both selected, they show the inclusive union of both categories rather than requiring both flags on the same card.
The Card Index also exposes the same Cute toggle as the Card Browser, and all of its curation predicates are applied identically to its count and row queries.
Artwork and stamps remain separate evidence fields because the two claims can have different sources and different buyer appeal.
Cards classified in both categories render two independent evidence rows and links.

Each filter button uses `aria-pressed` and a phone-sized tap target.
The full reviewed-corpus explanation remains attached to the group for assistive technology and its native tooltip.
Evidence badges are vertically centered within their rows so their labels align with short and wrapped reasons in card modals and compact cards.

Authenticated operators can edit Artwork and Stamp / marking independently from both the Card Index editor and the card detail modal.
Enabling a dimension requires a concise reason and an HTTPS evidence URL.
Disabling an active dimension is immediate.
The editor calls the audited `set_pokemon_japan_exclusivity_dimension` RPC, whose current override survives later manifest applications.
This restores manual curation without turning the generated manifest into a second mutable source of truth.

Customer purchase criteria retain explicit Artwork, Stamp / marking, Either, and Both modes because a persisted customer rule needs stable matching semantics rather than transient button state.

The application does not publish a CSV download of the approved corpus.
The maintained classification and audit reports remain internal data artifacts rather than a second public catalog that can drift from the database.

## Source Health presentation

The Source Health view excludes the internal `identity` and `aop` bookkeeping rows from its operator-facing source comparison.
Their database snapshots remain intact because the presentation filter does not delete or rewrite operational data.

## Validation

Unit tests cover the independent filter truth table, customer-criterion modes, audited editor payloads, matching Card Index count and row predicates, the absence of the CSV control, centered evidence-row styling, and the Source Health exclusions.
The controlled browser fixture checks exact result sets, phone tap targets, independent evidence links, badge alignment, and horizontal overflow at desktop and phone sizes.

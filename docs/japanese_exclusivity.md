# Japanese exclusivity

## Goal

The Japanese exclusivity surfaces let an operator filter exact Pokémon printings by verified exclusive artwork, verified exclusive stamps or markings, either category, or both categories.

## Architecture

The Card Browser filter uses the shared `JapanExclusivityMode` contract and passes the selected mode into the server-side card query.
Artwork and stamps remain separate evidence fields because the two claims can have different sources and different buyer appeal.
Cards classified in both categories render two independent evidence rows and links.

The filter trigger shows one compact category label and the current selection.
The menu shows the shared label once and then five short choices, while the full reviewed-corpus explanation remains attached to the trigger for assistive technology and its native tooltip.
Evidence badges are vertically centered within their rows so their labels align with short and wrapped reasons in card modals and compact cards.

The application does not publish a CSV download of the approved corpus.
The maintained classification and audit reports remain internal data artifacts rather than a second public catalog that can drift from the database.

## Source Health presentation

The Source Health view excludes the internal `identity` and `aop` bookkeeping rows from its operator-facing source comparison.
Their database snapshots remain intact because the presentation filter does not delete or rewrite operational data.

## Validation

Unit tests cover all five filter modes, the absence of the CSV control, centered evidence-row styling, and the Source Health exclusions.
The controlled browser fixture checks exact result sets, compact menu bounds, phone tap targets, independent evidence links, badge alignment, and horizontal overflow at desktop and phone sizes.

# Card quick-sale feedback

The quick-sale control in `CardDetailModal` records a sale from one source lot line.
Its request is bound to that exact game and lot line when the operator confirms.
The request continues if the operator closes the modal or opens another card.
A response from that previous opening must not display its success, margin or error, or close a form in the current opening.

## State ownership

Form selection, errors and success share one feedback value associated with the stable selected-row key, card ID, game and opening identity.
Render ignores feedback from another identity immediately, and completion checks the committed identity before changing local feedback.
A -> B -> A and closing/reopening the same card create distinct openings.
Buy-list keys include the game and entry ID, while browse keys distinguish PSA grades.
A target-price update that clones the same row retains its inputs and pending feedback; a different row key remains a distinct selection even when its card ID and game match.
The owned-inventory version is deliberately excluded: a refresh during a pending same-card sale does not discard that sale's form or eventual feedback.
The form's existing input defaults, toggling and validation remain unchanged.

The `sellBusy` lock remains component-wide until the actual RPC settles.
Closing and reopening a card cannot unlock another sale against stale holdings while the first write is pending.
The existing blocking behavior for another card also remains.
A successful write always calls `bumpOwnedInventory`, including when its original opening is gone or the component has unmounted.
Only local feedback is suppressed for an obsolete opening.
The write is neither cancelled nor automatically retried.

The `record_line_sale` payload, quantities, lot-line identity, currency/FX, local sale date, fees, platform trimming and rounding are unchanged.
Current rejected writes retain their inputs for an explicit retry.
Target-price saves, sightings, other mutations, shared metadata caches and the accounting implementation are outside this change.

## Verification

The existing `CardDetailModal-loading.test.tsx` harness also exercises deferred sale completions, avoiding a second copy of its transport and rendering setup.
The original implementation failed seven new lifecycle cases while 26 load and mutation-contract cases passed.
An intermediate whole-row-object identity failed three targeted clone-preservation cases; using stable row/card identity resolved those without merging distinct entries.
The matrix includes stale success/rejection after switching, reopening, A -> B -> A and same-ID game changes; the global pending-write lock; unmount; same-card inventory refresh; exact USD and JPY payloads; and explicit rejection/retry.
The focused suite also retains the variant, target-price identity and opportunity-payload tests.

The browser scenario reuses the production-gated card fixture and its shared-lock runner:

```bash
E2E_HEADED=1 xvfb-run -a bash scripts/e2e/run-card-detail-load-fixture.sh sale-feedback
```

A native close/open interaction runs while an intercepted sale response is held.
The original source displayed the old sale's success beneath the next card, even though the single request remained pinned to the correct original lot line and amount.
The scenario checks card switches and same-card reopen on desktop and phone, keeps the mutation lock until settlement, verifies the subsequent global inventory read, and rejects obsolete result display.
It inspects the exact intercepted sale payload and rejects unexpected traffic.
This is client lifecycle evidence with mocked transport, not live database, FIFO or accounting acceptance.

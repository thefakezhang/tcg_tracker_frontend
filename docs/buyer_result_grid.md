# Buyer result grid

## Purpose

The buyer result grid records what happened against purchase-plan lines already assigned through the backend's buyer-principal boundary.
The operator can also open the same screen in a read-only preview.
This phase completes the keyboard-first result-entry surface without changing authentication, RLS, RPCs, or accounting behavior.

## Goals

- Preserve every accepted edit through the existing `buyer_record_result` RPC.
- Make typing efficient with debounced autosave, vertical and horizontal keyboard movement, and spreadsheet paste.
- Prevent an older response from replacing a newer edit.
- Keep pending work attached to the current plan when the operator changes the plan picker.
- Restore `condition_seen` exactly when a saved row is reopened.
- Explain initial-load failure, saving, saved, failed, retry, invalid paste, and empty assignment states in English and Japanese.
- Keep the result journey usable at 1440 by 900 and 390 by 844 without page-level horizontal overflow.

## Architecture

`BuyerOrderView` remains the only result-entry view.
It reads assigned plans through `buyer_assigned_plans`, reads one plan through `buyer_plan_lines`, and writes one complete result row through `buyer_record_result`.
The database remains the authorization and finalization boundary.
An initial assigned-plan failure replaces the loading state with the translated error, recovery guidance, and a retry action.
Returned session failures and rejected transient requests use the same recoverable path.

`useBuyerResultAutosave` owns the optimistic row, the last server-confirmed row, and one job per plan line.
Cell changes reset a 450 millisecond timer and coalesce into the latest desired row because the RPC writes the complete row contract.
Only one request for a line may be in flight.
If the buyer changes the same line while a request is running, the newer row waits and is sent after the first response has been reconciled.
This serialization makes request completion order deterministic and prevents a stale write from winning.

A transient failure leaves the desired row visible and exposes Retry.
A terminal assignment or finalization refusal restores the last confirmed row and explains the refusal.
Escape removes an unsent edit.
If a request already reached the server, Escape schedules the confirmed row after that request completes.

Changing the selected plan flushes all pending result jobs before `activePlan` changes.
The picker stays on the current plan if any job remains failed.
Each line read also carries a monotonically increasing request token, so a slow response for the prior plan cannot replace the next plan's rows.
Totals, costs, and receipt reads carry the same latest-request fence and remain tagged with their plan until render.
A successful save schedules a totals refresh only while that saved row's plan is still selected.

`planBuyerGridPaste` parses tabs and line breaks into a rectangle.
It validates the rectangle bounds, every result label, whole-number quantity and price values, supported conditions, and the bought-row completeness rule before returning any edits.
The caller queues rows only after the complete selection passes.
English labels, Japanese labels, and stable raw outcome values resolve to the same backend values.
When a shared want has no remaining quantity, choosing a bought result is refused before an autosave job is queued and tells the buyer to ask the operator to raise the cap.

The table uses one set of controls at every viewport.
Below the `md` breakpoint, each semantic row becomes a two-column card and each result control carries its visible field label.
Editing controls and primary actions use a minimum 44-pixel height on phones.
Stale-price warnings show the source observation time as visible text.
Shared want progress also carries a visible explanation instead of relying on pointer-only title text.

## Non-goals

- This surface does not add a new buyer capability or bypass scoped RPCs.
- It does not change purchase-plan lines, reconciliation, delivery transitions, receipts, or shop costs.
- This phase does not change or verify storage-bucket authorization for the existing receipt upload path.
- It does not provide formulas, arbitrary columns, offline edits, or conflict merging across devices.
- It does not apply migrations, use a shared Supabase stack, or mutate cloud data.

## Verification

Pure tests cover paste validation, bilingual outcomes, purchase completeness, a zero remaining shared want, condition preservation, debounce states, retry, Escape, and serialized writes.
Component tests cover initial-load failure and retry, actual cell edits, the fully filled shared-want boundary, left and right movement, valid and invalid paste, condition restoration, retry, plan-change flushing, and the Japanese empty state.
The controlled browser fixture uses intercepted local RPC responses and makes no database or external requests.
It drives the same buyer shell and result view at desktop and phone viewports and records screenshots plus a JSON evidence report under `docs/evidence/buyer-result-grid/`.

## Receipt registration retry

The #1236 increment extracts `BuyerSourceReceipts` as the owner of one plan/source upload and registration attempt.
Once upload succeeds, a failed registration keeps that exact path available for retry without uploading the bytes again.
Upload failures never register metadata, obsolete completions cannot affect another plan, and closed plans expose no retry mutation.
The pending path is in-memory state; reload or navigation may leave an unregistered object, which is retained for separate operational reconciliation rather than deleted automatically.
Database migration 000464 supplies the authoritative plan/source/lifecycle checks on both Storage and registration; frontend controls are not an authorization boundary.
The complete authenticated buyer-order journey remains separately gated under #939.

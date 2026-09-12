# Authenticated buyer acceptance

Issue #939 owns the complete operator assignment, buyer result entry, receipt, and inventory reconciliation journey.
The earlier result-grid fixture intercepts RPC responses; these scripts exercise real GoTrue, PostgREST, Storage, and the production Next.js pages in a disposable Supabase project.
They do not authenticate against Google or use a real operator or buyer account.

## Architecture and isolation

The hosted diagnostic creates a new project named `issue939-<run>-<attempt>` and enables the committed custom access-token hook only in its isolated configuration.
It disables the repository's demonstration data seed.
`bootstrap-buyer-auth-fixture.mjs` verifies the exact project container labels and API port before creating synthetic identity mappings, four GoTrue users, and separate API and browser plans.
GoTrue issues the sessions and verifies them through its user endpoint; the fixture checks the emitted administrator, buyer, and unmapped roles.
It does not replace authorization with locally signed test tokens.

Credentials and Supabase status stay in private files outside the artifact directory.
Every HTTP origin must be literal loopback, and the browser rejects external requests.
SQL enters only the inspected disposable database container through stdin.
No cloud database, catalog mirror, real receipt, order, source request, or deployment is involved.

## Scripts and evidence

`buyer-receipt-storage-auth.mjs` checks own and foreign object reads, listings, uploads, metadata registration, idempotent retry, overwrite/delete denial, historical reads, lifecycle refusal, and operator-only capabilities over real HTTP.
Its report contains synthetic case labels and statuses, never tokens, passwords, or object bytes.

`buyer-authenticated-journey.mjs` signs in through GoTrue and gives isolated browser contexts the resulting Supabase SSR cookies.
Each language and viewport scenario owns a fresh Chromium process so native receipt-picker and download state cannot carry between scenarios.
Receipt evidence records native keyboard and click metadata without file contents or credentials, while upload still requires Tab navigation, Enter activation, a real file chooser and authenticated Storage registration.
The production middleware still verifies the session.
It checks deliberate assignment/send, buyer isolation, keyboard autosave and reload, keyboard receipt upload, and the operator's hand-back view.
The baseline at frontend `08bd60bd599c7c22eed79d59051deddfb6060267` reached hand-back and reproduced the missing reconciliation control in hosted run [34698287603](https://github.com/thefakezhang/tcg_tracker/actions/runs/34698287603).
The current positive fixture continues through recorded buyer source costs, an operator receipt download, explicit dates and FX, actual condition confirmation, warning acknowledgement and finalized inventory.
It asserts the retained cost facts and inventory quantities, reloads the result, and repeats for English and Japanese at desktop and phone sizes.
The positive fixture is under verification and has not yet passed its hosted runtime gate.
The resilience cases let the real finalization commit and then discard only its response, requiring the screen to retain inputs and discover the same inventory through review without a second write.
The disposable project uses 120-second tokens and keeps the first GoTrue-issued operator token only in its private fixture file.
After that token has expired beyond PostgREST's documented 30-second clock-skew tolerance, a direct read probe confirms rejection before one browser review request per scenario verifies the real 401 response and localized sign-in prompt.
Only the exact injected request's expected console error is classified separately; unrelated browser errors still fail the run.

The scripts require `GITHUB_ACTIONS=true`, `RUNNER_ENVIRONMENT=github-hosted`, a matching `TCG_DISPOSABLE_FIXTURE_RUN_ID`, and private fixture input.
The workflow pins the backend and frontend commits, records executed assertions and failures, and verifies project container, volume, and network cleanup.
Do not run this stack on a host where browser acquisition is active.

## Goals and non-goals

The acceptance gate must eventually cover the complete #939 operator and buyer journeys, including the existing effective-dated fee contract and receipt privacy changes.
Component tests, SQL role tests, and a partial browser run remain supporting evidence.
This fixture does not apply migrations to an application database, activate a source, place an order, upload a real receipt, or merge a pull request.

## Operator interface

`PurchaseReconciliationDialog` offers a review after an ordered plan is handed back.
The backend calculates fees and costs; the browser submits explicit dates, JPY per USD rates, rate references, optional receipt totals and condition confirmations.
Inventory condition choices use the canonical TCGplayer standard, consistent with manual intake.
A shop-specific planned condition requires explicit inventory condition review and remains unchanged on the original order.
Editing those inputs invalidates the reviewed digest and warning acknowledgement immediately.
A lost response preserves the inputs and offers another server review to discover any completed inventory write before another confirmation.
The planner's selector reports the stored order status without guessing that an ordered buyer has not started.
The implementation requires unapplied backend migration 000466 and the reviewed fee and receipt-privacy prerequisites.
The legacy backend reconciliation RPC remains a compatibility path; this component exclusively uses the new atomic inventory endpoint.

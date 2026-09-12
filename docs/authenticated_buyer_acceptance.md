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
The production middleware still verifies the session.
It checks deliberate assignment/send, buyer isolation, keyboard autosave and reload, keyboard receipt upload, and the operator's hand-back view.
Its initial acceptance assertion exposes the missing operator reconciliation control; it must not be counted as a complete journey until reconciliation and its authoritative inventory/cost outcome pass.

The scripts require `GITHUB_ACTIONS=true`, `RUNNER_ENVIRONMENT=github-hosted`, a matching `TCG_DISPOSABLE_FIXTURE_RUN_ID`, and private fixture input.
The workflow pins the backend and frontend commits, records executed assertions and failures, and verifies project container, volume, and network cleanup.
Do not run this stack on a host where browser acquisition is active.

## Goals and non-goals

The acceptance gate must eventually cover the complete #939 operator and buyer journeys, including the existing effective-dated fee contract and receipt privacy changes.
Component tests, SQL role tests, and a partial browser run remain supporting evidence.
This fixture does not apply migrations to an application database, activate a source, place an order, upload a real receipt, or merge a pull request.

# Sealed planning schema readiness

The backend contract, exact sealed identity, bulk RPC, rollout order, and recovery rules are defined in the [canonical sealed bulk purchase-planning document](https://github.com/thefakezhang/tcg_tracker/blob/main/docs/sealed_bulk_purchase_planning.md).
This document describes the frontend gate that keeps those planning actions unavailable until their read dependency is present.

## Goals

- Keep every sealed planning mutation disabled until the authenticated browser client can read the bounded candidate view.
- Distinguish an expected missing-view rollout state from authentication, permission, transport, and unexpected failures.
- Preserve ordinary sealed browsing and selection while planning is unavailable.
- Let an operator recheck readiness without reloading the page after the backend migration is deployed.

## Architecture

`readSealedPlanningReadiness` uses the shared Supabase browser client to read `pokemon_sealed_purchase_candidate_listings_v` with `select("product_id").limit(0)`.
The zero-row read exercises authentication, relation visibility, and the deployed view shape without loading listing data or invoking a mutation.
The readiness path never calls `add_sealed_to_purchase_plan` as a probe.

Only PostgreSQL `42P01` and PostgREST `PGRST205` responses from this exact view read mean that sealed planning is unavailable because the relation is missing from the active schema.
That state uses operator-facing retry-later copy and a Check again action.
Missing-column responses, including `PGRST204`, are unexpected contract drift and remain errors.
Authentication, permission, transport, and all other failures also remain surfaced errors with Retry instead of being presented as a normal rollout state.

`useSealedPlanningReadiness` uses the shared `useSupabaseQuery` SWR key `sealed-planning-readiness` plus the view name.
That key deduplicates an in-flight check and shares the result across mounted sealed-planning surfaces.
The query does not revalidate on window focus, and an unavailable response is valid cached data rather than an automatically retried error.
Check again calls the query's `mutate` path so an operator who stays on the page can enable planning after rollout.
Retry uses the same path for a surfaced read failure.

The Sealed browser mounts the gate while leaving its catalog, filters, layouts, detail view, and selection controls usable.
Its Add to plan action stays disabled during checking, unavailable, and error states, and its event and submit guards prevent a blocked dialog or mutation even if a caller bypasses the button state.

The purchase planner enables the same check only while the Add line dialog is open for `pokemon_sealed`.
Until readiness is confirmed, it disables sealed catalog search, candidate reads, the manual-entry toggle and fields, and both candidate and manual submissions.
The corresponding handlers repeat the readiness guard before reading candidates or inserting a line.
Card and MTG planning do not enable this gate.

## Non-goals

- The readiness read does not prove that a later mutation will succeed or bypass the RPC's authorization and integrity checks.
- The frontend does not infer deployment state from error text, probe a mutating endpoint, or hide authentication and permission failures as rollout delay.
- The gate does not apply migrations, refresh PostgREST schema caches, place orders, or change ordinary sealed catalog visibility.
- The gate does not change card or MTG planning behavior.

## Verification scope

Component tests classify only `42P01` and `PGRST205` as unavailable and keep missing-column, authentication, permission, transport, and unexpected responses on the error path.
Hook coverage proves an unavailable result can become ready through Check again and that both reads use the zero-row view query without an RPC.
Surface tests prove sealed bulk addition and sealed candidate or manual planning remain disabled until ready while browsing stays available.

The controlled headed-Xvfb fixture covers English and Japanese at desktop and phone sizes.
Ready journeys prove the zero-row check precedes the first mutation.
Missing-schema journeys prove ordinary browsing remains available, planning stays disabled, Check again repeats the exact read, and no mutation request occurs.
Transient-error journeys prove Retry repeats the read and enables planning only after a successful response.

The fixture supplies loopback PostgREST responses and an Authorization header, so it verifies request ordering, request shape, recovery, controls, localization, and mobile behavior.
It does not establish a live authenticated browser session, deployed database permissions, migration application, accounting, reconciliation, or live ordering.

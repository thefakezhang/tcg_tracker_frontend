# Image curation price evidence

## Goals

- Make card identity confidence visibly distinct from price evidence.
- Show whether a detected amount is safe for machine-assisted approval.
- Keep bulk approval limited to rows whose card identity exists and whose price evidence passes the backend contract.
- Keep every badge readable and wrapping on narrow phone and desktop layouts.

## Architecture

Each singles and sealed candidate includes an immutable `price_evidence` document written by the recognition service.
The document records the extraction method, OCR readability, and optional price-banner kind, score, threshold, and match result.

`lib/image-curation-price-evidence.ts` mirrors the database predicate for display and button eligibility.
The database remains authoritative and independently rechecks the evidence for scheduled, repeat-memory, and bulk approval.
A frontend check can hide an unsafe bulk action, but it cannot make an unsafe row eligible on the server.

The candidate card shows two separate badges:

- `Identity N%` is the card match confidence derived from visual identity signals.
- `Price verified` or `Price needs review` describes the semantic evidence for the amount.

When a source uses a price banner, the price badge includes the measured banner score.
Its accessible name and tooltip include the required threshold and OCR readability.
The badge container uses wrapping layout so these signals do not cause horizontal page scrolling.

## Justification

A high identity score proves only that the detected card resembles a catalog card.
It does not prove that OCR selected a shop price instead of attack damage, a collector number, or a copyright year.
Showing one unlabeled percentage made those independent claims look interchangeable and made bulk approval unsafe.

## Non-goals

- The frontend does not calculate card identity confidence.
- The frontend does not calibrate banner thresholds.
- An unverified price is not automatically rejected.
  It remains available for a curator to inspect and correct manually.
- OCR readability alone never makes a price eligible for automatic or bulk approval.

## Deployment order

Deploy the backend migration before this frontend.
The migration adds `price_evidence`, defaults legacy rows to unverified, and installs the server-side approval guards.
The frontend can then safely select the new column and render the separate identity and price badges.

# UI evidence

Visual verification artifacts for operator-facing features.

## S3 per-grade evidence panel

- `s3-grade-evidence-desktop.png` was captured at 1440 by 1100.
- `s3-grade-evidence-phone.png` was captured at 390 by 844 viewport width, with a full-page screenshot.

Both images render the production `GradeEvidencePanel` with deterministic S2-shaped fixture responses.
The fixture deliberately covers a Card Ladder series with an event marker, a source-only grade, a cohort-derived raw estimate, demand, population, bid age, and separate signal and listing freshness labels.

## Responsive decision controls

Phone-width Card Browser sessions default to the grid surface, where every card exposes Watch and a compact optional Dismiss action without horizontal scrolling.
There is no routine Pass button.
Visible actual marketplace opportunities and opened detail listings are recorded automatically, while indicator-only sources are excluded.
Dismiss opens a reason field only for an exceptional deliberate rejection.
The list surface keeps its decision column pinned to the right and hides secondary economics columns until enough desktop width is available.
Browser toolbars and card-detail footers wrap instead of increasing the page width.
Primary phone controls use a 44px minimum target, including store-sighting fields, Watch, Dismiss, dismissal reason, pagination, modal close, refresh, and lot actions.
The store-sighting form exposes an explicit Raw or PSA 1 through PSA 10 selector, preselected from the browser row while remaining editable before save.

## G8-G11 catalog discoverability

The interaction and recovery contract is documented in [`docs/catalog_discoverability.md`](../catalog_discoverability.md).
Local component evidence covers pointer, Enter, and Space result activation plus retained-result recovery from an external-identifier lookup failure.
The authenticated browser acceptance flow now covers the same behavior at 1440-pixel desktop and 390-pixel phone widths.
That browser flow passed against deployed frontend merge `496faf26` on 2026-08-13 at 1440x960 desktop and 390x844 phone viewports.
Credential-free evidence is retained locally with manifest SHA-256 `07dce2e40fe14ad64d4312b3211b55a40123acb41cd76c95ec37ed5cd0631c19`.

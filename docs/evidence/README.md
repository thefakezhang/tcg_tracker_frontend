# UI evidence

Visual verification artifacts for operator-facing features.

## S3 per-grade evidence panel

- `s3-grade-evidence-desktop.png` was captured at 1440 by 1100.
- `s3-grade-evidence-phone.png` was captured at 390 by 844 viewport width, with a full-page screenshot.

Both images render the production `GradeEvidencePanel` with deterministic S2-shaped fixture responses.
The fixture deliberately covers a Card Ladder series with an event marker, a source-only grade, a cohort-derived raw estimate, demand, population, bid age, and separate signal and listing freshness labels.

## Responsive decision controls

Phone-width Card Browser sessions default to the grid surface, where every card exposes Pass and Watch without horizontal scrolling.
The list surface keeps its decision column pinned to the right and hides secondary economics columns until enough desktop width is available.
Browser toolbars and card-detail footers wrap instead of increasing the page width.
Primary phone controls use a 44px minimum target, including store-sighting fields, Pass, Watch, reason, pagination, modal close, refresh, and lot actions.
The store-sighting form exposes an explicit Raw or PSA 1 through PSA 10 selector, preselected from the browser row while remaining editable before save.

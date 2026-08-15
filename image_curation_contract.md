# Image Curation - Frontend Contract

This document is the backend-to-frontend contract for the image-buylist curation dashboard.
It is the source of truth for what the dashboard reads, edits, and invokes for singles and sealed candidates.

The baseline candidate contract comes from migrations `000051`, `000062` through `000064`, `000066`, and `000067`.
The current feedback increment comes from `000226_image_curation_feedback`, `000227_image_curation_geometry`, and `000228_image_curation_repeat_memory`.
Migration `000225` is unrelated to image curation and must not be reused by this feature.
Deployments must apply migrations `000226` through `000228` before enabling the batch, geometry-correction, or repeat-memory paths described here.

## 1. User outcome

A JP card shop publishes a buylist image with cards or sealed products and yen prices.
The backend segments the source image, reads each price, proposes an identity, and writes one candidate per detected cell.
The dashboard lets an authenticated curator confirm or correct that proposal and then approve, reject, or send the candidate to `needs_review`.
Approval creates or updates a real buy listing while preserving the candidate as durable evidence.

The two candidate kinds share one interaction model:

- Singles use `pokemon_image_buylist_candidates` and promote into `pokemon_market_listings`.
- Sealed products use `pokemon_sealed_image_buylist_candidates` and promote into `pokemon_sealed_market_listings`.

## 2. Authentication and errors

Every read and mutation runs as the Supabase `authenticated` role.
The database rejects anonymous curation access and direct writes to protected status or promotion-link columns.
Status transitions and promotion must use the RPCs in this document.

The dashboard classifies query failures before choosing a recovery action.
A `401`, `PGRST301`, or expired-token/session error offers a real `/login` link.
A `403` or permission error explains that access is denied and does not offer a futile retry.
Other read failures retain the ordinary retry action.

## 3. Reading the queues

The dashboard reads candidates through PostgREST, filters to `pending` or `needs_review`, orders by confidence descending, and groups visible candidates by confidence band.
Matched catalog records are fetched by their candidate IDs and joined in the client.
Search corrections use the shared smart card or product search filters rather than a curation-specific identity matcher.

The shared candidate fields used by the current UI are:

| Field | Contract |
|---|---|
| `candidate_id` | Stable bigint passed to every action RPC |
| `status` | Queue state; the current UI reads `pending` and `needs_review` |
| `cell_image_url` | Detector-produced cell preview |
| `source_image_url` | Full renderable source image used by geometry correction |
| `source_grid_bbox` | Immutable detector-original geometry |
| `effective_source_grid_bbox` | Current geometry used for previews, hashes, and learning |
| `source_image_width`, `source_image_height` | Paired natural source dimensions, both null or both positive |
| `active_geometry_correction_id` | Active append-only correction evidence, or null |
| `ocr_price_jpy` | Proposed buy price in yen |
| `confidence` | Overall match confidence from zero to one |
| `match_method` | Matcher path used for the proposal |
| `match_score_features`, `match_score_embedding`, `match_score_text` | Optional per-signal evidence |
| `variant_attrs`, `variant_source` | Variant evidence and provenance |
| `curator_notes` | Optional curator explanation |
| `source_author_handle`, `source_tweet_url`, `source_tweet_date` | Buyer and source provenance |

Singles additionally read `candidate_card_id` and `card_grading`.
Sealed candidates additionally read `candidate_product_id` and `sealed_condition`.

The geometry JSON shape is:

```ts
interface ImageBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface ImageGeometry {
  card: ImageBox;
  price: ImageBox | null;
}
```

Legacy detector rows may store a single `ImageBox` in `source_grid_bbox`.
The frontend treats that legacy box as the card box with no price box.
The render baseline is `effective_source_grid_bbox` when present and otherwise `source_grid_bbox`.

## 4. Match and metadata correction

The correction panel keeps edits locally until the curator chooses an action.
Singles may override card identity, grading, price, notes, and geometry in the promotion request.
Sealed candidates may override product identity, sealed condition, price, notes, and geometry in the promotion request.
The RPC values win over the stored candidate values.

No-match candidates cannot be approved.
The curator must choose a valid existing catalog record or reject the candidate.
Creating a new catalog identity from this queue is outside this contract.

## 5. Geometry correction

Singles and sealed use the same `ImageGeometryEditor` component.
The editor renders the full `http` or `https` source image and measures its natural width and height on load.
Blue marks the card boundary and amber marks the optional price boundary.
The image overlays are visual only and contain noninteractive corner markers.
Each Card and Price box has an external two-column resize-control group so shallow overlays cannot make north and south hit targets overlap.
Every move and resize control has a minimum 44 by 44 CSS pixel target and remains usable without horizontal page overflow at a 390px viewport.

Dragging a move control preserves the box width and height.
Dragging `NW`, `NE`, `SW`, or `SE` changes only the two boundaries named by that corner.
Pointer capture keeps mouse and touch gestures active after the pointer leaves the control.
Arrow keys move or resize by 4 natural-image pixels, Shift changes the step to 10, and Alt changes the step to 1.
Every control has an accessible Card or Price label and an explicit corner label.

Reset restores the immutable detector geometry.
Remove Price sets the effective price box to null.
Add Price creates a bounded box in the lower part of the source image.
The frontend and database clamp geometry to the natural image dimensions and reject degenerate boxes.

The frontend submits a geometry correction only when the source is renderable, both natural dimensions are known, and the effective geometry differs from the baseline.
An untouched approval uses the ordinary promotion RPC and creates no false geometry evidence.
A changed approval uses the matching correction-and-promotion RPC atomically.

### Singles geometry RPC

`correct_and_promote_image_buylist_candidate` accepts:

| Parameter | Type |
|---|---|
| `p_candidate_id` | bigint |
| `p_card_id` | integer |
| `p_card_grading` | text |
| `p_price_jpy` | bigint |
| `p_curator_notes` | text |
| `p_effective_geometry` | jsonb `ImageGeometry` |
| `p_natural_width` | positive integer |
| `p_natural_height` | positive integer |

### Sealed geometry RPC

`correct_and_promote_sealed_image_buylist_candidate` accepts the same geometry and dimension parameters with `p_product_id` and `p_sealed_condition` in place of the singles identity fields.

Each correction RPC validates the authenticated curator subject, renderable source URL, natural dimensions, and bounded geometry.
It appends immutable correction evidence, updates only the effective geometry linkage, promotes the candidate, and returns `candidate_id`, `listing_id`, `correction_id`, and normalized `effective_geometry`.

## 6. Ordinary actions

| Candidate kind | RPC | Required parameters | Result |
|---|---|---|---|
| Singles | `promote_image_buylist_candidate` | `p_candidate_id`; optional `p_card_id`, `p_card_grading`, `p_price_jpy`, `p_curator_notes` | listing bigint |
| Singles | `reject_image_buylist_candidate` | `p_candidate_id`, optional `p_curator_notes` | void |
| Singles | `mark_image_buylist_candidate_needs_review` | `p_candidate_id`, optional `p_curator_notes` | void |
| Sealed | `promote_sealed_image_buylist_candidate` | `p_candidate_id`; optional `p_product_id`, `p_sealed_condition`, `p_price_jpy`, `p_curator_notes` | listing bigint |
| Sealed | `reject_sealed_image_buylist_candidate` | `p_candidate_id`, optional `p_curator_notes` | void |
| Sealed | `mark_sealed_image_buylist_candidate_needs_review` | `p_candidate_id`, optional `p_curator_notes` | void |

The promotable state machine is:

```text
pending      -> approved | rejected | needs_review
needs_review -> approved | rejected
```

Approved, auto-approved, and rejected decisions are not actionable from the active queue.

## 7. Bounded batch approval

Singles use `batch_promote_image_buylist_candidates` and sealed candidates use `batch_promote_sealed_image_buylist_candidates`.
Each RPC accepts one `p_decisions` JSON array containing between 1 and 200 unique candidate decisions.
The current dashboard submits matched, unchanged candidates from one confidence band in one request and refreshes once.
Candidates with edited geometry use their correction RPC individually because their audit payload includes geometry and natural dimensions.

Each decision runs in its own database savepoint.
A failed decision rolls back only that row while successful siblings remain committed.
Malformed envelopes or duplicate candidate IDs reject the request before decisions execute.

The response contract is:

```json
{
  "mode": "per_row_savepoint",
  "summary": { "requested": 3, "succeeded": 2, "failed": 1 },
  "results": [
    { "candidate_id": 10, "success": true, "listing_id": 100 },
    {
      "candidate_id": 11,
      "success": false,
      "error_code": "22023",
      "error_message": "candidate is not promotable"
    }
  ]
}
```

The dashboard shows the aggregate result and keeps each failed candidate visible with its readable error.
Unknown thrown values and Supabase error objects must be normalized so the UI never renders `[object Object]`.

## 8. Approval side effects

Promotion resolves the buyer location from `source_author_handle`.
It creates or updates a Buy listing in JPY with the candidate price and source tweet URL.
It records the selected singles grading or sealed condition, marks the candidate approved, stores the promoted listing ID, and returns that listing ID.
The entire promotion runs in one database transaction.

Geometry-corrected approval additionally preserves the detector-original geometry, corrected effective geometry, natural dimensions, curator subject, source context, and previous-correction linkage in append-only evidence.
Backend active learning uses the effective card crop rather than the full sheet or price banner.
Migration `000228` may auto-approve only strict same-source repeats of a human-confirmed exemplar and records separate append-only repeat evidence.
Repeat-memory evaluation and undo are backend/operator workflows and are not dashboard actions in this increment.

## 9. UI requirements and non-goals

- Keep `pending` and `needs_review` queue tabs, buyer filtering, confidence grouping, and keyboard navigation.
- Keep source links, OCR evidence, identity search, grading or condition controls, notes, and per-row readable failures.
- Keep all primary phone controls at least 44 CSS pixels in both dimensions.
- Do not add direct status writes, direct promotion-link writes, or a per-source matcher.
- Do not create catalog identities from the curation queue.
- Do not expose repeat-memory threshold tuning or rollback as curator controls.

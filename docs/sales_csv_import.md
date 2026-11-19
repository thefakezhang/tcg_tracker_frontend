# Sales CSV import

The Sales tab's **Import TCGplayer CSV** button opens `TcgplayerImportDialog` with the currently loaded holdings.
Choosing a CSV file runs the existing parser and matcher, shows the column mapping and match preview, and lets the operator exclude rows or resolve ambiguous holdings.
The preview table scrolls horizontally on phones without squeezing the quantity and price headers together.
File selection, row selection and ambiguity controls have accessible names; row-selection labels provide a 44-pixel touch target.

**Stage for review** passes the selected entries to the existing sale form.
Neither opening, previewing nor staging records a database sale.
The operator reviews the quantity, amounts, allocation method and expenses before pressing **Record sale**.
That confirmation retains the existing `record_lot_sale` RPC and payload shape.
A rejected save preserves the draft for an explicit retry.

## Amounts and identity

CSV prices are USD amounts, not prices in the holdings' acquisition currency.
When every included entry has a positive price, staging selects explicit item proceeds and USD, including when every holding originated on the export leg.
The final payload therefore uses the existing USD convention: `p_orig_currency: null` and `p_fx_rate: 1`.
The source leg label, allocation algorithm, market valuation policy, fees and accounting RPC remain unchanged.

The existing importer merges duplicate rows resolving to the same holding, calculates their quantity-weighted price, and caps the staged quantity to on-hand stock.
Each staged line retains its existing two-decimal rounding; the gross total sums those exact line cents so capped weighted prices cannot produce a mismatched total.
Ambiguous matches require an operator choice; unmatched rows cannot be included.
Holding keys retain game and condition identity.
An import with missing or nonpositive prices keeps the existing manual-review behavior: blank gross proceeds, market-value allocation and the leg-based currency default.
The ordinary manual sale entry point is unchanged.

## Verification

`SalesTab-csv-import.test.tsx` exercises the real Sales tab, importer, parser, matcher, paging helpers and sale payload builder with only Supabase transport replaced.
It covers the trigger, all-export and mixed-origin priced imports, USD totals and expenses, duplicate aggregation and stock caps, ambiguous and unmatched rows, unpriced imports, cancellation, and rejected-save retry.
The parser/matcher and sale-lot-model tests retain their independent contract coverage.

Run the controlled browser journey with already installed dependencies and Chromium:

```bash
E2E_HEADED=1 xvfb-run -a bash scripts/e2e/run-sales-csv-fixture.sh
```

The runner acquires the shared browser lock, starts an isolated loopback Next.js development server and closes its process group on exit.
The `/e2e/sales-csv` fixture returns 404 in production or without `E2E_FIXTURES_ENABLED=1`.
Playwright intercepts every Supabase request and rejects unexpected external traffic.
The 1440-by-900 desktop and 390-by-844 phone journeys upload a real CSV, exercise keyboard selection and staging, verify no writes before confirmation, and inspect the exact USD mutation payload.
Screenshots, request-failure diagnostics and results are retained in the reported `/tmp/tcg-sales-csv-browser-*` directory.

This supports the CSV entry point to CUJ 13; mocked transport does not establish database, FIFO, ledger or hosted acceptance.
No CUJ coverage status is promoted by this change.

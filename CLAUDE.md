# TCG Tracker Frontend

> **Keep this file up to date.** When you add features, change architecture, or modify conventions, update the relevant sections here so future developers and AI assistants have accurate context.

## Quick Reference

| Item | Detail |
|------|--------|
| Framework | Next.js 15 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui (base-nova theme), dark mode only |
| Backend | Supabase (auth, database, edge functions) |
| Tables | TanStack React Table v8 |
| Icons | Lucide React |
| i18n | Custom hook-based system (en, ja) |
| Deploy | Vercel |
| Dev server | `npm run dev` (port 3000) |
| Type check | `npx tsc --noEmit` |
| Build | `npm run build` (run after changes to catch Next.js-specific errors) |

## Project Purpose

A trading card game price tracking dashboard. Users browse Pokémon and MTG card listings aggregated from multiple marketplaces, compare buy/sell prices across locations, see ROI calculations, and optionally convert prices between currencies.

## Directory Structure

```
app/
  layout.tsx              # Root layout (dark theme, Geist font)
  page.tsx                # Redirects to /login
  globals.css             # Tailwind theme (oklch colors)
  auth/callback/route.ts  # Google OAuth callback
  dashboard/
    layout.tsx            # Auth guard, renders DashboardShell
    page.tsx              # Renders CardBrowser
    DashboardShell.tsx    # Context providers + sidebar + header
    AppSidebar.tsx        # Navigation, game picker, user settings menu
    CardBrowser.tsx       # Search filters + data table + modal trigger
    CardDetailModal.tsx   # Card detail dialog with buy/sell listing tables
    data-table.tsx        # Generic TanStack React Table wrapper
    columns.tsx           # Column definitions + PriceCell component
    use-card-data.ts      # Data fetching hook + caching + price computation
    GameContext.tsx        # Active game (pokemon/mtg) + PSA mode
    HeaderContext.tsx      # Dynamic header actions slot
    LanguageContext.tsx    # Language state (en/ja), localStorage persisted
    CurrencyContext.tsx    # Display currency (none/USD/JPY), localStorage persisted
components/ui/            # shadcn/ui primitives (do not edit directly unless customizing)
lib/
  utils.ts                # cn() utility (clsx + tailwind-merge)
  i18n/
    index.ts              # useTranslation() hook, t() function, TranslationKey type
    en.ts                 # English translations (source of truth for keys)
    ja.ts                 # Japanese translations (must match en.ts keys exactly)
  supabase/
    client.ts             # Browser-side Supabase client
    server.ts             # Server-side Supabase client (cookie-based)
    middleware.ts          # Session refresh middleware
hooks/
  use-mobile.ts           # useIsMobile() — 768px breakpoint
middleware.ts             # Next.js middleware entry (delegates to supabase/middleware)
supabase/
  config.toml             # Local Supabase dev config
  functions/
    update-exchange-rates/ # Deno edge function for rate updates
```

## Architecture & Patterns

### Context Provider Hierarchy

Providers wrap in this order inside `DashboardShell.tsx`:

```
LanguageProvider
  CurrencyProvider
    GameProvider
      HeaderProvider
        SidebarProvider
          AppSidebar + SidebarInset (header + main)
```

Each context follows the same pattern:
1. `createContext<T | null>(null)`
2. Provider component with state (optionally localStorage-persisted)
3. `useX()` hook that throws if used outside provider

### Data Fetching (`use-card-data.ts`)

- `useCardData()` is the main hook. It fetches card definitions + market listings from Supabase, computes price summaries (lowest buy, highest sell, ROI), and returns `CardRowData[]`.
- Filters: game, PSA mode, name search, card number, set code, selected tiers.
- 300ms debounce on filter changes. AbortController cancels stale requests.
- Three caches (module-level singletons, persist for the browser session):
  - `rateMapCache` — exchange rates (currency → USD rate)
  - `conditionsCache` — condition_id → tier mapping + available tiers
  - `locationMapCache` — location_id → name

### Price Display & Currency Conversion

Prices flow through two layers:

1. **Normalized prices** (`normalizedPrice` on `PriceEntry`) — always converted to USD using `rateMap` for sorting/ROI. This happens in `computePriceSummaries()`.
2. **Display conversion** (`CurrencyContext`) — when user selects a target currency (USD/JPY), `convertPrice()` converts the original price for display. When "none", original currency symbol + price shown as-is.

Conversion formula: `price * rateMap[fromCurrency] / rateMap[targetCurrency]` (USD rate = 1).

### i18n System

- Translation keys defined in `lib/i18n/en.ts` (source of truth).
- `ja.ts` must have the exact same keys (enforced by TypeScript).
- `TranslationKey` type is derived from `keyof typeof en`.
- Supports parameter interpolation: `t("key", { param: value })` replaces `{param}` in the string.
- When adding new UI text: add the key to both `en.ts` and `ja.ts`.

### Table System

- `DataTable` in `data-table.tsx` wraps TanStack React Table.
- Column definitions created by `createColumns(t, showSecond)` in `columns.tsx`.
- Features: sorting (with nulls-last), pagination (50 rows/page), column visibility, row click handler.
- `PriceCell` component handles currency conversion via `useCurrency()`.

### Card Detail Modal

- `CardDetailModal.tsx` fetches its own listings independently (not from the table data).
- Displays buy/sell listings in side-by-side tables, separated by Non-PSA/PSA tabs.
- Has its own tier filter dropdown.
- Uses `useCurrency()` for price conversion in `ListingTable`.

## Database Schema (from Supabase)

| Table | Key Columns |
|-------|-------------|
| `pokemon_card_definitions` / `mtg_card_definitions` | card_id, regional_name, set_code, card_number, misc_info, image_url |
| `pokemon_market_listings` / `mtg_market_listings` | card_id, price_type (Buy/Sell), price, currency, psa_grade, condition, location_id |
| `currencies` | code (PK), symbol |
| `exchange_rates` | from_currency, to_currency, rate |
| `conditions` | condition_id, tier |
| `locations` | location_id, name |

The listings tables have a foreign key to `currencies` — queries join via `currencies(symbol)`.

## Conventions

- **"UNKNOWN" as null**: Card fields (`card_number`, `misc_info`) may contain the string `"UNKNOWN"`. Treat these as null/empty throughout the UI. Never display "UNKNOWN" to users.
- **"use client"**: All dashboard components are client components. Server components are only used for layouts and the auth callback route.
- **localStorage keys**: `language`, `displayCurrency` — used for persisting user preferences.
- **No test framework** is currently configured.
- **shadcn/ui components** live in `components/ui/`. These are generated files — customize only when needed, prefer wrapping over modifying.
- **Icons**: Import from `lucide-react`. Don't add other icon libraries.
- **Type safety**: Translation keys are type-checked. Supabase queries return `unknown` records that are explicitly cast in mapping functions.

## Adding a New Feature — Checklist

1. If it needs new UI text, add keys to both `lib/i18n/en.ts` and `lib/i18n/ja.ts`.
2. If it needs new global state, create a context following the `LanguageContext` pattern and add the provider to `DashboardShell.tsx` in the correct position.
3. If it touches price display, integrate with `CurrencyContext.convertPrice()`.
4. If it adds a new Supabase table/column, document it in the Database Schema section above.
5. Run `npm run build` to verify no type or build errors.
6. **Update this CLAUDE.md** with any architectural changes.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/publishable key |

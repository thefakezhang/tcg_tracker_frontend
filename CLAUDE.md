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
    page.tsx              # Conditionally renders CardBrowser or BuyListView
    DashboardShell.tsx    # Context providers + sidebar + header
    AppSidebar.tsx        # Navigation, game picker, buy lists, user settings menu
    CardBrowser.tsx       # Search filters + data table + modal trigger
    CardDetailModal.tsx   # Card detail dialog with buy/sell listing tables + add to buy list
    BuyListContext.tsx     # Buy list state + CRUD operations (fetch, create, delete, add/remove entries)
    BuyListView.tsx       # Buy list card view (merges pokemon + mtg entries, list/grid with compact toggle)
    data-table.tsx        # Generic TanStack React Table wrapper
    columns.tsx           # Column definitions + PriceCell component
    use-card-data.ts      # Data fetching hook (paginated queries against pre-computed summary tables)
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
    aggregate-prices/      # Deno edge function: pre-computes price summaries into DB tables
```

## Architecture & Patterns

### Context Provider Hierarchy

Providers wrap in this order inside `DashboardShell.tsx`:

```
LanguageProvider
  CurrencyProvider
    GameProvider
      BuyListProvider
        HeaderProvider
          SidebarProvider
            AppSidebar + SidebarInset (header + main)
```

Each context follows the same pattern:
1. `createContext<T | null>(null)`
2. Provider component with state (optionally localStorage-persisted)
3. `useX()` hook that throws if used outside provider

### Data Fetching (`use-card-data.ts`)

- `useCardData()` is the main hook. It queries pre-computed `{game}_price_summaries` tables with server-side pagination, sorting, and filtering. Joins card definitions via `!inner` foreign key.
- Filters: game, PSA mode, name search, card number, set code, single selected tier.
- AbortController cancels stale requests. No client-side caching needed (queries are fast paginated reads).
- The `aggregate-prices` edge function pre-computes summaries from raw listings into `pokemon_price_summaries` / `mtg_price_summaries`. Invoke it to refresh data.
- Three caches still exist for `CardDetailModal` use:
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
- "Add to Buy List" button (popover) lets users save cards to any buy list.

### Buy Lists

- `BuyListContext.tsx` manages buy list state and CRUD operations via Supabase.
- Buy lists are cross-game — a single list can contain both Pokémon and MTG cards.
- `BuyListView.tsx` fetches entries from both `pokemon_buylist_entries` and `mtg_buylist_entries`, joins to their respective summary/definition tables, and merges results client-side.
- When clicking an entry in BuyListView, `setActiveGame` is called so CardDetailModal fetches from the correct game table.
- Grid view has a compact toggle (default on) that hides price/ROI info on cards.
- Buy list description is shown as a tooltip on the header title.
- Sidebar shows all buy lists with a create dialog (uses Field/FieldGroup/Label pattern).
- Clicking a game in sidebar clears `activeBuylistId` to return to CardBrowser.

## Database Schema (from Supabase)

| Table | Key Columns |
|-------|-------------|
| `pokemon_card_definitions` / `mtg_card_definitions` | card_id, regional_name, set_code, card_number, misc_info, image_url |
| `pokemon_market_listings` / `mtg_market_listings` | card_id, price_type (Buy/Sell), price, currency, psa_grade, condition, location_id |
| `currencies` | code (PK), symbol |
| `exchange_rates` | from_currency, to_currency, rate |
| `conditions` | condition_id, tier |
| `locations` | location_id, name |
| `pokemon_price_summaries` / `mtg_price_summaries` | card_id, tier (-1 for PSA), psa_grade, best_buy_*, best_sell_*, roi, updated_at |
| `buylists` | buylist_id (PK), name, description, created_at, updated_at |
| `pokemon_buylist_entries` / `mtg_buylist_entries` | entry_id (PK), buylist_id (FK→buylists), card_id (FK→*_card_definitions), psa_grade (0-10, default 0), notes, added_at |

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

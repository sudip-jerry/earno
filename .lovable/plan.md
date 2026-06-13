## What you'll get

A **Currency** setting in your profile. Pick once in Settings and every money figure across the app (equity, today's PNL, drawdown, position PNL/size/margin, aggregate PNL in the top strip, opportunity risk amount) renders in that currency. **Default: INR (₹).** Choices: INR, USD, EUR, GBP, AED, SGD, JPY.

Coin prices stay in USDT (they're not money — they're the quote asset of the pair).

## How it works

- Store the choice in `public.profiles.currency` (text, default `'INR'`) — migration below. Persisted per user.
- New `useCurrency()` hook reads/writes the profile field via Supabase, falls back to localStorage while loading.
- New `getFxRates` server fn fetches USD→{INR,EUR,GBP,AED,SGD,JPY} from frankfurter.app every 30 min (cached in TanStack Query). USD→USD = 1.
- New `formatMoney(amountUsd, { code, symbol, rate })` helper: returns e.g. `₹1,247.50`, signed when needed.
- Settings page gets a "Display currency" segmented selector showing the current rate next to each option.
- Replace every hardcoded `$` / `.toFixed(2)` USD render across the app with the helper.

## Files

- **Migration**: `alter table public.profiles add column currency text not null default 'INR' check (currency in ('INR','USD','EUR','GBP','AED','SGD','JPY'))`.
- **New** `src/lib/fx.functions.ts` — `getFxRates` server fn (frankfurter.app, no key, graceful fallback to last-known/static map on failure).
- **New** `src/hooks/use-currency.ts` — returns `{ code, symbol, rate, fmt(usd, opts?), setCurrency }`. Loads profile row, subscribes to changes, caches rates.
- **Edit** `src/routes/_authenticated/settings.tsx` — add "Display currency" section with the 7-option selector.
- **Edit** money renders in:
  - `src/routes/_authenticated/index.tsx` — equity, today PNL, max drawdown.
  - `src/routes/_authenticated/positions.tsx` — `fmtUsd` total PNL strip, per-card Active PNL, Size, Margin.
  - `src/components/positions-strip.tsx` — aggregate PNL.
  - `src/components/opportunity-card.tsx` — risk amount.

## Out of scope

- Converting CoinDCX coin prices (entry/mark/LTP, target/stop %) — those stay in their native quote (USDT). The close-limit price stays in USDT for parity with the exchange order.
- Historical PNL re-conversion at the rate-of-trade-time. Conversion uses the current FX snapshot.

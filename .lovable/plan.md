## What you'll see

1. **Live PNL fix**: open positions will show real profit/loss that updates every few seconds — not stuck at 0%.
2. **Instrument label**: each position card shows a "Futures" or "Spot" pill so you know which wallet it belongs to.
3. **Market toggle**: a "Coins / Futures" switch at the very top of every page (Futures = default).
4. **Sticky Positions strip**: a compact open-positions panel pinned to the top of Dashboard, Scanner and Movers. It shows total live PNL, count, has a refresh button, and auto-refreshes every 3s like CoinDCX. Tap to open the full Positions page.
5. **Cleanup**: recommendations are removed from the Dashboard and live only in the Scanner (as you asked).

## How it works

**Live PNL (the real fix)**
The reason every position shows +0.00% is that `mark_price` is only written once at booking time and nothing updates it. We'll poll CoinDCX's public ticker every 3s on the client for the symbols you currently hold and recompute PNL/ROE in the UI from `(live_price - entry) * qty * side * leverage`. No DB write needed for display. (A periodic mark-price update job can come later; this gives you a live number now.)

**Instrument detection**
We'll add an `instrument` column (`futures` | `spot`) to `positions` via a migration, backfill existing rows from the symbol shape (`B-XXX_USDT` → futures, `XXX/USDT` → spot), and stamp it on every new booking. Card shows a small pill next to the side badge.

**Market toggle (Coins vs Futures)**
New `useMarketMode` hook (localStorage, default `futures`). A segmented control rendered inside the new top strip on Dashboard / Scanner / Movers. Scanner + Movers queries already accept `market`; we'll wire them to read from the hook instead of being hardcoded. ("Coins" = spot.)

**Sticky Positions strip (`<PositionsStrip />`)**
New shared component placed at the top of Dashboard, Scanner and Movers (above existing content, below the page header). Contents:
- Left: "Open N" + live aggregate PNL (green/red, signed USD)
- Right: refresh button (spins while fetching) + chevron link to `/positions`
- Auto-refresh: positions list every 5s, live ticker prices every 3s, plus existing realtime postgres subscription
Tapping the strip navigates to the full Positions page.

**Dashboard cleanup**
Remove the "Best opportunities now" section and the existing "Open positions" summary card from `index.tsx` (both are now covered by Scanner + the sticky strip).

## Files

- New: `src/hooks/use-market-mode.ts` — `{ market, setMarket }` with localStorage persistence, default `"futures"`.
- New: `src/hooks/use-live-prices.ts` — given a list of symbols, polls CoinDCX futures + spot ticker endpoints every 3s and returns `Record<symbol, price>`.
- New: `src/components/positions-strip.tsx` — sticky top strip with live aggregate PNL, refresh, market toggle, link to `/positions`.
- New SQL migration: `alter table public.positions add column instrument text check (instrument in ('futures','spot'))`; backfill existing rows from symbol shape; default new rows from the booking handler.
- Edit `src/lib/movers.functions.ts` — `bookManualTrade` writes `instrument` based on the `market` arg (already passed from UI).
- Edit `src/routes/_authenticated/positions.tsx` — use `useLivePrices` to override `mark_price` for display; compute live PNL/ROE in render; show `Futures` / `Spot` pill; strip stays at top (it already is the whole page).
- Edit `src/routes/_authenticated/index.tsx` — drop the opportunities section and the positions summary card; mount `<PositionsStrip />` at the top.
- Edit `src/routes/_authenticated/scanner.tsx` and `movers.tsx` — mount `<PositionsStrip />` at the top; read `market` from `useMarketMode` instead of hardcoding.

## Out of scope

- Server-side mark-price updater / cron — not needed to fix the visible 0% issue; can be added later.
- Changes to bot logic, auto-book thresholds, or strictness presets.

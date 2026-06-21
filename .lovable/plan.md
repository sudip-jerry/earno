## Problem

When the top market toggle is set to **Coins**, the UI feels stripped down:
- Dashboard shows only a status line + three small panels (no hero, no KPIs, no bot health, no activity).
- Scanner shows just a signals list (no filters, no portfolio context, no scan meta).
- Positions shows only a holdings table (no realized PnL strip, no daily summary, no closed trades).
- Settings (mode, capital, max holdings, min confidence, scan interval) are only reachable on the `/coin-bot` route, not from the toggle-driven views.

The Futures side, by contrast, has hero, wealth strip, bot health, recommendations, recent activity, etc.

## Goal

Bring the **Coins** view to rough parity with **Futures** on the three toggle-aware pages — same shape, same density, coin-flavoured content — and surface settings inline so the user never has to leave the page.

## Scope (UI only — no trading-logic, route, or schema changes)

Reuse existing server functions in `src/lib/coin-bot/coin-bot.functions.ts`:
`getCoinPortfolio`, `getCoinSignals`, `getCoinHoldings`, `getCoinConfig`, `updateCoinConfig`, `runCoinScan`, `paperBuyCoin`, `paperSellCoin`.

### 1. New shared components under `src/components/coin-bot/`

- **`coin-hero.tsx`** — Dashboard hero card: allocated capital, available cash, invested, realized today, unrealized PnL (sum across open holdings), bot On/Off pill, last scan time. Mirrors the futures wealth hero density.
- **`coin-kpi-strip.tsx`** — 4 compact tiles: Win rate (today), Trades today, Best coin, Worst coin. Computed from `getCoinHoldings` summary + a small closed-trades aggregate (already returned by holdings function — read the file first to confirm shape; if not, derive from `open` + `summary` only, no new server work).
- **`coin-bot-health.tsx`** — Status card: bot enabled, mode (Intraday/Swing), scan interval, max holdings, min confidence, allocated capital. Inline edit via `updateCoinConfig` (toggle + segmented + small number inputs). Replaces the hidden cog panel.
- **`coin-recent-activity.tsx`** — Last 5–10 closed coin trades from holdings response (if exposed; otherwise hide gracefully).
- **`coin-scanner-toolbar.tsx`** — Scan button, last-scan timestamp, action filter pills (All / Buy / Hold / Wait / Avoid), search input.

If `getCoinHoldings` / `getCoinPortfolio` don't already return closed trades or last-scan time, the components render gracefully without them — no server-function changes in this plan.

### 2. Page-level wiring (toggle-aware, `market === "spot"` branches)

- **`src/routes/_authenticated/index.tsx`** (Dashboard): replace the current minimal spot branch with:
  `CoinHero` → `CoinKpiStrip` → `CoinBotHealth` → `CoinSignalsList` (top 5, "See all" → `/scanner`) → `CoinHoldingsCard` (compact) → `CoinRecentActivity`.
- **`src/routes/_authenticated/scanner.tsx`** (spot branch): `CoinScannerToolbar` → full `CoinSignalsList` with filter applied.
- **`src/routes/_authenticated/positions.tsx`** (spot branch): `CoinPortfolioCard` → `CoinHoldingsCard` (full) → `CoinRecentActivity`.

### 3. Minor

- Keep `/coin-bot` route working but make it a thin alias that renders the same Dashboard spot view (or leave as-is — decide during implementation, default: leave as-is to avoid route churn).
- Branding tokens: black `#0B0B0B`, blue `#0D1B3D`, accent `#1E3A8A`, light gray `#F1F3F6`, white. No emoji.
- Use existing Tailwind/shadcn primitives; no new deps.

## Out of scope

- No changes to `scorer.ts`, server functions, migrations, or route tree.
- No new server functions, no Futures-side changes, no tab-bar changes.
- No design-directions round (visual parity with existing Futures cards — deterministic edit).

## Files touched

- **Create**: `src/components/coin-bot/coin-hero.tsx`, `coin-kpi-strip.tsx`, `coin-bot-health.tsx`, `coin-recent-activity.tsx`, `coin-scanner-toolbar.tsx`
- **Edit**: `src/routes/_authenticated/index.tsx`, `src/routes/_authenticated/scanner.tsx`, `src/routes/_authenticated/positions.tsx`
- **Edit (optional)**: `src/components/coin-bot/coin-panels.tsx` to export a `compact` variant of `CoinHoldingsCard`.

## Verification

After build: toggle to Coins on Dashboard, Scanner, Positions at 430×778 mobile viewport; confirm hero, KPIs, bot-health settings editor, signals, holdings, and activity all render and that toggling Bot On/Off + changing Mode persists via `updateCoinConfig`.

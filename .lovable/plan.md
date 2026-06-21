## Goal

Add a second, parallel paper-trading engine — **Coin Paper Bot** — alongside the existing **Futures Paper Bot**, without touching the futures algo, futures routes, futures scripts, or futures tables unless strictly required. Both engines use real CoinDCX public market data only. No live orders, no API keys, no dummy prices.

## Scope rules

- Do NOT modify `auto-book.server.ts` futures logic, futures fee model, futures exit logic, or `positions` table schema beyond adding a single nullable `market_kind` column to distinguish futures vs coin rows (or use a new table — see Decision A).
- Do NOT touch existing futures routes (`/positions`, `/scanner`, `/bot`, `/beta-report`) except for additive UI: market-type filter pill in scanner, split sections in portfolio.
- No emoji icons anywhere. Use professional status pills.
- Branding tokens applied via `src/styles.css` semantic CSS variables, not hardcoded hex in components.

## Decision A — storage shape

Use a **separate `coin_positions` table** rather than overloading `positions`. Reason: futures rows have leverage/margin/TP-SL-price columns that are meaningless for coin holdings; mixing them risks breaking the futures algo's queries. Keeps blast radius zero on the futures side.

New tables (with GRANTs + RLS per project rules):

- `coin_bot_config` — per user: enabled, mode (`intraday` | `swing`), allocated_capital_usdt, available_cash_usdt, max_holdings, min_confidence, scan_interval_min, max_holding_days
- `coin_positions` — id, user_id, symbol, display, qty, avg_buy_price, last_price, status (`open`|`closed`), opened_at, closed_at, realized_pnl_usdt, unrealized_pnl_usdt, exit_reason, mode, target_price, stop_price, max_holding_until, notes
- `coin_signals` — id, user_id, symbol, action (`buy`|`sell`|`hold`|`wait`|`avoid`), confidence, price, buy_zone_low, buy_zone_high, target, stop, reason_short, reason_detail (jsonb), created_at, mode

## Decision B — signal source

Reuse `src/services/coindcxPublicApi.ts` (`fetchFuturesTickers` + `fetchCandles`). Coin universe = all `B-*_USDT` tickers from the same public board (CoinDCX exposes spot via futures-mirrored symbols on the public endpoint we already use). For each candidate, fetch 1m/5m/30m candles via `fetchMultiTimeframe` and score with a coin-mode scorer that ignores leverage/funding.

## Files to add

```
src/lib/coin-bot/
  scorer.ts                 # pure: candles → {action, confidence, target, stop, reason}
  engine.server.ts          # privileged scan + open/close paper trades (service role, called from cron)
  coin-bot.functions.ts     # createServerFn: getCoinPortfolio, getCoinSignals, getCoinHoldings,
                            #                  paperBuy, paperSell, getCoinConfig, updateCoinConfig
src/routes/_authenticated/
  coin-bot.tsx              # Coin Bot screen: signals list + holdings table + config drawer
src/routes/api/public/hooks/
  coin-scan.ts              # cron-callable: runs engine.server.ts scan for all enabled users
src/components/coin-bot/
  signal-card.tsx
  holdings-table.tsx
  why-coin-panel.tsx
src/hooks/use-market-type.ts # filter state for scanner: 'futures' | 'coin' | 'all'
supabase/migrations/<ts>_coin_bot.sql
```

## Files to edit (additive only)

- `src/routes/_authenticated/positions.tsx` — split into **Total / Futures / Coin** summary cards. Futures section reads existing data unchanged; Coin section reads new server fns.
- `src/routes/_authenticated/scanner.tsx` — add market-type pill (Futures / Coin / All). Futures path unchanged; Coin path renders coin signals.
- `src/routes/_authenticated/route.tsx` (or tab bar) — add **Coin Bot** tab.
- `src/components/tab-bar.tsx` — add Coin Bot entry.
- `src/styles.css` — add brand tokens: `--brand-black #0B0B0B`, `--brand-blue #0D1B3D`, `--brand-blue-accent #1E3A8A`, `--brand-gray #F1F3F6`. Map to semantic tokens; do not hardcode in components.
- `src/integrations/supabase/types.ts` — regenerated after migration.

## Coin Bot scoring (engine)

Pure function over 1m/5m/30m candles + 24h change. Outputs one of:

- `buy` — 5m + 30m EMA trending up, RSI 50–70, volume > 1.5x avg, confidence ≥ min
- `sell` — open holding hit target / stop / 5m trend break / momentum fade / max holding reached / better-opportunity rotation
- `hold` — open holding, trend intact, no exit trigger
- `wait` — setup forming, confidence below threshold
- `avoid` — downtrend, low volume, or wide spread

No 12-min / 180-min force close. Exit only on listed triggers.

## Modes

- **Intraday Coin Mode**: scan every 3 min, prefer short-term momentum, allow overnight carry if trend valid.
- **Swing Coin Mode**: scan every 15 min, hold across days, exit only on signal/stop/target/trend break. `max_holding_days` default 7.

## Cron

New row via `supabase--insert` (NOT migration, per project rules) calling `/api/public/hooks/coin-scan` every 3 minutes. Handler verifies `CRON_SECRET`, iterates enabled coin-bot users, calls engine for each.

## Portfolio page layout

```text
[ Total Portfolio ]
  total value | virtual cash | realized | unrealized | today | open | closed | drawdown

[ Futures Paper Bot ]            [ Coin Paper Bot ]
  allocated / available / margin   allocated / cash / holdings value
  open positions                   active holdings count
  realized / unrealized            realized / unrealized
  trades today                     best / worst coin
```

Each section links to its dedicated screen (Futures → `/positions` existing, Coin → `/coin-bot`).

## Coin Bot screen

- **Signals list** — cards: coin, action pill, confidence %, current price, buy zone, target, stop, holding status, short reason, [Paper Buy] [Paper Sell] [Why?]
- **Holdings table** — coin, qty, avg buy, current, value, unrealized PnL, realized PnL, holding duration, bot action (Hold/Sell/Add), exit reason if sold
- **Why panel** — status pills only (Trend / Momentum / Volume / Spread / Risk), no emoji, no raw numbers on main UI

## Scanner update

Single filter pill row at top: `[Futures] [Coin] [All]`. Default = Futures (preserves current behavior). Coin tab renders coin signals from `getCoinSignals`. UI shows Action / Confidence / Reason / Status / Risk only — technicals stay inside Why.

## What stays unchanged

- All futures algo files: `auto-book.server.ts`, `signal-scoring.server.ts`, `fees.ts`, `beta-report.functions.ts`, futures cron `mark-positions.ts` and `auto-book.ts` hooks, `positions` table.
- Existing paper futures engine `paperTradingEngine.ts`.

## Open questions before implementing

1. **Coin Bot starting virtual capital** — default to **5,000 USDT** allocated, separate from futures wallet? Or share one virtual wallet split by allocation slider?
2. **Coin universe size** — scan all ~150 `B-*_USDT` symbols every cycle, or top 50 by 24h volume? (Smaller = faster, fewer public-API calls.)
3. **Should the Coin Bot tab be visible to all users immediately, or gated behind a feature flag / plan tier like the futures bot is?**

If you confirm sensible defaults (5000 USDT, top 50 by volume, visible to all authenticated users) I'll proceed.


# CoinDCX Futures Auto-Trading Bot

## ⚠️ Important upfront context

- **Real money risk.** Live mode places real CoinDCX futures orders. Bugs, network blips, or API errors can cause real losses. We start in **paper mode by default**; live mode requires an explicit confirm + typed phrase.
- **CoinDCX availability.** CoinDCX's public futures API is geographically and account-tier restricted. Some endpoints require KYC + futures-enabled accounts. We'll surface clear errors if your key lacks permissions.
- **No financial advice.** EMA crossover is a simple trend-following heuristic. It loses in choppy markets. Treat this as a tool you supervise, not a "set and forget" income machine.

## What we're building

A web app where you:
1. Log in (Lovable Cloud auth).
2. Paste CoinDCX API key + secret (stored encrypted, server-side only).
3. Configure risk caps (leverage, % risk/trade, max positions, daily loss limit, capital per trade).
4. Toggle **Paper ↔ Live**.
5. Start/stop the bot. Watch live positions, P&L, trade log, and equity curve.

## The algorithm

**Scanner (runs every 5 min via cron):**
1. Pull all USDT-margined perpetual futures from CoinDCX.
2. Fetch 1h price change for each. Rank.
3. Take top N gainers (long candidates) + top N losers (short candidates), N from UI.

**Signal (per candidate symbol, on 15m candles — configurable):**
1. Compute EMA(9) and EMA(21).
2. **Long entry:** EMA9 crosses above EMA21 AND symbol is in top-gainers list AND last candle close > EMA21.
3. **Short entry:** EMA9 crosses below EMA21 AND symbol is in top-losers list AND last close < EMA21.
4. Skip if a position is already open on that symbol, or if account caps would be breached.

**Position sizing:**
`position_size = (account_equity × risk_pct) / (entry_price × stop_distance_pct)` — so a 2% SL with 2% account risk = 1× equity notional, then leverage is applied within your cap.

**Exits:**
- **Take-profit:** +3% from entry (net of fees estimate).
- **Stop-loss:** −2% from entry, hard stop placed on exchange immediately after entry fills.
- **Trailing:** once price moves +1% in favor, ratchet SL to break-even; then trail at 1% behind highest favorable price (longs) / lowest (shorts).
- **Time stop:** close after 24h if neither TP nor SL hit (configurable).

**Safety circuit-breakers:**
- Daily realized-loss cap → bot pauses 24h.
- Consecutive-loss cap (e.g. 4) → pause until manual resume.
- Exchange API error rate spike → pause + alert.
- Kill switch button → cancel all open orders + close all positions at market.

## Tech architecture

- **Frontend:** TanStack Start (existing template). Dashboard, settings, trade log, equity chart.
- **Backend:** Lovable Cloud (Supabase). Tables: `api_credentials` (encrypted), `bot_config`, `positions`, `trades`, `equity_snapshots`, `bot_events` (log).
- **Server functions** (`createServerFn`): CoinDCX REST calls (HMAC-signed with user's secret), strategy evaluation, order placement, paper-trading simulator.
- **Public cron route** (`/api/public/tick`) called every minute by Supabase `pg_cron` → runs the scanner + manages open positions. Signature-protected.
- **Paper mode:** uses live CoinDCX market data but routes orders to a simulated portfolio table; identical code path otherwise.
- **AI Gateway (optional later):** end-of-day summary of bot behavior in plain English.

## Design direction

Trader-dashboard aesthetic, dark by default, dense but legible:
- **Top bar:** Paper/Live toggle (red pill when Live), account equity, daily P&L, kill switch.
- **Left:** strategy config (EMAs, TF, TP/SL/trailing, risk caps, scanner thresholds).
- **Center:** open positions table (symbol, side, entry, mark, P&L, SL, TP, age) + equity curve sparkline.
- **Right:** live trade log stream + bot event log (signals, skips with reason, errors).
- **Bottom:** historical trades table with win rate, avg R, profit factor.
- Color tokens: bg `oklch(0.18 0.02 250)`, green `oklch(0.72 0.18 145)`, red `oklch(0.65 0.22 25)`, amber for warnings.

I'll generate 2–3 rendered design directions before building so you can pick the layout you want.

## Build phases

1. **Phase 1 — Foundation:** Auth, DB schema, settings UI, encrypted API-key storage, CoinDCX connectivity test button (read-only: balance + symbols).
2. **Phase 2 — Paper engine:** Scanner + EMA signals + simulated order book + positions/trades persistence + dashboard.
3. **Phase 3 — Live engine:** Signed CoinDCX order placement, real SL/TP orders, reconciliation loop, kill switch.
4. **Phase 4 — Safety + polish:** Circuit breakers, daily caps, trade log filters, equity chart, optional AI daily summary.

Each phase ends with the app usable; you approve before moving to the next.

## Open items I need from you before Phase 3

- Confirmation you have CoinDCX **Futures API access enabled** on your account (separate from spot).
- Whether to support **isolated** margin only, **cross** only, or both (recommend isolated for safety).

---

Approve this plan and I'll start with Phase 1 + generate design directions for the dashboard.

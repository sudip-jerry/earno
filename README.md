# EarnO — Crypto Futures & Spot Intelligence Platform

![Status](https://img.shields.io/badge/status-Paper%20Optimisation-orange.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)
![Phase](https://img.shields.io/badge/phase-Entry%20Quality-yellow.svg)

**Live**: [earno.lovable.app](https://earno.lovable.app)

EarnO is a beginner-friendly crypto futures and spot trading intelligence platform built on CoinDCX. It runs a fully automated paper-trading bot, learns from trade history, and adapts its configuration automatically — with the goal of eventually delivering profitable live trading with controlled risk.

The platform is **not** a single trading algorithm. It is a five-layer system:

```
Signal Engine → Risk Engine → Execution Engine → Learning Engine → Recommendation Engine
```

---

## Core Philosophy

> Optimise for positive expectancy, not maximum trades.

- Profit Factor > 1 is the primary success metric
- Fewer high-quality trades beat many low-quality trades
- Net PnL after fees is the real scoreboard — gross PnL is irrelevant
- The system learns from trade history and converges toward better configuration automatically
- Exit protection is designed and validated first; entry quality is the current focus

---

## System Architecture

```
Browser (React 19 + TanStack Router)
  └── TanStack Start SSR + createServerFn handlers
       ├── Supabase Auth + PostgreSQL
       ├── Auto-book cron   /api/public/hooks/auto-book
       ├── Mark-positions cron   /api/public/hooks/mark-positions
       └── Coin-scan cron   /api/public/hooks/coin-scan

Market Data (public endpoints, no API key required for paper mode)
  ├── CoinDCX futures ticker
  ├── CoinDCX spot ticker
  └── CoinDCX OHLCV candles

Execution (live mode only)
  └── CoinDCX signed order APIs
```

**Stack**: TanStack Start · React 19 · Nitro / Cloudflare Workers · Supabase PostgreSQL · TypeScript 5.8+ · Tailwind CSS 4 · Radix UI · TanStack Query 5

---

## Trading Modules

### Futures Bot

Automated scalp trading on CoinDCX perpetual futures (USDT pairs).

**Signal layer**
- Multi-timeframe candles: 1m, 5m, 30m, 1h
- Indicators: RSI, VWAP, EMA stack (9/21), ATR, volume spike ratio, spread proxy
- Market regime detection: bullish / bearish / neutral derived from 24h price change
- Confidence score 0–100. Bias is long or short only when ≥ 2 of (trend, VWAP, EMA) agree

**Exit stack** — implemented and validated; do not duplicate
- Stop loss · Take profit
- TP1 on 50% size with breakeven arming
- Move to breakeven · Trailing stop
- Profit fade exit · Profit protection exit
- Weak-progress time exit · Pre-TP1 failed momentum exit

**Validated finding**: SL-after-BE = 0 and SL-after-TP1 = 0 across the full trade history. Exit protection is solved. Current bottleneck is entry quality.

### Coin (Spot) Bot

Automated spot trading on CoinDCX. Portfolio-style: holds multiple assets simultaneously and waits for breakouts. Uses 1m/5m/30m signals. Produces: buy / sell / hold / wait / avoid.

**Validated finding**: coin bot performance scales with the number of concurrent holdings. Fewer holdings produces worse outcomes because spot trading requires diversification — winners carry the flat positions. This is the opposite of futures.

---

## Entry Quality Gates (Auto-Book)

Gates fire sequentially before a position is opened. Any rejection skips the trade and logs to `bot_signals` with a structured reason visible in the activity feed.

| Gate | What it blocks |
|---|---|
| Regime filter | Shorts in bullish regime; longs in bearish regime |
| Confidence threshold | Signals below the configured minimum |
| Session hour block | High-noise market transition windows (configurable by style) |
| SL width cap | ATR-derived stop distance exceeds the per-style hard cap |
| EV ratio | `(confidence × TP%) / ((1 − confidence) × SL%)` below minimum |
| Pre-entry fee gate | Projected net PnL at TP does not clear entry + exit fees + GST |
| Pre-exit fee gate | Realised net too small to exit profitably |

**Why session blocking**: market transition hours produce significantly more false breakouts than mid-session hours. The system blocks auto-booking during identified high-noise windows and allows it during historically higher-quality windows.

**Why EV ratio**: a trade can pass the confidence threshold but still have negative expected value if the stop is wide relative to the target. The EV gate catches this before booking.

**Why the fee gate**: with taker fees and GST, round-trip cost on notional is approximately 0.12%. Setups with small targets are gross winners but net losers after fees. The fee gate rejects these at entry, not at exit.

---

## Concurrency Architecture

### Futures: concentrate, do not diversify

Multiple concurrent futures positions entered in the same market regime are positively correlated — when one fails, they all fail. Data confirms profit factor degrades sharply beyond 2 concurrent positions. The system queues signals rather than piling in.

**Design principle**: max 1–2 open futures positions at any time, varying by style.

### Coins: diversify, do not concentrate

Spot coin holdings are negatively correlated in outcome — any one holding may go flat, but the basket as a whole benefits when a breakout occurs. Data confirms profit factor approaches 1.0 only at 5+ concurrent holdings.

**Design principle**: max holdings should be high (configured at 8), not low.

---

## Symbol Management

### Direction-specific cooldown (futures)
`(symbol, side)` pairs cool independently after repeated hard stop-losses. A symbol on short cooldown remains available for long entries and vice versa. Cooldowns are user-cross (triggered by any user's losses on the symbol).

### Symbol blocklist (futures + coins)
Persistent per-user blocklists stored on config. Symbols with statistically poor win rates in a given direction are added and reviewed periodically.

---

## Coin Bot: Swing vs Intraday

The coin scorer differentiates behaviour by mode:

- **Intraday**: primary signal from 5m trend; tight stop; momentum-fade exits enabled; frequent scans
- **Swing**: primary signal from 30m trend; wider stop to absorb intraday noise; momentum-fade and trend-break exits suppressed (5m signals do not close a swing position); less frequent scans

---

## Learning & Recommendation Engine

- RAG status (red / amber / green) computed continuously from recent trade patterns
- Critical recommendations auto-applied when the bot is running and status is red
- All recommendations are config field patches — no code branches per user
- Plain-English explanations for every trigger and every change surfaced in the UI

Auto-tune triggers: loss-streak · daily-bleed · sl-dominated · shorts-bleeding · longs-bleeding · low-profit-factor · overtrading · wide-net · slow-blocklist

---

## Dashboard Design Principles

Built around one question for a beginner: **"Is my bot making money and is it getting better?"**

- Hero: portfolio value + today's P&L + 14-day daily bar chart (green/red per day) + total P&L + % return on capital
- Bot status: running / paused / cooldown + reason in plain English
- Recommendations: RAG panel with one-tap apply
- Activity feed: every auto-book, skip, and gate rejection shown with a plain-English explanation — not raw system codes
- No jargon on the home screen: no SL rate, no confidence scores, no fee breakdowns, no profit factor number

---

## Architecture Constraints

These must not be violated when extending the system:

1. **No hardcoded user groups** — all behaviour derives from config field values; no branching on user identity in code
2. **No second exit system** — the existing exit stack is the only exit system; do not add parallel exit logic
3. **No schema bloat** — extend existing fields before adding new tables
4. **No strategy rewrites from a single bad day** — diagnose from aggregated data first
5. **No manual config tweaking as the primary adaptation mechanism** — the recommendation engine owns adaptation
6. **Futures and coin modules are independent** — they do not share execution paths

---

## Development

```bash
bun install
bun run dev        # http://localhost:5173
bunx tsgo --noEmit # typecheck
bun run build
```

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
CRON_SECRET=your_cron_secret
```

---

## Disclaimer

EarnO is a paper-trading optimisation platform. All live trading carries substantial financial risk. The developers assume no liability for trading losses. Always validate with paper mode before enabling live trading.

---

*Last updated: June 2026 · Current phase: Entry quality optimisation*

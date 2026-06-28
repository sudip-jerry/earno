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
- Net PnL after fees is the real scoreboard (gross PnL is irrelevant)
- The system learns from thousands of trades and converges toward better config automatically
- Exit protection is solved first; entry quality is the current focus

---

## System Architecture

```
Browser (React 19 + TanStack Router)
  └── TanStack Start SSR + createServerFn handlers
       ├── Supabase Auth + PostgreSQL
       ├── Auto-book cron  (/api/public/hooks/auto-book)
       ├── Mark-positions cron  (/api/public/hooks/mark-positions)
       └── Coin-scan cron  (/api/public/hooks/coin-scan)

Market Data (all public, no API key required for paper mode)
  ├── CoinDCX futures ticker: /market_data/v3/current_prices/futures/rt
  ├── CoinDCX spot ticker:    /exchange/ticker
  └── CoinDCX candles:        /market_data/candles

Execution (live mode only)
  └── CoinDCX signed order APIs (balance / wallet / place order)
```

**Stack**: TanStack Start 1.167+ · React 19 · Nitro/Cloudflare Workers · Supabase PostgreSQL · TypeScript 5.8+ · Tailwind CSS 4 · Radix UI · TanStack Query 5

---

## Trading Modules

### Futures Bot
Automated scalp trading on CoinDCX perpetual futures (USDT pairs).

**Signal layer**: 1m/5m/30m/1h candles · RSI · VWAP · EMA stack (9/21) · ATR · volume spike ratio · spread proxy · market regime detection (bullish/bearish/neutral per 24h change).

**Scoring**: 0–100 confidence. HIGH ≥ 80, MEDIUM ≥ 65, LOW ≥ 55, AVOID < 55. Bias is long or short only when ≥ 2 of (trend, VWAP, EMA) agree. Regime mismatch (e.g. short in bullish regime) is filtered at auto-book gate.

**Exit stack** (implemented, not to be duplicated):
- Stop loss · Take profit · TP1 (50% size at TP1 price, arms breakeven)
- Move to breakeven · Trailing stop · Profit fade exit
- Profit protection exit · Weak-progress time exit
- Pre-TP1 failed momentum exit

**Key confirmed finding**: SL-after-BE = 0, SL-after-TP1 = 0 across 1,688 closed trades. Exit protection is solved. Current bottleneck is **entry quality**.

### Coin (Spot) Bot
Automated spot trading on CoinDCX. Portfolio-style: holds multiple assets and waits for breakouts. Uses 1m/5m/30m signals. Scores: buy / sell / hold / wait / avoid.

**Key confirmed finding**: Coin bot performs best with 5+ concurrent holdings (profit factor 1.009 vs 0.22–0.43 at lower counts). This is the opposite of futures — spot requires diversification, futures requires concentration.

---

## User Config Groups (Paper Phase)

All behaviour derives from config fields. No hardcoded group logic in code.

| Field | Aggressive | Balanced | Conservative |
|---|---|---|---|
| trading_style | aggressive | balanced | conservative |
| timeframe | 3m | 15m | 15m |
| leverage | 3 | 3 | 2 |
| risk_per_trade_pct | 0.5% | 0.5% | 0.35% |
| min_rr | 1.8 | 2.5 | 3.0 |
| auto_book_confidence_threshold | 85 | 80 | 88 |
| max_trades_per_day | 20 | 25 | 10 |
| cooldown_minutes | 40 | 60 | 90 |
| **max_open_positions** | **2** | **2** | **1** |
| min_ev_ratio | 0.9 | 1.0 | 1.2 |
| max_sl_atr_pct | 2.5% | 2.0% | 1.5% |
| minimum_net_profit_to_enter_pct | 0.15% | 0.15% | 0.50% |
| minimum_net_profit_to_exit_pct | 0.18% | 0.18% | 0.18% |

**Profit protection ROE thresholds** (exit layer):
- Conservative: BE 1.0% · TP1 1.2% · Hard 1.6%
- Balanced: BE 1.1% · TP1 1.4% · Hard 1.8%
- Aggressive: BE 1.2% · TP1 1.5% · Hard 2.0%

---

## Entry Quality Gates (Auto-Book)

Seven gates fire sequentially before a position is opened. Any rejection skips the trade and logs to `bot_signals` with a structured reason.

| Gate | Field | What it blocks |
|---|---|---|
| Regime filter | regime_filter_enabled | Shorts in bullish regime, longs in bearish regime |
| Confidence threshold | auto_book_confidence_threshold | Weak signals below style floor |
| Session hour block | blocked_session_hours_ist | High-noise transition windows (11 IST, 19 IST worst) |
| SL width cap | max_sl_atr_pct | ATR-derived stop too wide for the style cap |
| EV ratio | min_ev_ratio | (confidence × TP%) / ((1−confidence) × SL%) below floor |
| Fee gate (entry) | minimum_net_profit_to_enter_pct | Projected net at TP doesn't clear fees + GST |
| Fee gate (exit) | minimum_net_profit_to_exit_pct | Realised net too small to exit profitably |

**Session hours blocked per style (IST)**:
- Conservative: 10, 11, 13, 14, 18, 19
- Balanced: 11, 19
- Aggressive: 19

**Why session blocking**: historical data showed 11 IST (pre-US open) cost -₹190 total at 41% win rate; 19 IST (US open) cost -₹84 at 36% win rate. Only profitable hour across history: 15 IST at 76% win rate.

---

## Concurrency Rules (Data-Derived)

### Futures: fewer is better
Analysis across 868 closed trades:

| Concurrent positions | Profit factor | Win rate |
|---|---|---|
| 0–2 | **0.91** | 64.7% |
| 3+ | 0.33 | 52.3% |

**Config**: max_open_positions = 2 (aggressive/balanced), 1 (conservative).

Multiple concurrent futures positions correlate their losses — when one setup fails in a given regime, all others opened in the same regime fail too. The bot now queues signals instead of piling in.

### Coins: more is better
Analysis across 170 closed coin positions:

| Concurrent holdings | Profit factor | Win rate |
|---|---|---|
| 1 | 0.37 | 40% |
| 2 | 0.22 | 20% |
| 3–4 | 0.43 | 33% |
| **5+** | **1.009** | 33% |

**Config**: max_holdings = 8 (unchanged). Spot requires portfolio diversification — winners carry the flat positions.

---

## Symbol Management

### Futures symbol cooldown
Direction-specific cooldown: `(symbol, side)` pairs cool independently. A symbol on SHORT cooldown remains available for LONG (and vice versa). Triggered after 2+ hard SLs from any user within 6 hours.

### Futures symbol blocklist
Global `symbol_blocklist` on `bot_config`. B-PHB_USDT permanently blocked.

### Coin symbol blocklist
`symbol_blocklist` on `coin_bot_config`. Currently blocked: B-PUMP_USDT, B-HEI_USDT, B-ARK_USDT, B-BEL_USDT, B-NEAR_USDT (all 0% win rate across ≥ 4 trades).

---

## Coin Bot Configuration

| Field | Value |
|---|---|
| min_confidence | 78 (raised from 65) |
| max_holdings | 8 |
| scan_interval_min | 3 (intraday) / 30+ (swing) |
| symbol_blocklist | 5 symbols |

**Swing mode fixes (scorer.ts)**:
- Stop distance widened from 2.0% → 3.5% (swing needs room to breathe)
- Trend-broken and momentum-faded exits gated `&& !isSwing` (5m noise no longer closes swing trades)
- Swing buy signals now require 30m trend alignment as primary (not 5m)

---

## Learning & Recommendation Engine

- RAG status (red/amber/green) computed from recent trade patterns
- Auto-apply critical recommendations when bot is running and status is red
- Plain-English trigger explanations ("Several losing trades in a row today")
- Plain-English change descriptions ("Risking less per trade — now 0.35% of balance")
- All recommendations are config patches, not code branches

**Auto-tune triggers**: loss-streak · daily-bleed · sl-dominated · shorts-bleeding · longs-bleeding · low-pf · overtrading · wide-net · auto-blacklist-loose

---

## Dashboard (Beginner-First Design)

The home screen is built around one question: **"Is my bot making money and is it getting better?"**

**Section order**:
1. Header + mode toggle pill
2. Paper/Live mode banner
3. Open positions banner (conditional)
4. Portfolio card — value · today's P&L · 14-day bar chart (green/red by day) · total P&L · % return
5. Recommendations panel (RAG)
6. Quick actions: Scanner (primary) · Positions · Bot Panel
7. Wealth Engine status card with inline risk strip (always visible, not tap-to-reveal)
8. Safety controls (Pause / Emergency Stop)
9. Recent activity feed

**Recent activity feed** handles structured display for: auto_book · skip · auto_tune · session_hour_skip · sl_width_skip · ev_ratio_skip · pre_entry_net_profit_skip. Each gate rejection shows a plain-English explanation of why the trade was blocked.

**Removed from home screen**: raw fee totals · SL rate metrics · profit factor number · milestone cards · performance history card · "Today's insight" duplicate box.

---

## Key Database Tables

| Table | Purpose |
|---|---|
| positions | Futures open/closed positions with full exit metadata |
| bot_config | Per-user futures config (all style/risk/gate fields) |
| bot_signals | Signal scan log with rejection reasons |
| bot_events | Activity feed (auto_book, skip, auto_tune, gate events) |
| coin_positions | Spot open/closed holdings |
| coin_bot_config | Per-user coin config (confidence, holdings, blocklist) |
| coin_signals | Coin scan signals |
| plans | User plan entitlements |
| profiles | User profile |

### Notable bot_config fields added in current phase

```sql
-- Entry quality gates
max_sl_atr_pct              numeric   -- hard cap on ATR-derived SL width; reject trade if exceeded
min_ev_ratio                numeric   -- EV proxy gate: (p×tp)/((1-p)×sl) must exceed this
blocked_session_hours_ist   int[]     -- IST hours where auto-book is suppressed
minimum_net_profit_to_enter_pct numeric -- pre-entry fee gate (mirrors exit-side field)

-- Exit protection (earlier phase, now confirmed working)
breakeven_armed_at          timestamptz
tp1_roe_pct                 numeric
exit_protection_reason      text
profit_protection_active    boolean
```

---

## Success Metrics

| Metric | Target | Current status |
|---|---|---|
| SL-after-BE | 0 | ✅ Confirmed 0 across 1,688 trades |
| SL-after-TP1 | 0 | ✅ Confirmed 0 |
| Profit Factor | > 1.0 | 🔴 0.33 (crowded) → 0.91 (solo/pair) |
| Net PnL | Positive | 🔴 Negative (entry quality phase) |
| Avg SL MFE | > 1% | 🔴 0.47% (trades go straight to stop) |
| Coin PF (5+ holdings) | > 1.0 | ✅ 1.009 |

**Current bottleneck**: Entry quality. 89% of stop-loss trades had MFE < 1% — the trade was wrong from bar 1. The session block, SL width cap, and EV ratio gates are designed to address this directly.

---

## Roadmap

### Current phase — Entry Quality
- [x] Session-aware auto-book gate
- [x] SL width hard cap per style
- [x] EV ratio pre-entry gate
- [x] Fee-aware pre-entry gate
- [x] Max open positions reduced to 1–2 (data-derived)
- [x] Direction-specific symbol cooldown
- [x] Conservative style as third group
- [x] Coin scorer swing fixes

### Next phase — Signal Quality
- [ ] Regime-based target_multiplier relaxation (neutral regime: 1.5× instead of 2.2–3.0×)
- [ ] Per-symbol direction auto-blocklist (weekly learning job)
- [ ] Funding rate as regime modifier (negative funding → suppress longs system-wide)
- [ ] Profit factor gate at entry (EV proxy already covers this partially)

### Strategy evolution
- [ ] Multiple strategies + shared risk engine (VWAP pullback · Supertrend · Bollinger mean reversion · Breakout + volume spike)
- [ ] EarnO as strategy orchestrator, not single-algorithm system

---

## Paper Users (Current)

| User | Style | Timeframe | Max positions |
|---|---|---|---|
| Sudip Gupta | Aggressive | 3m | 2 |
| Kush Bajpayee | Aggressive | 3m | 2 |
| Yashwanth Kumar | Balanced | 15m | 2 |
| Akshay Sharma | Balanced | 15m | 2 |
| Robin Mathew | Conservative | 15m | 1 |
| Shambhu Tiwary | Conservative | 15m | 1 |

---

## Development

```bash
# Install
bun install

# Dev server
bun run dev         # http://localhost:5173

# Typecheck
bunx tsgo --noEmit

# Build
bun run build
```

### Environment
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
CRON_SECRET=your_cron_secret
```

---

## Constraints (Do Not Violate)

1. **No hardcoded user groups** — all behaviour derives from config fields, never from user_id or name branches in code
2. **No second exit system** — the existing SL/TP/BE/trailing/profit-fade/time-exit stack is the only exit system
3. **No schema bloat** — extend existing fields before adding new tables
4. **No full strategy rewrites from a bad day** — diagnose from data first
5. **No constant manual config tweaking** — the recommendation engine handles adaptation
6. **Coin module is separate** — futures and coin logic never share execution paths

---

## Disclaimer

EarnO is a paper-trading optimisation platform. All live trading carries substantial risk. Never invest more than you can afford to lose. The developers assume no liability for financial losses. Always start with paper mode.

---

*Last updated: June 2026 · Phase: Paper trading optimisation · Focus: Entry quality*

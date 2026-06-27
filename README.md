# EarnO - Automated Futures Trading Bot for CoinDCX

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Status](https://img.shields.io/badge/status-Production-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue.svg)

**Live Application**: [earno.lovable.app](https://earno.lovable.app)

EarnO is a sophisticated, production-grade **automated futures trading application** designed for CoinDCX. It combines real-time market analysis, intelligent trade recommendations, paper trading simulation, and advanced risk management to enable profitable scalp trading strategies on cryptocurrency futures.

---

## 🎯 Quick Overview

| Feature | Details |
|---------|---------|
| **Supported Markets** | CoinDCX Futures (with Spot market support) |
| **Trading Modes** | Paper Trading (simulation) + Live Trading |
| **Base Framework** | TanStack Start (React 19 + Server-Side Rendering) |
| **Core Language** | TypeScript 5.8+ |
| **UI Library** | Radix UI + Tailwind CSS v4 |
| **Real-time Updates** | TanStack React Query v5 |
| **Database** | Supabase (PostgreSQL) |
| **Hosting** | Cloudflare Workers (via Nitro) |

---

## High-Level System Architecture

TanStack Start v1.167.x runs the React 19 app on Nitro/Cloudflare Workers. File-based UI routes under `src/routes/_authenticated` handle the dashboard, scanner, positions, settings, plans, and admin screens; authenticated `createServerFn` handlers under `src/lib/*.functions.ts` serve app reads/writes; and server routes under `/api/public/hooks/*` run the cron-triggered auto-book, mark-positions, and coin-scan passes. `attachSupabaseAuth` is registered as function middleware, while server-only modules such as `auto-book.server.ts`, `config.server.ts`, `coindcx.server.ts`, and `futures/live-execution.server.ts` stay off the client bundle.

```
Browser UI + React Query
  -> TanStack Start routes + createServerFn handlers
  -> Supabase auth/session + Postgres tables (bot_config, positions, bot_signals, plans, coupons)
Cron POST hooks (/api/public/hooks/auto-book, /mark-positions, /coin-scan)
  -> server-route handlers verify CRON_SECRET / RPC secret
  -> server-only engines in src/lib/*.server.ts
Market data + execution
  -> CoinDCX public futures ticker: /market_data/v3/current_prices/futures/rt
  -> CoinDCX public spot ticker: /exchange/ticker
  -> CoinDCX public candles: /market_data/candles
  -> CoinDCX signed balance / wallet / order APIs for live mode
Recent Supabase migrations add TP1, breakeven, runner PnL, and exit-protection fields on positions and keep the mark-positions cron on a 1-minute schedule.
```

---

## Trading Algorithm (High Level)

- The scanner builds a futures universe from CoinDCX USDT pairs by combining top 24h movers with top-volume symbols, then enriches them with 1m, 5m, 30m, and 1h candles, RSI, VWAP, EMA stack, ATR%, spread proxy, and volume-spike ratios; spot scans use the spot ticker with the same candle enrichment.
- Per-symbol scoring produces a 0-100 confidence with HIGH at 80+, MEDIUM at 65+, LOW at 55+, and AVOID below 55, using trend, VWAP, EMA, RSI, volume, spread, ATR, and entry-distance scores minus overextension and choppy-tape penalties. Bias becomes long or short only when at least 2 of trend, VWAP, and EMA agree.
- Risk accepted / Manual review required comes from the ATR-based risk engine. Default presets are Conservative (risk 0.5%, min SL 1.5%, ATR x2.0, max auto SL 2.5%, target x1.5), Balanced (1.0%, 1.5%, x2.2, 4.0%, x1.7), and Aggressive (1.5%, 1.8%, x2.4, 5.0%, x2.0); every preset requires min R:R 1.5 and can return Volatility too high for auto-book or Risk-reward weak.
- Auto-book eligible setups still pass plan limits, user confidence thresholds, spread and market-regime guards, cooldowns, symbol blocklists, hard-SL cooldowns, max-open-position checks, and the daily loss cap. Auto-Trader allows 5 auto-booked trades per day; Unlimited is effectively uncapped.
- Paper trading is the default path. Live mode reuses the same scanner, scorer, and risk rules, but sizes from the selected futures or spot wallet allocation and places signed CoinDCX entry and exit orders.
- Exit handling combines take-profit, stop-loss, TP1 on 50% size with breakeven arming, trailing exits, runner protection, profit-fade exits, weak-progress time exits, pre-TP1 failed-momentum or trend-invalidated exits, and kill-switch style pauses when user-level loss or plan rules stop new bookings.

---

## Features (High Level)

- Dashboard: bot start/pause controls, mode status, plan badge, live portfolio summaries, and quick actions for movers, settings, upgrade, and admin.
- Scanner: ranked futures and spot movers, strictness presets, confidence bands, reason labels, risk checklists, and manual booking with ATR-aware target/stop context.
- Positions: open/history tabs, realtime Supabase refresh, manual close/edit flows, TP1 and breakeven state, exit protection labels, and per-trade chart sheets.
- Settings: paper-by-default bot configuration, trading style presets, risk overrides, long/short toggles, auto-book thresholds, symbol blocklist, and live wallet allocation controls.
- Auth/Plans: Lovable auth with Supabase session attachment, Free/Insights/Auto-Trader/Unlimited entitlements, Razorpay checkout, coupons, and upgrade flows.
- Admin: user plan management, coupon creation, beta reports, per-user algo tuning, and current-config/activity views.

---

## 📊 Data Models

### Positions Table
```sql
CREATE TABLE positions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  symbol VARCHAR(40) NOT NULL,
  side ENUM('long', 'short') NOT NULL,
  leverage INTEGER,
  qty NUMERIC,
  entry_price NUMERIC,
  mark_price NUMERIC,
  stop_loss NUMERIC,
  take_profit NUMERIC,
  pnl NUMERIC,
  pnl_pct NUMERIC,
  status ENUM('open', 'closed') DEFAULT 'open',
  exit_price NUMERIC,
  exit_reason VARCHAR(50),
  exchange_order_id VARCHAR(100),
  opened_at TIMESTAMP DEFAULT now(),
  closed_at TIMESTAMP,
  mode ENUM('paper', 'live') DEFAULT 'paper'
);
```

### Bot Config Table
```sql
CREATE TABLE bot_config (
  user_id UUID PRIMARY KEY,
  mode ENUM('paper', 'live') DEFAULT 'paper',
  is_running BOOLEAN DEFAULT false,
  ema_fast INTEGER DEFAULT 9,
  ema_slow INTEGER DEFAULT 21,
  timeframe VARCHAR(10) DEFAULT '5m',
  leverage INTEGER DEFAULT 3,
  take_profit_pct NUMERIC DEFAULT 0.6,
  stop_loss_pct NUMERIC DEFAULT 0.4,
  risk_per_trade_pct NUMERIC DEFAULT 1,
  max_open_positions INTEGER DEFAULT 3,
  daily_loss_cap_pct NUMERIC DEFAULT 5,
  scanner_top_n INTEGER DEFAULT 30,
  auto_book BOOLEAN DEFAULT false,
  strategy VARCHAR(50),
  min_scalp_score INTEGER DEFAULT 65,
  paper_equity NUMERIC DEFAULT 10000
);
```

### API Credentials (Encrypted)
```sql
CREATE TABLE api_credentials (
  user_id UUID PRIMARY KEY,
  api_key VARCHAR(256) ENCRYPTED,
  api_secret VARCHAR(512) ENCRYPTED,
  is_valid BOOLEAN DEFAULT false,
  last_checked_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT now()
);
```

---

## 🚀 Key Features

### ✅ Market Scanning
- Real-time top movers detection
- Multi-timeframe technical analysis (1m, 5m, 30m)
- Opportunity scoring (0-100 scale)
- Risk checklist generation

### ✅ Trade Management
- Manual trade booking
- Auto-book ready signals (tier: "auto")
- Position tracking with real-time PnL
- Stop-loss & take-profit management
- Paper trading simulation

### ✅ Risk Management
- Daily loss caps
- Maximum position limits
- Risk-per-trade sizing
- Consecutive loss cooldowns
- Minimum score thresholds

### ✅ Analytics
- Trade history & statistics
- Performance metrics (win rate, Sharpe ratio, max drawdown)
- Daily P&L tracking
- Technical indicator visualization

---

## 🛠️ Tech Stack

### Frontend
- **React 19.2.0** - UI framework
- **TanStack Router 1.168+** - File-based routing
- **TanStack React Query 5.83+** - Server state management
- **Radix UI** - Accessible components
- **Tailwind CSS 4.2+** - Styling
- **React Hook Form 7.71+** - Form handling
- **Zod 3.24+** - Type-safe validation

### Backend
- **TanStack Start 1.167+** - Full-stack framework
- **Nitro 3.0+** - Server runtime (Cloudflare Workers)
- **Node.js 22+** / **Bun** - Runtime

### Database & Auth
- **Supabase 2.108+** - PostgreSQL backend
- **Lovable Cloud Auth** - Authentication

### Development
- **TypeScript 5.8+** - Type safety
- **Vite 7.3+** - Build tool
- **ESLint 9.32+** - Linting
- **Prettier 3.7+** - Code formatting

---

## 📦 Installation & Setup

### Prerequisites
- Node.js 22+ or Bun
- Git
- Supabase project
- CoinDCX API keys (for live trading)

### Clone & Install

```bash
git clone https://github.com/sudip-jerry/earno.git
cd earno

# Install dependencies
bun install
# or
npm install
```

### Environment Setup

Create `.env` file:

```env
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key

# Optional: CoinDCX API (if using live trading)
COINDCX_API_KEY=your_api_key
COINDCX_API_SECRET=your_api_secret
```

### Development Server

```bash
# Start dev server (with HMR)
bun run dev
# or
npm run dev
```

Access at `http://localhost:5173`

### Production Build

```bash
# Build for production
bun run build

# Preview production build
bun run preview
```

---

## 🔐 Security Considerations

1. **API Key Encryption**: All user CoinDCX credentials are encrypted at rest in Supabase
2. **Authentication**: Lovable Cloud Auth provides secure user sessions
3. **Server-Side Validation**: All trade decisions validated server-side before execution
4. **HTTPS/TLS**: All external API calls use HTTPS
5. **Rate Limiting**: Implemented for CoinDCX API calls (4.5s timeout)

---

## 📈 Example Trade Flow

```
User Visits Scanner
  ↓
Server calls getTopMovers()
  ├─ Fetch 40 top pairs from CoinDCX
  ├─ Download 1m, 5m, 30m candles for each
  ├─ Calculate RSI, VWAP, EMA, volume spike
  ├─ Score using scalpScorer (0-100)
  ├─ Assign tier: auto/watch/weak/avoid
  └─ Return 15-30 opportunities sorted by confidence
  ↓
Frontend displays Movers List
  ├─ Show opportunity card with:
  │  ├─ Symbol & price
  │  ├─ Scalp score (0-100)
  │  ├─ Bias (long/short/wait)
  │  ├─ Risk checklist (4 sections)
  │  ├─ Reason label (e.g., "Ready for auto-book")
  │  └─ Action buttons (Long, Short, Watch)
  │
  └─ User clicks "LONG"
      ↓
      Modal opens with confirmation
      ├─ Show: quantity, leverage, SL, TP, risk/reward
      └─ User confirms
          ↓
          bookManualTrade() called
          ├─ Load user config
          ├─ Check risk constraints
          ├─ Calculate position size
          ├─ Insert position record (mode: paper/live)
          ├─ Log trade event
          └─ Return success
              ↓
              Position appears in Active Positions
              ├─ Real-time mark price updates
              ├─ Live P&L calculation
              └─ Close button triggers closeManualTrade()
```

---

## 📊 Sample Screenshots (Data-Driven UI)

### Opportunity Scanner
```
┌─────────────────────────────────────────────────────────┐
│  Market Movers - Futures (Moderate Strictness)          │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  [BTC/USDT] Confidence: 78 (HIGH)                       │
│  Price: $45,250 | Change 24h: +3.5%                     │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Bias: LONG | RSI: 58 | Volume Spike: YES        │    │
│  │                                                   │    │
│  │ ✓ 5m trend bullish (0.35%)                       │    │
│  │ ✓ EMA alignment                                  │    │
│  │ ✓ Price above VWAP (+0.25%)                      │    │
│  │ ✓ Pullback near fair value                       │    │
│  │ ✓ Entry near support                             │    │
│  │ ✓ Not overextended (RSI 58)                      │    │
│  │ ✓ RSI in ideal range (45-65)                     │    │
│  │ ✓ Volume spike confirmed                         │    │
│  │ ✓ Candle strength valid                          │    │
│  │ ✓ Spread acceptable (tight)                      │    │
│  │ ✓ Stop-loss valid (2%)                           │    │
│  │ ✓ Target valid (0.6%)                            │    │
│  │ ✓ Risk-reward 0.30 : 1 (OK)                      │    │
│  └─────────────────────────────────────────────────┘    │
│                                                           │
│  Ready for auto-book | [LONG] [SHORT] [MORE]            │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

### Active Positions
```
┌─────────────────────────────────────────────────────────┐
│  Active Positions (3/5 Max)                              │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ETH/USDT - LONG                                         │
│  Entry: $2,450 | Mark: $2,465 | Qty: 1.2                │
│  P&L: +$18.00 (+0.73%) | SL: $2,400 | TP: $2,534        │
│  [Close Position]                                        │
│                                                           │
│  XRP/USDT - SHORT                                        │
│  Entry: $2.15 | Mark: $2.12 | Qty: 50                   │
│  P&L: +$150.00 (+3.49%) | SL: $2.22 | TP: $2.07         │
│  [Close Position]                                        │
│                                                           │
│  ADA/USDT - LONG                                         │
│  Entry: $0.95 | Mark: $0.93 | Qty: 120                  │
│  P&L: -$24.00 (-2.53%) | SL: $0.93 | TP: $0.97          │
│  [Close Position]                                        │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

---

## 📞 Support & Contact

- **Website**: [earno.lovable.app](https://earno.lovable.app)
- **Issues**: GitHub Issues
- **Email**: support@earno.app

---

## 📜 License

MIT License - See LICENSE file for details

---

## ⚠️ Disclaimer

**EarnO is provided as-is for educational and trading purposes.** The developers assume no liability for:
- Financial losses incurred through trading
- API outages or data inaccuracies
- Unforeseen bugs in the trading algorithms
- Unauthorized access to user accounts

**Always**:
- Start with **paper trading** to validate strategies
- Use **strict risk management** settings
- Never invest more than you can afford to lose
- Monitor **live trades closely**, especially on first deployment

---

**Happy Trading! 🚀📈**

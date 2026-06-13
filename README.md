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

## 🏗️ High-Level System Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    Client Layer (React)                        │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Routes (File-based TanStack Router)                    │  │
│  │  ├─ Home Dashboard                                      │  │
│  │  ├─ Opportunity Scanner (Top Movers)                    │  │
│  │  ├─ Active Positions                                    │  │
│  │  ├─ Trade History                                       │  │
│  │  ├─ Bot Configuration                                  │  │
│  │  └─ Risk & Performance Analytics                        │  │
│  └─────────────────────────────────────────────────────────┘  │
│                          ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Components & Hooks                                     │  │
│  │  ├─ OpportunityCard (displays scan results)            │  │
│  │  ├─ RecommendationModal (trade suggestions)            │  │
│  │  ├─ TabBar & Theme Toggle                              │  │
│  │  └─ UI Primitives (Dialog, Slider, Dropdown, etc.)    │  │
│  └─────────────────────────────────────────────────────────┘  │
│                          ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  State Management (React Query + Hooks)                │  │
│  │  ├─ Market data caching & invalidation                 │  │
│  │  ├─ Position tracking (real-time updates)              │  │
│  │  └─ User authentication & session                      │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                           ↓ HTTP/JSON
┌────────────────────────────────────────────────────────────────┐
│              Server Layer (TanStack Start + Nitro)             │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Server Functions (src/lib/*.functions.ts)             │  │
│  │  ├─ movers.functions.ts (getTopMovers)                 │  │
│  │  │   └─ Market opportunity scanner                      │  │
│  │  ├─ bot.functions.ts (saveCredentials, testConnection) │  │
│  │  │   └─ Bot configuration & credential management      │  │
│  │  └─ stats.functions.ts (performance metrics)           │  │
│  └─────────────────────────────────────────────────────────┘  │
│                          ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Services (Trading Core Logic)                          │  │
│  │  ├─ ScalpScorer (line 193-246)                          │  │
│  │  │   └─ Quantifies opportunity attractiveness (0-100)   │  │
│  │  ├─ RiskEngine (line 65-177)                            │  │
│  │  │   └─ Position sizing & trade approval                │  │
│  │  ├─ PaperTradingEngine                                  │  │
│  │  │   └─ Backtesting & simulation                        │  │
│  │  └─ CoindcxPublicApi                                    │  │
│  │      └─ Market data aggregation                         │  │
│  └─────────────────────────────────────────────────────────┘  │
│                          ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Authentication Middleware                              │  │
│  │  └─ Lovable Cloud Auth + Supabase JWT validation       │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                           ↓ API Calls
┌────────────────────────────────────────────────────────────────┐
│            External Services & Data Sources                    │
│  ├─ CoinDCX Public API                                        │
│  │   ├─ Real-time futures pricing                            │
│  │   ├─ Candle data (1m, 5m, 30m, 1h)                       │
│  │   ├─ Order book & liquidity info                          │
│  │   └─ User API (authenticated - with user credentials)     │
│  ├─ Supabase Database                                        │
│  │   ├─ User data & credentials (encrypted)                 │
│  │   ├─ Bot configuration & state                           │
│  │   ├─ Trade history & position tracking                   │
│  │   └─ Analytics & performance logs                        │
│  └─ Lovable Cloud Auth                                       │
│      └─ User authentication & session management             │
└────────────────────────────────────────────────────────────────┘
```

---

## 🧠 Core Trading Algorithms

### 1️⃣ **Scalp Scoring Algorithm** (`src/services/scalpScorer.ts`)

The **ScalpScorer** is the heart of opportunity identification. It transforms raw market data into a 0-100 confidence score that determines whether a trading opportunity is worth pursuing.

#### Score Components (weights must sum to ~100):

| Component | Weight | Purpose |
|-----------|--------|---------|
| **Liquidity** | 15 | Volume-based scoring: $100k→0, $1M→5, $10M→10, $100M+→15 |
| **Spread** | 10 | Bid-ask tightness: ≤0.02%→10, 0.25%→2, >0.25%→0 |
| **Volatility** | 15 | 5-min candle range: 0.15%-0.6%→15 (sweet spot) |
| **Trend** | 20 | 30-min candle patterns: 3 greens→20, 2 greens→12, mixed→6 |
| **Volume Spike** | 15 | Last 5m vol vs 10-bar avg: ≥3x→15, ≥2x→12, 1.5x→8 |
| **Momentum** | 25 | 1m+5m cross-alignment: bullish/bearish agreement→strong score |

#### Penalties (subtracted from total):

- **Overextension Penalty** (0-25): RSI extremes (>80, <20) or parabolic moves (>1.5% in 5m)
- **Choppy Market Penalty** (0-25): Direction flips (>4 in 6 candles) or wick-heavy candles (>70% wick)

#### Algorithm Flow:

```typescript
export function scoreScalp(input: ScoreInput): ScoreResult {
  // 1. Calculate RSI(14) on 5m closes
  const rsi5 = rsi(m5.map(c => c.close));
  
  // 2. Score each component independently
  const liquidity = liquidityScore(ticker.volume24h);
  const spread = spreadScore(ticker.spreadPct);
  const volatility = volatilityScore(m5);
  const trend = trendScore(m30);
  const volumeSpike = volumeSpikeScore(m5);
  const momentum = momentumScore(m1, m5);
  
  // 3. Sum positive components
  const positive = liquidity + spread + volatility + trend + volumeSpike + momentum;
  
  // 4. Apply penalties
  const score = clamp(
    positive - overextensionPenalty(rsi5, m1) - choppyMarketPenalty(m5),
    0,
    100
  );
  
  // 5. Determine bias (Long/Short/Wait) based on momentum + trend alignment
  let bias: Bias = "wait";
  if (momentum.dir !== "wait") {
    const trendAligned = 
      (momentum.dir === "long" && trend.dir in ["up", "flat"]) ||
      (momentum.dir === "short" && trend.dir in ["down", "flat"]);
    bias = trendAligned ? momentum.dir : "wait";
  }
  if (score < 35) bias = "wait"; // Confidence floor
  
  return { score, bias, breakdown, reasons, rsi5m, trend30m };
}
```

#### Example Output:
```json
{
  "score": 78,
  "bias": "long",
  "breakdown": {
    "liquidity": 15,
    "spread": 10,
    "volatility": 15,
    "trend": 20,
    "volumeSpike": 12,
    "momentum": 18,
    "overextensionPenalty": 0,
    "choppyMarketPenalty": 0
  },
  "reasons": [
    "Strong long momentum (1m+5m aligned)",
    "30m trend up",
    "Volume spike vs 10-bar avg",
    "Deep liquidity",
    "Tight spread"
  ],
  "rsi5m": 58,
  "trend30m": "up"
}
```

---

### 2️⃣ **Market Movers Scanner** (`src/lib/movers.functions.ts`)

The **getTopMovers** server function scans CoinDCX for the most attractive trading opportunities by analyzing top-volume pairs against multiple strictness presets.

#### Algorithm Steps:

```
Step 1: Fetch Top 40-50 Pairs (by volume)
  ├─ CoinDCX /market_data/v3/current_prices/futures/rt
  └─ Sort by 24h quote volume (deepest pairs first)

Step 2: Enrich Each Pair
  ├─ Fetch candles: 1m (2 bars), 5m (20 bars), 30m (4 bars)
  ├─ Calculate technical indicators
  │  ├─ RSI(14) on 5m closes
  │  ├─ VWAP (Volume-Weighted Average Price) on 5m
  │  ├─ EMA trend direction (30m)
  │  ├─ Volume spike ratio (last 5m / 10-bar avg)
  │  └─ % changes (1m, 5m, 30m)
  └─ Score opportunity using scalpScorer

Step 3: Apply Tiering Logic
  ├─ Check Hard Rejects (Avoid tier)
  │  ├─ RSI > 78 (long) → "Overbought"
  │  ├─ RSI < 22 (short) → "Oversold"
  │  └─ Volume24h < $250k → "Liquidity too low"
  │
  ├─ Check Auto-Book Eligibility
  │  ├─ Bias ≠ "wait"
  │  ├─ Spread ≠ "wide"
  │  ├─ Volume tier ≠ "low"
  │  ├─ Risk-reward ratio ≥ preset.rrMin
  │  ├─ RSI in safe range for direction
  │  ├─ VWAP distance ≤ pullbackMaxPct
  │  ├─ Volume spike ratio ≥ preset.volRatio
  │  └─ 5m trend aligned with bias
  │
  └─ Assign Tier
      ├─ "auto" → Ready for auto-booking (HIGH confidence)
      ├─ "watch" → Monitor for setup (MEDIUM confidence)
      ├─ "weak" → Weak signal (LOW confidence)
      └─ "avoid" → Risk checks failed (AVOID)

Step 4: Derive Reason Label (contextual guidance)
  ├─ "Ready for auto-book"
  ├─ "Waiting for pullback" (VWAP distance too far)
  ├─ "Waiting for volume confirmation" (spike not yet triggered)
  ├─ "Waiting for candle close" (1m candle still forming)
  ├─ "Overextended" (RSI in extreme zone)
  ├─ "Spread too wide"
  ├─ "Choppy market"
  ├─ "Low liquidity"
  └─ "Watching for setup" (no clear blocker yet)

Step 5: Build Risk Checklist
  └─ 4 categories with pass/warn/fail status:
      ├─ Trend (5m trend, EMA align, VWAP distance)
      ├─ Entry (pullback depth, fair value, overextension)
      ├─ Momentum (RSI range, volume spike, candle strength)
      └─ Risk (spread, stop-loss, target, R:R ratio)
```

#### Strictness Presets:

| Preset | Auto Confidence | Vol Ratio | Pullback Max | Min R:R |
|--------|-----------------|-----------|--------------|---------|
| **Less** | 60 | 1.2x | 0.50% | 1.1 |
| **Moderate** | 70 | 1.3x | 0.35% | 1.2 |
| **Strict** | 80 | 1.5x | 0.25% | 1.3 |

#### Output Structure:

```typescript
type Mover = {
  // Identification
  symbol: string;           // "B-BTC_USDT"
  display: string;          // "BTC/USDT"
  price: number;
  change24h: number;

  // Technical Data
  scalpScore: number;       // 0-100
  bias: "long" | "short" | "wait";
  trend30m: "up" | "down" | "flat" | "mixed";
  rsi: number | null;       // RSI(14) on 5m
  emaTrend: "up" | "down" | "flat";
  vwapStatus: "above" | "below";
  vwapDistPct: number | null;

  // Market Conditions
  spread: "tight" | "normal" | "wide";
  volumeTier: "low" | "ok" | "high";
  volumeSpike: boolean;

  // Decision
  tier: "auto" | "watch" | "weak" | "avoid";
  action: "long" | "short" | "wait" | "avoid";
  confidenceLabel: "High" | "Medium" | "Low" | "Avoid";
  reasonLabel: ReasonLabel;

  // Checklists
  checks: ChecklistSections;
};
```

---

### 3️⃣ **Trade Booking Algorithm** (Auto-Book Logic)

The **Trade Booking** flow combines scoring, risk validation, and position sizing to execute trades automatically or with user confirmation.

#### Trade Booking Decision Tree:

```
User Triggers Trade (Manual or Auto-Book Signal)
  │
  ├─→ [1] Load User Configuration
  │   ├─ Trading mode (paper/live)
  │   ├─ Leverage (1-5x)
  │   ├─ Take-profit % (0.1-50%)
  │   ├─ Stop-loss % (0.1-50%)
  │   ├─ Risk per trade (0.1-20% of equity)
  │   ├─ Max open positions (1-10)
  │   └─ Paper equity (for simulation)
  │
  ├─→ [2] Run Risk Checks (RiskEngine.evaluateTrade)
  │   ├─ Check 1: Daily loss cap
  │   │   └─ If (dailyPnL ≤ -(equity × dailyLossCap%)) → REJECT
  │   │
  │   ├─ Check 2: Max trades per day
  │   │   └─ If (tradeCount ≥ maxTradesPerDay) → REJECT
  │   │
  │   ├─ Check 3: Max open positions
  │   │   └─ If (openCount ≥ maxOpenPositions) → REJECT
  │   │
  │   ├─ Check 4: Consecutive losses
  │   │   └─ If (lossStreak ≥ maxConsecutiveLosses) → REJECT
  │   │
  │   ├─ Check 5: Loss cooldown
  │   │   └─ If (minsSinceLastLoss < cooldownMinutes) → REJECT
  │   │
  │   └─ Check 6: Minimum scalp score
  │       └─ If (opportunityScore < minScalpScore) → REJECT
  │
  ├─→ [3] Calculate Position Sizing
  │   ├─ Risk amount = equity × riskPerTradePct / stopLossPct
  │   ├─ Notional = min(riskAmount, equity) × leverage
  │   └─ Quantity = notional / entryPrice
  │
  ├─→ [4] Derive Stop-Loss & Take-Profit
  │   ├─ For LONG:
  │   │   ├─ Stop-Loss = entryPrice × (1 - stopLossPct/100)
  │   │   └─ Take-Profit = entryPrice × (1 + takeProfitPct/100)
  │   │
  │   └─ For SHORT:
  │       ├─ Stop-Loss = entryPrice × (1 + stopLossPct/100)
  │       └─ Take-Profit = entryPrice × (1 - takeProfitPct/100)
  │
  ├─→ [5] Execute Trade
  │   ├─ Paper Mode:
  │   │   └─ Insert into 'positions' table with mode='paper'
  │   │
  │   └─ Live Mode:
  │       ├─ Call CoinDCX API (/exchange/v1/orders/create)
  │       └─ Store order_id + position record
  │
  └─→ [6] Post-Trade Actions
      ├─ Insert trade event log
      ├─ Invalidate React Query cache
      ├─ Emit notification to user
      └─ (Optional) Trigger stop-loss/take-profit watchers
```

#### Position Sizing Example:

```
Config:
  ├─ Equity: $10,000
  ├─ Risk per trade: 2%
  ├─ Stop-loss: 2%
  ├─ Leverage: 3x
  └─ Take-profit: 6%

Calculation:
  1. Risk amount = $10,000 × 2% / 2% = $10,000
  2. Notional = min($10,000, $10,000) × 3x = $30,000
  3. Entry Price = $50,000
  4. Quantity = $30,000 / $50,000 = 0.6 BTC
  
  5. Stop-Loss = $50,000 × (1 - 2/100) = $49,000
  6. Take-Profit = $50,000 × (1 + 6/100) = $53,000
  
  7. Risk/Reward = ($53,000 - $50,000) / ($50,000 - $49,000) = $3,000 / $1,000 = 3.0:1
```

#### Server Function: `bookManualTrade` (`src/lib/movers.functions.ts:682-741`)

```typescript
export const bookManualTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => bookSchema.parse(d))
  .handler(async ({ data, context }) => {
    // data = { symbol, side, price, market? }
    
    // 1. Load config & check position count
    const cfg = await supabaseAdmin
      .from("bot_config")
      .select("mode, leverage, take_profit_pct, stop_loss_pct, ...")
      .eq("user_id", context.userId);
    
    const openCount = await supabaseAdmin
      .from("positions")
      .select("id", { count: "exact" })
      .eq("user_id", context.userId)
      .eq("status", "open");
    
    if (openCount >= cfg.max_open_positions) {
      throw new Error(`Max positions reached`);
    }
    
    // 2. Calculate position size
    const equity = Number(cfg.paper_equity ?? 0);
    const riskPct = Number(cfg.risk_per_trade_pct ?? 1);
    const leverage = Number(cfg.leverage ?? 3);
    const sl = Number(cfg.stop_loss_pct ?? 2);
    const tp = Number(cfg.take_profit_pct ?? 3);
    
    const notional = Math.min((equity * riskPct) / sl, equity) * leverage;
    const qty = notional / data.price;
    
    // 3. Calculate stops
    const stop_loss = data.side === "long" 
      ? data.price * (1 - sl / 100) 
      : data.price * (1 + sl / 100);
    
    const take_profit = data.side === "long" 
      ? data.price * (1 + tp / 100) 
      : data.price * (1 - tp / 100);
    
    // 4. Insert position record
    await supabaseAdmin
      .from("positions")
      .insert({
        user_id: context.userId,
        mode: cfg.mode,
        symbol: data.symbol,
        side: data.side,
        leverage,
        qty,
        entry_price: data.price,
        mark_price: data.price,
        stop_loss,
        take_profit,
        pnl: 0,
        pnl_pct: 0,
        status: "open",
        exchange_order_id: cfg.mode === "paper" ? `paper-manual-${Date.now()}` : null,
      });
    
    // 5. Log event
    await supabaseAdmin
      .from("bot_events")
      .insert({
        user_id: context.userId,
        level: "info",
        message: `Manual ${data.side.toUpperCase()} on ${data.symbol} at ${data.price}`,
      });
    
    return { ok: true };
  });
```

---

### 4️⃣ **Risk Engine** (`src/services/riskEngine.ts`)

The **RiskEngine** is a pure decision function that evaluates whether a new trade is permitted based on account-level constraints.

#### Configuration Options:

```typescript
type RiskConfig = {
  equityUsdt: number;                   // Account balance
  dailyLossCapPct: number;              // e.g., 3 = stop at -3%
  maxTradesPerDay: number;              // Hard limit per day
  maxOpenPositions: number;             // Concurrent position limit
  maxConsecutiveLosses: number;         // Streak before cooldown
  cooldownMinutesAfterLoss: number;     // Wait time after loss
  minScalpScore: number;                // Opportunity threshold (0-100)
};
```

#### Decision Rules (checked in order):

1. **Daily Loss Cap** ✓/✗
   - If cumulative PnL for the day ≤ -(equity × cap%), reject trade
   
2. **Max Trades Per Day** ✓/✗
   - If trade count ≥ limit, reject trade
   
3. **Max Open Positions** ✓/✗
   - If open positions ≥ limit, reject trade
   
4. **Consecutive Losses** ✓/✗
   - If loss streak ≥ threshold, reject trade
   
5. **Loss Cooldown** ✓/✗
   - If minutes since last losing trade < cooldown, reject trade
   
6. **Minimum Scalp Score** ✓/✗
   - If opportunity score < minimum, reject trade

#### Output:

```typescript
type RiskDecision = {
  allowed: boolean;
  reasons: string[];        // All rule outcomes
  blockedBy: string[];      // Reasons that blocked (subset)
  metrics: {
    dailyPnlUsdt: number;
    dailyLossCapUsdt: number;
    tradesToday: number;
    openPositions: number;
    consecutiveLosses: number;
    minutesSinceLastLoss: number | null;
  };
};
```

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

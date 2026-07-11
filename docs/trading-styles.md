# Trading Styles — Conservative · Moderate · Aggressive

EarnO runs **one algorithm** with three risk profiles. The style does **not** change
*what* the bot looks for — it changes *how much it risks, how wide it lets trades run,
and how often it trades*. Every cohort is pinned to one style.

> **Mode is the single source of truth.** The trading mode is the only risk setting a user
> configures — risk %, stops, target, R:R, **confidence threshold, and leverage** all derive
> from it via `STYLE_PRESETS`. The fine numeric fields are admin-only overrides (a `bot_config`
> column only overrides the preset when an admin sets it; otherwise the mode default wins).

> **Naming:** the code and database use `balanced`; in the UI and these notes it's also
> called **Moderate**. They are the same style.

The numeric settings live in [`src/lib/risk-engine.ts`](../src/lib/risk-engine.ts)
(`STYLE_PRESETS`). This doc is the human-readable reference.

---

## 1. At a glance

| | **Conservative** | **Moderate** (balanced) | **Aggressive** |
|---|---|---|---|
| Intent | Preserve capital | Everyday default | Chase volatile setups |
| Confidence to book | **≥ 78** (pickiest) | **≥ 72** | **≥ 66** (most trades) |
| Risk per trade | **0.35%** of equity | **1.0%** | **1.5%** |
| Leverage | 2× | 3× | 3× |
| Trades / day (cap) | 10 | 15 | 25 |
| Lets winners run | Least (trail 0.70%) | Medium (0.90%) | **Most (1.30%)** |
| Books | Rarely, only A+ setups | Regularly | Often, tolerates noise |

---

## 2. Full settings (from `STYLE_PRESETS`)

| Parameter | Conservative | Moderate | Aggressive | What it controls |
|---|---|---|---|---|
| `autoBookConfidence` | **78** | **72** | **66** | Signal must clear this to auto-book (else shown, not traded) |
| `leverage` | **2×** | **3×** | **3×** | Position leverage |
| `riskPct` | 0.35% | 1.0% | 1.5% | Equity risked per trade → position size |
| `minSL` | 1.5% | 1.5% | 1.8% | Floor on the stop distance |
| `atrMult` | 2.0× | 2.2× | 2.4× | Stop = ATR × this (volatility-scaled) |
| `maxAutoSL` | 2.5% | 4.0% | 5.0% | Cap on the stop distance |
| `targetMult` | 1.5× | 1.7× | 2.0× | Take-profit = stop × this |
| `minRR` | **3.0** | 1.5 | 1.5 | Reject a booking below this reward:risk |
| `tp1Pct` | 0.55% | 0.70% | 0.70% | Partial-profit level (books part of the position) |
| `trailPct` | 0.70% | 0.90% | 1.30% | Trailing-stop distance after TP1 |
| `profitFadeMinPct` | 0.6% | 0.6% | 0.6% | Min gain before a profit-fade exit can trigger |
| `profitFadeGivebackPct` | 0.4% | 0.4% | 0.4% | Give-back from peak that triggers the fade exit |
| `weakProgressMinPct` | 0.3% | 0.3% | 0.3% | Progress threshold below which a trade is "weak" |
| `weakProgressWindowMin` | 60 min | 55 min | 50 min | Time a weak trade is given before a time-exit |
| `maxTradesPerDay` | 10 | 15 | 25 | Daily booking cap |
| `maxSameDirPerDay` | 5 | 8 | 12 | Cap on same-side (all-long / all-short) bookings |
| `maxTradesPerSymbolPerDay` | 2 | 3 | 4 | Per-symbol daily cap (anti-churn) |
| `lossesBeforeSymbolCooldown` | 2 | 2 | 3 | Stop-losses on a symbol before it's benched |
| `symbolCooldownHours` | 6h | 5h | 3h | How long a benched symbol sits out |

### Config-level settings (`bot_config`)

These are **not** mode-derived — they're set per cohort (defaults / admin), independent of style:

| | Notes |
|---|---|
| Daily loss cap | 5% (all modes) |
| Max open positions, cooldown, auto-close | per-cohort defaults |
| Structure filters (shadow A/B) | admin flags on the treatment cohorts |
| Strategy, timeframe, allow long/short | orthogonal user choices, not risk-mode |

---

## 3. How each style behaves

### Conservative — capital preservation
The smallest risk (0.35%/trade) with the **tightest stops** (never wider than 2.5%) and,
critically, a **min reward:risk of 3.0** — it only books when the projected reward is at
least 3× the risk, so most candidates are rejected. Fewest trades (10/day, 2/symbol),
lowest leverage (2×), and the **longest symbol cooldown** (6h after 2 stops). It also
trails tightest (0.70%), so it protects a winner quickly rather than letting it run.
Net effect: **few, high-quality, low-variance trades.**

### Moderate (balanced) — the default
1% risk/trade, volatility-adjusted stops up to 4%, and a normal 1.5 R:R bar so it books
regularly (up to 15/day). Trails at 0.90% — enough room for a winner to breathe without
giving back too much. This is the everyday setting and the baseline the backtests are
tuned against.

### Aggressive — ride the volatile ones
Largest risk (1.5%/trade), **widest stops** (up to 5%), and the **widest trail (1.30%)** —
it gives winners the most room to run, accepting bigger give-backs for bigger runs. Highest
activity (25/day, 4/symbol), shortest cooldown (3h), leverage 3×. Expect the **biggest
swings** in both directions; it tolerates noise the other two filter out.

---

## 4. Entry-filter tiers (structure filters)

The long structure filter and the mean-reversion short filter run as a shadow A/B on the
Moderate and Aggressive treatment cohorts. The short-fade filter is designed to run at
three tiers matching the styles (only the **Moderate** tier is coded today; the others are
design targets):

| Short-fade parameter | Conservative | Moderate (live) | Aggressive |
|---|---|---|---|
| Extension above 15m VWAP | ≥ 2.0% | **≥ 1.2%** | ≥ 0.8% |
| RSI(14) on 15m | ≥ 72 | **≥ 68** | ≥ 64 |
| Volume spike vs 20-bar avg | ≥ 2.0× | **≥ 1.5×** | ≥ 1.3× |
| Funding gate (crowded longs) | required | preferred | off |
| Target / Stop | +2.0 / −1.0% | +1.5 / −1.0% | +1.2 / −1.0% |

Tighter tiers = fewer, higher-conviction shorts; looser tiers trade more and accept more
noise. The **long** structure filter (30m higher-highs · 1m not-overbought · 1m rising ·
Supertrend) is currently a single gate, not yet tiered by style.

---

## 5. Where to change these

- **Style presets:** `src/lib/risk-engine.ts` → `STYLE_PRESETS`.
- **Per-cohort overrides** (leverage, confidence threshold, filter flags): `bot_config` rows.
- **Short-fade thresholds:** `DEFAULT_MEANREV_SHORT_PARAMS` in `src/lib/futures/manual-entry.ts`.

_Reference doc — describes current behaviour, not a change log._

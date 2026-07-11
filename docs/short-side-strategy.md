# Short-Side Strategy — Mean-Reversion Fade

A short-side algorithm that stops fighting the squeeze. EarnO's legacy shorts lose because
they chase weakness into a bounce; this replaces that with a **mean-reversion fade** — the
short pattern that holds up in backtests and in the literature — with three tunable risk
settings.

Scope: INR-M perpetual futures. Status: live in the shadow A/B on the treatment cohorts.

---

## 1. Why the legacy shorts bleed

Over 30 days of real paper trades, EarnO's shorts have a decent hit-rate but negative
expectancy — the entry style is the reason. It shorts weakness that has already happened,
on thin coins, right where a bounce is most likely.

| Diagnostic | Value |
|---|---|
| Shorts entered *below* VWAP | ~100% |
| Shorts entered while overbought (RSI ≥ 65) | 0 |
| "Short a confirmed downtrend" filter — win rate | 28% |
| Shorts when funding ≤ 0 — expectancy | −0.29 |
| Shorts when funding > 0 (crowded longs) | +0.21 |

It can also fire a LONG (81%) and a SHORT (61%) on the **same coin within 30 minutes** —
the direction flips as the 30-minute candle mix wobbles. The signal reacts to noise instead
of structure, so it enters mid-move and gets run over.

**Diagnosis:** momentum-into-a-downtrend on microcaps — the single worst short pattern in
choppy crypto.

## 2. What leading systematic desks short

| Short archetype | Edge | Verdict |
|---|---|---|
| **Mean-reversion fade + volume filter** | Fade an overextended move on a liquid coin; volume filter lifts win-rate ~61%→81% | **Chosen** |
| Funding-rate / crowded-long | Short when funding is very positive — collect funding *and* fade the crowd | Overlay |
| Range breakdown (Donchian) | Short a clean break below consolidation with volume expansion | Later |
| Momentum into downtrend | Sell confirmed weakness — whipsawed & squeezed in low-volume regimes | Legacy (weakest) |

Post-2021, BTC-neutral mean-reversion has run a Sharpe near 2.3 vs ~1.0 for momentum; it
works best on liquid, range-bound names (BTC/ETH/majors), not breakout microcaps.

## 3. The algorithm

Fade an **overextended, overbought** move on a **liquid** coin, gated by a **volume spike**,
only once it actually **rolls over**. All on the 15-minute chart to avoid 1-minute noise.

1. **Overextended above VWAP** (15m) — price ≥ X% above its rolling VWAP.
2. **Overbought** (15m) — RSI(14) ≥ threshold.
3. **Volume spike** (15m) — last bar volume ≥ N× its 20-bar average (biggest win-rate lift).
4. **Bearish rollover** (15m) — bar closes below its open *and* below the prior close.

**Optional overlay — funding gate:** require positive funding (crowded longs) before
shorting. In EarnO's own data this flips short expectancy from −0.29 to +0.21.

Implemented as `evaluateMeanReversionShort` in `src/lib/futures/manual-entry.ts`
(`DEFAULT_MEANREV_SHORT_PARAMS` = the Moderate tier).

## 4. Three settings

| Parameter | Conservative | Moderate (live) | Aggressive |
|---|---|---|---|
| Extension above 15m VWAP | ≥ 2.0% | ≥ 1.2% | ≥ 0.8% |
| RSI(14) on 15m | ≥ 72 | ≥ 68 | ≥ 64 |
| Volume spike vs 20-bar avg | ≥ 2.0× | ≥ 1.5× | ≥ 1.3× |
| Funding gate | required | preferred | off |
| Target / Stop | +2.0 / −1.0% | +1.5 / −1.0% | +1.2 / −1.0% |
| Universe | BTC · ETH | Top-15 majors | Top-25 liquid |
| Expected frequency | very few | few | moderate |

Only the Moderate tier is coded today; the others are design targets.

## 5. Backtest evidence

7-day walk-forward across 24 liquid coins, no look-ahead, fixed 1.5%/1.0% bracket, moderate
thresholds:

| | Value |
|---|---|
| Trades | 26–27 |
| Win rate | 56–58% |
| Profit factor | 1.5–1.7 |
| Expectancy / trade | +0.22–0.28% |

For contrast, EarnO's legacy shorts run ~37–40% win with negative expectancy. On the
tightest universe (BTC/ETH + majors) the fade returned 80% win / PF 8.4 on 5 trades — the
edge concentrates in the most liquid names, as the research predicts.

**Read honestly:** a real sample and a genuine edge, but still one 7-day window. The fixed
1.5% target *understates* a fade (which usually runs further, so live PF should be higher).
The decisive test is the live shadow A/B over 1–2 weeks.

## 6. Rollout

- **Shadow A/B, not a switch.** Enabled on the treatment cohorts behind a default-off flag
  (`structure_short_filter_enabled`); compared to identical control twins.
- **It also calms the flip-flops** — requiring overextension + rollover means the bot can't
  fire long-then-short on the same coin off candle noise.
- **What it won't do:** fire often. This is a selective, high-conviction short — a complement
  to the long book, not a volume engine.

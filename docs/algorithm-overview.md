# EarnO — Full Algorithm & Live Status

Two bots (futures & coins) on CoinDCX paper trading. This maps every stage of the
pipeline and tags each with its real status, so it's clear what's live, what's being
A/B-tested, what's only backtested, and what's still a known weakness.

- **Futures cohorts:** 7 (2 aggressive · 3 balanced · 2 conservative)
- **Fee basis:** taker 0.05%/side + 18% GST (CoinDCX charges maker = taker)

**Status legend:** `LIVE` running in production · `SHADOW` live on a subset for A/B ·
`BACKTEST` validated on candles, not trading · `PROPOSED` designed, not built ·
`ISSUE` known weakness.

---

## Bot 1 · Futures pipeline (`positions`)

| Stage | Status | Detail |
|---|---|---|
| **Universe** | `LIVE` | Each scan rebuilds a watchlist from two arms, both gated by a **≥ 20M USDT 24h-volume floor** and both now **decliner-free**: (1) **top 24h gainers (≥ +2%)** and (2) **top by volume among flat-to-up names (24h change ≥ 0)**. Every live edge keys off an upside move — longs ride gainers, mean-reversion shorts fade the overextended ones — and a falling coin can't even book on a long-only cohort (it votes short → blocked), so decliners are excluded from **both** arms. Stays fully dynamic (no hardcoded majors list); the 90% major-coin floor + structure filter gate any weak major longs. Direction is chosen per-coin by indicator vote, not by `change24h`. |
| **Signal / direction** | `LIVE` `ISSUE` | 8-component confidence score (0–100); long/short from EMA/VWAP/trend votes on 1m·5m·30m. **Weakness:** confidence is anti-predictive at the top — 80+ trades win only ~52% yet are 90% of the book. Direction flips on candle noise. |
| **Auto-book gate** | `LIVE` | Books only when confidence clears the cohort threshold (80–90). Below that, shown in the feed but not traded. |
| **Entry gates** | `LIVE` | Regime filter · spread cap · momentum-exhaustion block · per-symbol post-stop cooldown · major-coin confidence floor · min-net-profit-to-enter · blocked session hours. |
| **Structure filter — LONGS** | `SHADOW` | Before a long books: 30m higher-highs · 1m not overbought · 1m rising · Supertrend bullish. Live on **2 of 7 cohorts** vs control twins. Backtest: 65% win / PF 3.3 vs a losing 40% baseline. |
| **Short logic** | `SHADOW` | Base logic shorts weakness continuation → squeezed (28% win). A **mean-reversion fade filter** now gates shorts on the treatment cohorts (fade an overextended, overbought, volume-spiking 15m move as it rolls over). Backtest on 24 liquid coins: 56–58% win / PF 1.5–1.7. |
| **Exits** | `LIVE` | TP + partial TP1 · trailing stop · profit-fade · weak-progress time-exit · hard stop-loss · time-exit · breakeven ratchet · profit-protection. Fee-aware: won't exit below a min net-profit floor. The trail is wide so winners run — realized winners avg +2.7 vs losers −1.9. |
| **Risk & fees** | `LIVE` | Per-style presets (conservative/balanced/aggressive) set SL·TP·trail·leverage. Fees at taker 0.05%/side + 18% GST on notional. |

## Bot 2 · Coin / spot pipeline (`coin_positions`)

| Stage | Status | Detail |
|---|---|---|
| **Scorer** | `LIVE` | Intraday m1·m5·m30; swing adds h4·d1. Trend from an EMA 9/21 crossover. |
| **Regime / structure gate** | `LIVE` | Swing entries require intact structure — price above h4 EMA21, no lower-lows on m30, momentum not fading. |
| **Re-entry guardrail** | `LIVE` | After 1 stop-loss a symbol goes on a 6-hour cooldown — stops re-buying a falling coin. |
| **Exits** | `LIVE` | Volatility-scaled TP/SL/breakeven — each coin's targets scale to its own ATR, so calm majors get reachable ~2.5% targets and volatile alts keep wide ones. |

---

## Known weaknesses & roadmap

**Still weak (`ISSUE`)**
- Confidence model is anti-predictive at the top — the core ranker doesn't separate winners from losers.
- Universe: thin/choppy coins excluded (20M volume floor) and **both** arms are now decliner-free (gainers arm ≥ +2%; volume arm only flat-to-up names). Remaining gap: ranking is 24h-based, so a coin breaking out *intraday* but flat on 24h can be missed until it clears the 24h gate (see the freshness arm below).
- Shorts base logic chases weakness → squeezed (mean-reversion fix now live in shadow A/B).
- Direction flip-flops on candle noise (a long & a short on one coin within 30 min).

**Next (`PROPOSED`)**
1. Judge the long + short structure-filter A/Bs over 1–2 weeks; if they hold, make them default. Tune the fade's target (wider suits a fade).
2. Fix funding-signal population (done — transient spot-fetch failures no longer null it).
3. Universe volume floor (≥20M) and full decliner exclusion (both arms) shipped; the backtest universe was aligned to the same gainers-only selection so validation matches live.
4. **Freshness arm (`PROPOSED`)** — rank a universe arm by *recent* (1h/4h) momentum so fresh intraday breakouts get scanned before they clear the 24h gate (that's where the long edge is earliest). Cost: the futures ticker exposes no intraday field, so this needs a candle-fetch pass over the candidate pool (the universe is built before candle analysis today) — a heavier, deliberate change, not yet built.
5. Add a funding-rate gate for shorts (crowded longs).

_Live = running in production. Shadow = live on a subset of cohorts for A/B. Backtested =
validated on refetched CoinDCX candles, not yet trading. No live-trading change ships
without an explicit go-ahead._

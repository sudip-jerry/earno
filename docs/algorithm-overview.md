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
| **Universe** | `LIVE` | Each scan rebuilds a watchlist from two arms, both gated by a **≥ 20M USDT 24h-volume floor** and both now **decliner-free**: (1) **top 24h gainers (≥ +2%)** and (2) **top by volume among flat-to-up names (24h change ≥ 0)**. Every live edge keys off an upside move — longs ride gainers, mean-reversion shorts fade the overextended ones — and a falling coin can't even book on a long-only cohort (it votes short → blocked), so decliners are excluded from **both** arms. Stays fully dynamic (no hardcoded majors list); the 90% major-coin floor + structure filter gate any weak major longs. Direction is chosen per-coin by indicator vote, not by `change24h`. A **spread-persistence quality gate** also drops any coin that has repeatedly tripped the hard-spread block across recent scans — thin meme micro-caps (e.g. VELVET, HMSTR) never get scanned. |
| **Signal / direction** | `LIVE` `ISSUE` | 8-component confidence score (0–100); long/short from EMA/VWAP/trend votes on 1m·5m·30m. **Weakness:** confidence is anti-predictive at the top — 80+ trades win only ~52% yet are 90% of the book. Direction flips on candle noise. |
| **Auto-book gate** | `LIVE` | Books only when confidence clears the cohort threshold (80–90). Below that, shown in the feed but not traded. |
| **Entry gates** | `LIVE` | Regime filter · spread cap · momentum-exhaustion block · per-symbol post-stop cooldown · major-coin confidence floor · min-net-profit-to-enter · blocked session hours · **2-scan entry confirmation — all cohorts, both sides, final gate**: an entry must survive every other gate on two consecutive scans before booking (kills the single-lucky-tick whipsaw entry); the DB counter enforces a min-gap so overlapping scan passes can't double-count. A **1-minute hot-list pass** was tried on 2026-07-12 (shipped 17:00 UTC, killed ~18:40 same day by its pre-registered bar): re-checking pending candidates at +60s admitted 4 trades/hour whose next full-scan look fell BELOW the threshold (conf 88→64 flicker, −$23.6 aggregate) — and their volume spikes were 0.19–0.67×, so no climax guard could have caught them. Lesson kept: the 2-minute spacing is not dead latency, it IS the debounce — a 60s re-look is not an independent observation on fast indicators. Its honest cost stays measured (median 0.048% price adverse drift per booking, 28/38 against) and is accepted. Cron unscheduled, `hotlist_enabled=false` everywhere (default false); the `hotlistOnly` code path stays dormant for a possible post-July-19 redesign requiring look-to-look stability. The 2-scan debounce's rejects averaged +0.06% gross at 30m — below the 0.118% round-trip fee — so single-look booking stays off. In bearish regimes, surviving fade shorts are held to the counter-trend floor (the old with-trend short discount was removed — it was calibrated for shorting falling symbols, which the gainers-only universe no longer contains). |
| **Structure filter — LONGS** | `OFF` (2026-07-17, A/B verdict) | The 10-day balanced-twin A/B reversed the early read decisively: control (filters OFF) +$85.69 at 50.3% win vs treatment −$26.47 at 41.7% — the filters cut trade volume 39% and their surviving shorts LOST while unfiltered shorts won. Both shadow filters (structure long + mean-rev short) set false everywhere; flags kept for re-test. |
| **Long vetoes** | `LIVE` (all cohorts, promoted 2026-07-21 at its bar) | v2's autopsy survivors — the only two components that replicated across two opposite regimes: no longs on symbols already labeled Bullish-24h (don't chase), no longs at RSI>65. Arm test (2ce184c8 only, Jul 17–21) hit its pre-registered bar at n=52 vetoed closures: kept profile 58.9% win +$28.29 (n=253) vs vetoed profile 38.5% win **−$112.55** — kept beat vetoed on both win% and net, so the veto was promoted book-wide (`long_vetoes_enabled=true` everywhere; migration 20260721051500). One banked counter-example: a slow strong trender (XMR, Jul 18) can grind higher for hours while vetoed — accepted cost, dwarfed by the chase losses. Explicitly NOT a crash-day defense — that's the market pause. |
| **Intraday market-pause — LONGS** | `LIVE` | No NEW longs while ≥50% of the scanned universe is in intraday downtrend (share of `trend_status` in Downtrend/Strong downtrend; labels the scan already computes — zero extra fetches). Shorts and all exits unaffected: in red tape the book goes short-only, not dark. Replay Jul 10–17: the ≥50% band was net-negative for longs in BOTH windows (green −$41.87, red −$9.16). Known limit: it cannot catch tops bought in the hour BEFORE a rollover becomes visible — that residual is contained by caps/circuit-breaker, and a sub-hour market-health signal is the post-review project. |
| **V2 confluence gate — LONGS** | `KILLED` (2026-07-15, at its pre-registered bar) | Measured-component score (trend strength +2 · calm volume +1 / spike −2 · RSI 40–55 +1 / 55–65 −1 · sideways +1 / bullish −1, book at ≥2) that beat confidence in an IN-SAMPLE replay (selected +$32.74 vs rejected −$87.86 on the same 14d that trained the weights). Out-of-sample (n=32 selected at the bar): 46.9% win **−$15.57** vs rejected 63% **+$64.59** — inversion held in every universe-strength band (no regime where it worked), so neither promotion, sign-flip, nor regime-switching survived. Gate off everywhere; passive tally kept in monitoring so a true bull regime can still be tested. Lessons banked: in-sample replay is a hypothesis, not a verdict; the climax penalty (spike ≥1.5 → −2) remains independently validated and feeds the component autopsy for the confidence model's successor. | |
| **Short logic** | `LIVE` + `SHADOW` | **Aggressive-twins short A/B (2026-07-21):** the 3m-momentum twins' short lane was negative four consecutive weeks (−$228 cum; shorts peak ~1.2% ROE — under every protection threshold — and 42% round-trip to the full stop) while the other cohorts' shorts made +$127/7d under identical gates. 31fac812 is now long-only (`allow_short=false`); twin 6163db97 keeps shorts as control (bar: n≥25 further shorts — negative → kill aggressive shorts; positive → re-examine). **Continuation-short gate (`LIVE`, all cohorts): shorts are fade-only.** Shorting a symbol already in a bearish 24h regime (34% win, −$72/14d) or with RSI<40 (32% win) is blocked outright; only fade-shaped shorts (bullish/sideways 24h symbol, RSI≥40 — 45.6% win, +$18/14d measured) may book. On top, the **mean-reversion fade filter** (`SHADOW`, treatment cohorts) requires an overextended, overbought, volume-spiking 15m move rolling over. Backtest: 56–58% win / PF 1.5–1.7. |
| **Exits** | `LIVE` | TP + partial TP1 · trailing stop · profit-fade · weak-progress time-exit · hard stop-loss · time-exit · breakeven ratchet · profit-protection. Fee-aware: won't exit below a min net-profit floor. The trail is wide so winners run — realized winners avg +2.7 vs losers −1.9. **Breakeven = NET breakeven** (stop sits at entry ± round-trip fees + slippage, so a protected round-trip closes at ≈₹0 instead of −fees). **Micro peak-lock** covers the pre-TP1 dead zone: once peak ROE ≥ 1.2% (below the 2.65% TP1), a fast reversal locks ~40% of the peak instead of round-tripping — the fade exit only runs post-TP1 and 1-minute marks can miss fast reversals. Coin bot breakeven is also net (avgBuy × 1.002). |
| **Risk & fees** | `LIVE` | Per-style presets (conservative/balanced/aggressive) set SL·TP·trail·leverage. Fees at taker 0.05%/side + 18% GST on notional. **Invariant: `targetMult ≥ minRR`** — the plan's R:R *is* the target multiplier, so an incoherent pair rejects every booking as "Risk-reward weak". The 07-11 mode-reseed shipped conservative as 1.5×/3.0 and silently killed both conservative cohorts for ~26h (3,320 skips, 0 bookings) until restored to 3.3×/3.0 on 07-12. |
| **Reliability** | `LIVE` | Filter candles cached 90s (they were refetched per cohort per scan; the filters fail *closed* on fetch failure, so a rate-limited CoinDCX would silently block bookings — failures are never cached). Scanner candles cached 45s (same origin as the trading path). Confirmation-RPC failures and config-select failures log loudly instead of silently disabling protections. Regime/trend labels the gates key off are shared exported constants — a wording edit can't silently disarm a gate. `allow_long`/`allow_short` both require explicit `false` to disable a side. |

## Bot 2 · Coin / spot pipeline (`coin_positions`)

| Stage | Status | Detail |
|---|---|---|
| **Scorer** | `LIVE` | Intraday m1·m5·m30; swing adds h4·d1. Trend from an EMA 9/21 crossover. |
| **Regime / structure gate** | `LIVE` | Swing entries require intact structure — price above h4 EMA21, no lower-lows on m30, momentum not fading. |
| **Regime gate** | `LIVE` | No NEW buys while <45% of the scanned universe is positive over 24h (breadth from ticker data, zero extra fetches). Two-window replay: every long-only entry rule bled −25..−75 in a red week while USDT was free — regime is first-order, entry rule second-order. Exits keep managing holdings. **Breadth-threshold sweep (2026-07-13, 30-symbol replay, both windows):** the 45% binary floor improved nearly every entry rule in BOTH windows (donchian +21.5→+31.0 net/14d; random −63→−35) and is kept. Raising to 55% was mixed (helped climax, hurt donchian both windows) — rejected. **Breadth-TIERED switching** (donchian when breadth≥60%, dip-buy in 45–60%) was REFUTED: the switched rule lost −34/14d and −27.6/7d vs donchian's +31/−21 under the plain 45% gate — dip-buying the mediocre-breadth band is where it dies (chop dips keep falling). One cell worth revisiting July-19: momentum-style entries (climax) restricted to breadth≥60% scored their best run (+51.7/14d) — entry-rule × breadth interaction, not a gate change. |
| **Entry A/B (3 arms)** | `SHADOW` | Replay on 30 real traded symbols (shared exits, fees, regime-gated) showed the original "rising momentum and volume" entry is statistically indistinguishable from RANDOM entries. Arms: **control** (original entry, 4 cohorts) · **donchian** (fresh 20-bar-high breakout — best offense: +16.9/14d, 2 cohorts; **volume-confirmed ≥1.5× since 2026-07-13** — replay under the live gate: free in good tape, red-week loss −21.4→−3.4, PF 0.85→1.17; arm sample restarts from this date) · **nfi_dip** (NostalgiaForInfinity-style guarded dip-buy — best defense: −5.9 in the red week, smallest of all rules incl. random, 2 cohorts). |
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
4. **Freshness arm (`SHADOW`, live on 2ce184c8 since 2026-07-22)** — hypothesis validated on 14d × 137 symbols of 15m closes across two opposite-regime weeks: top-decile **4h** movers not yet Bullish-24h were the only bucket positive at 2h forward in the red week and the best in the green week (+0.20%/2h vs +0.05% base; fee-clear rate 33–35% vs 25%). Top **1h** movers were negative both weeks — 1h spikes mean-revert; refuted and banked. Implementation avoids the feared candle-fetch cost entirely: the scan pass snapshots the top-150 liquid pool's prices every ~15 min (`futures_price_snaps`, self-pruning at 30h, zero extra API calls) and ranks 4h momentum from them. Arm cohorts book LONGS only from the fresh set; up to 8 fresh symbols missing from the normal arms are added to the scan but invisible to non-arm cohorts. Cold start: for the first 4h after deploy the arm books nothing (no 4h-old snapshot exists). **Bar: n≥30 closed arm longs must beat same-window non-arm longs on win% AND net/trade, or the flag dies.** Freshness is a ranking edge, not a signal — all existing gates (confidence, confirmation, vetoes, pause) still apply on top.
5. Add a funding-rate gate for shorts (crowded longs).
6. **Side-aware stop geometry — SHIPPED for shorts (2026-07-12):** the fade-short sweep was monotonic (tight 0.85/1.45 → PF 0.90 vs the long-preset scale 1.5/2.55 → PF 0.61 at 26% win), and live shorts were inheriting the long geometry. `computeRiskPlan` now takes a `side`: shorts run each style's SAME R:R ratio at **60% of the long stop scale, capped at 1.3% price** (aggressive ≈ 1.1/2.2, balanced ≈ 0.9/1.5). Longs untouched (their retune is item 7, July-19). Note: the scanner RISK CHECK panel still displays long geometry (display-only; queued with scanner work). The mean-rev fade remains regime-cyclical (56–58% win in the pump week, negative in the soft week) — the live A/B judges the fade itself.
7. **Long stop-geometry retune — NOT SHIPPED (re-validation failed its bar, 2026-07-21):** the Jul-12 sweep's winner (**1.1%/1.9% price**, ≈ −3.3/+5.7 ROE, R:R ≈ 1.73:1) beat baseline in both of its original windows (7d +78.9 vs +54.6 · 14d +54.9 vs +28.4). The pre-registered ship condition was that this edge replicate on the freshest data in BOTH sub-windows. Fresh replay (350 real longs Jul 13–20, live exit stack incl. net-breakeven + micro-lock, deltas-only reading — absolute levels are pessimistic-convention artifacts and 157/411 rows carry breakeven-parked stops): retune +$74 better in Jul 13–16 but **−$12 WORSE in Jul 17–20** — the edge did not replicate in the freshest window, so the geometry stays as-is. Re-testable after the next few weeks of closed longs; the MAE observation (95% of winners never dip below −2.2% ROE) still stands as motivation. |

## Go-live clock (restarted at the July-19 review)

- **T0 = 2026-07-22 00:00 IST** (restarted 2026-07-21 when the long vetoes were promoted
  book-wide — a champion-config change; the original Jul-20 T0's day 1 had already failed
  the daily-drawdown cap at −$53.51 on one cohort, so the restart cost nothing). All
  go-live metrics (daily net P&L, max daily drawdown, win rate, weekly totals) count from
  trades closed at/after T0 — no balance resets, no history wipes; `paper_equity` is a
  fixed $1,000 per cohort so sizing never drifts.
- **Champion config (frozen):** confidence thresholds per style · fade-only shorts with
  side-aware short geometry · net breakeven + micro peak-lock · 2-scan entry confirmation
  · structure filters OFF · **long vetoes ALL cohorts** (no Bullish-24h chase, no RSI>65
  longs) · intraday market-pause for longs (≥50% down-share) · coin regime gate at 45%
  breadth. Champion-config changes restart the clock; arm-flag flips at pre-registered
  bars on test arms do not.
- **Bar:** 2 consecutive net-positive paper weeks (W1 ends Jul 28, W2 ends Aug 4 IST) with
  max daily drawdown <5% of the $1,000 book per cohort. Earliest futures-only real-money
  pilot: **Aug 5**.
- **Pre-pilot P1 build (shipped 2026-07-21):** ① live TP1 — the 50% partial close is a
  real reduce-only order in live mode, booked only on order success (fails → retried next
  pass); ② entry orphan reconciliation — a live fill whose row-insert fails is flattened
  immediately (entry order-before-insert was already correct); ③ equity circuit breaker —
  mark pass tracks an intraday (IST) equity peak per user (`equity_peak`), and at
  `circuit_breaker_pct` (default 10%) below peak flattens the book (real orders in live;
  rows whose live flatten fails stay OPEN rather than hiding exposure) and halts new
  entries for the rest of the IST day (`halted_on`); ④ kill switch now flattens live
  positions on the exchange, not just in the DB; ⑤ coin phantom-buy fix — atomic
  buy/close RPCs (cash + row in one transaction), per-user scan lease against
  overlapping scans, unique open-holding index, and live-order-BEFORE-commit with a
  compensating sell if the local commit fails. Daily loss cap was already live-aware
  (blocks new entries at `daily_loss_cap_pct` of resolved equity). Emergency
  `circuit_breaker`/`kill_switch` closes book PnL without fee estimation — acceptable
  for a brake, noted for reporting. Coins stay paper until every entry arm reaches n≥30 entries.

_Live = running in production. Shadow = live on a subset of cohorts for A/B. Backtested =
validated on refetched CoinDCX candles, not yet trading. No live-trading change ships
without an explicit go-ahead._

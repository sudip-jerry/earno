# Signal v3 — entry ranker rebuild (SPEC, not yet built)

Drafted 2026-07-24 as the contingency for the Aug-4 decision point: if the
go-live clock fails even with every validated protection live, filtering has
hit its ceiling and the entry signal itself gets rebuilt from this spec.
Nothing here ships without an explicit go-ahead; the validation plan below
runs first regardless.

## The governing lesson (paid for three times)

Snapshot-STATE features do not replicate as long-entry predictors:

| Candidate | In-sample | Out-of-sample verdict |
|---|---|---|
| Confidence model (8-component) | looked fine | anti-predictive at the top (80+ ≈52% win, 90% of book) |
| v2 composite (trend/spike/RSI/regime) | +$32.74 vs −$87.86 | KILLED at bar: selected −$15.57 vs rejected +$64.59 |
| Sideways+calm-volume bonus (v2 survivor) | best surviving cell | REFUTED 2026-07-24: 56.1% win but −$0.91/trade (n=107, Jul 16–24) — best win rate, worst per-trade |
| Volume-spike penalty as scoring term | validated twice | sign FLIPPED twice across windows — unusable as a ranker term |

What HAS replicated, every test, both regime directions:
- **4h freshness** (top-decile 4h return, 24h < +1%): only bucket positive at
  2h forward in the red week, best bucket in the green week; fee-clear rate
  33–35% vs 25% base. (1h version mean-reverts — refuted.)
- **Toxicity vetoes**: RSI>65 longs and Bullish-24h chases lose in every
  window measured (live book-wide since 2026-07-21).
- **Intraday down-share ≥50% → no longs** (live).
- **Exit mechanics**: side-aware geometry, net breakeven, micro locks.

Conclusion: rank entries by **where price is going** (path/forward-momentum
features validated against forward returns), not **what the snapshot looks
like**. State features survive only as hard vetoes at their toxic extremes.

## Design

Candidate pool per scan = current universe arms ∪ fresh-4h set (already live
via `futures_price_snaps`). For each candidate symbol, LONG rank score:

1. **r4h percentile** within the liquid pool (0–1) — primary term. Validated.
2. **Freshness bonus**: +0.25 if in the fresh set (top-decile r4h AND 24h < +1%). Validated.
3. **Chase penalty**: hard veto (not a score) — 24h ≥ +1% label OR RSI>65 → ineligible. Live already.
4. **r1h guard**: if the symbol's own 1h return is in the pool's top decile → ineligible this scan
   (1h spikes mean-revert; re-eligible once the spike cools). From the refuted-1h finding.
5. **Confidence demoted to a floor**, not a ranker: candidate must clear the cohort's
   existing threshold, but ordering among eligible candidates is by (1)+(2) only.
   Keeps all plumbing (bands, display, per-style thresholds) intact.
6. Everything else unchanged: 2-scan confirmation, market-pause, spread/universe
   gates, caps, exits. v3 changes WHICH long gets booked first, not how it's managed.
Shorts are out of scope (fade gate + new micro-lock own that side).

Hold horizon note: the freshness edge decays by 4h in weak tape — existing
auto_close (90–180m) already fits; no change.

## Validation plan (before any code)

Extend the fa_test methodology (scratchpad `fa/fa_test.py`, 15m closes,
137 symbols — refresh to the trailing 14d):
1. Hourly grid: compute the v3 rank for every pool symbol; select top-K (K=3).
2. Measure forward 1h/2h returns and fee-clear rate (0.6% hurdle) of v3
   selections vs (a) the current system's proxy (top confidence among
   gainers-arm symbols — approximated by top-decile r24h picks), (b) random,
   (c) fresh-set-only baseline.
3. PASS BAR (pre-registered): v3 selections beat (a) on mean forward 2h return
   AND fee-clear rate in BOTH week-halves. Fail either half → v3 dies on paper,
   no arm, no code.

## Rollout (only if validation passes AND Aug-4 forces the rebuild)

Shadow arm on one cohort (`signal_v3_enabled` flag, same pattern as every
arm): v3 ordering live for that cohort's longs only. Pre-registered bar at
n≥30 closed v3 longs: beat same-window non-v3 longs on win% AND net/trade,
or the flag dies. No champion-config change, so the go-live clock (if still
running) does not restart for the arm itself.

## Data caveats

- positions.market_regime stores the GLOBAL BTC regime (lowercase
  neutral/bullish/bearish), NOT the per-symbol 24h label — per-symbol labels
  require joining bot_signals via signal_id. Component tallies that filtered
  positions.market_regime='Bullish 24h' matched zero rows (the RSI>65 half of
  the veto tally did the measuring). The live veto gate reads the correct
  per-symbol label from the scan analysis.
- Longs closed before ~Jul 16 don't join to bot_signals (purged/unlinked) —
  single-window caveat on the sideways+calm refutation (n=107).

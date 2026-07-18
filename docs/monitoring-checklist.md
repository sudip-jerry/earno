# EarnO 4-hourly monitoring checklist

ANALYSIS ONLY — no code/config/flag/cron changes during the strategy freeze (until
July 19) unless the user directs otherwise or a pre-registered bar below is crossed.
Futures P&L is USD/USDT (never INR).

## Futures (updated 2026-07-17: filters OFF everywhere; long-vetoes arm live on
## 2ce184c8; universal intraday market-pause live)
- **Long-vetoes passive tally** (the arm's pre-registered bar): across ALL cohorts'
  closed longs, split by veto condition (market_regime='Bullish 24h' OR rsi>65 at
  the booked signal). At n≥30 vetoed closures: kept must beat vetoed (win% AND net)
  or flip `long_vetoes_enabled=false` on 2ce184c8 and report.
- **Market-pause activity**: bot_events meta->>'kind'='long_market_pause' count +
  down_share values; sanity: pauses should cluster in red hours, and shorts should
  still book during pauses.
- Filter-block events (structure_filter_blocked / short_filter_blocked) should now
  be ZERO — nonzero means a flag got re-enabled unexpectedly.
- 4h book net PnL by cohort/arm.
- v2 arm (2ce184c8) out-of-sample tally: selected vs rejected since 2026-07-12 06:00
  (promotion bar: n≥30 selected; filter joins on `s.created_at >=` to hit the index).
- Filter A/B arms vs controls; conservative cohorts booking normally (no
  "Risk-reward weak" floods — that signature = targetMult/minRR incoherence).
- Gates health: `entry_confirm_rpc_error` count, universe warnings, spread-skip volume.
- Short bookings: tight fade geometry live (stop ≈0.9–1.3% price, per-style R:R
  unchanged); continuation-short gate holding (no bearish-24h/RSI<40 shorts).

## Hot-list pass — KILLED 2026-07-12 (bar crossed in 1st hour)
- The 1-min hot pass admitted 4 flicker trades/hour (conf 88→64 at the next look,
  −$23.6 aggregate; vol spikes 0.19–0.67x so a climax guard couldn't catch them).
  Cron `earno-hotlist-pass` unscheduled; `hotlist_enabled=false` all cohorts,
  default false.
- Watch only: no futures bookings should cluster on odd minutes anymore; if the
  cron reappears in `cron.job`, flag it to the user.

## Coins
- Regime gate blocks (breadth <45%) vs buys; exits still managing holdings.
  NOTE: on `coin_bot_events`, `kind` is a TOP-LEVEL COLUMN (`WHERE kind='regime_gate_skip'`),
  NOT `meta->>'kind'` (that pattern silently returns 0 — it hid 27h of legitimate
  regime blocking on 2026-07-13/14 until the block messages were read directly).
  The gate messages carry the live breadth reading ("only 26% of universe positive").
- Entry-rule arms: donchian (31fac812, e703d5bd) · nfi_dip (6163db97, 8a067000) ·
  control (rest) — trade counts + PnL per arm.
- No cash drift; breakeven stops at avgBuy×1.002 behaving.

Report to the user only what is noteworthy or bar-crossing; otherwise keep it brief.

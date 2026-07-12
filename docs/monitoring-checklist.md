# EarnO 4-hourly monitoring checklist

ANALYSIS ONLY — no code/config/flag/cron changes during the strategy freeze (until
July 19) unless the user directs otherwise or a pre-registered bar below is crossed.
Futures P&L is USD/USDT (never INR).

## Futures
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
- Entry-rule arms: donchian (31fac812, e703d5bd) · nfi_dip (6163db97, 8a067000) ·
  control (rest) — trade counts + PnL per arm.
- No cash drift; breakeven stops at avgBuy×1.002 behaving.

Report to the user only what is noteworthy or bar-crossing; otherwise keep it brief.

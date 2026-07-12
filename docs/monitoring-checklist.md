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

## Hot-list quality (decides the pre-registered bar)
- **Hot-pass bookings**: futures positions with odd `extract(minute from opened_at)`
  since last pass, joined to their booked signal (confidence, volume_spike_ratio).
- **Hot-only admissions** (the deciding metric): for each hot booking, the same
  symbol+user's next full-scan signal (+1 min). If its confidence < cohort threshold,
  the old 2-min cadence would NOT have booked it — count these and track their PnL.
  (Reference case: HYPE 2026-07-12 17:13 was NOT one — next look was 67 ≥ 66.)
- **Climax share**: % of hot bookings with volume_spike_ratio ≥ 1.5 vs full-scan
  bookings' share.
- **Adverse drift** pending→booked, hot vs full (the benefit side; baseline median
  0.048% cost at the 2-min cadence, 28/38 against).
- **Pre-approved decision bar**: hot-only admissions > ~3/day AND aggregate PnL
  negative → apply the climax guard (hot pass confirms only when
  volume_spike_ratio < 1.5, in the hot-pass branch of runAutoBookPass) or set
  `hotlist_enabled=false`, and tell the user. Otherwise keep — the drift saving is free.

## Coins
- Regime gate blocks (breadth <45%) vs buys; exits still managing holdings.
- Entry-rule arms: donchian (31fac812, e703d5bd) · nfi_dip (6163db97, 8a067000) ·
  control (rest) — trade counts + PnL per arm.
- No cash drift; breakeven stops at avgBuy×1.002 behaving.

Report to the user only what is noteworthy or bar-crossing; otherwise keep it brief.

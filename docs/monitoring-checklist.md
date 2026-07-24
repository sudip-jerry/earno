# EarnO 4-hourly monitoring checklist

ANALYSIS ONLY — no code/config/flag/cron changes during the strategy freeze (until
July 19) unless the user directs otherwise or a pre-registered bar below is crossed.
Futures P&L is USD/USDT (never INR).

## Futures (updated 2026-07-17: filters OFF everywhere; long-vetoes arm live on
## 2ce184c8; universal intraday market-pause live)
- **Long vetoes: PROMOTED to all cohorts 2026-07-21** (bar crossed at n=52: kept
  58.9%/+$28.29 vs vetoed 38.5%/−$112.55). Watch `long_veto_blocked` events (now
  expected from every cohort) and keep the kept-vs-vetoed-profile tally as a
  post-promotion sanity check — if the vetoed profile ever turns strongly positive
  over a fresh n≥30 window, flag for re-review; do not flip flags silently.
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
- P1 safety events (all should be RARE; any occurrence is worth a line in the report):
  `circuit_breaker_tripped` / `circuit_breaker_flatten_failed` (flatten-failed = live
  exposure left open deliberately — needs eyes), `live_tp1_failed`/`live_tp1_placed`,
  `live_orphan_flattened`/`live_orphan_flatten_failed`, `kill_switch_flatten_failed`.
  Coin side (kind is a COLUMN): `auto_buy_rejected` (lost race — occasional is fine),
  `coin_close_rpc_error` (RPC broken, legacy fallback in use — fix the function),
  `live_buy_orphan_flattened`/`live_buy_orphan_flatten_failed`.
- Short bookings: tight fade geometry live (stop ≈0.9–1.3% price, per-style R:R
  unchanged); continuation-short gate holding (no bearish-24h/RSI<40 shorts).
- **Freshness arm (2026-07-22, 2ce184c8):** arm longs only from top-decile 4h
  movers (24h < +1%). Watch: `futures_price_snaps` growing (~150 rows/15min,
  pruned at 30h — a stale max(snapped_at) >20min = snapshot writes broken);
  arm bookings tally toward the bar (n≥30 closed arm longs vs same-window
  non-arm longs on win% AND net/trade); first 4h after deploy the arm books no
  longs (cold start — expected, not a failure).
- **Short micro-lock, side-aware (2026-07-24):** shorts arm 0.6% ROE / floor
  0.5% (longs unchanged 1.2/0.35). Both aggressive cohorts are two-sided again
  (the Jul-21 side-off A/B is CLOSED — Kush's control hit its bar at n=35,
  −$16.79, and the mechanical fix shipped instead of a side kill). Watch:
  micro_peak_lock exits should rise on shorts; if the twins' short lane is
  still clearly negative over the next n≥25 closed shorts WITH the lock live,
  the problem is entry-side — flag for the signal-rebuild list, don't flip
  side flags.

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

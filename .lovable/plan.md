## Goal

Improve automated exits and dashboard attribution by mirroring profitable manual-exit behaviour. Entry engine, scanner, Trading Style UI, Strictness UI, user flow, final TP formula, and SL formula are unchanged (SL only moves to breakeven after TP1).

## Scope of change (files)

- DB migration (one): extend `positions` and `bot_config_audit` use only — no new versioning columns.
- `src/lib/risk-engine.ts` — add TP1 %, trail %, profit-fade, weak-progress thresholds per Trading Style preset. Pure functions.
- `src/lib/auto-book.server.ts` — populate TP1 + trail + tracking fields on open; new mark-pass behaviour (TP1 partial → breakeven SL, trailing, profit-fade, weak-progress, MFE/MAE).
- `src/lib/auto-book.server.ts` — add style-aware execution caps + rolling symbol cooldown + market regime guard at book-decision time.
- `src/lib/bot.functions.ts` (manual close path) — snapshot MFE/MAE/peak/giveback at manual close and tag `exit_reason='manual'`.
- `src/lib/beta-report.functions.ts` — new aggregation fields for the dashboard split.
- `src/lib/recommendations.functions.ts` — guardrails + dedupe + anti-thrash check against `bot_config_audit`.
- `src/routes/_authenticated/beta-report.tsx` (or whichever dashboard panel renders PnL) — render the new split safely with null-safe fallbacks.
- No changes to scanner, entry engine, Trading Style UI, Strictness UI.

## DB migration

Single migration, additive only. All columns nullable so old rows keep working.

`positions` adds:
- `tp1_price numeric`, `tp1_pct numeric`
- `tp1_hit boolean default false`, `tp1_hit_at timestamptz`, `tp1_pnl numeric`
- `tp1_qty_closed numeric` (simulated half), `remaining_qty numeric`
- `breakeven_moved boolean default false`
- `trail_pct numeric`, `trail_anchor_price numeric` (best price seen post-TP1)
- `final_tp_hit boolean default false`
- `final_exit_reason text` (one of `take_profit | stop_loss | time_exit | trailing_exit | profit_fade_exit | breakeven_exit | manual | weak_progress_time_exit`)
- `peak_unrealized_pnl_pct numeric`, `giveback_pct numeric`
- `max_favourable_excursion_pct numeric`, `max_adverse_excursion_pct numeric`
- `highest_unrealized_pnl numeric`, `lowest_unrealized_pnl numeric`
- `weak_progress boolean default false`, `weak_progress_marked_at timestamptz`
- `manual_saved_pnl numeric`, `manual_missed_pnl numeric`, `shadow_exit_reason text`, `shadow_exit_pnl numeric`, `shadow_closed_at timestamptz`

No new columns on `bot_config`. Style-aware caps + cooldowns are derived from existing `trading_style` + strictness (no schema churn); `max_open_positions`, `risk_per_trade_pct`, `daily_loss_cap_pct` already exist and remain user-tunable overrides.

Audit/version tracking continues via existing `bot_config_audit` trigger — no `algo_version` field.

## Style presets (added to `risk-engine.ts`)

Extend `StylePreset` with: `tp1Pct`, `trailPct`, `profitFadeMinPct=0.6`, `profitFadeGivebackPct=0.4`, `weakProgressMinPct=0.3`, `weakProgressWindowMin=60`, plus execution caps `maxTradesPerDay`, `maxSameDirPerDay`, `maxTradesPerSymbolPerDay`, `lossesBeforeSymbolCooldown`, `symbolCooldownHours`.

```text
                 tp1   trail  trades/d  sameDir  /sym  losses→cd  cd-hrs
Conservative    0.55   0.30      9         5      2       2         6
Balanced        0.70   0.42     15         8      3       2-3      4-6
Aggressive      0.90   0.62     25        12      4       3        3-4
```

Strictness shifts caps:
- less → upper end, moderate → middle, strict → lower end (and stricter min-score). Strictness is read from the existing `useStrictness` preset on the client and mirrored server-side via the value persisted in `bot_config.min_scalp_score` mapping (no schema change).

If ATR-derived TP exists for a setup, use `max(tp1Pct, atrTp1Equivalent)`.

## Auto-book changes (open phase, `auto-book.server.ts`)

When opening a paper trade:
1. Compute TP1 from preset (or ATR equivalent), persist `tp1_price`, `tp1_pct`, `remaining_qty = qty`, `tp1_qty_closed = 0`, `trail_pct` from preset.
2. Pre-trade gates (in this order, all reuse existing data):
   - Market regime guard (new): compute `market_regime` from BTC 1h EMA slope + RSI buckets already fetched in the scanner pass; block shorts in strong_bullish unless confidence ≥ 90 & reversal pattern flag; symmetric for strong_bearish/longs. Bullish/bearish require stricter confirmation (+5 conf, +1 confluence). Persist `market_regime`, `shorts_allowed_reason`, `longs_allowed_reason` on the resulting `bot_signals` row; increment a `trades_blocked_by_regime` counter in the per-user event log.
   - Style-aware caps: count today's positions (UTC day) for user — total, same-direction, per-symbol — and reject when over preset cap.
   - Rolling symbol cooldown: query last 24h closed positions for `(user, symbol)`; apply cooldown windows above; 4+ losses & 0 wins → 24h cooldown.
3. All other entry logic unchanged.

## Mark-pass changes (`runMarkPass`)

Per open position, in order:
1. Compute `pnl`, `pnlPct` (existing).
2. Update MFE/MAE: `max_favourable_excursion_pct = max(prev, pnlPct)`, `max_adverse_excursion_pct = min(prev, pnlPct)`; same for `highest_unrealized_pnl` / `lowest_unrealized_pnl`; `peak_unrealized_pnl_pct = max(prev, pnlPct)`; `giveback_pct = peak - pnlPct` when `peak ≥ profitFadeMinPct`.
3. TP1: if not `tp1_hit` and price crossed `tp1_price`:
   - Set `tp1_hit=true`, `tp1_hit_at`, `tp1_pnl = pnlPct * (qty/2)` (simulated 50% close — one row remains visible).
   - Set `tp1_qty_closed = qty/2`, `remaining_qty = qty/2`.
   - Move `stop_loss = entry_price` (breakeven), `breakeven_moved=true`. SL formula otherwise unchanged.
   - Initialize `trail_anchor_price = mark`.
4. Post-TP1 trailing: update `trail_anchor_price` to best favourable mark; if mark retraces by `trail_pct` from anchor → close remaining, `final_exit_reason='trailing_exit'`.
5. Profit-fade: if `peak_unrealized_pnl_pct ≥ 0.6` and `giveback_pct/peak ≥ 0.4` → close remaining, `final_exit_reason='profit_fade_exit'`.
6. Final TP (existing formula): on hit → `final_tp_hit=true`, `final_exit_reason='take_profit'`.
7. SL (existing formula, possibly moved to breakeven): on hit → `final_exit_reason= breakeven_exit if breakeven_moved else stop_loss`.
8. Weak-progress: if `opened_at` age in 45–60 min window and `peak_unrealized_pnl_pct < 0.3` → set `weak_progress=true`, `weak_progress_marked_at`. Do NOT force SL. After flag, tighten trail to `trail_pct/2` and shorten `auto_close_minutes` effective ceiling to `min(existing, age + 30m)`; if momentum turns negative (mark crosses below entry post-flag for long, opposite for short) → `final_exit_reason='weak_progress_time_exit'`.
9. PnL on closed trades reflects TP1 leg + remaining-leg pnl: `pnl_pct = tp1_pnl + (exit_pnl_pct * remaining_qty/qty)`. `pnl` recomputed from leg pnls. Verified by unit-style check in the validation step.

All transitions guarded so no double-exit (`if status!='open' return`; idempotent on `tp1_hit`).

## Manual exits (`bot.functions.ts`)

On user-initiated close:
- Snapshot `peak_unrealized_pnl_pct`, MFE/MAE at exit, set `exit_reason='manual'`, `source='manual'` on positions row (already exists).
- Spawn a lightweight shadow tracker: persist `shadow_exit_*` later via mark-pass continuing to read the row even when closed-manually — implemented by NOT updating `status` for shadow; instead the mark-pass also picks rows where `exit_reason='manual' AND shadow_exit_reason IS NULL AND closed_at > now()-24h` and simulates what would have happened (TP1/TP/SL/trail/fade/time) until one fires. Result stored in `shadow_exit_*`, plus `manual_saved_pnl = manual_pnl - shadow_pnl` (when manual better) and `manual_missed_pnl = shadow_pnl - manual_pnl` (when shadow better).

## Dashboard (`beta-report.functions.ts` + panel)

Add aggregations (computed in the existing report function, null-safe with `COALESCE(...,0)`):
`total_pnl, bot_exit_pnl, manual_exit_pnl, manual_saved_pnl, manual_missed_pnl, take_profit_pnl, tp1_pnl, stop_loss_pnl, time_exit_pnl, trailing_exit_pnl, profit_fade_exit_pnl, breakeven_exit_pnl, manual_exit_count, bot_exit_count, tp1_hit_rate, final_tp_hit_rate, sl_after_positive_count` (count of closed losers where `peak_unrealized_pnl_pct > 0.3`).

Render in the existing dashboard panel as a new "Exit attribution" sub-grid. Old rows with null new fields fall back to current `exit_reason`/`pnl` only.

## Recommendation engine (`recommendations.functions.ts`)

- Whitelist of actions: symbol cooldown, direction guard, risk reduction, max-open-position guard, kill switch, regime-based short/long restriction. All other automated mutations disabled.
- Each card payload: `{ problem, affected, evidence, action, configDiff, willNotChange, whySafe, blockedByAntiThrash }`.
- Dedupe: group candidate recommendations by `(user_id, field)` per cycle, keep highest-priority only.
- Anti-thrash (read `bot_config_audit`):
  - Skip if same `(user_id, field)` changed in last 24h.
  - Skip risk-up / cap-up / cooldown-down if user's last 24h realized PnL < 0.
  - Risk-up additionally requires 24h profit factor > 1.2 and trade count ≥ 20.
  - Skip confidence-down on losing day.
  - Log each skipped recommendation with reason for the admin panel.

## Validation

After migration + code edits:
1. `bun run build` / typecheck (auto by harness).
2. Targeted vitest cases (add under `src/services/__tests__/`): TP1 split pnl math, breakeven activation, trailing exit, profit-fade trigger at peak 1.0% → 0.6%, weak-progress flag at 60 min, MFE/MAE monotonicity, market-regime block of shorts in strong_bullish, style cap rejection, anti-thrash skip path.
3. Manual smoke via `/api/public/hooks/mark-positions` POST against a seeded paper trade.
4. Dashboard renders for a user whose trades have all-null new fields.

## Explicitly out of scope

No new mode, no copilot/autopilot split, no `algo_version` column, no scanner change, no entry change, no UI flow change, no change to final TP or SL formulas (other than the breakeven move after TP1).

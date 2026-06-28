
## Goal 1 — Make "conservative" a first-class style + add pre-entry net-profit gate

### Where `trading_style` is currently read (audit)
Already 3-style aware — no missing branches found:
- `src/lib/risk-engine.ts` → `STYLE_PRESETS` has `conservative`, `balanced`, `aggressive` (sizing, SL/TP caps, TP1, trail, caps, cooldown).
- `src/lib/futures/strategy-policy.ts` → `resolveRiskProfile` already maps `conserv*` → `conservative` (min-confidence 40, ambiguous forbidden).
- `src/lib/futures/exit-policy.ts` → only splits "aggressive" vs "moderate"; `conservative` correctly folds into the looser `moderate` exit profile. Intentional, leave as is.
- `src/lib/auto-book.server.ts` mark-pass → `ROE_HARD` and `RUNNER_PROT` tables both have all 3 styles already.
- `src/lib/futures-exit-replay.functions.ts` → passes raw `trading_style` through to `evaluateFuturesExit`, which normalises. Fine.
- UI: `settings.tsx`, `algo-config.tsx`, `admin.tsx` already expose Conservative in selects.
- Zod schemas in `bot.functions.ts`, `plans.functions.ts`, `beta-report.functions.ts` already accept `"conservative"`.

Conclusion: no code path silently assumes only 2 styles. Conservative is wired everywhere it matters. The remaining work is the new field + tuning conservative's preset to the requested numbers + the data update.

### Schema change (one migration)

Add a generic per-config pre-entry net-profit floor, mirroring the existing exit-side field:

```sql
ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS minimum_net_profit_to_enter_pct numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.bot_config.minimum_net_profit_to_enter_pct IS
  'Pre-entry gate: required projected net profit (after entry+exit fees + GST) at the planned TP, expressed as % of entry notional. 0 disables the gate.';
```

No new table, no RLS change (existing `bot_config` policies cover it), no GRANT change (table already granted). Field is generic — every style can use it; only the 2 conservative users get a non-zero default in the data update.

**Default value rationale (proposed):** with the current `taker_taker_with_gst` model, round-trip fee on notional ≈ 0.118%. Conservative's `targetMult = 1.5` and `minSL = 1.5` give TP ≈ 2.25% on notional, so a fee-aware floor of **0.50%** (net profit at TP, on notional) easily passes clean setups but blocks marginal high-fee/low-RR ones. We will set conservative users to **0.50**, and leave aggressive/balanced at **0** (no behavior change). Final value is a one-line tweak after we see live data.

### Code change (one file, narrow)

`src/lib/auto-book.server.ts`:
1. Add `minimum_net_profit_to_enter_pct` to the `BotConfig` type and to the `select(...)` column list in `runAutoBookPass`.
2. After `plan` is computed and **before** the `bot_signals` insert / position booking, compute:
   - `entryNotional = plan.positionSize` (already qty×price equivalent)
   - `exitNotionalAtTp = qty × tpPrice`
   - `fees = (entryNotional × entry_fee_pct + exitNotionalAtTp × exit_fee_pct) × (1 + gst_pct/100) / 100`
   - `grossAtTp = qty × |tpPrice − entry|`
   - `netPctAtTp = (grossAtTp − fees) / entryNotional × 100`
   - If `cfg.minimum_net_profit_to_enter_pct > 0` and `netPctAtTp < cfg.minimum_net_profit_to_enter_pct`: set `rejection = "Projected net profit at TP below minimum_net_profit_to_enter_pct"`, `final = "skip"`, log a `pre_entry_net_profit_skip` event with the computed numbers. Uses `feeModelRates(DEFAULT_FEE_MODEL)` from `src/lib/fees.ts` — same fee model already used on the exit side.

No new module, no second exit system, no scoring change. Pure pre-entry gate, config-driven, applies uniformly across all styles.

### Conservative preset tuning

Update `STYLE_PRESETS.conservative` in `src/lib/risk-engine.ts` to match the requested numbers where they belong in the preset (the rest live on `bot_config`):
- `riskPct: 0.35` (was 0.5)
- `minRR: 3.0` (was 1.5)
- `maxTradesPerDay: 10` (was 9)
- Other preset fields (SL floor, ATR mult, TP1, trail, weak-progress, profit-fade) unchanged — these aren't in the request and the existing values are already the "conservative" shape.

Per-user fields (`timeframe`, `leverage`, `auto_book_confidence_threshold`, `cooldown_minutes`, `max_trades_per_day`, `min_rr`, `risk_per_trade_pct`, new `minimum_net_profit_to_enter_pct`) are set in the data update below, not in code — per the "no hardcoded user groups" rule.

## Goal 2 — Reassign 6 users into 3 style groups (data only)

Single `UPDATE` against `bot_config`, joined via `profiles.email`. No code path changes; behavior follows from the config values.

| Email | trading_style | timeframe | leverage | risk_per_trade_pct | min_rr | auto_book_confidence_threshold | max_trades_per_day | cooldown_minutes | minimum_net_profit_to_enter_pct |
|---|---|---|---|---|---|---|---|---|---|
| sudip.gupta.87@gmail.com | aggressive | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged (0) |
| hellokushbajpai@gmail.com | aggressive | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged (0) |
| yashy05@gmail.com | balanced | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged (0) |
| akshay.bsg@gmail.com | balanced | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged (0) |
| robinm379@gmail.com | conservative | 15m | 2 | 0.35 | 3.0 | 88 | 10 | 90 | 0.50 |
| shambhutiwary1@gmail.com | conservative | 15m | 2 | 0.35 | 3.0 | 88 | 10 | 90 | 0.50 |

Current DB confirms `robinm379` and `shambhutiwary1` are presently `aggressive/3m` and `balanced/15m` respectively — both will be moved to the new conservative group.

## Execution order

1. Migration: add `minimum_net_profit_to_enter_pct` column (default 0).
2. After migration approval + types regen: edit `src/lib/auto-book.server.ts` (select list + pre-entry gate) and `src/lib/risk-engine.ts` (conservative preset numbers).
3. Data update via insert tool: set the 2 conservative users' bot_config rows to the values in the table. Aggressive/balanced rows untouched.
4. Typecheck.

## Open questions before I proceed

- **Net-profit floor default of 0.50% on notional** for conservative — OK, or do you want it expressed/tuned differently (e.g. as ROE on margin, which at 2× leverage would be 1.0%)?
- **Aggressive and balanced users**: keep at `minimum_net_profit_to_enter_pct = 0` (gate disabled), or seed a small floor (e.g. 0.15%) so the field is exercised on those groups too from day one?

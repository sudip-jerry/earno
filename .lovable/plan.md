## Confirmations

**(a) Where SL/TP/confidence are available at gate time** (`src/lib/auto-book.server.ts`):
- `plan.slPct` and `plan.tpPct` are computed by `computeRiskPlan(...)` (via `presetFromConfig`) earlier in the loop and exist by the time we reach the booking block around line ~771.
- `a.confidence_pct` is the analyzed confidence score (already used at line 748 against `auto_book_confidence_threshold`).
- ATR%-based SL distance = `plan.slPct` (already factors `atr_multiplier`, `min_sl_pct`, and is hard-capped by `max_auto_sl_pct` → "manual_review"). The new `max_sl_atr_pct` is a separate, stricter REJECT-only ceiling that runs before the EV / session checks.

All three new gates fit cleanly into the existing `rejection`-string pattern, get logged via `logEvent` + written into `bot_signals.rejection_reason` by the existing insert path (no new logging plumbing).

**(b) Column type for `blocked_session_hours_ist`**: use Postgres `integer[]` (`int4[]`) with default `'{}'`. Reasons:
- Native array, no JSON parsing in TS, trivially queryable with `= ANY(...)` if ever needed.
- supabase-js types it as `number[] | null` — no casts at call site.
- bot_config already uses `text[]` for `symbol_blocklist`, so `integer[]` is consistent with existing schema style (no new tables, no JSONB needed).

**(c) Proposed migration** (one statement, additive, no backfill of defaults beyond column default):

```sql
ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS max_sl_atr_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_ev_ratio numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked_session_hours_ist integer[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.bot_config.max_sl_atr_pct IS
  'Hard reject ceiling on ATR-derived SL%. 0 = disabled.';
COMMENT ON COLUMN public.bot_config.min_ev_ratio IS
  'Min EV proxy = (p*tp)/((1-p)*sl) where p=confidence/100. 0 = disabled.';
COMMENT ON COLUMN public.bot_config.blocked_session_hours_ist IS
  'IST hours (0-23) where auto-book is blocked. Empty = no block.';
```

No new GRANTs/policies needed — additive columns inherit the existing `bot_config` RLS/grants.

## Implementation steps (after approval)

1. **Migration** — the SQL above.
2. **Data seed** (`supabase--insert`, 6 `UPDATE` statements scoped by `user_id` resolved from `auth.users.email`):
   - Conservative (robinm379, shambhutiwary1): `max_sl_atr_pct=1.5, min_ev_ratio=1.2, blocked_session_hours_ist='{10,11,13,14,18,19}'`
   - Balanced (yashy05, akshay.bsg): `max_sl_atr_pct=2.0, min_ev_ratio=1.0, blocked_session_hours_ist='{11,19}'`
   - Aggressive (sudip.gupta.87, hellokushbajpai): `max_sl_atr_pct=2.5, min_ev_ratio=0.9, blocked_session_hours_ist='{19}'`
3. **`src/lib/auto-book.server.ts`**:
   - Extend `BotConfig` type with the three fields; add them to the `select(...)` column list at line ~339.
   - Insert three new gate blocks **after** the existing pre-conditions and **before** the booking block (~line 771), in this order so the cheapest checks short-circuit first:
     - **Session gate**: compute IST hour via `new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })` → parseInt; reject if included in array.
     - **SL-width gate**: if `max_sl_atr_pct > 0 && plan.slPct > max_sl_atr_pct` → reject.
     - **EV gate**: `p = a.confidence_pct / 100; ev = (p * plan.tpPct) / ((1 - p) * plan.slPct)`; guard div-by-zero (`p < 1 && plan.slPct > 0`); reject if below threshold.
   - Each gate sets `rejection = "..."`, `final = "skip"`, calls `logEvent(..., "info", ..., { kind: "<gate>_skip", ... })` mirroring the `pre_entry_net_profit_skip` pattern. The downstream `bot_signals` insert path already records `rejection_reason`, so analytics UI picks them up automatically.
4. **Type sync** — `src/integrations/supabase/types.ts` is auto-regenerated after migration approval; add the three fields to the `BotConfig` interface used in `auto-book.server.ts`. No UI changes (out of scope per request).
5. **Typecheck** — run `tsgo` to confirm green.

## What is explicitly NOT changing

- No exit-layer changes (BE / TP1 / trailing / profit-fade / time-exit untouched).
- No new tables, no JSONB, no schema bloat.
- No user-id branches or hardcoded style logic in code — all behaviour reads from `bot_config`.
- Coin/spot module untouched.
- `max_auto_sl_pct` (manual-review path) left intact; `max_sl_atr_pct` is the new strict reject lane and operates independently.

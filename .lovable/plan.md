## Goal

Move earnO from a fixed % stop-loss to a **volatility-adjusted** risk model with three trading-style presets, while keeping the app mobile-first and the existing layout intact.

## 1. Database (one migration)

Extend `bot_config` with new columns (existing ones repurposed where possible):

- `trading_style` text default `'balanced'` (`conservative` | `balanced` | `aggressive`)
- `min_sl_pct` numeric default `1.2`
- `atr_multiplier` numeric default `1.5`
- `max_auto_sl_pct` numeric default `4.0`
- `target_multiplier` numeric default `1.7` (R:R target multiple of SL)
- `min_rr` numeric default `1.5`

Keep `stop_loss_pct`/`take_profit_pct` for backwards compatibility but stop using them in auto-book logic. Defaults match **Balanced**.

## 2. ATR computation

Add `atrPctFromCandles(candles, period=14)` helper in `src/lib/movers.functions.ts` (already fetches 5m/15m candles). ATR% = ATR / lastClose × 100. Surface `atrPct` on each `Mover` and use it in scoring.

## 3. SL / TP / sizing engine

New shared helper `src/lib/risk-engine.ts` (client-safe pure functions):

```ts
computeRiskPlan({ atrPct, preset, capital, entryPrice })
  → { slPct, tpPct, rr, riskAmount, positionSize, status, reason }
```

Rules:

- `slPct = clamp(atrPct * preset.atrMult, preset.minSL, ∞)`
- If `slPct > preset.maxAutoSL` → `status = "manual_review"`, reason = "Volatility too high for auto-book", but still return `slPct` for display.
- `tpPct = slPct * preset.targetMult`; `rr = tpPct / slPct`.
- If `rr < preset.minRR` → `status = "manual_review"`, reason = "Risk-reward weak".
- `riskAmount = capital * preset.riskPct / 100`
- `positionSize = riskAmount / (slPct / 100)` (notional, independent of leverage).
- If all checks pass → `status = "auto_eligible"`.

## 4. Auto-book engine (`src/lib/auto-book.server.ts`)

- Read new preset columns.
- For each candidate compute `riskPlan` using mover's `atrPct`.
- Only auto-book when `status === "auto_eligible"` AND existing checks (confidence, cooldown, max open, daily cap) pass.
- Replace event message format with:
  `Auto-booked LONG BTCUSDT · Confidence 84% · Target +5.2% · Stop -3.1% · Stop Type Volatility-based · Risk ₹1,000 · R:R 1.7:1`
- Skip events:
  `Skipped SOLUSDT · Reason Volatility too high · Required Stop 7.8% · Allowed 4%`

## 5. UI changes

**Scanner card (`opportunity-card.tsx`)**: replace TP/SL row with grid of Target / Stop / Stop Type / Risk / R:R / Position Size / Status badge, plus muted helper line "Stop is based on recent market volatility, not a fixed percentage."

**Activity feed (`recent-activity.tsx`)**: parse new structured meta from `bot_events` rather than raw text; render stacked label/value rows.

**Settings (`settings.tsx`)**:
- New top section "Trading Style" — three selectable cards (Conservative/Balanced/Aggressive). Selecting one updates the preset columns in `pending`.
- Existing sliders moved into a collapsible "Advanced settings" (`<details>` or shadcn `Accordion`), default collapsed.
- Add helper text under stop & risk fields.
- Remove `take_profit_pct` & `stop_loss_pct` controls (no longer used by engine); keep them only as advanced-readonly note if desired.

**Why-modal (`recommendation-modal.tsx`)**: add "Risk Check" section with Stop Type / ATR / Stop / Max Allowed / Risk per Trade / Position Size / R:R / Final Result line. Wording uses "Risk accepted" / "Risk rejected".

**Positions page**: leave manual TP/SL editor untouched (user already has % toggle).

## 6. Wording guardrails

Audit `wealth-hero.tsx`, `wealth-engine-status.tsx`, `why-no-trade.tsx`, `bot-health.tsx` for "safe", "guaranteed", future-wealth projections; replace with neutral status terms ("Risk accepted/rejected", "Auto-book eligible", "Manual review required", "Volatility too high", "Risk-reward weak"). CAGR is already removed.

## 7. Out of scope

- No new pages, no live trading, no AI chat.
- Branding, nav, mascot copy unchanged.
- Paper-trading context stays as-is.

## Technical notes

- All preset math is pure and lives in `risk-engine.ts` so Scanner, auto-book engine, and Why-modal share one source of truth.
- Default trading_style for existing rows backfilled to `balanced` in the migration.
- ATR period 14 over the same 15m candles already requested for scoring (no extra API calls).
- `positionSize` is shown in user's display currency via existing `useCurrency` hook.
- Mobile-first: Scanner card uses 2-column grid that collapses to single column under 360px.

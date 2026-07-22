-- Freshness arm (shadow, 2026-07-22). Hypothesis test on 14d × 137 symbols of
-- 15m closes, split across two opposite-regime weeks: top-decile 4h movers NOT
-- yet labeled Bullish-24h were the only bucket with positive 2h forward returns
-- in the red week and the best bucket in the green week (+0.20%/2h vs +0.05%
-- base; fee-clearing rate 33-35% vs 25%). Top-decile 1h movers were NEGATIVE
-- in both weeks (1h spikes mean-revert) — the 1h variant is refuted and banked.
--
-- The arm: the scan pass maintains ~15-min price snapshots of the top-150
-- liquid pool (zero extra API calls) and ranks 4h momentum from them. Arm
-- cohorts book LONGS only from the fresh set (top-decile 4h AND 24h < +1%);
-- fresh symbols outside the normal universe arms are scanned but invisible to
-- non-arm cohorts. Live on 2ce184c8 only. Pre-registered bar: at n>=30 closed
-- arm longs, they must beat same-window non-arm longs on win% AND net/trade,
-- or the flag dies v2-style.
CREATE UNLOGGED TABLE IF NOT EXISTS futures_price_snaps (
  snapped_at timestamptz NOT NULL,
  symbol text NOT NULL,
  price numeric NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fps_snapped_at ON futures_price_snaps (snapped_at);
ALTER TABLE futures_price_snaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS freshness_arm_enabled boolean DEFAULT false;
UPDATE bot_config SET freshness_arm_enabled = true
WHERE user_id = '2ce184c8-f6b6-47b7-8fcd-aca071259841';

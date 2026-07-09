-- Early-breakeven arming threshold (ROE %). When set (> 0), the exit engine
-- moves the stop to entry once a trade's unrealized ROE reaches this value —
-- protecting the gain from a round-trip to a loss, independent of TP1.
-- NULL / 0 = off (default), so this is a no-op until explicitly enabled per user
-- (used to A/B-test the tighter gain-protection on one pilot cohort vs control).
ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS breakeven_arm_roe_pct numeric;

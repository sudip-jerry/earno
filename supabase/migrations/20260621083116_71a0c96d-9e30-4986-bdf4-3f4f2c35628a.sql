ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS sl_floor_applied boolean,
  ADD COLUMN IF NOT EXISTS calculated_sl_pct numeric,
  ADD COLUMN IF NOT EXISTS final_sl_pct numeric,
  ADD COLUMN IF NOT EXISTS atr_multiplier_used numeric,
  ADD COLUMN IF NOT EXISTS sl_floor_experiment_version text,
  ADD COLUMN IF NOT EXISTS auto_close_minutes_used integer,
  ADD COLUMN IF NOT EXISTS auto_close_reason text,
  ADD COLUMN IF NOT EXISTS auto_close_experiment_version text,
  ADD COLUMN IF NOT EXISTS experiment_id text;
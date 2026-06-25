
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS locked_runner_roe_pct numeric,
  ADD COLUMN IF NOT EXISTS tp1_booked_pnl numeric,
  ADD COLUMN IF NOT EXISTS runner_pnl numeric,
  ADD COLUMN IF NOT EXISTS profit_protection_active boolean DEFAULT false;

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS breakeven_armed_at timestamptz,
  ADD COLUMN IF NOT EXISTS tp1_roe_pct numeric,
  ADD COLUMN IF NOT EXISTS exit_protection_reason text;
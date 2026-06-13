ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS auto_book boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS strategy text NOT NULL DEFAULT 'vwap_pullback',
  ADD COLUMN IF NOT EXISTS cooldown_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS max_trades_per_day integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS auto_close_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS move_to_breakeven boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS min_scalp_score integer NOT NULL DEFAULT 50;
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
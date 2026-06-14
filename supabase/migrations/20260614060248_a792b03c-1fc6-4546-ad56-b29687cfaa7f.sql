
ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS trading_style text NOT NULL DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS min_sl_pct numeric NOT NULL DEFAULT 1.2,
  ADD COLUMN IF NOT EXISTS atr_multiplier numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS max_auto_sl_pct numeric NOT NULL DEFAULT 4.0,
  ADD COLUMN IF NOT EXISTS target_multiplier numeric NOT NULL DEFAULT 1.7,
  ADD COLUMN IF NOT EXISTS min_rr numeric NOT NULL DEFAULT 1.5;

ALTER TABLE public.bot_config
  ADD CONSTRAINT bot_config_trading_style_chk
  CHECK (trading_style IN ('conservative','balanced','aggressive'));

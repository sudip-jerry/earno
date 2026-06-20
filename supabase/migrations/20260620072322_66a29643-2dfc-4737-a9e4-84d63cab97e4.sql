
-- Raise SL floor and auto-close defaults to reduce SL-hits and time-exits.
-- Change column defaults
ALTER TABLE public.bot_config ALTER COLUMN min_sl_pct SET DEFAULT 1.5;
ALTER TABLE public.bot_config ALTER COLUMN atr_multiplier SET DEFAULT 2.2;
ALTER TABLE public.bot_config ALTER COLUMN auto_close_minutes SET DEFAULT 120;

-- Bump existing rows that are below the new safer floors.
UPDATE public.bot_config SET min_sl_pct = 1.5 WHERE min_sl_pct IS NULL OR min_sl_pct < 1.5;
UPDATE public.bot_config SET atr_multiplier = 2.2 WHERE atr_multiplier IS NULL OR atr_multiplier < 2.2;
UPDATE public.bot_config SET auto_close_minutes = 120 WHERE auto_close_minutes IS NULL OR auto_close_minutes < 120;

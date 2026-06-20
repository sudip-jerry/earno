ALTER TABLE public.bot_config ALTER COLUMN max_trades_per_day SET DEFAULT 50;
UPDATE public.bot_config SET max_trades_per_day = 50 WHERE max_trades_per_day < 50;
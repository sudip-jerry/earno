ALTER TABLE public.bot_config ADD COLUMN IF NOT EXISTS symbol_blocklist text[] NOT NULL DEFAULT '{}'::text[];
-- Pre-seed PHB for users who recently auto-traded it
UPDATE public.bot_config SET symbol_blocklist = ARRAY['B-PHB_USDT']::text[]
WHERE user_id IN (SELECT DISTINCT user_id FROM public.positions WHERE symbol = 'B-PHB_USDT')
  AND NOT ('B-PHB_USDT' = ANY(symbol_blocklist));
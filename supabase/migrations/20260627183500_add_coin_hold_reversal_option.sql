ALTER TABLE public.coin_bot_config
ADD COLUMN hold_until_trend_reversal boolean NOT NULL DEFAULT true;

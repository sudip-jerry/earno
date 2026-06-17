
ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS symbol_sl_cooldown_minutes integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS symbol_blacklist_threshold integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS allow_long boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS regime_filter_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.bot_config
  ADD CONSTRAINT symbol_sl_cooldown_range CHECK (symbol_sl_cooldown_minutes >= 0 AND symbol_sl_cooldown_minutes <= 1440),
  ADD CONSTRAINT symbol_blacklist_threshold_range CHECK (symbol_blacklist_threshold >= 1 AND symbol_blacklist_threshold <= 20);

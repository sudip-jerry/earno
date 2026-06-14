ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS live_wallet_source text NOT NULL DEFAULT 'futures',
  ADD COLUMN IF NOT EXISTS live_allocation_mode text NOT NULL DEFAULT 'amount',
  ADD COLUMN IF NOT EXISTS live_allocation_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS live_allocation_pct numeric NOT NULL DEFAULT 100;

ALTER TABLE public.bot_config
  DROP CONSTRAINT IF EXISTS bot_config_live_wallet_source_chk,
  ADD CONSTRAINT bot_config_live_wallet_source_chk CHECK (live_wallet_source IN ('futures','spot'));

ALTER TABLE public.bot_config
  DROP CONSTRAINT IF EXISTS bot_config_live_allocation_mode_chk,
  ADD CONSTRAINT bot_config_live_allocation_mode_chk CHECK (live_allocation_mode IN ('full','amount','percent'));
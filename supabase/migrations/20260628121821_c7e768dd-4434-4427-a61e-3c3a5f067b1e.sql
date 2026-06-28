ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS minimum_net_profit_to_enter_pct numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.bot_config.minimum_net_profit_to_enter_pct IS
  'Pre-entry gate: required projected net profit (after entry+exit fees + GST) at the planned TP, expressed as % of entry notional. 0 disables the gate.';
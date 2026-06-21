
ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS fee_aware_exits_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS minimum_net_profit_to_exit_pct numeric NOT NULL DEFAULT 0.18,
  ADD COLUMN IF NOT EXISTS slippage_buffer_pct numeric NOT NULL DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS minimum_gross_profit_before_profit_fade_exit_pct numeric NOT NULL DEFAULT 0.30,
  ADD COLUMN IF NOT EXISTS minimum_gross_profit_before_weak_progress_exit_pct numeric NOT NULL DEFAULT 0.25;

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS gross_pnl numeric,
  ADD COLUMN IF NOT EXISTS estimated_total_fee numeric,
  ADD COLUMN IF NOT EXISTS estimated_slippage numeric,
  ADD COLUMN IF NOT EXISTS estimated_net_pnl numeric,
  ADD COLUMN IF NOT EXISTS exit_fee_aware boolean,
  ADD COLUMN IF NOT EXISTS exit_blocked_reason text,
  ADD COLUMN IF NOT EXISTS original_exit_reason text;


ALTER TABLE public.bot_config 
  ALTER COLUMN leverage SET DEFAULT 2,
  ALTER COLUMN take_profit_pct SET DEFAULT 3.0,
  ALTER COLUMN stop_loss_pct SET DEFAULT 1.5,
  ALTER COLUMN risk_per_trade_pct SET DEFAULT 1.0,
  ALTER COLUMN max_open_positions SET DEFAULT 2,
  ALTER COLUMN max_trades_per_day SET DEFAULT 10,
  ALTER COLUMN cooldown_minutes SET DEFAULT 15,
  ALTER COLUMN daily_loss_cap_pct SET DEFAULT 3.0;

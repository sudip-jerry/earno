
-- 1. bot_config thresholds
ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS auto_book_confidence_threshold integer NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS display_confidence_threshold integer NOT NULL DEFAULT 55;

-- 2. bot_signals
CREATE TABLE IF NOT EXISTS public.bot_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  scan_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name text,
  symbol text NOT NULL,
  price numeric,
  action text NOT NULL,
  side_bias text,
  confidence_pct numeric,
  confidence_band text,
  reason text,
  final_decision text,
  booked boolean NOT NULL DEFAULT false,
  booked_trade_id uuid,
  rejection_reason text,
  strategy text,
  timeframe text,
  config_id text,
  trend_status text,
  vwap_status text,
  ema_alignment text,
  rsi numeric,
  volume_spike_ratio numeric,
  spread_pct numeric,
  atr_pct numeric,
  distance_from_vwap_pct numeric,
  distance_from_ema21_pct numeric,
  impulse_candle_pct numeric,
  risk_reward numeric,
  market_regime text,
  cooldown_active boolean,
  daily_loss_available boolean,
  max_position_available boolean
);

CREATE INDEX IF NOT EXISTS bot_signals_user_created_idx ON public.bot_signals (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bot_signals_scan_idx ON public.bot_signals (scan_id);
CREATE INDEX IF NOT EXISTS bot_signals_created_idx ON public.bot_signals (created_at DESC);

GRANT SELECT ON public.bot_signals TO authenticated;
GRANT ALL ON public.bot_signals TO service_role;

ALTER TABLE public.bot_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own signals"
  ON public.bot_signals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all signals"
  ON public.bot_signals FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

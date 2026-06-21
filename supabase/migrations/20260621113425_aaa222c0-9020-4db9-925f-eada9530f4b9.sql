
-- Coin Paper Bot config (per user)
CREATE TABLE public.coin_bot_config (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'intraday' CHECK (mode IN ('intraday','swing')),
  allocated_capital_usdt numeric NOT NULL DEFAULT 5000,
  available_cash_usdt numeric NOT NULL DEFAULT 5000,
  max_holdings integer NOT NULL DEFAULT 8,
  min_confidence integer NOT NULL DEFAULT 65,
  scan_interval_min integer NOT NULL DEFAULT 3,
  max_holding_days integer NOT NULL DEFAULT 7,
  universe_size integer NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coin_bot_config TO authenticated;
GRANT ALL ON public.coin_bot_config TO service_role;
ALTER TABLE public.coin_bot_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coin_bot_config self select" ON public.coin_bot_config
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "coin_bot_config self insert" ON public.coin_bot_config
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "coin_bot_config self update" ON public.coin_bot_config
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER tg_coin_bot_config_updated_at
  BEFORE UPDATE ON public.coin_bot_config
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Coin paper positions/holdings
CREATE TABLE public.coin_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  display text NOT NULL,
  qty numeric NOT NULL,
  avg_buy_price numeric NOT NULL,
  last_price numeric,
  invested_usdt numeric NOT NULL,
  current_value_usdt numeric,
  unrealized_pnl_usdt numeric DEFAULT 0,
  realized_pnl_usdt numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  mode text NOT NULL DEFAULT 'intraday' CHECK (mode IN ('intraday','swing')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','bot')),
  target_price numeric,
  stop_price numeric,
  max_holding_until timestamptz,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  exit_price numeric,
  exit_reason text,
  open_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_coin_positions_user_status ON public.coin_positions(user_id, status);
CREATE INDEX idx_coin_positions_user_symbol_status ON public.coin_positions(user_id, symbol, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coin_positions TO authenticated;
GRANT ALL ON public.coin_positions TO service_role;
ALTER TABLE public.coin_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coin_positions self select" ON public.coin_positions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "coin_positions self insert" ON public.coin_positions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "coin_positions self update" ON public.coin_positions
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "coin_positions self delete" ON public.coin_positions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER tg_coin_positions_updated_at
  BEFORE UPDATE ON public.coin_positions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Coin signals (latest recommendations per user)
CREATE TABLE public.coin_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  display text NOT NULL,
  action text NOT NULL CHECK (action IN ('buy','sell','hold','wait','avoid')),
  confidence integer NOT NULL DEFAULT 0,
  price numeric NOT NULL,
  buy_zone_low numeric,
  buy_zone_high numeric,
  target numeric,
  stop numeric,
  reason_short text NOT NULL DEFAULT '',
  reason_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  mode text NOT NULL DEFAULT 'intraday' CHECK (mode IN ('intraday','swing')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_coin_signals_user_status_created ON public.coin_signals(user_id, status, created_at DESC);
CREATE INDEX idx_coin_signals_user_symbol_created ON public.coin_signals(user_id, symbol, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coin_signals TO authenticated;
GRANT ALL ON public.coin_signals TO service_role;
ALTER TABLE public.coin_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coin_signals self select" ON public.coin_signals
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "coin_signals self insert" ON public.coin_signals
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "coin_signals self update" ON public.coin_signals
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

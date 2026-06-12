
-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile upsert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- CoinDCX API credentials (server-only access)
CREATE TABLE public.api_credentials (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  is_valid BOOLEAN NOT NULL DEFAULT false,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.api_credentials TO service_role;
ALTER TABLE public.api_credentials ENABLE ROW LEVEL SECURITY;
-- No grants to authenticated/anon; only server-side admin code reads these.

-- Bot configuration
CREATE TABLE public.bot_config (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper','live')),
  is_running BOOLEAN NOT NULL DEFAULT false,
  ema_fast INT NOT NULL DEFAULT 9,
  ema_slow INT NOT NULL DEFAULT 21,
  timeframe TEXT NOT NULL DEFAULT '15m',
  leverage INT NOT NULL DEFAULT 3 CHECK (leverage BETWEEN 2 AND 5),
  take_profit_pct NUMERIC(6,3) NOT NULL DEFAULT 3.0,
  stop_loss_pct NUMERIC(6,3) NOT NULL DEFAULT 2.0,
  trailing_enabled BOOLEAN NOT NULL DEFAULT true,
  risk_per_trade_pct NUMERIC(6,3) NOT NULL DEFAULT 2.0,
  max_open_positions INT NOT NULL DEFAULT 3,
  daily_loss_cap_pct NUMERIC(6,3) NOT NULL DEFAULT 6.0,
  scanner_top_n INT NOT NULL DEFAULT 5,
  allow_short BOOLEAN NOT NULL DEFAULT true,
  paper_equity NUMERIC(18,4) NOT NULL DEFAULT 1000.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.bot_config TO authenticated;
GRANT ALL ON public.bot_config TO service_role;
ALTER TABLE public.bot_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own config read" ON public.bot_config FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own config insert" ON public.bot_config FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own config update" ON public.bot_config FOR UPDATE USING (auth.uid() = user_id);

-- Positions (open + closed)
CREATE TABLE public.positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('paper','live')),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long','short')),
  leverage INT NOT NULL,
  qty NUMERIC(24,8) NOT NULL,
  entry_price NUMERIC(24,8) NOT NULL,
  mark_price NUMERIC(24,8),
  stop_loss NUMERIC(24,8),
  take_profit NUMERIC(24,8),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  pnl NUMERIC(18,4),
  pnl_pct NUMERIC(10,4),
  exit_price NUMERIC(24,8),
  exit_reason TEXT,
  exchange_order_id TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.positions TO authenticated;
GRANT ALL ON public.positions TO service_role;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own positions read" ON public.positions FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX positions_user_status_idx ON public.positions(user_id, status, opened_at DESC);

-- Bot event log
CREATE TABLE public.bot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','signal','trade','warn','error')),
  message TEXT NOT NULL,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.bot_events TO authenticated;
GRANT ALL ON public.bot_events TO service_role;
ALTER TABLE public.bot_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own events read" ON public.bot_events FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX bot_events_user_time_idx ON public.bot_events(user_id, created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_credentials_updated BEFORE UPDATE ON public.api_credentials FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_config_updated BEFORE UPDATE ON public.bot_config FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_positions_updated BEFORE UPDATE ON public.positions FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto-create profile + default bot config on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)));
  INSERT INTO public.bot_config (user_id) VALUES (NEW.id);
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

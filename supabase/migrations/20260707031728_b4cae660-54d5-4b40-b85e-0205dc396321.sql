
CREATE TABLE public.fx_rates (
  currency text PRIMARY KEY,
  rate numeric NOT NULL CHECK (rate > 0),
  source text NOT NULL DEFAULT 'static',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.fx_rates TO anon, authenticated;
GRANT ALL ON public.fx_rates TO service_role;

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fx_rates public read"
  ON public.fx_rates FOR SELECT
  USING (true);

CREATE TRIGGER fx_rates_set_updated_at
  BEFORE UPDATE ON public.fx_rates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.fx_rates (currency, rate, source) VALUES
  ('USD', 1,    'static'),
  ('INR', 99,   'static'),
  ('EUR', 0.92, 'static'),
  ('GBP', 0.78, 'static'),
  ('AED', 3.67, 'static'),
  ('SGD', 1.34, 'static'),
  ('JPY', 156,  'static')
ON CONFLICT (currency) DO NOTHING;

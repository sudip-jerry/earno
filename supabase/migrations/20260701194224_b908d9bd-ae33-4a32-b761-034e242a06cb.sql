
ALTER TABLE public.coin_universe ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read coin_universe"
  ON public.coin_universe
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "deny insert coin_universe"
  ON public.coin_universe AS RESTRICTIVE
  FOR INSERT TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "deny update coin_universe"
  ON public.coin_universe AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny delete coin_universe"
  ON public.coin_universe AS RESTRICTIVE
  FOR DELETE TO anon, authenticated
  USING (false);

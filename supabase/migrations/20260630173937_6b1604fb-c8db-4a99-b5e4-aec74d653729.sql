
REVOKE ALL ON public.regime_confidence_floors FROM anon;
REVOKE ALL ON public.regime_confidence_floors FROM authenticated;
GRANT SELECT ON public.regime_confidence_floors TO authenticated;
GRANT ALL ON public.regime_confidence_floors TO service_role;

ALTER TABLE public.regime_confidence_floors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_regime_floors" ON public.regime_confidence_floors;
CREATE POLICY "authenticated_read_regime_floors"
  ON public.regime_confidence_floors
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admins_manage_regime_floors" ON public.regime_confidence_floors;
CREATE POLICY "admins_manage_regime_floors"
  ON public.regime_confidence_floors
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

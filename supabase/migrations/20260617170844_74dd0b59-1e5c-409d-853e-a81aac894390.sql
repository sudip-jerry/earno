
-- bot_config: re-scope existing policies to authenticated only
DROP POLICY IF EXISTS "own config read" ON public.bot_config;
DROP POLICY IF EXISTS "own config insert" ON public.bot_config;
DROP POLICY IF EXISTS "own config update" ON public.bot_config;

CREATE POLICY "own config read" ON public.bot_config
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "own config insert" ON public.bot_config
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own config update" ON public.bot_config
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- bot_config_audit: deny all client writes (trigger uses SECURITY DEFINER and bypasses RLS via service_role/owner)
CREATE POLICY "deny insert audit" ON public.bot_config_audit
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "deny update audit" ON public.bot_config_audit
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny delete audit" ON public.bot_config_audit
  AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (false);

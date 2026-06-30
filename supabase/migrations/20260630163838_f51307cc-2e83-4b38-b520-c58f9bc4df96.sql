DROP POLICY IF EXISTS "users_own_coin_cfg_audit" ON public.coin_bot_config_audit;
CREATE POLICY "users_own_coin_cfg_audit" ON public.coin_bot_config_audit
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
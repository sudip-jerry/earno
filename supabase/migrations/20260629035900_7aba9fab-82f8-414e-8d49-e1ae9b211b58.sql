DROP POLICY IF EXISTS users_own_coin_events ON public.coin_bot_events;
CREATE POLICY users_own_coin_events ON public.coin_bot_events
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
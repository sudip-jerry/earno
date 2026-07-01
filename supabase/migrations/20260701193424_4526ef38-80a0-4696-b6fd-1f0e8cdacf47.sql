
-- Replace permissive ALL policy on coin_bot_config_audit with SELECT-only + restrictive deny writes
DROP POLICY IF EXISTS "Users manage their own coin bot audit" ON public.coin_bot_config_audit;
DROP POLICY IF EXISTS "Users can view their own coin bot audit" ON public.coin_bot_config_audit;
DROP POLICY IF EXISTS "Users view own coin bot audit" ON public.coin_bot_config_audit;

CREATE POLICY "Users view own coin_cfg_audit"
  ON public.coin_bot_config_audit
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "deny insert coin_cfg_audit"
  ON public.coin_bot_config_audit AS RESTRICTIVE
  FOR INSERT TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "deny update coin_cfg_audit"
  ON public.coin_bot_config_audit AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny delete coin_cfg_audit"
  ON public.coin_bot_config_audit AS RESTRICTIVE
  FOR DELETE TO anon, authenticated
  USING (false);

-- Add explicit restrictive deny writes on payment_orders (defence-in-depth)
CREATE POLICY "deny insert payment_orders"
  ON public.payment_orders AS RESTRICTIVE
  FOR INSERT TO anon, authenticated
  WITH CHECK (false);

CREATE POLICY "deny update payment_orders"
  ON public.payment_orders AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "deny delete payment_orders"
  ON public.payment_orders AS RESTRICTIVE
  FOR DELETE TO anon, authenticated
  USING (false);

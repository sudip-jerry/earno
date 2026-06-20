-- 1. bot_signals: deny client writes; service role bypasses RLS so the engine still writes.
CREATE POLICY "deny client insert on bot_signals"
  ON public.bot_signals AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (false);
CREATE POLICY "deny client update on bot_signals"
  ON public.bot_signals AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (false) WITH CHECK (false);
CREATE POLICY "deny client delete on bot_signals"
  ON public.bot_signals AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (false);

-- 2. payment_orders: orders must start as 'created'. The 'service updates orders' UPDATE
--    policy is broad, but with RLS the request runs as the user, so a user cannot UPDATE
--    rows owned by anyone (no SELECT match outside their own user_id wouldn't matter — the
--    UPDATE qual is true and there is no user_id filter). Tighten that too.
DROP POLICY IF EXISTS "users insert own order" ON public.payment_orders;
CREATE POLICY "users insert own order"
  ON public.payment_orders FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'created');

DROP POLICY IF EXISTS "service updates orders" ON public.payment_orders;
-- No client UPDATE policy → only service_role (which bypasses RLS) can update orders.

-- 3. positions: gate INSERT mode by plan tier.
DROP POLICY IF EXISTS "own positions insert" ON public.positions;
CREATE POLICY "own positions insert"
  ON public.positions FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      mode = 'paper'
      OR public.current_plan_tier(auth.uid()) IN ('auto5'::public.plan_tier, 'unlimited'::public.plan_tier)
    )
  );
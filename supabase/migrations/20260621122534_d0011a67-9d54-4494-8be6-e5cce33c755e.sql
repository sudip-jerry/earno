
-- coupon_redemptions: deny UPDATE/DELETE to clients
CREATE POLICY "deny client update on coupon_redemptions" ON public.coupon_redemptions
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny client delete on coupon_redemptions" ON public.coupon_redemptions
  AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false);

-- positions: add WITH CHECK to update policy mirroring insert
DROP POLICY "own positions update" ON public.positions;
CREATE POLICY "own positions update" ON public.positions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    (auth.uid() = user_id) AND (
      (mode = 'paper') OR
      (current_plan_tier(auth.uid()) = ANY (ARRAY['auto5'::public.plan_tier, 'unlimited'::public.plan_tier]))
    )
  );

-- user_plans: deny INSERT/UPDATE/DELETE for non-admin clients
CREATE POLICY "deny client insert on user_plans" ON public.user_plans
  AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "deny client update on user_plans" ON public.user_plans
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "deny client delete on user_plans" ON public.user_plans
  AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (has_role(auth.uid(), 'admin'::app_role));

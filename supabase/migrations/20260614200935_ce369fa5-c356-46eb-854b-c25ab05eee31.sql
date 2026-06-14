-- 1) Lock down coupon_redemptions: only service_role may INSERT.
DROP POLICY IF EXISTS "users insert own redemption" ON public.coupon_redemptions;
DROP POLICY IF EXISTS "users insert own redemptions" ON public.coupon_redemptions;
DROP POLICY IF EXISTS "user insert own redemption" ON public.coupon_redemptions;

-- (No INSERT policy for authenticated → blocked by default; server uses supabaseAdmin.)

-- 2) Fix user_roles RESTRICTIVE policy: only cover writes, so own-role SELECT works.
DROP POLICY IF EXISTS "deny non-admin writes on user_roles" ON public.user_roles;

CREATE POLICY "deny non-admin insert on user_roles"
  ON public.user_roles AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "deny non-admin update on user_roles"
  ON public.user_roles AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "deny non-admin delete on user_roles"
  ON public.user_roles AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

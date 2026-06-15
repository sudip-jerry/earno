
-- 1) Revoke anon EXECUTE on has_role SECURITY DEFINER function
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;

-- 2) Remove admin self-escalation: drop the permissive ALL policy on user_roles.
-- Role writes must go through service_role (admin server functions) only.
DROP POLICY IF EXISTS "admin manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "deny non-admin insert on user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "deny non-admin update on user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "deny non-admin delete on user_roles" ON public.user_roles;

-- Explicit restrictive denies on writes for authenticated + anon
CREATE POLICY "deny client insert on user_roles"
  ON public.user_roles AS RESTRICTIVE FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
CREATE POLICY "deny client update on user_roles"
  ON public.user_roles AS RESTRICTIVE FOR UPDATE
  TO authenticated, anon
  USING (false) WITH CHECK (false);
CREATE POLICY "deny client delete on user_roles"
  ON public.user_roles AS RESTRICTIVE FOR DELETE
  TO authenticated, anon
  USING (false);

-- 3) Explicit deny INSERT on coupon_redemptions for client roles
CREATE POLICY "deny client insert on coupon_redemptions"
  ON public.coupon_redemptions AS RESTRICTIVE FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);


-- Revoke Data API SELECT on coupons from authenticated/anon; only admins (via existing policy) and service_role need it.
REVOKE SELECT ON public.coupons FROM authenticated;
REVOKE SELECT ON public.coupons FROM anon;

-- Harden user_roles with a RESTRICTIVE policy that blocks all writes by non-admins.
DROP POLICY IF EXISTS "deny non-admin writes on user_roles" ON public.user_roles;
CREATE POLICY "deny non-admin writes on user_roles"
ON public.user_roles
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

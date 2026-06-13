
-- 1. Restrict profiles policies to authenticated role
DROP POLICY IF EXISTS "own profile read" ON public.profiles;
DROP POLICY IF EXISTS "own profile upsert" ON public.profiles;
DROP POLICY IF EXISTS "own profile update" ON public.profiles;

CREATE POLICY "own profile read" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile upsert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 2. Revoke direct EXECUTE on SECURITY DEFINER functions from anon/authenticated.
-- These functions are used inside RLS policies (which run with definer rights regardless)
-- and inside server-side code via service_role. Public exposure via PostgREST is unnecessary.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_plan_tier(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;

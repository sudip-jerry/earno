-- has_role is SECURITY DEFINER and read-only; authenticated needs EXECUTE so
-- the app can check the current user's roles (e.g. show the Admin entry point).
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
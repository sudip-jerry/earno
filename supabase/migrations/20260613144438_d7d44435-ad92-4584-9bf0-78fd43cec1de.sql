
REVOKE EXECUTE ON FUNCTION public.verify_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_secret(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.current_plan_tier(uuid) FROM PUBLIC, anon;
-- authenticated keeps EXECUTE: bot.functions.ts calls it via the user-scoped supabase client.
GRANT EXECUTE ON FUNCTION public.current_plan_tier(uuid) TO authenticated, service_role;

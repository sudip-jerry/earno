
-- Fix 1: bot_cfg_mode_rls_bypass — restrictive tier gate on bot_config updates
CREATE POLICY "live_mode_tier_gate" ON public.bot_config
  AS RESTRICTIVE FOR UPDATE TO authenticated
  WITH CHECK (
    (mode IS DISTINCT FROM 'live' OR public.current_plan_tier(auth.uid()) IN ('auto5','unlimited'))
    AND (is_running IS NOT TRUE OR public.current_plan_tier(auth.uid()) IN ('auto5','unlimited'))
    AND (auto_book IS NOT TRUE OR public.current_plan_tier(auth.uid()) IN ('auto5','unlimited'))
  );

-- Fix 2: coin_bot_config_audit_all_policy_conflict — drop misleading permissive ALL policy;
-- SELECT-only policy already exists ("Users view own coin_cfg_audit"); restrictive deny policies remain.
DROP POLICY IF EXISTS "users_own_coin_cfg_audit" ON public.coin_bot_config_audit;

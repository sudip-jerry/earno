CREATE OR REPLACE FUNCTION public.redeem_coupon_atomic(_code text, _user_id uuid)
RETURNS TABLE(tier public.plan_tier, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_id uuid;
  c_tier public.plan_tier;
  c_duration int;
  c_max int;
  c_valid_until timestamptz;
  c_active boolean;
  updated_count int;
  expires timestamptz;
BEGIN
  SELECT id, tier, duration_days, max_uses, valid_until, active
    INTO c_id, c_tier, c_duration, c_max, c_valid_until, c_active
  FROM public.coupons
  WHERE code = upper(_code)
  FOR UPDATE;

  IF c_id IS NULL OR NOT c_active THEN
    RAISE EXCEPTION 'Invalid or inactive coupon' USING ERRCODE = 'P0001';
  END IF;
  IF c_valid_until IS NOT NULL AND c_valid_until < now() THEN
    RAISE EXCEPTION 'Coupon expired' USING ERRCODE = 'P0001';
  END IF;

  -- Atomic conditional increment: only succeeds if cap not reached
  UPDATE public.coupons
     SET used_count = used_count + 1
   WHERE id = c_id
     AND (max_uses IS NULL OR used_count < max_uses)
  RETURNING 1 INTO updated_count;

  IF updated_count IS NULL THEN
    RAISE EXCEPTION 'Coupon fully redeemed' USING ERRCODE = 'P0001';
  END IF;

  -- Per-user uniqueness enforced by UNIQUE(coupon_id, user_id)
  BEGIN
    INSERT INTO public.coupon_redemptions(coupon_id, user_id)
    VALUES (c_id, _user_id);
  EXCEPTION WHEN unique_violation THEN
    -- Roll back the increment effect by decrementing, then signal
    UPDATE public.coupons SET used_count = used_count - 1 WHERE id = c_id;
    RAISE EXCEPTION 'You have already used this coupon' USING ERRCODE = 'P0001';
  END;

  expires := now() + make_interval(days => c_duration);

  INSERT INTO public.user_plans(user_id, tier, source, started_at, expires_at, status)
  VALUES (_user_id, c_tier, 'coupon', now(), expires, 'active')
  ON CONFLICT (user_id) DO UPDATE
    SET tier = EXCLUDED.tier,
        source = EXCLUDED.source,
        started_at = EXCLUDED.started_at,
        expires_at = EXCLUDED.expires_at,
        status = EXCLUDED.status;

  RETURN QUERY SELECT c_tier, expires;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_coupon_atomic(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_atomic(text, uuid) TO service_role;
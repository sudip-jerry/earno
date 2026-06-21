REVOKE ALL ON FUNCTION public.redeem_coupon_atomic(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_coupon_atomic(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.redeem_coupon_atomic(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_atomic(text, uuid) TO service_role;
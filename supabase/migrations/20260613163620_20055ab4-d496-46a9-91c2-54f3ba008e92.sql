
-- Revoke Data API write access from anon/authenticated on payment_orders and coupon_redemptions.
-- All writes must go through server functions using service_role.
REVOKE INSERT, UPDATE, DELETE ON public.payment_orders FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.coupon_redemptions FROM anon, authenticated;

-- Ensure service_role retains full access (idempotent).
GRANT ALL ON public.payment_orders TO service_role;
GRANT ALL ON public.coupon_redemptions TO service_role;

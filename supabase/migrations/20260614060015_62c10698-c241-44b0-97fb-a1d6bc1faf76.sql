
-- coupon_redemptions: add INSERT policy scoped to the caller
CREATE POLICY "users insert own redemption"
ON public.coupon_redemptions
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- payment_orders: INSERT scoped to caller; UPDATE restricted to service_role
CREATE POLICY "users insert own order"
ON public.payment_orders
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "service updates orders"
ON public.payment_orders
FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

-- Narrow read policies from public to authenticated
DROP POLICY IF EXISTS "own events read" ON public.bot_events;
CREATE POLICY "own events read"
ON public.bot_events
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own positions read" ON public.positions;
CREATE POLICY "own positions read"
ON public.positions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

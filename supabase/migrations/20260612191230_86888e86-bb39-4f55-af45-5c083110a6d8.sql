-- Add explicit owner-scoped write policies to bot_events and positions.
-- These tables previously relied on default-deny for writes; adding policies makes
-- the access model explicit while keeping the same owner-only scope used elsewhere.

-- bot_events write policies
CREATE POLICY "own events insert"
  ON public.bot_events
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own events update"
  ON public.bot_events
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "own events delete"
  ON public.bot_events
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- positions write policies
CREATE POLICY "own positions insert"
  ON public.positions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own positions update"
  ON public.positions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "own positions delete"
  ON public.positions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Grant the matching write privileges to authenticated so the policies are effective
GRANT INSERT, UPDATE, DELETE ON public.bot_events TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.positions TO authenticated;
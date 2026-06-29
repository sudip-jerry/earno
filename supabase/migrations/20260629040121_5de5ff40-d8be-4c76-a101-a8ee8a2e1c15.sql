DROP POLICY IF EXISTS "own positions delete" ON public.positions;
CREATE POLICY "own positions delete" ON public.positions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND mode = 'paper');
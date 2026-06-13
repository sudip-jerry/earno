
-- Revoke any direct Data API access; api_credentials is only touched by service_role via server code.
REVOKE ALL ON public.api_credentials FROM anon, authenticated, PUBLIC;
GRANT ALL ON public.api_credentials TO service_role;

-- Ensure RLS is on (already on, but explicit).
ALTER TABLE public.api_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_credentials FORCE ROW LEVEL SECURITY;

-- Explicit deny policies to document intent: no client role may read or write.
DROP POLICY IF EXISTS "Deny all access to api_credentials" ON public.api_credentials;
CREATE POLICY "Deny all access to api_credentials"
  ON public.api_credentials
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

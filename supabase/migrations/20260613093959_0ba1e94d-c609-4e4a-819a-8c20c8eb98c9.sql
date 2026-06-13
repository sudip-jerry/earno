CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

-- pg_net does not support ALTER EXTENSION SET SCHEMA, so drop & recreate.
SELECT cron.unschedule('earno-auto-book');
SELECT cron.unschedule('earno-mark-positions');

DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'earno-auto-book',
  '*/2 * * * *',
  $$
  SELECT extensions.http_post(
    url := 'https://project--ac00ba6e-fed5-4828-ad8c-e3c81a9eacc9.lovable.app/api/public/hooks/auto-book',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvb2ZweW53b2dqbWdtb3V4b2VuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNzQ3MTcsImV4cCI6MjA5Njg1MDcxN30.BPWZl0eNoa9bkbcbsy_OBpJusDGK39EPVpADA3OXYlg"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'earno-mark-positions',
  '*/2 * * * *',
  $$
  SELECT extensions.http_post(
    url := 'https://project--ac00ba6e-fed5-4828-ad8c-e3c81a9eacc9.lovable.app/api/public/hooks/mark-positions',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvb2ZweW53b2dqbWdtb3V4b2VuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNzQ3MTcsImV4cCI6MjA5Njg1MDcxN30.BPWZl0eNoa9bkbcbsy_OBpJusDGK39EPVpADA3OXYlg"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
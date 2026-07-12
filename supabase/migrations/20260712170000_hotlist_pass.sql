-- Hot-list confirmation pass (2026-07-12).
--
-- The 2-scan entry confirmation adds almost exactly one full-scan cycle of
-- latency (measured: p50 120s, max 161s across 37 bookings) and the market
-- moved AGAINST the pending entry in 28/38 cases while waiting — median cost
-- 0.048% of price per booking. A 1-minute "hot-list" pass re-checks ONLY the
-- candidates already awaiting their 2nd confirmation, through the identical
-- gate chain, so the second look lands ~60s after the first instead of ~120s.
-- The debounce itself is kept: its rejected candidates averaged +0.06% gross
-- at 30m — below the 0.118% round-trip fee — so single-look booking stays off.
-- Everything idempotent.

-- Per-cohort participation flag (default ON; explicit false is the kill switch).
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS hotlist_enabled boolean DEFAULT true;

-- The hot pass runs on ODD minutes; the full scan (earno-auto-book) runs on
-- even minutes (*/2). The interleave is deliberate: the two passes never share
-- a minute, so they cannot race each other into double-booking the same
-- candidate on effectively one tick. (confirm_entry's min-gap blocks
-- double-COUNTING, but two same-second passes that both read confirms=2 could
-- both book — scheduling removes that window entirely.)
SELECT cron.schedule(
  'earno-hotlist-pass',
  '1-59/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://earno.lovable.app/api/public/hooks/auto-book',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_secret' LIMIT 1)
    ),
    body := '{"mode":"hotlist"}'::jsonb
  );
  $$
);

-- Tighten scan-log retention to cut storage + query load.
--
-- Context (measured): bot_signals holds ~1.2M rows / 747MB and grows ~176k
-- rows/day (one full row per scanned symbol per pass). bot_events grows
-- ~156k rows/day since gate-rejection logging was added, and its 30-day
-- window would balloon it to ~4.7M rows. No consumer reads far back:
--   - beta report reads the most recent ~50k bot_signals rows (~7h)
--   - the signal-age tracker reads the last 4h of bot_signals
--   - the activity feed shows only recent bot_events
-- So the long windows are pure storage overhead. Shorten them.
--
-- bot_signals: 7d -> 2d.  bot_events: 30d -> 7d.
-- (Schedules/times unchanged; only the DELETE interval changes.)

do $$
begin
  perform cron.unschedule('earno-purge-signals');
exception when others then null;
end $$;

select cron.schedule(
  'earno-purge-signals',
  '0 19 * * *',
  $$ DELETE FROM public.bot_signals WHERE created_at < now() - interval '2 days'; $$
);

do $$
begin
  perform cron.unschedule('earno-purge-events');
exception when others then null;
end $$;

select cron.schedule(
  'earno-purge-events',
  '5 19 * * *',
  $$ DELETE FROM public.bot_events WHERE created_at < now() - interval '7 days'; $$
);

-- Hot-list pass DISABLED (2026-07-12, ~1.5h after 20260712170000_hotlist_pass.sql).
--
-- Pre-registered kill bar crossed in the first hour: 4 hot-only admissions
-- (bookings whose next full-scan look fell below the cohort threshold — trades
-- the 2-minute cadence would have rejected), aggregate ≈ −$23.6. The failures
-- were CONFIDENCE flicker (88→64 within a minute) at volume spikes of 0.19–0.67x,
-- so no climax guard evaluable at confirmation time could catch them. Lesson:
-- the 2-minute spacing is itself the debounce — a +60s re-look is not an
-- independent observation on fast indicators. The hotlistOnly code path stays
-- dormant behind hotlist_enabled for any post-July-19 redesign.
-- Everything idempotent.

SELECT cron.unschedule('earno-hotlist-pass')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'earno-hotlist-pass');

ALTER TABLE bot_config ALTER COLUMN hotlist_enabled SET DEFAULT false;
UPDATE bot_config SET hotlist_enabled = false WHERE hotlist_enabled IS DISTINCT FROM false;

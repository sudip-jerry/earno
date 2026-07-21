-- Long vetoes promoted to ALL cohorts (2026-07-21), at the arm's pre-registered bar.
-- Evidence (closed longs, all cohorts, 2026-07-17 19:00+00 → promotion): kept profile
-- n=253, 58.9% win, +$28.29 vs vetoed profile (Bullish-24h chase or RSI>65 at entry)
-- n=52, 38.5% win, −$112.55 — kept beat vetoed on both win% and net, decisively.
-- Champion-config change → go-live clock restarts at T0 = 2026-07-22 00:00 IST.
-- Applied out-of-band to the live DB via query_database; idempotent for replays.
UPDATE bot_config SET long_vetoes_enabled = true
WHERE long_vetoes_enabled IS DISTINCT FROM true;

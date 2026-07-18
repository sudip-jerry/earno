-- July-19 review fixes, implemented early by user direction (2026-07-17).
-- Everything idempotent; applied out-of-band to the live DB via query_database.

-- 1) Long vetoes flag (v2's autopsy survivors: no Bullish-24h chase, no RSI>65
--    longs — the only two components that replicated across opposite regimes;
--    kept set 70.8% win +$70.41 Jul 10-15). Live-arm test on 2ce184c8 only,
--    with a pre-registered bar (n>=30 vetoed closures: kept must beat vetoed).
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS long_vetoes_enabled boolean DEFAULT false;
UPDATE bot_config SET long_vetoes_enabled = true
WHERE user_id = '2ce184c8-f6b6-47b7-8fcd-aca071259841';

-- 2) Shadow filters OFF everywhere. 10-day balanced-twin A/B verdict:
--    control (filters off) +$85.69 at 50.3% win vs treatment −$26.47 at 41.7%;
--    the mean-rev short filter blocked the winning fade lane and its survivors
--    lost. Flags stay in place for any future re-test.
UPDATE bot_config
SET structure_entry_filter_enabled = false,
    structure_short_filter_enabled = false
WHERE structure_entry_filter_enabled IS DISTINCT FROM false
   OR structure_short_filter_enabled IS DISTINCT FROM false;

-- (3) The universal intraday market-pause for longs ships in code — no schema.

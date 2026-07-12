-- Entry-confirmation debounce + v2 confluence gate + analysis indexes.
-- These objects were first applied out-of-band on 2026-07-12; this migration
-- makes them reproducible (fresh environments, branch DBs, DR restores).
-- Everything is idempotent.

-- 2-scan entry confirmation state: one row per (user, symbol, side).
-- Rows are dead ~210s after their last update (the confirm window); the table
-- stays tiny (bounded by users x symbols x 2).
CREATE TABLE IF NOT EXISTS entry_confirmations (
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL,
  confirms int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, symbol, side)
);

-- Consecutive-pass counter with BOTH bounds:
--   max age (_window_secs): a pass older than this resets the streak to 1,
--     so only genuinely consecutive scans accumulate.
--   min gap (_min_gap_secs): a pass younger than this does NOT increment,
--     so overlapping cron passes / manual "run now" seconds after the cron
--     can't reach 2/2 on effectively one market tick.
DROP FUNCTION IF EXISTS confirm_entry(uuid, text, text, int);
CREATE OR REPLACE FUNCTION confirm_entry(
  _user uuid, _symbol text, _side text,
  _window_secs int DEFAULT 210,
  _min_gap_secs int DEFAULT 60
) RETURNS int LANGUAGE plpgsql AS $$
DECLARE _c int; _age interval;
BEGIN
  SELECT confirms, now() - updated_at INTO _c, _age
  FROM entry_confirmations WHERE user_id=_user AND symbol=_symbol AND side=_side;
  IF FOUND AND _age < make_interval(secs => _min_gap_secs) THEN
    RETURN _c;
  END IF;
  INSERT INTO entry_confirmations (user_id, symbol, side, confirms, updated_at)
  VALUES (_user, _symbol, _side, 1, now())
  ON CONFLICT (user_id, symbol, side) DO UPDATE
    SET confirms = CASE
          WHEN entry_confirmations.updated_at >= now() - make_interval(secs => _window_secs)
          THEN entry_confirmations.confirms + 1
          ELSE 1 END,
        updated_at = now()
  RETURNING confirms INTO _c;
  RETURN _c;
END $$;

GRANT EXECUTE ON FUNCTION confirm_entry(uuid, text, text, int, int) TO service_role, authenticated, anon;

-- V2 confluence gate flag (dormant unless enabled per cohort).
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS v2_long_gate_enabled boolean;

-- Universe quality gate reads recent spread_skip events every scan; without
-- this partial index that query seq-scans bot_events (~1M rows / 14d).
CREATE INDEX IF NOT EXISTS bot_events_spread_skip_idx
  ON bot_events (created_at) WHERE (meta->>'kind') = 'spread_skip';

-- Signal trajectory / component analyses join signals by user+symbol+time.
CREATE INDEX IF NOT EXISTS bot_signals_user_symbol_created_idx
  ON bot_signals (user_id, symbol, created_at DESC);

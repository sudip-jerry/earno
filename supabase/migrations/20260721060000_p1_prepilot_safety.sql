-- P1 pre-pilot safety plumbing (2026-07-21). Applied out-of-band to the live
-- DB via query_database; idempotent for replays.

-- ── Coin phantom-buy fix ────────────────────────────────────────────────────
-- Root cause: the bot buy path inserted the position row, tracked cash only in
-- memory, and wrote the debit once at scan end — with no lock against
-- overlapping scans, no error check on the insert, no uniqueness on open
-- holdings, and (live mode) no rollback when the real order was rejected.

-- DB-level backstop: one open holding per user+symbol.
CREATE UNIQUE INDEX IF NOT EXISTS uq_coin_positions_open_symbol
  ON coin_positions (user_id, symbol) WHERE status = 'open';

-- Scan lease (CAS in code): two overlapping scans can't double-buy.
ALTER TABLE coin_bot_config ADD COLUMN IF NOT EXISTS scan_lease_until timestamptz;

-- Atomic buy: cash debit + position insert in ONE transaction. Returns the new
-- position id, or NULL when cash is insufficient or the symbol is already held
-- open (unique_violation) — in both cases NOTHING is written.
CREATE OR REPLACE FUNCTION coin_buy_atomic(
  _user_id uuid, _symbol text, _display text, _qty numeric, _price numeric,
  _invested numeric, _mode text, _target numeric, _stop numeric,
  _max_holding_until timestamptz, _open_reason text
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _pos_id uuid;
BEGIN
  UPDATE coin_bot_config
     SET available_cash_usdt = available_cash_usdt - _invested
   WHERE user_id = _user_id AND available_cash_usdt >= _invested;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO coin_positions (user_id, symbol, display, qty, avg_buy_price, last_price,
    invested_usdt, current_value_usdt, status, mode, source, target_price, stop_price,
    max_holding_until, open_reason)
  VALUES (_user_id, _symbol, _display, _qty, _price, _price, _invested, _invested,
    'open', _mode, 'bot', _target, _stop, _max_holding_until, _open_reason)
  RETURNING id INTO _pos_id;
  RETURN _pos_id;
EXCEPTION WHEN unique_violation THEN
  RETURN NULL;
END $$;

-- Atomic close: CAS on status='open' + cash credit in ONE transaction. Returns
-- realized PnL, or NULL when a concurrent pass already closed the row (caller
-- must skip — prevents double-close / double-credit).
CREATE OR REPLACE FUNCTION coin_close_atomic(
  _pos_id uuid, _exit_price numeric, _exit_reason text
) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE _row coin_positions%ROWTYPE;
BEGIN
  UPDATE coin_positions SET status='closed', closed_at=now(),
      exit_price=_exit_price, last_price=_exit_price,
      current_value_usdt = qty*_exit_price,
      realized_pnl_usdt = qty*_exit_price - invested_usdt - invested_usdt*0.001 - qty*_exit_price*0.001,
      unrealized_pnl_usdt = 0,
      exit_reason=_exit_reason
   WHERE id=_pos_id AND status='open'
   RETURNING * INTO _row;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE coin_bot_config SET available_cash_usdt = available_cash_usdt + _row.qty*_exit_price
   WHERE user_id = _row.user_id;
  RETURN _row.realized_pnl_usdt;
END $$;

-- These run under the service role from the scan engine only.
REVOKE EXECUTE ON FUNCTION coin_buy_atomic(uuid,text,text,numeric,numeric,numeric,text,numeric,numeric,timestamptz,text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION coin_close_atomic(uuid,numeric,text) FROM anon, authenticated, public;

-- ── Equity circuit breaker ──────────────────────────────────────────────────
-- Mark pass maintains an intraday (IST) equity peak per user; at
-- circuit_breaker_pct below the peak it flattens the book (real reduce-only
-- orders in live mode) and stamps halted_on — the entry pass books nothing for
-- that user until the next IST day. 0 disables.
ALTER TABLE bot_config
  ADD COLUMN IF NOT EXISTS equity_peak numeric,
  ADD COLUMN IF NOT EXISTS equity_peak_date date,
  ADD COLUMN IF NOT EXISTS halted_on date,
  ADD COLUMN IF NOT EXISTS circuit_breaker_pct numeric DEFAULT 10;

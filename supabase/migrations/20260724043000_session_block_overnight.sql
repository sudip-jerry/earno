-- Overnight session block (2026-07-24). Hour-of-day P&L profile over 3 weeks,
-- split into two ~10-day windows for stability: entries opened 23:00-04:59 IST
-- (US afternoon/evening) were net-negative in BOTH windows (−$70 and −$193)
-- while 10:00-22:00 IST holds nearly all consistently green hours. The
-- `blocked_session_hours_ist` gate already existed in code (skip-only, entries
-- only; exits/marks unaffected) — it had simply never been set.
UPDATE bot_config SET blocked_session_hours_ist = ARRAY[23,0,1,2,3,4];

-- Funding-rate gate for shorts: VALIDATED two-window (strong-negative funding
-- shorts negative in both halves and hold 24 of 25 full-stop squeezes;
-- neutral/positive-funding shorts flat-to-strongly-positive) but PARKED — the
-- side-aware short micro-lock shipped hours earlier targets the same failure
-- tail, and two overlapping changes on one lane would make the n>=25 lock
-- readout unreadable. If the short lane is still negative at the lock readout,
-- this gate is the next pre-validated lever.

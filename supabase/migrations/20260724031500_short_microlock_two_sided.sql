-- Two-sided trading restored (2026-07-24). The side-off flags were a
-- tourniquet, not strategy (user call: "no logic with short or long off").
-- Root cause of the short bleed was mechanical: shorts peak ~1.2% ROE — just
-- under every protection threshold — so 42% round-tripped to the full stop.
-- Fix shipped in code: SIDE-AWARE micro peak-lock (shorts arm 0.6% ROE, lock
-- floor 0.5%; longs unchanged at 1.2/0.35). Sweep on 334 real shorts
-- (Jul 14-24, deltas vs live): aggressive twins +$81.5/10d, all other cohorts
-- +$208.1/10d, no damage to the profit-fade harvest (locks 47→80).
-- With the ratchet in place, shorts come back on for 31fac812 — both
-- aggressive cohorts fully two-sided again. Watch: if the twins' short lane
-- stays clearly negative over the next n>=25 closed shorts WITH the lock
-- live, the problem is entry-side and goes to the signal-rebuild list.
UPDATE bot_config SET allow_short = true
WHERE user_id = '31fac812-f752-45e6-87c2-59d8fb9aae55';

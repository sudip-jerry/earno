-- Aggressive-twins short-lane A/B (2026-07-21). The twins' (3m momentum) short
-- lane has never had a positive week: −7.79 / −16.58 / −126.64 / −76.55 over
-- four consecutive weeks (both stop geometries, both gate regimes), while the
-- other six cohorts' shorts made +$127 in the last 7d under identical gates.
-- Mechanical cause: 3m-timed shorts peak ~1.2% ROE — under TP1, under the 1.5%
-- breakeven arm, under the 1.2% micro-lock — so 42% round-trip to the full stop.
-- A/B: shorts OFF for 31fac812 (Sudip); twin 6163db97 (Kush) keeps shorts as
-- control. Pre-registered bar: at n>=25 further Kush shorts — still negative →
-- kill shorts for aggressive cohorts entirely; clearly positive → re-examine.
UPDATE bot_config SET allow_short = false
WHERE user_id = '31fac812-f752-45e6-87c2-59d8fb9aae55';

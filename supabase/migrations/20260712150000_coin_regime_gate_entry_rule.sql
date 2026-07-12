-- Coin bot: universe-breadth regime gate + entry-rule A/B flag.
-- Evidence (2026-07-12 two-window replay on the bot's 30 traded symbols,
-- shared exits, after fees): every long-only entry rule bled in the red week
-- (current 'climax' entry −75, indistinguishable from random entries) while
-- the up week paid ~+60 to every rule — regime is first-order, entry rule
-- second-order. Donchian fresh-high topped every window it could win.
ALTER TABLE coin_bot_config ADD COLUMN IF NOT EXISTS regime_gate_enabled boolean;
ALTER TABLE coin_bot_config ADD COLUMN IF NOT EXISTS entry_rule text;

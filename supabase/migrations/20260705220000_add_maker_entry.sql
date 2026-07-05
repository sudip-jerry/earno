-- Maker-first live entry (dormant unless enabled per user; live-only).
--
-- When maker_entry_enabled = true, live auto-book posts a passive limit
-- (maker) order at the signal price and waits maker_entry_wait_ms (~5s) for a
-- fill. If it fills we pay the lower maker fee; if not we cancel and flip to a
-- market (taker) order so the entry still happens. Default OFF so this is a
-- no-op until explicitly turned on for a pilot cohort. Paper mode is unchanged
-- (always simulated as taker).
ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS maker_entry_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS maker_entry_wait_ms integer NOT NULL DEFAULT 5000;

-- Records how a position's entry actually filled so exit fee accounting can
-- pick the correct model (maker_taker vs taker_taker). Defaults to 'taker',
-- matching today's behavior for every existing and paper trade.
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS entry_fill_type text NOT NULL DEFAULT 'taker';

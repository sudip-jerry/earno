ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS scan_interval_minutes integer NOT NULL DEFAULT 5;

ALTER TABLE public.bot_config
  DROP CONSTRAINT IF EXISTS bot_config_scan_interval_chk;

ALTER TABLE public.bot_config
  ADD CONSTRAINT bot_config_scan_interval_chk
  CHECK (scan_interval_minutes BETWEEN 1 AND 60);
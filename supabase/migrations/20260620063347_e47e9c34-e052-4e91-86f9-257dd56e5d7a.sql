
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS signal_id uuid REFERENCES public.bot_signals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS algo_id text,
  ADD COLUMN IF NOT EXISTS algo_name text,
  ADD COLUMN IF NOT EXISTS algo_version text,
  ADD COLUMN IF NOT EXISTS confidence_at_entry numeric,
  ADD COLUMN IF NOT EXISTS confidence_band_at_entry text,
  ADD COLUMN IF NOT EXISTS entry_reason text,
  ADD COLUMN IF NOT EXISTS market_regime text,
  ADD COLUMN IF NOT EXISTS rsi_at_entry numeric,
  ADD COLUMN IF NOT EXISTS volume_spike_ratio_at_entry numeric,
  ADD COLUMN IF NOT EXISTS spread_pct_at_entry numeric,
  ADD COLUMN IF NOT EXISTS distance_from_vwap_pct_at_entry numeric,
  ADD COLUMN IF NOT EXISTS distance_from_ema21_pct_at_entry numeric;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'positions_source_check'
  ) THEN
    ALTER TABLE public.positions
      ADD CONSTRAINT positions_source_check CHECK (source IN ('auto','manual'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS positions_signal_id_idx ON public.positions(signal_id);

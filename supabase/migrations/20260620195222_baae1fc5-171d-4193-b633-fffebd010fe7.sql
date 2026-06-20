
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS tp1_price numeric,
  ADD COLUMN IF NOT EXISTS tp1_pct numeric,
  ADD COLUMN IF NOT EXISTS tp1_hit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tp1_hit_at timestamptz,
  ADD COLUMN IF NOT EXISTS tp1_pnl numeric,
  ADD COLUMN IF NOT EXISTS tp1_qty_closed numeric,
  ADD COLUMN IF NOT EXISTS remaining_qty numeric,
  ADD COLUMN IF NOT EXISTS breakeven_moved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trail_pct numeric,
  ADD COLUMN IF NOT EXISTS trail_anchor_price numeric,
  ADD COLUMN IF NOT EXISTS final_tp_hit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS final_exit_reason text,
  ADD COLUMN IF NOT EXISTS peak_unrealized_pnl_pct numeric,
  ADD COLUMN IF NOT EXISTS giveback_pct numeric,
  ADD COLUMN IF NOT EXISTS max_favourable_excursion_pct numeric,
  ADD COLUMN IF NOT EXISTS max_adverse_excursion_pct numeric,
  ADD COLUMN IF NOT EXISTS highest_unrealized_pnl numeric,
  ADD COLUMN IF NOT EXISTS lowest_unrealized_pnl numeric,
  ADD COLUMN IF NOT EXISTS weak_progress boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weak_progress_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_saved_pnl numeric,
  ADD COLUMN IF NOT EXISTS manual_missed_pnl numeric,
  ADD COLUMN IF NOT EXISTS shadow_exit_reason text,
  ADD COLUMN IF NOT EXISTS shadow_exit_pnl numeric,
  ADD COLUMN IF NOT EXISTS shadow_closed_at timestamptz;

CREATE INDEX IF NOT EXISTS positions_shadow_pending_idx
  ON public.positions (closed_at)
  WHERE exit_reason = 'manual' AND shadow_exit_reason IS NULL;

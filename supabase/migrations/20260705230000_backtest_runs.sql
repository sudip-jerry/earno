-- Backtest harness output. Each row is one config variant replayed over a set
-- of real booked trades against their true 1m candle path (fetched at run time,
-- since positions only store MFE/MAE peaks, not the intra-trade path).
--
-- Purpose: A/B the exit + fee levers (early breakeven, maker entry, wider TP,
-- slippage) on real entries, deterministically, before enabling them live.
CREATE TABLE IF NOT EXISTS public.backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  label text,                       -- human label for the whole run
  variant text NOT NULL,            -- variant name (e.g. "baseline", "be_arm_2pct")
  scope jsonb,                      -- { userId?, sinceHours, symbol? } that selected trades
  knobs jsonb,                      -- the overrides this variant applied
  trades integer NOT NULL DEFAULT 0,
  replayed integer NOT NULL DEFAULT 0,   -- trades with a usable candle path
  wins integer NOT NULL DEFAULT 0,
  win_rate numeric,
  gross_pct numeric,                -- sum of per-trade gross ROE %
  net_pct numeric,                  -- sum of per-trade net ROE % (after fees+slippage)
  avg_net_pct numeric,              -- net per trade
  gross_pnl numeric,                -- sum absolute gross PnL (USDT)
  net_pnl numeric,                  -- sum absolute net PnL (USDT)
  total_fees numeric,
  expectancy numeric,               -- avg net PnL per trade
  max_drawdown numeric,             -- worst cumulative net-PnL drawdown across the sequence
  exit_breakdown jsonb,             -- { exit_reason: count }
  details jsonb                     -- optional per-trade rows for drill-down
);

CREATE INDEX IF NOT EXISTS backtest_runs_created_idx ON public.backtest_runs (created_at DESC);

ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;

-- Service role (cron / server route) manages rows; no public access.
DROP POLICY IF EXISTS "backtest_runs service manage" ON public.backtest_runs;
CREATE POLICY "backtest_runs service manage" ON public.backtest_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

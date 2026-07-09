-- Minimum expected-edge gate (fee-aware, perps). The gross target move (tpPct)
-- must clear the instrument's minimum viable edge, or round-trip fees + slippage
-- mechanically consume the profit — the textbook "0.2% target with 0.1%/side
-- fees" failure, which is exactly EarnO's cost-drag loss mode (tiny targets,
-- ~44% "win" but net-negative).
--
-- Field guidance: perps ~0.6%, spot ~0.35% (spot is gated on the coin-bot path,
-- not here). Left NULL (gate OFF) so this is a no-op on deploy; it is enabled
-- per user AFTER the backtest harness confirms, on real history, that the floor
-- flips expectancy positive on the surviving trades. Set to 0.6 to enable for
-- futures perps.
ALTER TABLE public.bot_config
  ADD COLUMN IF NOT EXISTS minimum_expected_edge_pct numeric;

COMMENT ON COLUMN public.bot_config.minimum_expected_edge_pct IS
  'Skip auto-book when the gross target move %% is below this floor (fees would dominate). Perps ~0.6, spot ~0.35. NULL/0 = off.';

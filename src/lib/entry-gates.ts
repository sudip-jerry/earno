// Pure entry-gate helpers for the futures auto-book pass.
//
// Extracted as pure functions (no I/O) so the exact logic that runs live can
// also be exercised by unit tests. auto-book.server.ts is the only production
// caller.

import { feeModelRates, DEFAULT_FEE_MODEL, type FeeModel } from "@/lib/fees";

/**
 * Projected net profit at the planned take-profit, as a percentage of entry
 * notional, using the SAME cost model as the exit path (auto-book.server.ts
 * runMarkPass): entry+exit fees + GST, plus a slippage buffer (and reserved
 * funding). Keeping entry and exit on one cost model prevents the pre-entry
 * gate from being optimistic by the slippage the exit later subtracts.
 */
export function projectedNetPctAtTp(args: {
  entryPrice: number;
  takeProfit: number;
  qty: number;
  slippageBufferPct: number;
  fundingPct?: number;
  model?: FeeModel;
}): number {
  const { entryPrice, takeProfit, qty, slippageBufferPct } = args;
  const entryNotional = qty * entryPrice;
  if (entryNotional <= 0) return 0;

  const fees = feeModelRates(args.model ?? DEFAULT_FEE_MODEL);
  const exitNotionalAtTp = qty * takeProfit;
  const grossAtTp = qty * Math.abs(takeProfit - entryPrice);
  const feesAtTp =
    ((entryNotional * fees.entry_fee_pct) / 100 + (exitNotionalAtTp * fees.exit_fee_pct) / 100) *
    (1 + fees.gst_pct / 100);
  const slippageAtTp = (exitNotionalAtTp * slippageBufferPct) / 100;
  const fundingAtTp = (entryNotional * (args.fundingPct ?? 0)) / 100;

  return ((grossAtTp - feesAtTp - slippageAtTp - fundingAtTp) / entryNotional) * 100;
}

import { describe, it, expect } from "vitest";
import { projectedNetPctAtTp } from "@/lib/entry-gates";
import { feeModelRates, DEFAULT_FEE_MODEL } from "@/lib/fees";

// Recompute the exit-side net%-of-notional the way runMarkPass does, so the
// entry gate is pinned to the exact same cost model.
function exitStyleNetPctAtTp(entry: number, tp: number, qty: number, slipPct: number) {
  const f = feeModelRates(DEFAULT_FEE_MODEL);
  const entryNotional = qty * entry;
  const exitNotional = qty * tp;
  const gross = qty * Math.abs(tp - entry);
  const fee = ((entryNotional * f.entry_fee_pct) / 100 + (exitNotional * f.exit_fee_pct) / 100) * (1 + f.gst_pct / 100);
  const slip = (exitNotional * slipPct) / 100;
  return ((gross - fee - slip) / entryNotional) * 100;
}

describe("projectedNetPctAtTp", () => {
  it("matches the exit-side cost model (fees + GST + slippage)", () => {
    const entry = 100;
    const tp = 101; // +1% gross
    const qty = 5;
    const slip = 0.05;
    const got = projectedNetPctAtTp({ entryPrice: entry, takeProfit: tp, qty, slippageBufferPct: slip });
    expect(got).toBeCloseTo(exitStyleNetPctAtTp(entry, tp, qty, slip), 9);
  });

  it("is strictly lower than a fees-only projection (slippage is now subtracted)", () => {
    const entry = 100,
      tp = 101,
      qty = 5;
    const f = feeModelRates(DEFAULT_FEE_MODEL);
    const entryNotional = qty * entry;
    const exitNotional = qty * tp;
    const gross = qty * Math.abs(tp - entry);
    const fee = ((entryNotional * f.entry_fee_pct) / 100 + (exitNotional * f.exit_fee_pct) / 100) * (1 + f.gst_pct / 100);
    const feesOnlyPct = ((gross - fee) / entryNotional) * 100;
    const withSlip = projectedNetPctAtTp({ entryPrice: entry, takeProfit: tp, qty, slippageBufferPct: 0.05 });
    expect(withSlip).toBeLessThan(feesOnlyPct);
  });

  it("returns 0 for a non-positive notional", () => {
    expect(projectedNetPctAtTp({ entryPrice: 0, takeProfit: 101, qty: 5, slippageBufferPct: 0.05 })).toBe(0);
  });

  it("works symmetrically for shorts (tp below entry)", () => {
    const got = projectedNetPctAtTp({ entryPrice: 100, takeProfit: 99, qty: 5, slippageBufferPct: 0.05 });
    expect(got).toBeCloseTo(exitStyleNetPctAtTp(100, 99, 5, 0.05), 9);
  });
});

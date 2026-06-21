// CoinDCX futures fees applied to realized PnL.
// Taker (market / SL / TP hits / time exits / auto-close): 0.05%
// Maker (limit closes): 0.02%
// Opens are always taker — the bot books with market orders.
export const FEE_TAKER = 0.0005;
export const FEE_MAKER = 0.0002;
export const FEE_OPEN = FEE_TAKER;

export function closeFeeRate(exitReason: string | null | undefined): number {
  const r = (exitReason ?? "").toLowerCase();
  // Anything explicitly limit-based is maker; everything else (sl/tp/auto/time/manual market) is taker.
  if (r === "manual_limit" || r.includes("limit")) return FEE_MAKER;
  return FEE_TAKER;
}

export type FeeInputs = {
  pnl?: number | null;
  entry_price?: number | null;
  exit_price?: number | null;
  qty?: number | null;
  exit_reason?: string | null;
};

export function tradeFee(t: FeeInputs): number {
  const entry = Number(t.entry_price ?? 0);
  const exit = Number(t.exit_price ?? 0);
  const qty = Number(t.qty ?? 0);
  if (!qty || !entry) return 0;
  const openFee = entry * qty * FEE_OPEN;
  const closeFee = exit > 0 ? exit * qty * closeFeeRate(t.exit_reason) : 0;
  return openFee + closeFee;
}

// Net realized pnl, fees deducted. For still-open trades (no exit_price), only entry fee is deducted.
export function netPnl(t: FeeInputs): number {
  return Number(t.pnl ?? 0) - tradeFee(t);
}

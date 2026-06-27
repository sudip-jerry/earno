// CoinDCX INR-M Futures fee model.
// maker 0.02%, taker 0.05%, GST 18% on fees.
// Default for paper simulation: taker_taker_with_gst (market order both sides).
// Effective fee per side incl. GST: 0.059% (0.05% × 1.18).
// Fee is calculated on notional = qty × price (not on margin).
// Do not add TDS for INR-M Futures.

export const MAKER_FEE_PCT = 0.02;
export const TAKER_FEE_PCT = 0.05;
export const GST_PCT = 18;

export type FeeModel =
  | "maker_maker_with_gst"
  | "maker_taker_with_gst"
  | "taker_taker_with_gst"
  | "taker_taker_without_gst";

export const DEFAULT_FEE_MODEL: FeeModel = "taker_taker_with_gst";

export function feeModelRates(model: FeeModel = DEFAULT_FEE_MODEL): {
  entry_fee_pct: number;
  exit_fee_pct: number;
  gst_pct: number;
} {
  switch (model) {
    case "maker_maker_with_gst":
      return { entry_fee_pct: MAKER_FEE_PCT, exit_fee_pct: MAKER_FEE_PCT, gst_pct: GST_PCT };
    case "taker_taker_with_gst":
      return { entry_fee_pct: TAKER_FEE_PCT, exit_fee_pct: TAKER_FEE_PCT, gst_pct: GST_PCT };
    case "taker_taker_without_gst":
      return { entry_fee_pct: TAKER_FEE_PCT, exit_fee_pct: TAKER_FEE_PCT, gst_pct: 0 };
    case "maker_taker_with_gst":
    default:
      return { entry_fee_pct: MAKER_FEE_PCT, exit_fee_pct: TAKER_FEE_PCT, gst_pct: GST_PCT };
  }
}

export type FeeInputs = {
  pnl?: number | null;
  entry_price?: number | null;
  exit_price?: number | null;
  qty?: number | null;
  exit_reason?: string | null;
};

export type FeeBreakdown = {
  fee_model: FeeModel;
  entry_fee_pct: number;
  exit_fee_pct: number;
  gst_pct: number;
  entry_notional: number;
  exit_notional: number;
  entry_fee: number;
  exit_fee: number;
  gst_fee: number;
  total_fee: number;
  gross_pnl: number;
  net_pnl: number;
};

export function computeFees(t: FeeInputs, model: FeeModel = DEFAULT_FEE_MODEL): FeeBreakdown {
  const { entry_fee_pct, exit_fee_pct, gst_pct } = feeModelRates(model);
  const entry = Number(t.entry_price ?? 0);
  const exit = Number(t.exit_price ?? 0);
  const qty = Number(t.qty ?? 0);
  const gross_pnl = Number(t.pnl ?? 0);

  const entry_notional = qty > 0 && entry > 0 ? qty * entry : 0;
  const exit_notional = qty > 0 && exit > 0 ? qty * exit : 0;
  const entry_fee = (entry_notional * entry_fee_pct) / 100;
  const exit_fee = (exit_notional * exit_fee_pct) / 100;
  const gst_fee = ((entry_fee + exit_fee) * gst_pct) / 100;
  const total_fee = entry_fee + exit_fee + gst_fee;
  const net_pnl = gross_pnl - total_fee;

  return {
    fee_model: model,
    entry_fee_pct,
    exit_fee_pct,
    gst_pct,
    entry_notional,
    exit_notional,
    entry_fee,
    exit_fee,
    gst_fee,
    total_fee,
    gross_pnl,
    net_pnl,
  };
}

export function tradeFee(t: FeeInputs, model: FeeModel = DEFAULT_FEE_MODEL): number {
  return computeFees(t, model).total_fee;
}

// Net realized pnl, fees deducted. For still-open trades (no exit_price), only entry-side fee is deducted.
export function netPnl(t: FeeInputs, model: FeeModel = DEFAULT_FEE_MODEL): number {
  return computeFees(t, model).net_pnl;
}

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

// Fee model for a trade whose entry actually filled as a maker: maker on the way
// in (post-only limit, 0.02%), taker on the way out (market close, 0.05%) — hence
// maker_taker, NOT maker_maker (which would understate the real exit cost).
export const MAKER_FILL_FEE_MODEL: FeeModel = "maker_taker_with_gst";

/**
 * Fee model the reporting helpers use when no explicit model is passed.
 *
 * HONEST PER-FILL: a trade is billed on the maker model ONLY when its entry
 * actually filled as a maker (entry_fill_type === "maker"). Everything else —
 * historical trades, taker fallbacks, spot — uses the taker default. So realized
 * dashboards reflect fees actually PAID, never a maker what-if (that projection
 * lives in the backtest harness). Fails safe: a row without entry_fill_type
 * resolves to taker, never falsely maker.
 *
 * This is a reporting/display default only. Trading/exit logic (auto-book,
 * entry-gates) keeps DEFAULT_FEE_MODEL so decisions stay conservative. Override
 * per-call by passing an explicit model.
 */
export function reportingFeeModel(t: FeeInputs): FeeModel {
  return t.entry_fill_type === "maker" ? MAKER_FILL_FEE_MODEL : DEFAULT_FEE_MODEL;
}

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
  // Drives the reporting fee model: "maker" bills the trade on the maker basis;
  // anything else (incl. undefined) uses the taker default. Fails safe.
  entry_fill_type?: string | null;
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

export function computeFees(t: FeeInputs, model?: FeeModel): FeeBreakdown {
  const resolved = model ?? reportingFeeModel(t);
  const { entry_fee_pct, exit_fee_pct, gst_pct } = feeModelRates(resolved);
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
    fee_model: resolved,
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

export function tradeFee(t: FeeInputs, model?: FeeModel): number {
  return computeFees(t, model).total_fee;
}

// Net realized pnl, fees deducted. For still-open trades (no exit_price), only entry-side fee is deducted.
export function netPnl(t: FeeInputs, model?: FeeModel): number {
  return computeFees(t, model).net_pnl;
}

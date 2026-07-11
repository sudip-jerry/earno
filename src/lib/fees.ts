// CoinDCX INR-M Futures fee model.
// IMPORTANT (validated against real CoinDCX trades, Jul 2026): CoinDCX charges the
// SAME rate for maker and taker futures orders — the official fee table has a single
// "Maker & Taker Fee" column. There is NO maker discount. Reconciling four real
// closed trades (US/DEXE/VELVET/SKL) gives 0.05% per side + 18% GST = 0.059%/side
// incl. GST, ~0.118% round-trip. So both entry and exit are modelled at 0.05%.
// Fee is calculated on notional = qty × price (not on margin). No TDS for INR-M Futures.
//
// MAKER_FEE_PCT is retained only for legacy/spot models; for CoinDCX futures it is
// NOT used — maker == taker == 0.05%.

export const MAKER_FEE_PCT = 0.02;
export const TAKER_FEE_PCT = 0.05;
export const GST_PCT = 18;

export type FeeModel =
  | "maker_maker_with_gst"
  | "maker_taker_with_gst"
  | "taker_taker_with_gst"
  | "taker_taker_without_gst";

export const DEFAULT_FEE_MODEL: FeeModel = "taker_taker_with_gst";

// Reporting basis for FUTURES (perps). CoinDCX charges maker == taker on futures
// (see header note; validated against real trades), so reporting uses taker/taker —
// identical to the real cost and to DEFAULT_FEE_MODEL. A maker basis here would
// understate fees ~2.5× and inflate reported net PnL; that mistake was reverted.
export const REPORTING_FEE_MODEL_FUTURES: FeeModel = "taker_taker_with_gst";

/** True when a trade row is a futures/perp trade (explicit instrument, or the
 *  CoinDCX perp symbol prefix "B-" when instrument isn't on the row). */
function isFuturesTrade(t: FeeInputs): boolean {
  if (t.instrument === "futures") return true;
  if (t.instrument === "spot") return false;
  return (t.symbol ?? "").startsWith("B-");
}

/** Fee model used by the reporting helpers when no explicit model is passed:
 *  maker basis for futures, taker default otherwise. */
export function reportingFeeModel(t: FeeInputs): FeeModel {
  return isFuturesTrade(t) ? REPORTING_FEE_MODEL_FUTURES : DEFAULT_FEE_MODEL;
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
  // Used to pick the reporting fee model (maker basis for futures). Either is
  // enough; symbol's "B-" prefix classifies perps when instrument isn't present.
  symbol?: string | null;
  instrument?: string | null;
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

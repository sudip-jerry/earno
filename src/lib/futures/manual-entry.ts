/**
 * Manual futures entry rule — pure, side-effect-free.
 *
 * Encodes the discretionary long strategy that works by hand:
 *   1. 30m chart: uptrend confirmed by the last 3 candles (higher closes) —
 *      price structure, NOT a lagging EMA (EarnO's EMA9/21 read stays "up"
 *      while price rolls over).
 *   2. 1m chart: RSI(14) not overbought AND last 5 candles up (higher closes)
 *      — refuses climax/blow-off entries (EarnO instead REWARDS volume spikes).
 *   3. Supertrend(10, 3) bullish on the entry (1m) timeframe as confirmation.
 *
 * Long only. All three must hold to enter.
 */

export type MECandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  time?: number;
};

/** Tunable parameters. Defaults match the manual method. */
export type ManualEntryParams = {
  trend30Lookback: number; // consecutive 30m candles that must make higher closes
  trend1Lookback: number; // consecutive 1m candles that must make higher closes
  rsiPeriod: number;
  rsiOverbought: number; // block entry when 1m RSI >= this
  stPeriod: number; // Supertrend ATR period
  stMultiplier: number; // Supertrend ATR multiplier
};

export const DEFAULT_MANUAL_ENTRY_PARAMS: ManualEntryParams = {
  trend30Lookback: 3,
  trend1Lookback: 5,
  rsiPeriod: 14,
  rsiOverbought: 70,
  stPeriod: 10,
  stMultiplier: 3,
};

export type ManualEntryResult = {
  enterLong: boolean;
  reasons: string[]; // human-readable pass/fail notes
  detail: {
    trend30Up: boolean;
    trend1Up: boolean;
    rsi1m: number | null;
    rsiOk: boolean;
    supertrendUp: boolean | null;
  };
};

/** RSI (Wilder-style over the trailing `period` window). */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** True Range series (index 0 uses high-low). */
function trueRanges(candles: MECandle[]): number[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      tr.push(c.high - c.low);
      continue;
    }
    const prevClose = candles[i - 1].close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  return tr;
}

/** Wilder ATR series (null until enough bars). */
export function atrSeries(candles: MECandle[], period: number): (number | null)[] {
  const tr = trueRanges(candles);
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return out;
  // First ATR = simple average of the first `period` TRs.
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = atr;
  for (let i = period; i < candles.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
}

/**
 * Supertrend. Returns per-candle uptrend flags (true = price above the
 * Supertrend line = bullish). Null until enough bars for ATR.
 */
export function supertrend(
  candles: MECandle[],
  period = 10,
  multiplier = 3,
): (boolean | null)[] {
  const n = candles.length;
  const atr = atrSeries(candles, period);
  const trendUp: (boolean | null)[] = new Array(n).fill(null);
  let finalUpper = 0;
  let finalLower = 0;
  let prevUp = true;
  let started = false;
  for (let i = 0; i < n; i++) {
    const a = atr[i];
    if (a == null) continue;
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const basicUpper = hl2 + multiplier * a;
    const basicLower = hl2 - multiplier * a;
    const prevClose = i > 0 ? candles[i - 1].close : candles[i].close;

    if (!started) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      prevUp = candles[i].close >= hl2;
      trendUp[i] = prevUp;
      started = true;
      continue;
    }
    finalUpper = basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
    finalLower = basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;

    let up: boolean;
    if (prevUp) {
      // was in uptrend (line = lower band); flip down if close breaks below it
      up = candles[i].close >= finalLower;
    } else {
      up = candles[i].close > finalUpper;
    }
    trendUp[i] = up;
    prevUp = up;
  }
  return trendUp;
}

/**
 * True when the last `lookback` candles are in an UPTREND — net higher over the
 * window AND a majority are green. This matches the discretionary "last N candles
 * up" (a rising trend), not a literal strictly-monotonic close sequence (which is
 * rare and rejected ~everything).
 */
function isUptrend(candles: MECandle[], lookback: number): boolean {
  if (candles.length < lookback + 1) return false;
  const slice = candles.slice(-(lookback + 1)); // lookback bars + the prior anchor
  const netUp = slice[slice.length - 1].close > slice[0].close;
  let green = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i].close >= slice[i].open) green += 1;
  }
  const majorityGreen = green >= Math.ceil(lookback / 2);
  return netUp && majorityGreen;
}

/**
 * Evaluate the manual long-entry rule. c30m and c1m are chronological candle
 * arrays ending at (and including) the candle at the decision moment.
 */
export function evaluateManualEntry(
  c30m: MECandle[],
  c1m: MECandle[],
  params: ManualEntryParams = DEFAULT_MANUAL_ENTRY_PARAMS,
): ManualEntryResult {
  const reasons: string[] = [];

  const trend30Up = isUptrend(c30m, params.trend30Lookback);
  if (!trend30Up) reasons.push(`30m not in uptrend (last ${params.trend30Lookback})`);

  const closes1 = c1m.map((c) => c.close);
  const rsi1m = rsi(closes1, params.rsiPeriod);
  const rsiOk = rsi1m != null && rsi1m < params.rsiOverbought;
  if (rsi1m == null) reasons.push("1m RSI unavailable");
  else if (!rsiOk) reasons.push(`1m RSI overbought (${rsi1m.toFixed(0)} >= ${params.rsiOverbought})`);

  const trend1Up = isUptrend(c1m, params.trend1Lookback);
  if (!trend1Up) reasons.push(`1m not in uptrend (last ${params.trend1Lookback})`);

  const stSeries = supertrend(c1m, params.stPeriod, params.stMultiplier);
  const supertrendUp = stSeries.length ? stSeries[stSeries.length - 1] : null;
  if (supertrendUp !== true) reasons.push("Supertrend not bullish");

  const enterLong = trend30Up && rsiOk && trend1Up && supertrendUp === true;
  if (enterLong) reasons.push("All conditions met — enter long");

  return {
    enterLong,
    reasons,
    detail: { trend30Up, trend1Up, rsi1m, rsiOk, supertrendUp },
  };
}

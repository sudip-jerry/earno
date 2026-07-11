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

/** Mirror of isUptrend for the short side: net lower over the window AND a
 *  majority of candles red. Used to short a former mover once it turns down. */
function isDowntrend(candles: MECandle[], lookback: number): boolean {
  if (candles.length < lookback + 1) return false;
  const slice = candles.slice(-(lookback + 1));
  const netDown = slice[slice.length - 1].close < slice[0].close;
  let red = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i].close < slice[i].open) red += 1;
  }
  const majorityRed = red >= Math.ceil(lookback / 2);
  return netDown && majorityRed;
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

export type ManualShortResult = {
  enterShort: boolean;
  reasons: string[];
  detail: {
    trend30Down: boolean;
    trend1Down: boolean;
    rsi1m: number | null;
    rsiOk: boolean;
    supertrendDown: boolean | null;
  };
};

/**
 * Short mirror of evaluateManualEntry: short the highest movers once they roll
 * over — 30m downtrend, 1m RSI not oversold (avoid capitulation bottoms, the
 * short-side analogue of "not overbought"), 1m downtrend, Supertrend bearish.
 * `rsiOverbought` is reused as the symmetric oversold floor (100 - rsiOverbought).
 */
export function evaluateManualEntryShort(
  c30m: MECandle[],
  c1m: MECandle[],
  params: ManualEntryParams = DEFAULT_MANUAL_ENTRY_PARAMS,
): ManualShortResult {
  const reasons: string[] = [];

  const trend30Down = isDowntrend(c30m, params.trend30Lookback);
  if (!trend30Down) reasons.push(`30m not in downtrend (last ${params.trend30Lookback})`);

  const closes1 = c1m.map((c) => c.close);
  const rsi1m = rsi(closes1, params.rsiPeriod);
  const oversold = 100 - params.rsiOverbought;
  const rsiOk = rsi1m != null && rsi1m > oversold;
  if (rsi1m == null) reasons.push("1m RSI unavailable");
  else if (!rsiOk) reasons.push(`1m RSI oversold (${rsi1m.toFixed(0)} <= ${oversold})`);

  const trend1Down = isDowntrend(c1m, params.trend1Lookback);
  if (!trend1Down) reasons.push(`1m not in downtrend (last ${params.trend1Lookback})`);

  const stSeries = supertrend(c1m, params.stPeriod, params.stMultiplier);
  const st = stSeries.length ? stSeries[stSeries.length - 1] : null;
  const supertrendDown = st == null ? null : st === false;
  if (supertrendDown !== true) reasons.push("Supertrend not bearish");

  const enterShort = trend30Down && rsiOk && trend1Down && supertrendDown === true;
  if (enterShort) reasons.push("All conditions met — enter short");

  return {
    enterShort,
    reasons,
    detail: { trend30Down, trend1Down, rsi1m, rsiOk, supertrendDown },
  };
}

/**
 * True when recent price fails to make a new high — the last 2 bars' peak is
 * below the highest high of the prior `lookback` bars (a "lower high", the first
 * crack in an up-move). Structure signal on a slow timeframe (15m), NOT 1m noise.
 */
function isLowerHigh(candles: MECandle[], lookback: number): boolean {
  if (candles.length < lookback + 2) return false;
  const recent = Math.max(candles[candles.length - 1].high, candles[candles.length - 2].high);
  const prior = Math.max(...candles.slice(-(lookback + 2), -2).map((c) => c.high));
  return recent < prior;
}

/** Rolling VWAP over the last `lookback` bars: sum(typical*vol)/sum(vol),
 *  typical = (high+low+close)/3. Falls back to close-average if volume is absent. */
function rollingVwap(candles: MECandle[], lookback: number): number | null {
  if (candles.length < lookback) return null;
  const slice = candles.slice(-lookback);
  let pv = 0;
  let vol = 0;
  for (const c of slice) {
    const typ = (c.high + c.low + c.close) / 3;
    const v = c.volume ?? 0;
    pv += typ * v;
    vol += v;
  }
  if (vol <= 0) return slice.reduce((a, c) => a + c.close, 0) / slice.length;
  return pv / vol;
}

export type MeanReversionShortParams = {
  vwapLookback: number; // bars for the rolling VWAP
  extPct: number; // price must be this % above VWAP (overextended)
  rsiPeriod: number;
  rsiOverbought: number; // slow-timeframe RSI must be >= this
  volLookback: number; // bars to average volume over
  volMult: number; // last bar volume must be >= volMult × average (the volume filter)
};

export const DEFAULT_MEANREV_SHORT_PARAMS: MeanReversionShortParams = {
  vwapLookback: 20,
  extPct: 1.2,
  rsiPeriod: 14,
  rsiOverbought: 68,
  volLookback: 20,
  volMult: 1.5,
};

export type MeanReversionShortResult = {
  enterShort: boolean;
  reasons: string[];
  detail: {
    extAbovePct: number | null;
    rsi: number | null;
    volSpike: number | null;
    stretched: boolean;
    volOk: boolean;
    bearTrigger: boolean;
  };
};

/**
 * Mean-reversion fade short (the leading-algo edge): fade an OVEREXTENDED move on
 * a LIQUID coin, gated by a volume filter, once it starts to turn. Runs on a slow
 * timeframe (15m) to avoid noise:
 *   1. price >= extPct above rolling VWAP  (overextended)
 *   2. RSI >= rsiOverbought                 (overbought confirmation)
 *   3. last-bar volume >= volMult × avg     (the volume filter — biggest win-rate lift)
 *   4. bar rolls over (bearish close below prior close)  (don't fade a still-rising move)
 * Point this at BTC/ETH/majors (ranging, high-liquidity) where mean reversion works,
 * NOT microcap breakouts.
 */
export function evaluateMeanReversionShort(
  c15m: MECandle[],
  params: MeanReversionShortParams = DEFAULT_MEANREV_SHORT_PARAMS,
): MeanReversionShortResult {
  const reasons: string[] = [];
  const vwap = rollingVwap(c15m, params.vwapLookback);
  const last = c15m[c15m.length - 1];
  const extAbovePct = vwap && vwap > 0 ? ((last.close - vwap) / vwap) * 100 : null;
  const stretchedByVwap = extAbovePct != null && extAbovePct >= params.extPct;

  const rsiVal = rsi(c15m.map((c) => c.close), params.rsiPeriod);
  const overbought = rsiVal != null && rsiVal >= params.rsiOverbought;
  const stretched = stretchedByVwap && overbought;
  if (!stretchedByVwap) reasons.push(`not extended above VWAP (${extAbovePct?.toFixed(2) ?? "?"}% < ${params.extPct}%)`);
  if (!overbought) reasons.push(`RSI not overbought (${rsiVal?.toFixed(0) ?? "?"} < ${params.rsiOverbought})`);

  let volSpike: number | null = null;
  if (c15m.length >= params.volLookback + 1) {
    const win = c15m.slice(-(params.volLookback + 1), -1);
    const avg = win.reduce((a, c) => a + (c.volume ?? 0), 0) / win.length;
    volSpike = avg > 0 ? (last.volume ?? 0) / avg : null;
  }
  const volOk = volSpike != null && volSpike >= params.volMult;
  if (!volOk) reasons.push(`no volume spike (${volSpike?.toFixed(2) ?? "?"}× < ${params.volMult}×)`);

  const prev = c15m[c15m.length - 2];
  const bearTrigger = !!prev && last.close < last.open && last.close < prev.close;
  if (!bearTrigger) reasons.push("no bearish rollover candle");

  const enterShort = stretched && volOk && bearTrigger;
  if (enterShort) reasons.push("All conditions met — mean-reversion short");

  return {
    enterShort,
    reasons,
    detail: { extAbovePct, rsi: rsiVal, volSpike, stretched, volOk, bearTrigger },
  };
}

export type ExhaustionShortParams = {
  gainerPct: number; // 24h change must exceed this (the coin actually ran)
  rsi30Overbought: number; // 30m RSI must be >= this (coarse "it's stretched" check)
  rsiPeriod: number;
  swingLookback: number; // 15m bars to check for a lower high
  stPeriod: number;
  stMultiplier: number;
  freshFlipBars: number; // Supertrend must have been UP within this many 15m bars (fresh rollover)
};

export const DEFAULT_EXHAUSTION_SHORT_PARAMS: ExhaustionShortParams = {
  gainerPct: 8,
  rsi30Overbought: 65,
  rsiPeriod: 14,
  swingLookback: 6,
  stPeriod: 10,
  stMultiplier: 3,
  freshFlipBars: 4,
};

export type ExhaustionShortResult = {
  enterShort: boolean;
  reasons: string[];
  detail: {
    ranUp: boolean;
    rsi30: number | null;
    stretched: boolean;
    lowerHigh: boolean;
    freshFlipDown: boolean;
  };
};

/**
 * Exhaustion short — fade an overbought mover as it ROLLS OVER (the manual method
 * the user actually trades), all on slow timeframes to avoid 1m noise:
 *   1. 24h change >= gainerPct        — the coin ran up (worth fading)
 *   2. 30m RSI >= rsi30Overbought     — stretched/overbought (coarse extended check)
 *   3. 15m lower high                 — the up-move stalled (first failed new high)
 *   4. 15m Supertrend just flipped up→down (fresh, within freshFlipBars) — the turn
 * This is the OPPOSITE of evaluateManualEntryShort (which shorts an already-
 * established downtrend and gets squeezed). Here we short the top forming.
 */
export function evaluateExhaustionShort(
  c30m: MECandle[],
  c15m: MECandle[],
  change24h: number,
  params: ExhaustionShortParams = DEFAULT_EXHAUSTION_SHORT_PARAMS,
): ExhaustionShortResult {
  const reasons: string[] = [];

  const ranUp = change24h >= params.gainerPct;
  if (!ranUp) reasons.push(`24h change ${change24h.toFixed(1)}% < gainer ${params.gainerPct}%`);

  const rsi30 = rsi(c30m.map((c) => c.close), params.rsiPeriod);
  const stretched = rsi30 != null && rsi30 >= params.rsi30Overbought;
  if (rsi30 == null) reasons.push("30m RSI unavailable");
  else if (!stretched) reasons.push(`30m RSI not overbought (${rsi30.toFixed(0)} < ${params.rsi30Overbought})`);

  const lowerHigh = isLowerHigh(c15m, params.swingLookback);
  if (!lowerHigh) reasons.push("15m still making higher highs (no rollover)");

  const st15 = supertrend(c15m, params.stPeriod, params.stMultiplier);
  const nowDown = st15.length ? st15[st15.length - 1] === false : false;
  let wasUp = false;
  for (let i = Math.max(0, st15.length - 1 - params.freshFlipBars); i < st15.length - 1; i++) {
    if (st15[i] === true) wasUp = true;
  }
  const freshFlipDown = nowDown && wasUp;
  if (!freshFlipDown) reasons.push("15m Supertrend not a fresh up→down flip");

  const enterShort = ranUp && stretched && lowerHigh && freshFlipDown;
  if (enterShort) reasons.push("All conditions met — exhaustion short");

  return {
    enterShort,
    reasons,
    detail: { ranUp, rsi30, stretched, lowerHigh, freshFlipDown },
  };
}

/**
 * Coin Paper Bot scorer — pure functions.
 * Inputs: 1m / 5m / 30m candles + 24h change + spread. Outputs Buy/Sell/Hold/Wait/Avoid
 * with confidence, target/stop, and a short reason. No leverage, no futures.
 */

import type { Candle } from "@/services/coindcxPublicApi";

export type CoinAction = "buy" | "sell" | "hold" | "wait" | "avoid";

export type CoinScoreInput = {
  symbol: string;
  display: string;
  price: number;
  change24hPct: number;
  spreadPct: number | null;
  m1: Candle[];
  m5: Candle[];
  m30: Candle[];
  /** true when caller already holds this coin — drives hold/sell vs buy/wait */
  holding?: boolean;
  /** average buy price for the holding, used for trend-break / momentum checks */
  avgBuy?: number;
  /** caller mode */
  mode?: "intraday" | "swing";
  h4?: Candle[];
  d1?: Candle[];
  /** when true, held coins wait for a 30m reversal before early exit */
  holdUntilTrendReversal?: boolean;
};

export type CoinScore = {
  action: CoinAction;
  confidence: number; // 0-100
  reason_short: string;
  target_pct: number; // distance from price
  stop_pct: number;
  target: number;
  stop: number;
  detail: {
    trend_5m: "up" | "down" | "flat";
    trend_30m: "up" | "down" | "flat";
    momentum: "rising" | "fading" | "neutral";
    volume: "strong" | "normal" | "weak";
    rsi_14: number | null;
    spread: "tight" | "wide" | "unknown";
    pills: string[];
  };
};

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function trendOf(closes: number[]): "up" | "down" | "flat" {
  if (closes.length < 10) return "flat";
  const fast = ema(closes, 9);
  const slow = ema(closes, 21);
  const f = fast[fast.length - 1];
  const s = slow[slow.length - 1];
  const diff = ((f - s) / s) * 100;
  if (diff > 0.1) return "up";
  if (diff < -0.1) return "down";
  return "flat";
}

function volumeStrength(candles: Candle[]): "strong" | "normal" | "weak" {
  if (candles.length < 10) return "normal";
  const vols = candles.map((c) => c.volume || 0);
  const recent = vols.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
  if (avg <= 0) return "normal";
  const ratio = recent / avg;
  if (ratio >= 1.5) return "strong";
  if (ratio <= 0.6) return "weak";
  return "normal";
}

function momentumOf(closes: number[]): "rising" | "fading" | "neutral" {
  if (closes.length < 6) return "neutral";
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 4];
  const slope = ((last - prev) / prev) * 100;
  if (slope > 0.25) return "rising";
  if (slope < -0.25) return "fading";
  return "neutral";
}

/** True when price has broken below the prior swing low on the entry (30m)
 *  timeframe — i.e. making a fresh lower low (downtrend structure). Used to
 *  block swing buys into a rollover the lagging D1/H4 EMA hasn't caught yet. */
function makingLowerLow(m30: Candle[]): boolean {
  const lows = m30.map((c) => c.low).filter((n) => n > 0);
  if (lows.length < 12) return false;
  const recentLow = Math.min(...lows.slice(-3)); // last 3 bars
  const priorLow = Math.min(...lows.slice(-12, -3)); // prior 9 bars
  return recentLow < priorLow;
}

export function scoreCoin(input: CoinScoreInput): CoinScore {
  const closes5 = input.m5.map((c) => c.close).filter((n) => n > 0);
  const closes30 = input.m30.map((c) => c.close).filter((n) => n > 0);
  const closes1 = input.m1.map((c) => c.close).filter((n) => n > 0);

  const trend5 = trendOf(closes5);
  const trend30 = trendOf(closes30);
  const mom = momentumOf(closes1.length ? closes1 : closes5);
  const vol = volumeStrength(input.m5.length ? input.m5 : input.m30);
  const r = rsi(closes5, 14);
  const spread = input.spreadPct == null ? "unknown" : input.spreadPct <= 0.15 ? "tight" : "wide";

  const pills: string[] = [];
  pills.push(`Trend 5m: ${trend5}`);
  pills.push(`Trend 30m: ${trend30}`);
  pills.push(`Momentum: ${mom}`);
  pills.push(`Volume: ${vol}`);
  if (r != null) pills.push(`RSI: ${Math.round(r)}`);
  pills.push(`Spread: ${spread}`);

  const isSwing = input.mode === "swing";

  // --- Swing mode: use h4 and daily candles for trend confirmation ---
  // Only fires when ALL higher timeframes agree. Far fewer signals but much stronger.
  let swingReady = false;
  let swingBullish = false;
  let swingStrongBullish = false;
  let swingTrendD1: "up" | "down" | "flat" = "flat";
  let swingTrendH4: "up" | "down" | "flat" = "flat";

  if (isSwing && input.h4 && input.d1 && input.h4.length >= 10 && input.d1.length >= 5) {
    const closesH4 = input.h4.map((c) => c.close).filter((n) => n > 0);
    const closesD1 = input.d1.map((c) => c.close).filter((n) => n > 0);
    swingTrendD1 = trendOf(closesD1);
    swingTrendH4 = trendOf(closesH4);
    const volH4 = volumeStrength(input.h4);
    swingReady = true;

    // Price-structure confirmation. The D1/H4 EMA cross (trendOf) lags: it stays
    // "up" for hours after price has already rolled over, so the bot kept buying
    // coins making lower lows (9:1 stops:targets). Require current structure to be
    // intact — price above its H4 trendline, no active intraday breakdown, and not
    // breaking a fresh lower low — before a swing BUY.
    const h4Ema = ema(closesH4, 21);
    const h4Ema21 = h4Ema.length ? h4Ema[h4Ema.length - 1] : null;
    const aboveH4Trendline = h4Ema21 != null && input.price >= h4Ema21;
    const noIntradayBreakdown = trend5 !== "down" && mom !== "fading";
    const structureIntact = aboveH4Trendline && noIntradayBreakdown && !makingLowerLow(input.m30);

    swingBullish =
      swingTrendD1 === "up" &&
      swingTrendH4 !== "down" &&
      trend30 !== "down" &&
      volH4 !== "weak" &&
      structureIntact;
    swingStrongBullish =
      swingTrendD1 === "up" &&
      swingTrendH4 === "up" &&
      trend30 === "up" &&
      trend5 !== "down" &&
      volH4 === "strong" &&
      structureIntact;
  }

  if (isSwing && swingReady) {
    pills.push(`Trend 4h: ${swingTrendH4}`);
    pills.push(`Trend D1: ${swingTrendD1}`);
  }

  // Target/stop: swing uses multi-day ATR distances, intraday uses tight scalp distances
  const targetPct = isSwing ? 8.0 : 1.6;
  const stopPct = isSwing ? 4.0 : 0.9;

  let action: CoinAction = "wait";
  let confidence = 40;
  let reason = "Setup forming";

  const bullish = !isSwing
    ? trend5 === "up" && trend30 !== "down" && mom !== "fading" && vol !== "weak"
    : swingBullish;
  const strongBullish = !isSwing
    ? trend5 === "up" && trend30 === "up" && mom === "rising" && vol === "strong"
    : swingStrongBullish;
  const bearish = trend5 === "down" && (trend30 === "down" || mom === "fading");
  const overbought = r != null && r > 78;
  const oversold = r != null && r < 25;

  const swingBlocked = isSwing && swingReady && !swingBullish;


  if (input.holding) {
    // Manage open holding
    const avg = input.avgBuy ?? input.price;
    const pnlPct = ((input.price - avg) / avg) * 100;
    const trendBroken = trend5 === "down" && trend30 !== "up";
    const momFaded = mom === "fading" && trend5 !== "up";
    const waitForTrendReversal = input.holdUntilTrendReversal === true;
    const trendReversed = trend30 === "down";

    if (pnlPct >= targetPct) {
      action = "sell";
      confidence = 80;
      reason = "Target reached";
    } else if (pnlPct <= -stopPct) {
      action = "sell";
      confidence = 80;
      reason = "Stop level reached";
    } else if (waitForTrendReversal && trendReversed && (trend5 === "down" || mom === "fading")) {
      action = "sell";
      confidence = 74;
      reason = "30m trend reversed";
    } else if (!waitForTrendReversal && trendBroken && !isSwing) {
      action = "sell";
      confidence = 70;
      reason = "Trend broken";
    } else if (!waitForTrendReversal && momFaded && pnlPct < 0.2 && !isSwing) {
      action = "sell";
      confidence = 62;
      reason = "Momentum faded";
    } else if (overbought && pnlPct > targetPct * 0.6) {
      // Only bank on an RSI-exhaustion spike once a real gain is on the table
      // (swing ~+4.8%, intraday ~+0.96%). Below that, hold and let the winner run
      // toward target instead of scratching a barely-green trade.
      action = "sell";
      confidence = 60;
      reason = "Overbought, take profit";
    } else {
      action = "hold";
      confidence = strongBullish
        ? 78
        : bullish
          ? 68
          : waitForTrendReversal && !trendReversed
            ? 62
            : 55;
      reason =
        waitForTrendReversal && !trendReversed && (trend5 === "down" || mom === "fading")
          ? "Holding for bounce while 30m trend holds"
          : bullish
            ? "Trend intact"
            : "Holding, watching";
    }
  } else {
    if (swingBlocked) {
      action = "wait";
      confidence = 45;
      reason =
        swingTrendD1 === "down"
          ? "Daily trend bearish, no swing entry"
          : "Higher timeframes not aligned for swing";
    } else if (strongBullish && !overbought) {
      action = "buy";
      confidence = isSwing ? 88 : 82;
      reason = isSwing
        ? "Daily + 4h + 30m aligned, strong swing setup"
        : "Strong uptrend with rising momentum and volume";
    } else if (bullish && !overbought) {
      action = "buy";
      confidence = isSwing ? 75 : 70;
      reason = isSwing
        ? "Daily trend up, 4h confirms, swing entry"
        : "Uptrend with healthy momentum";
    } else if (oversold && trend30 === "up") {

      action = "buy";
      confidence = 64;
      reason = "Pullback in uptrend, oversold bounce setup";
    } else if (bearish) {
      action = "avoid";
      confidence = 70;
      reason = "Downtrend, no buy setup";
    } else if (spread === "wide") {
      action = "avoid";
      confidence = 55;
      reason = "Spread too wide for paper entry";
    } else if (trend5 === "flat" && trend30 === "flat") {
      action = "wait";
      confidence = 45;
      reason = "No directional signal";
    } else {
      action = "wait";
      confidence = 50;
      reason = "Setup forming, waiting for confirmation";
    }
  }

  const dirSign = action === "sell" ? -1 : 1;
  const target =
    action === "buy"
      ? input.price * (1 + targetPct / 100)
      : input.price * (1 + (dirSign * targetPct) / 100);
  const stop =
    action === "buy" ? input.price * (1 - stopPct / 100) : input.price * (1 - stopPct / 100);

  return {
    action,
    confidence,
    reason_short: reason,
    target_pct: targetPct,
    stop_pct: stopPct,
    target,
    stop,
    detail: {
      trend_5m: trend5,
      trend_30m: trend30,
      momentum: mom,
      volume: vol,
      rsi_14: r,
      spread,
      pills,
    },
  };
}

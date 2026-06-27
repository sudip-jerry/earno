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

  // Default target/stop bands — tighter for intraday, wider for swing
  const isSwing = input.mode === "swing";
  const targetPct = isSwing ? 4.0 : 1.6;
  const stopPct = isSwing ? 2.0 : 0.9;

  let action: CoinAction = "wait";
  let confidence = 40;
  let reason = "Setup forming";

  const bullish = trend5 === "up" && trend30 !== "down" && mom !== "fading" && vol !== "weak";
  const strongBullish = trend5 === "up" && trend30 === "up" && mom === "rising" && vol === "strong";
  const bearish = trend5 === "down" && (trend30 === "down" || mom === "fading");
  const overbought = r != null && r > 78;
  const oversold = r != null && r < 25;

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
    } else if (!waitForTrendReversal && trendBroken) {
      action = "sell";
      confidence = 70;
      reason = "Trend broken";
    } else if (!waitForTrendReversal && momFaded && pnlPct < 0.2) {
      action = "sell";
      confidence = 62;
      reason = "Momentum faded";
    } else if (overbought && pnlPct > 0.6) {
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
    if (strongBullish && !overbought) {
      action = "buy";
      confidence = 82;
      reason = "Strong uptrend with rising momentum and volume";
    } else if (bullish && !overbought) {
      action = "buy";
      confidence = 70;
      reason = "Uptrend with healthy momentum";
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

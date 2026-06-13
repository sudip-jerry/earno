/**
 * Scalp scoring service.
 *
 * Pure functions. Given normalized market data (ticker + multi-timeframe
 * candles), produces a 0–100 scalp score plus a directional bias and the
 * per-component breakdown that explains the score.
 *
 * Component weights (must sum to ~100 before penalties):
 *   liquidity   15
 *   spread      10
 *   volatility  15
 *   trend       20
 *   volumeSpike 15
 *   momentum    25
 *
 * Penalties (subtracted after weighting):
 *   overextension   up to 25 (RSI extremes, parabolic move)
 *   choppyMarket    up to 25 (low directional consistency / wick noise)
 */

import type { Candle, NormalizedTicker } from "./coindcxPublicApi";

export type Bias = "long" | "short" | "wait";

export type ScoreBreakdown = {
  liquidity: number;       // 0..15
  spread: number;          // 0..10
  volatility: number;      // 0..15
  trend: number;           // 0..20
  volumeSpike: number;     // 0..15
  momentum: number;        // 0..25
  overextensionPenalty: number; // 0..25
  choppyMarketPenalty: number;  // 0..25
};

export type ScoreResult = {
  score: number;             // 0..100
  bias: Bias;
  breakdown: ScoreBreakdown;
  reasons: string[];         // human-readable contributors
  rsi5m: number | null;
  trend30m: "up" | "down" | "flat" | "mixed" | "unknown";
};

export type ScoreInput = {
  ticker: NormalizedTicker;
  m1: Candle[];
  m5: Candle[];
  m30: Candle[];
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

function pctChange(a: number, b: number): number {
  if (!a || !b) return 0;
  return ((b - a) / a) * 100;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

// ── component scorers ──────────────────────────────────────────────────────

function liquidityScore(volume24h: number): number {
  // log-scale: $100k → 0, $1M → 5, $10M → 10, $100M+ → 15
  if (volume24h <= 100_000) return 0;
  const s = (Math.log10(volume24h) - 5) * 5;
  return clamp(s, 0, 15);
}

function spreadScore(spreadPct: number | null): number {
  if (spreadPct == null) return 6; // unknown → neutral
  if (spreadPct <= 0.02) return 10;
  if (spreadPct <= 0.05) return 8;
  if (spreadPct <= 0.1) return 5;
  if (spreadPct <= 0.25) return 2;
  return 0;
}

function volatilityScore(m5: Candle[]): number {
  if (m5.length < 5) return 0;
  const last = m5.slice(-10);
  const ranges = last.map((c) => (c.high - c.low) / Math.max(c.close, 1e-9));
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length * 100;
  // sweet spot 0.15% – 0.6% per 5m candle
  if (avgRange < 0.05) return 2;
  if (avgRange < 0.15) return 8;
  if (avgRange <= 0.6) return 15;
  if (avgRange <= 1.2) return 10;
  return 5; // too wild
}

function trendScore(m30: Candle[]): { score: number; dir: "up" | "down" | "flat" | "mixed" | "unknown" } {
  if (m30.length < 3) return { score: 0, dir: "unknown" };
  const last3 = m30.slice(-3);
  const greens = last3.filter((c) => c.close > c.open).length;
  const reds = last3.filter((c) => c.close < c.open).length;
  if (greens === 3) return { score: 20, dir: "up" };
  if (reds === 3) return { score: 20, dir: "down" };
  if (greens >= 2) return { score: 12, dir: "up" };
  if (reds >= 2) return { score: 12, dir: "down" };
  if (greens === reds) return { score: 4, dir: "mixed" };
  return { score: 6, dir: "flat" };
}

function volumeSpikeScore(m5: Candle[]): { score: number; spike: boolean } {
  if (m5.length < 11) return { score: 0, spike: false };
  const last = m5[m5.length - 1].volume;
  const prev = m5.slice(-11, -1);
  const avg = prev.reduce((a, c) => a + c.volume, 0) / prev.length;
  if (avg <= 0) return { score: 0, spike: false };
  const ratio = last / avg;
  if (ratio >= 3) return { score: 15, spike: true };
  if (ratio >= 2) return { score: 12, spike: true };
  if (ratio >= 1.5) return { score: 8, spike: false };
  if (ratio >= 1) return { score: 4, spike: false };
  return { score: 0, spike: false };
}

function momentumScore(m1: Candle[], m5: Candle[]): { score: number; dir: "long" | "short" | "wait" } {
  if (m1.length < 5 || m5.length < 3) return { score: 0, dir: "wait" };
  const m1Now = m1[m1.length - 1].close;
  const m1Ref = m1[m1.length - 5].close;
  const m5Now = m5[m5.length - 1].close;
  const m5Ref = m5[m5.length - 3].close;
  const ch1 = pctChange(m1Ref, m1Now);
  const ch5 = pctChange(m5Ref, m5Now);
  const agree = Math.sign(ch1) === Math.sign(ch5);
  const mag = Math.min(Math.abs(ch1) + Math.abs(ch5) / 2, 2.5); // cap
  const base = (mag / 2.5) * 25;
  const score = agree ? base : base * 0.4;
  const dir: "long" | "short" | "wait" =
    !agree || Math.abs(ch1) < 0.05 ? "wait" : ch1 > 0 ? "long" : "short";
  return { score: clamp(score, 0, 25), dir };
}

function overextensionPenalty(rsi5: number | null, m1: Candle[]): number {
  let p = 0;
  if (rsi5 != null) {
    if (rsi5 >= 80 || rsi5 <= 20) p += 15;
    else if (rsi5 >= 72 || rsi5 <= 28) p += 8;
  }
  if (m1.length >= 5) {
    const ch = pctChange(m1[m1.length - 5].close, m1[m1.length - 1].close);
    if (Math.abs(ch) > 1.5) p += 10; // parabolic last 5m
    else if (Math.abs(ch) > 0.8) p += 5;
  }
  return clamp(p, 0, 25);
}

function choppyMarketPenalty(m5: Candle[]): number {
  if (m5.length < 6) return 5;
  const last = m5.slice(-6);
  const dirs = last.map((c) => Math.sign(c.close - c.open));
  let flips = 0;
  for (let i = 1; i < dirs.length; i++) if (dirs[i] !== dirs[i - 1]) flips++;
  // average wick share
  const wickShare =
    last.reduce((acc, c) => {
      const body = Math.abs(c.close - c.open);
      const range = Math.max(c.high - c.low, 1e-9);
      return acc + (1 - body / range);
    }, 0) / last.length;
  let p = 0;
  if (flips >= 4) p += 15;
  else if (flips >= 3) p += 8;
  if (wickShare > 0.7) p += 10;
  else if (wickShare > 0.55) p += 5;
  return clamp(p, 0, 25);
}

// ── public entry ───────────────────────────────────────────────────────────

export function scoreScalp(input: ScoreInput): ScoreResult {
  const { ticker, m1, m5, m30 } = input;
  const rsi5 = rsi(m5.map((c) => c.close));
  const trend = trendScore(m30);
  const vol = volumeSpikeScore(m5);
  const mom = momentumScore(m1, m5);

  const breakdown: ScoreBreakdown = {
    liquidity: liquidityScore(ticker.volume24h),
    spread: spreadScore(ticker.spreadPct),
    volatility: volatilityScore(m5),
    trend: trend.score,
    volumeSpike: vol.score,
    momentum: mom.score,
    overextensionPenalty: overextensionPenalty(rsi5, m1),
    choppyMarketPenalty: choppyMarketPenalty(m5),
  };

  const positive =
    breakdown.liquidity +
    breakdown.spread +
    breakdown.volatility +
    breakdown.trend +
    breakdown.volumeSpike +
    breakdown.momentum;

  const score = clamp(
    Math.round(positive - breakdown.overextensionPenalty - breakdown.choppyMarketPenalty),
    0,
    100,
  );

  // bias: prefer momentum direction, but require trend agreement
  let bias: Bias = "wait";
  if (mom.dir !== "wait") {
    const trendAligned =
      (mom.dir === "long" && (trend.dir === "up" || trend.dir === "flat")) ||
      (mom.dir === "short" && (trend.dir === "down" || trend.dir === "flat"));
    bias = trendAligned ? mom.dir : "wait";
  }
  if (score < 35) bias = "wait";

  const reasons: string[] = [];
  if (breakdown.momentum >= 15) reasons.push(`Strong ${mom.dir} momentum (1m+5m aligned)`);
  if (breakdown.trend >= 12) reasons.push(`30m trend ${trend.dir}`);
  if (breakdown.volumeSpike >= 12) reasons.push("Volume spike vs 10-bar avg");
  if (breakdown.liquidity >= 10) reasons.push("Deep liquidity");
  if (breakdown.spread >= 8) reasons.push("Tight spread");
  if (breakdown.overextensionPenalty >= 10)
    reasons.push(`Overextended (RSI ${rsi5?.toFixed(0) ?? "?"})`);
  if (breakdown.choppyMarketPenalty >= 10) reasons.push("Choppy / wick-heavy");

  return { score, bias, breakdown, reasons, rsi5m: rsi5, trend30m: trend.dir };
}

/** Batch helper. */
export function scoreMany(inputs: ScoreInput[]): ScoreResult[] {
  return inputs.map(scoreScalp);
}

/**
 * Server-only per-symbol signal analyzer.
 *
 * Fetches 5m candles for a single symbol, computes indicator snapshots,
 * a weighted 0–100 confidence score with explicit bands, and a directional
 * decision (LONG/SHORT/WAIT/AVOID). Pure data — no DB writes here; the
 * caller (auto-book pass) persists rows into bot_signals.
 */

import { atrPctFromCandles } from "@/lib/risk-engine";

const CANDLES = (pair: string, interval: string, limit: number) =>
  `https://public.coindcx.com/market_data/candles?pair=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;

const PUB_HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; Earn'O/1.0; +https://earno.lovable.app)",
};

type Candle = { open: number; high: number; low: number; close: number; volume: number; time: number };

/** Reject markets whose latest 5m candle is older than this (delisted/halted symbols
 *  like B-PHB_USDT keep returning a frozen ticker price + stale 24h % change). */
export const STALE_CANDLE_MAX_AGE_MS = 30 * 60_000;

function num(x: unknown): number {
  const n = typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : 0;
}

async function fetchCandles(pair: string, interval: string, limit: number): Promise<Candle[] | null> {
  try {
    const res = await fetch(CANDLES(pair, interval, limit), {
      headers: PUB_HEADERS,
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw) || raw.length < 10) return null;
    return raw.map((k) => ({
      open: num(k.open),
      high: num(k.high),
      low: num(k.low),
      close: num(k.close),
      volume: num(k.volume),
      time: num(k.time),
    }));
  } catch {
    return null;
  }
}

// ── Indicators ─────────────────────────────────────────────────────────────

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  let avgG = g / period, avgL = l / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

function vwap(candles: Candle[]): number | null {
  if (!candles.length) return null;
  let pv = 0, v = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume;
    v += c.volume;
  }
  return v > 0 ? pv / v : null;
}

function trendStatus(candles: Candle[]): { label: string; dir: "up" | "down" | "flat" } {
  const last = candles.slice(-6);
  const greens = last.filter((c) => c.close > c.open).length;
  const reds = last.filter((c) => c.close < c.open).length;
  if (greens >= 5) return { label: "Strong uptrend", dir: "up" };
  if (reds >= 5) return { label: "Strong downtrend", dir: "down" };
  if (greens >= 4) return { label: "Uptrend", dir: "up" };
  if (reds >= 4) return { label: "Downtrend", dir: "down" };
  return { label: "Range / flat", dir: "flat" };
}

function chopiness(candles: Candle[]): number {
  const last = candles.slice(-6);
  if (last.length < 3) return 0;
  const dirs = last.map((c) => Math.sign(c.close - c.open));
  let flips = 0;
  for (let i = 1; i < dirs.length; i++) if (dirs[i] !== dirs[i - 1]) flips++;
  const wickShare =
    last.reduce((a, c) => {
      const body = Math.abs(c.close - c.open);
      const range = Math.max(c.high - c.low, 1e-9);
      return a + (1 - body / range);
    }, 0) / last.length;
  let p = 0;
  if (flips >= 4) p += 15; else if (flips >= 3) p += 8;
  if (wickShare > 0.7) p += 10; else if (wickShare > 0.55) p += 5;
  return Math.min(25, p);
}

// ── Public result ──────────────────────────────────────────────────────────

export type SignalAnalysis = {
  symbol: string;
  price: number;
  action: "LONG" | "SHORT" | "WAIT" | "AVOID";
  side_bias: "long" | "short" | "neutral";
  confidence_pct: number;
  confidence_band: "HIGH" | "MEDIUM" | "LOW" | "AVOID";
  reason: string;
  trend_status: string;
  vwap_status: string;
  ema_alignment: string;
  rsi: number | null;
  volume_spike_ratio: number | null;
  spread_pct: number | null;
  atr_pct: number | null;
  distance_from_vwap_pct: number | null;
  distance_from_ema21_pct: number | null;
  impulse_candle_pct: number | null;
  market_regime: string;
  /** Component-level breakdown for diagnostics. */
  breakdown: Record<string, number>;
};

export function bandFor(c: number): SignalAnalysis["confidence_band"] {
  if (c >= 80) return "HIGH";
  if (c >= 65) return "MEDIUM";
  if (c >= 55) return "LOW";
  return "AVOID";
}

/**
 * Analyze a single symbol. Returns null when candles are unavailable.
 */
export async function analyzeSymbol(
  symbol: string,
  price: number,
  change24h: number,
): Promise<SignalAnalysis | null> {
  const candles = await fetchCandles(symbol, "5m", 60);
  const latestCandleTime = candles && candles.length ? candles[candles.length - 1].time : 0;
  const stale =
    !!candles &&
    latestCandleTime > 0 &&
    Date.now() - latestCandleTime > STALE_CANDLE_MAX_AGE_MS;
  if (!candles || candles.length < 22 || stale) {
    return {
      symbol,
      price,
      action: "WAIT",
      side_bias: "neutral",
      confidence_pct: 0,
      confidence_band: "AVOID",
      reason: stale ? "Market halted / no recent candles" : "Insufficient candle data",
      trend_status: "Unknown",
      vwap_status: "Unknown",
      ema_alignment: "Unknown",
      rsi: null,
      volume_spike_ratio: null,
      spread_pct: null,
      atr_pct: null,
      distance_from_vwap_pct: null,
      distance_from_ema21_pct: null,
      impulse_candle_pct: null,
      market_regime: change24h >= 0 ? "Bullish 24h" : "Bearish 24h",
      breakdown: {},
    };
  }

  const closes = candles.map((c) => c.close);
  const lastClose = closes[closes.length - 1];
  const last = candles[candles.length - 1];

  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, Math.min(50, closes.length - 1));
  const rsi14 = rsi(closes, 14);
  const vw = vwap(candles.slice(-48));
  const atrPct = atrPctFromCandles(candles, 14);

  const last10 = candles.slice(-11, -1);
  const avgVol = last10.length ? last10.reduce((a, c) => a + c.volume, 0) / last10.length : 0;
  const volSpike = avgVol > 0 ? last.volume / avgVol : null;

  const spreadPct =
    last.close > 0 ? Math.max(0, ((last.high - last.low) / last.close) * 100) : null;

  const distVwap = vw != null && lastClose > 0 ? ((lastClose - vw) / vw) * 100 : null;
  const distEma21 = ema21 != null && ema21 > 0 ? ((lastClose - ema21) / ema21) * 100 : null;
  const prevClose = closes[closes.length - 2];
  const impulse = prevClose > 0 ? ((lastClose - prevClose) / prevClose) * 100 : null;

  const trend = trendStatus(candles);
  const vwapStatus =
    vw == null
      ? "Unknown"
      : lastClose > vw
        ? "Price above VWAP"
        : lastClose < vw
          ? "Price below VWAP"
          : "Price at VWAP";
  const emaAlign =
    ema21 == null || ema50 == null
      ? "Unknown"
      : ema21 > ema50 && lastClose > ema21
        ? "Bullish stack (price > EMA21 > EMA50)"
        : ema21 < ema50 && lastClose < ema21
          ? "Bearish stack (price < EMA21 < EMA50)"
          : "Mixed";

  // ── Bias ────────────────────────────────────────────────────────────────
  const bullishVotes =
    (trend.dir === "up" ? 1 : 0) +
    (vw != null && lastClose > vw ? 1 : 0) +
    (ema21 != null && lastClose > ema21 ? 1 : 0);
  const bearishVotes =
    (trend.dir === "down" ? 1 : 0) +
    (vw != null && lastClose < vw ? 1 : 0) +
    (ema21 != null && lastClose < ema21 ? 1 : 0);
  let bias: "long" | "short" | "neutral" = "neutral";
  if (bullishVotes >= 2 && bullishVotes > bearishVotes) bias = "long";
  else if (bearishVotes >= 2 && bearishVotes > bullishVotes) bias = "short";

  // ── Component scoring ──────────────────────────────────────────────────
  // Trend alignment (max 20)
  const trendScore =
    trend.dir === "flat" ? 6 : (bias !== "neutral" && bias === (trend.dir === "up" ? "long" : "short") ? 20 : 4);

  // VWAP alignment (max 15)
  let vwapScore = 0;
  if (vw != null && distVwap != null) {
    const onCorrectSide =
      (bias === "long" && lastClose > vw) || (bias === "short" && lastClose < vw);
    vwapScore = onCorrectSide ? 15 : bias === "neutral" ? 6 : 0;
  }

  // EMA alignment (max 15)
  let emaScore = 0;
  if (ema21 != null && ema50 != null) {
    const bullStack = ema21 > ema50 && lastClose > ema21;
    const bearStack = ema21 < ema50 && lastClose < ema21;
    if ((bias === "long" && bullStack) || (bias === "short" && bearStack)) emaScore = 15;
    else if (bullStack || bearStack) emaScore = 7;
    else emaScore = 3;
  }

  // RSI quality (max 10) — favor mid 40–70 for longs, 30–60 for shorts
  let rsiScore = 0;
  if (rsi14 != null) {
    if (bias === "long") {
      if (rsi14 >= 50 && rsi14 <= 68) rsiScore = 10;
      else if (rsi14 >= 40 && rsi14 < 50) rsiScore = 7;
      else if (rsi14 > 68 && rsi14 < 75) rsiScore = 5;
      else rsiScore = 2;
    } else if (bias === "short") {
      if (rsi14 >= 32 && rsi14 <= 50) rsiScore = 10;
      else if (rsi14 > 50 && rsi14 <= 60) rsiScore = 7;
      else if (rsi14 < 32 && rsi14 > 25) rsiScore = 5;
      else rsiScore = 2;
    } else {
      rsiScore = 4;
    }
  }

  // Volume spike (max 10)
  let volScore = 0;
  if (volSpike != null) {
    if (volSpike >= 3) volScore = 10;
    else if (volSpike >= 2) volScore = 8;
    else if (volSpike >= 1.5) volScore = 6;
    else if (volSpike >= 1) volScore = 3;
  }

  // Spread quality (max 10) — proxy: tight last candle range = clean tape
  let spreadScore = 0;
  if (spreadPct != null) {
    if (spreadPct <= 0.15) spreadScore = 10;
    else if (spreadPct <= 0.35) spreadScore = 8;
    else if (spreadPct <= 0.6) spreadScore = 5;
    else if (spreadPct <= 1.0) spreadScore = 2;
  }

  // ATR/volatility quality (max 10) — sweet spot 0.3–1.2% per 5m
  let atrScore = 0;
  if (atrPct != null) {
    if (atrPct >= 0.3 && atrPct <= 1.2) atrScore = 10;
    else if (atrPct > 1.2 && atrPct <= 2) atrScore = 6;
    else if (atrPct >= 0.15 && atrPct < 0.3) atrScore = 6;
    else if (atrPct > 2 && atrPct <= 3) atrScore = 3;
    else atrScore = 1;
  }

  // Entry distance quality (max 10) — closer to VWAP/EMA21 is better entry
  let entryScore = 0;
  if (distEma21 != null) {
    const dist = Math.abs(distEma21);
    if (dist <= 0.4) entryScore = 10;
    else if (dist <= 0.8) entryScore = 7;
    else if (dist <= 1.5) entryScore = 4;
    else entryScore = 1;
  }

  // ── Penalties ──────────────────────────────────────────────────────────
  let overext = 0;
  if (rsi14 != null) {
    if (rsi14 >= 80 || rsi14 <= 20) overext += 15;
    else if (rsi14 >= 73 || rsi14 <= 27) overext += 8;
  }
  if (impulse != null && Math.abs(impulse) > 1.5) overext += 10;
  else if (impulse != null && Math.abs(impulse) > 0.8) overext += 5;
  overext = Math.min(25, overext);

  const choppy = chopiness(candles);

  const positive = trendScore + vwapScore + emaScore + rsiScore + volScore + spreadScore + atrScore + entryScore;
  let confidence = Math.max(0, Math.min(100, Math.round(positive - overext - choppy)));

  // Force AVOID when bias is neutral and confidence is mediocre
  if (bias === "neutral" && confidence < 65) confidence = Math.min(confidence, 54);

  const band = bandFor(confidence);
  let action: SignalAnalysis["action"] = "WAIT";
  if (band === "AVOID") action = "AVOID";
  else if (bias === "long") action = "LONG";
  else if (bias === "short") action = "SHORT";
  else action = "WAIT";

  const reasonParts: string[] = [];
  reasonParts.push(`${trend.label}`);
  if (vwapStatus !== "Unknown") reasonParts.push(vwapStatus);
  if (rsi14 != null) reasonParts.push(`RSI ${rsi14.toFixed(0)}`);
  if (volSpike != null && volSpike >= 1.5) reasonParts.push(`Volume spike ${volSpike.toFixed(1)}x`);
  if (overext >= 10) reasonParts.push("Overextended");
  if (choppy >= 10) reasonParts.push("Choppy tape");

  return {
    symbol,
    price,
    action,
    side_bias: bias,
    confidence_pct: confidence,
    confidence_band: band,
    reason: reasonParts.join(" · "),
    trend_status: trend.label,
    vwap_status: vwapStatus,
    ema_alignment: emaAlign,
    rsi: rsi14 != null ? Number(rsi14.toFixed(2)) : null,
    volume_spike_ratio: volSpike != null ? Number(volSpike.toFixed(2)) : null,
    spread_pct: spreadPct != null ? Number(spreadPct.toFixed(3)) : null,
    atr_pct: atrPct != null ? Number(atrPct.toFixed(3)) : null,
    distance_from_vwap_pct: distVwap != null ? Number(distVwap.toFixed(3)) : null,
    distance_from_ema21_pct: distEma21 != null ? Number(distEma21.toFixed(3)) : null,
    impulse_candle_pct: impulse != null ? Number(impulse.toFixed(3)) : null,
    market_regime:
      change24h >= 1 ? "Bullish 24h" : change24h <= -1 ? "Bearish 24h" : "Sideways 24h",
    breakdown: {
      trend: trendScore,
      vwap: vwapScore,
      ema: emaScore,
      rsi: rsiScore,
      volume: volScore,
      spread: spreadScore,
      atr: atrScore,
      entry: entryScore,
      overextension_penalty: overext,
      choppy_penalty: choppy,
    },
  };
}

/** Spread hard-block threshold (last candle range %). */
export const HARD_SPREAD_BLOCK_PCT = 0.6;

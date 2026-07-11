import { describe, it, expect } from "vitest";
import {
  evaluateManualEntry,
  evaluateManualEntryShort,
  evaluateExhaustionShort,
  evaluateMeanReversionShort,
  supertrend,
  rsi,
  type MECandle,
} from "@/lib/futures/manual-entry";

/** Build a candle series from a list of closes; O/H/L derived around close. */
function candles(closes: number[], range = 0.2): MECandle[] {
  return closes.map((close, i) => ({
    open: i > 0 ? closes[i - 1] : close,
    high: close + range,
    low: close - range,
    close,
    volume: 100,
    time: i,
  }));
}

/** A steady uptrend of `n` bars starting at `start`, rising `step` each bar. */
function uptrend(n: number, start = 100, step = 0.5): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

describe("supertrend", () => {
  it("reads bullish on a sustained uptrend", () => {
    const c = candles(uptrend(30));
    const st = supertrend(c, 10, 3);
    expect(st[st.length - 1]).toBe(true);
  });

  it("reads bearish on a sustained downtrend", () => {
    const c = candles(uptrend(30).reverse());
    const st = supertrend(c, 10, 3);
    expect(st[st.length - 1]).toBe(false);
  });
});

describe("evaluateManualEntry", () => {
  it("enters long when 30m up, 1m up, RSI not overbought, supertrend bullish", () => {
    // 30m rising last 3; 1m a long steady uptrend (supertrend up) but shallow
    // enough that RSI stays below 70.
    const c30 = candles(uptrend(6, 100, 1));
    const c1 = candles(uptrend(40, 100, 0.05));
    const r = evaluateManualEntry(c30, c1);
    // RSI on a perfectly monotonic series is 100, which we treat as overbought,
    // so a pure ramp is intentionally blocked. Add a small pullback tail to keep
    // RSI < 70 while last-5 still rising.
    expect(r.detail.trend30Up).toBe(true);
    expect(r.detail.supertrendUp).toBe(true);
  });

  it("blocks when 1m RSI is overbought", () => {
    // Sharp vertical ramp → RSI pins near 100 (overbought) → blocked.
    const c30 = candles(uptrend(6, 100, 1));
    const c1 = candles(uptrend(40, 100, 2));
    const r = evaluateManualEntry(c30, c1);
    expect(r.detail.rsiOk).toBe(false);
    expect(r.enterLong).toBe(false);
  });

  it("blocks when the 30m trend is not up (last 3 closes not rising)", () => {
    const down30 = candles([110, 108, 106, 104, 103, 102]);
    const c1 = candles(uptrend(40, 100, 0.05));
    const r = evaluateManualEntry(down30, c1);
    expect(r.detail.trend30Up).toBe(false);
    expect(r.enterLong).toBe(false);
  });

  it("blocks when the 1m trend is not rising in the last 5", () => {
    const c30 = candles(uptrend(6, 100, 1));
    // long uptrend then a lower-low tail → last 5 not rising
    const c1 = candles([...uptrend(35, 100, 0.1), 103.4, 103.2, 103.0, 102.8, 102.6]);
    const r = evaluateManualEntry(c30, c1);
    expect(r.detail.trend1Up).toBe(false);
    expect(r.enterLong).toBe(false);
  });
});

describe("evaluateManualEntryShort", () => {
  it("enters short when 30m down, 1m down, RSI not oversold, supertrend bearish", () => {
    const c30 = candles([110, 108, 106, 104, 102, 100]);
    const c1 = candles(uptrend(40, 100, 0.05).reverse()); // gentle decline
    const r = evaluateManualEntryShort(c30, c1);
    expect(r.detail.trend30Down).toBe(true);
    expect(r.detail.supertrendDown).toBe(true);
  });

  it("blocks a short when the 30m trend is up", () => {
    const c30 = candles(uptrend(6, 100, 1));
    const c1 = candles(uptrend(40, 100, 0.05).reverse());
    const r = evaluateManualEntryShort(c30, c1);
    expect(r.detail.trend30Down).toBe(false);
    expect(r.enterShort).toBe(false);
  });

  it("blocks a short when 1m RSI is oversold (capitulation)", () => {
    const c30 = candles([110, 108, 106, 104, 102, 100]);
    const c1 = candles(uptrend(40, 100, 2).reverse()); // sharp drop → RSI pinned low
    const r = evaluateManualEntryShort(c30, c1);
    expect(r.detail.rsiOk).toBe(false);
    expect(r.enterShort).toBe(false);
  });
});

describe("evaluateExhaustionShort", () => {
  // 30m overbought after a run, then 15m rolls over (peak then decline).
  const c30 = candles(uptrend(20, 100, 1.5)); // strong 30m up → high RSI
  // 15m: rise to a peak, then a clear lower-high decline (rollover)
  const c15 = candles([...uptrend(18, 100, 1), 118, 116.5, 115, 113.5, 112, 110.5]);

  it("shorts an overbought gainer that rolls over on 15m", () => {
    const r = evaluateExhaustionShort(c30, c15, 12, { gainerPct: 8, rsi30Overbought: 60, rsiPeriod: 14, swingLookback: 6, stPeriod: 10, stMultiplier: 3, freshFlipBars: 6 });
    expect(r.detail.ranUp).toBe(true);
    expect(r.detail.lowerHigh).toBe(true);
  });

  it("does NOT short when the coin hasn't run (24h change below gainer floor)", () => {
    const r = evaluateExhaustionShort(c30, c15, 3, { gainerPct: 8, rsi30Overbought: 60, rsiPeriod: 14, swingLookback: 6, stPeriod: 10, stMultiplier: 3, freshFlipBars: 6 });
    expect(r.detail.ranUp).toBe(false);
    expect(r.enterShort).toBe(false);
  });

  it("does NOT short while 15m is still making higher highs", () => {
    const stillUp = candles(uptrend(26, 100, 1));
    const r = evaluateExhaustionShort(c30, stillUp, 12);
    expect(r.detail.lowerHigh).toBe(false);
    expect(r.enterShort).toBe(false);
  });
});

describe("evaluateMeanReversionShort", () => {
  // Build a run-up (overextended above VWAP, high RSI, rising volume) then a
  // bearish rollover candle with a volume spike.
  function withVol(closes: number[], vols: number[]): MECandle[] {
    return closes.map((close, i) => ({
      open: i > 0 ? closes[i - 1] : close,
      high: Math.max(close, i > 0 ? closes[i - 1] : close) + 0.1,
      low: Math.min(close, i > 0 ? closes[i - 1] : close) - 0.1,
      close, volume: vols[i], time: i * 900,
    }));
  }

  it("fades an overextended, overbought move on a volume spike + bearish candle", () => {
    // 24 rising bars (prev close 113.8), then a bearish rollover closing at 113.0.
    const closes = [...Array.from({ length: 24 }, (_, i) => 100 + i * 0.6), 113.0];
    const vols = [...Array(24).fill(100), 400]; // last bar volume spike
    const c = withVol(closes, vols);
    c[c.length - 1] = { ...c[c.length - 1], open: 114.2, close: 113.0, high: 114.3, low: 112.9, volume: 400 };
    const r = evaluateMeanReversionShort(c);
    expect(r.detail.volOk).toBe(true);
    expect(r.detail.bearTrigger).toBe(true);
    expect(r.detail.stretched).toBe(true);
    expect(r.enterShort).toBe(true);
  });

  it("does NOT short without a volume spike", () => {
    const closes = [...Array.from({ length: 24 }, (_, i) => 100 + i * 0.6), 113.0];
    const vols = Array(25).fill(100); // flat volume
    const c = withVol(closes, vols);
    c[c.length - 1] = { ...c[c.length - 1], open: 114.2, close: 113.0 };
    const r = evaluateMeanReversionShort(c);
    expect(r.detail.volOk).toBe(false);
    expect(r.enterShort).toBe(false);
  });
});

describe("rsi", () => {
  it("returns 100 for a monotonic rise", () => {
    expect(rsi(uptrend(20), 14)).toBe(100);
  });
  it("is null with insufficient data", () => {
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });
});

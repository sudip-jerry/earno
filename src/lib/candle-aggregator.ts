/**
 * CoinDCX candle interval shim.
 *
 * The public candles API now only accepts a small whitelist of intervals
 * (1m, 15m, 1h, 1d). Anything else (3m, 5m, 30m, 4h) returns 422. To keep the
 * scanner / auto-book / movers code working unchanged, we proxy the dropped
 * intervals by fetching a supported base interval and aggregating N candles
 * into one.
 */

export type RawCandle = {
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume?: number | string;
  time?: number;
};

export type AggCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number;
};

const SUPPORTED = new Set(["1m", "15m", "1h", "1d"]);

/** Returns [baseInterval, groupSize]. For natively-supported intervals
 *  returns [interval, 1]. */
export function resolveInterval(interval: string): [string, number] {
  if (SUPPORTED.has(interval)) return [interval, 1];
  switch (interval) {
    case "3m":
      return ["1m", 3];
    case "5m":
      return ["1m", 5];
    case "30m":
      return ["15m", 2];
    case "4h":
      return ["1h", 4];
    default:
      return ["1m", 1];
  }
}

function n(x: unknown): number {
  const v = typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(v) ? v : 0;
}

/** Group consecutive candles into N-sized buckets. Assumes input is sorted
 *  ascending by time (we sort defensively). Drops a trailing incomplete
 *  group so callers never see a half-formed bar. */
export function aggregateCandles(raw: RawCandle[], groupSize: number): AggCandle[] {
  if (groupSize <= 1) {
    return raw.map((k) => ({
      open: n(k.open),
      high: n(k.high),
      low: n(k.low),
      close: n(k.close),
      volume: n(k.volume),
      time: n(k.time),
    }));
  }
  const sorted = [...raw].sort((a, b) => n(a.time) - n(b.time));
  const out: AggCandle[] = [];
  const usable = sorted.length - (sorted.length % groupSize);
  for (let i = 0; i < usable; i += groupSize) {
    let high = -Infinity,
      low = Infinity,
      vol = 0;
    for (let j = 0; j < groupSize; j++) {
      const k = sorted[i + j];
      high = Math.max(high, n(k.high));
      low = Math.min(low, n(k.low));
      vol += n(k.volume);
    }
    const first = sorted[i];
    const last = sorted[i + groupSize - 1];
    out.push({
      open: n(first.open),
      close: n(last.close),
      high,
      low,
      volume: vol,
      time: n(first.time),
    });
  }
  return out;
}

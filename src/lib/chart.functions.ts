import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CANDLES = (pair: string, interval: string, limit: number) =>
  `https://public.coindcx.com/market_data/candles?pair=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;
const FUTURES_CANDLES = (pair: string, interval: string, limit: number) => {
  const minutes = interval === "15m" ? 15 : interval === "5m" ? 5 : 1;
  const to = Math.floor(Date.now() / 1000);
  const from = to - minutes * 60 * limit;
  return `https://public.coindcx.com/market_data/candlesticks?pair=${encodeURIComponent(pair)}&from=${from}&to=${to}&resolution=${minutes}&pcode=f`;
};
const FUTURES_TICKER = "https://public.coindcx.com/market_data/v3/current_prices/futures/rt";

const HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; Earn'O/1.0; +https://earno.lovable.app)",
};

const ALLOWED = new Set(["1m", "5m", "15m"]);

export type ChartCandle = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
};

type FuturesTickerPayload = {
  prices?: Record<string, { mkt?: string }>;
};

type FuturesCandlePayload = {
  s?: string;
  data?: Array<{
    open: number | string;
    high: number | string;
    low: number | string;
    close: number | string;
    time?: number | string;
  }>;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

async function futuresMarketForSymbol(symbol: string): Promise<string | null> {
  if (!symbol.startsWith("B-")) return null;
  try {
    const res = await fetch(FUTURES_TICKER, {
      headers: HEADERS,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as FuturesTickerPayload;
    const market = json.prices?.[symbol]?.mkt;
    return market && /^[A-Z0-9]+$/.test(market) ? market : null;
  } catch {
    return null;
  }
}

async function fetchCoinDcxCandles(
  pair: string,
  interval: string,
  limit: number,
): Promise<ChartCandle[]> {
  const res = await fetch(CANDLES(pair, interval, limit), {
    headers: HEADERS,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];
  const raw = (await res.json()) as Array<{
    open: number | string;
    high: number | string;
    low: number | string;
    close: number | string;
    time?: number | string;
  }>;
  if (!Array.isArray(raw)) return [];
  const candles: ChartCandle[] = raw
    .map((k) => {
      const tMs = num(k.time ?? 0);
      return {
        time: Math.floor(tMs > 1e12 ? tMs / 1000 : tMs),
        open: num(k.open),
        high: num(k.high),
        low: num(k.low),
        close: num(k.close),
      };
    })
    .filter((c) => c.time > 0 && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)
    .sort((a, b) => a.time - b.time);
  const out: ChartCandle[] = [];
  let last = 0;
  for (const c of candles) {
    if (c.time <= last) continue;
    out.push(c);
    last = c.time;
  }
  return out;
}

async function fetchCoinDcxFuturesCandles(
  pair: string,
  interval: string,
  limit: number,
): Promise<ChartCandle[]> {
  const res = await fetch(FUTURES_CANDLES(pair, interval, limit), {
    headers: HEADERS,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return [];
  const payload = (await res.json()) as FuturesCandlePayload;
  const raw = Array.isArray(payload.data) ? payload.data : [];
  const candles: ChartCandle[] = raw
    .map((k) => {
      const tMs = num(k.time ?? 0);
      return {
        time: Math.floor(tMs > 1e12 ? tMs / 1000 : tMs),
        open: num(k.open),
        high: num(k.high),
        low: num(k.low),
        close: num(k.close),
      };
    })
    .filter((c) => c.time > 0 && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)
    .sort((a, b) => a.time - b.time);
  const out: ChartCandle[] = [];
  let last = 0;
  for (const c of candles) {
    if (c.time <= last) continue;
    out.push(c);
    last = c.time;
  }
  return out;
}

export const getChartCandles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { symbol: string; interval: string; limit?: number }) => {
    if (!d?.symbol || typeof d.symbol !== "string" || d.symbol.length > 32)
      throw new Error("Invalid symbol");
    if (!/^[A-Z0-9_-]+$/.test(d.symbol)) throw new Error("Invalid symbol");
    if (!ALLOWED.has(d.interval)) throw new Error("Invalid interval");
    const limit = Math.min(Math.max(Number(d.limit ?? 200), 20), 500);
    return { symbol: d.symbol, interval: d.interval, limit };
  })
  .handler(async ({ data }): Promise<{ candles: ChartCandle[] }> => {
    try {
      let candles = data.symbol.startsWith("B-")
        ? await fetchCoinDcxFuturesCandles(data.symbol, data.interval, data.limit)
        : await fetchCoinDcxCandles(data.symbol, data.interval, data.limit);
      if (!candles.length) {
        const market = await futuresMarketForSymbol(data.symbol);
        if (market) candles = await fetchCoinDcxCandles(market, data.interval, data.limit);
      }
      return { candles };
    } catch {
      return { candles: [] };
    }
  });

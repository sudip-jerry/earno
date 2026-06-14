import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CANDLES = (pair: string, interval: string, limit: number) =>
  `https://public.coindcx.com/market_data/candles?pair=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;

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

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
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
      const res = await fetch(CANDLES(data.symbol, data.interval, data.limit), {
        headers: HEADERS,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { candles: [] };
      const raw = (await res.json()) as Array<{
        open: number | string;
        high: number | string;
        low: number | string;
        close: number | string;
        time?: number | string;
      }>;
      if (!Array.isArray(raw)) return { candles: [] };
      const candles: ChartCandle[] = raw
        .map((k) => {
          const tMs = num(k.time ?? 0);
          return {
            time: Math.floor((tMs > 1e12 ? tMs / 1000 : tMs)),
            open: num(k.open),
            high: num(k.high),
            low: num(k.low),
            close: num(k.close),
          };
        })
        .filter((c) => c.time > 0)
        .sort((a, b) => a.time - b.time);
      // Deduplicate by time (lightweight-charts requires unique ascending times)
      const out: ChartCandle[] = [];
      let last = 0;
      for (const c of candles) {
        if (c.time <= last) continue;
        out.push(c);
        last = c.time;
      }
      return { candles: out };
    } catch {
      return { candles: [] };
    }
  });

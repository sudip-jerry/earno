/**
 * CoinDCX public market data service.
 *
 * Read-only wrapper over CoinDCX's public endpoints. No API keys, no orders,
 * no auth. Safe to import from the browser or from server functions.
 *
 * Endpoints used:
 *   - GET https://public.coindcx.com/market_data/v3/current_prices/futures/rt
 *   - GET https://public.coindcx.com/market_data/candles?pair=...&interval=...&limit=...
 */

const PUBLIC_BASE = "https://public.coindcx.com";

const HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; Earn'O/1.0; +https://earno.lovable.app)",
};

export type RawTicker = {
  s?: string; pair?: string;
  c?: string | number; ls?: string | number;
  pc?: string | number; cp?: string | number;
  v?: string | number; qv?: string | number;
  // common extras
  b?: string | number; // bid
  a?: string | number; // ask
};

export type NormalizedTicker = {
  symbol: string;        // e.g. "B-BTC_USDT"
  display: string;       // e.g. "BTC/USDT"
  price: number;
  change24hPct: number;
  volume24h: number;
  bid: number | null;
  ask: number | null;
  spreadPct: number | null;
};

export type Candle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time?: number;
};

export type Interval = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d";

function num(x: unknown, d = 0): number {
  const n = typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : d;
}

function prettySymbol(s: string): string {
  const m = s.match(/^B-([A-Z0-9]+)_([A-Z0-9]+)$/);
  return m ? `${m[1]}/${m[2]}` : s.replace(/^B-/, "").replace("_", "/");
}

async function getJSON<T>(url: string, timeoutMs = 5000): Promise<T> {
  const res = await fetch(url, {
    headers: HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.json()) as T;
}

/** Fetch the futures real-time ticker board (all symbols in one call). */
export async function fetchFuturesTickers(): Promise<NormalizedTicker[]> {
  const raw = await getJSON<unknown>(
    `${PUBLIC_BASE}/market_data/v3/current_prices/futures/rt`,
  );
  const rows: RawTicker[] = Array.isArray(raw)
    ? (raw as RawTicker[])
    : raw && typeof raw === "object" && Array.isArray((raw as { prices?: unknown }).prices)
      ? ((raw as { prices: RawTicker[] }).prices)
      : raw && typeof raw === "object"
        ? Object.values(raw as Record<string, RawTicker>)
        : [];

  const out: NormalizedTicker[] = [];
  for (const r of rows) {
    const symbol = (r.s ?? r.pair ?? "").toString();
    if (!symbol.startsWith("B-") || !symbol.endsWith("_USDT")) continue;
    const price = num(r.c ?? r.ls);
    if (price <= 0) continue;
    const bid = r.b != null ? num(r.b) : null;
    const ask = r.a != null ? num(r.a) : null;
    const spreadPct =
      bid && ask && bid > 0 ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null;
    out.push({
      symbol,
      display: prettySymbol(symbol),
      price,
      change24hPct: num(r.pc ?? r.cp),
      volume24h: num(r.qv ?? r.v),
      bid,
      ask,
      spreadPct,
    });
  }
  return out;
}

/** Fetch OHLCV candles for a single pair. */
export async function fetchCandles(
  pair: string,
  interval: Interval,
  limit = 100,
): Promise<Candle[]> {
  const url = `${PUBLIC_BASE}/market_data/candles?pair=${encodeURIComponent(
    pair,
  )}&interval=${interval}&limit=${limit}`;
  type Raw = {
    open: number | string; close: number | string;
    high: number | string; low: number | string;
    volume?: number | string; time?: number;
  };
  const raw = await getJSON<Raw[]>(url, 4500);
  if (!Array.isArray(raw)) return [];
  return raw.map((k) => ({
    open: num(k.open),
    high: num(k.high),
    low: num(k.low),
    close: num(k.close),
    volume: num(k.volume),
    time: k.time,
  }));
}

/** Convenience helper: fetch 1m/5m/30m candles in parallel for a pair. */
export async function fetchMultiTimeframe(pair: string): Promise<{
  m1: Candle[];
  m5: Candle[];
  m30: Candle[];
}> {
  const [m1, m5, m30] = await Promise.all([
    fetchCandles(pair, "1m", 30).catch(() => []),
    fetchCandles(pair, "5m", 30).catch(() => []),
    fetchCandles(pair, "30m", 12).catch(() => []),
  ]);
  return { m1, m5, m30 };
}

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type Recommendation = "long" | "short" | "neutral";

export type Mover = {
  symbol: string;
  display: string;
  price: number;
  change1m: number | null;
  change5m: number | null;
  change30mLast: number | null;
  change24h: number;
  rank24h: number;
  volume24h: number;
  recommendation: Recommendation;
  confidence: number; // 0-100
  reasons: string[];
  trend30: "up" | "down" | "mixed" | "unknown";
};

const PUBLIC_FUTURES_TICKER =
  "https://public.coindcx.com/market_data/v3/current_prices/futures/rt";
const CANDLES = (pair: string, interval: string, limit: number) =>
  `https://public.coindcx.com/market_data/candles?pair=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;
const PUBLIC_API_HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; EarnO/1.0; +https://earno.lovable.app)",
};

type TickerRow = {
  s?: string; pair?: string;
  c?: string | number; ls?: string | number;
  pc?: string | number; cp?: string | number;
  v?: string | number; qv?: string | number;
};

function num(x: unknown, d = 0): number {
  const n = typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : d;
}

function prettySymbol(s: string): string {
  const m = s.match(/^B-([A-Z0-9]+)_([A-Z0-9]+)$/);
  return m ? `${m[1]}/${m[2]}` : s.replace(/^B-/, "").replace("_", "/");
}

async function fetchCandles(
  pair: string,
  interval: string,
  limit: number,
): Promise<Array<{ open: number; close: number; high: number; low: number }> | null> {
  try {
    const res = await fetch(CANDLES(pair, interval, limit), {
      headers: PUBLIC_API_HEADERS,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ open: number; close: number; high: number; low: number }>;
    if (!Array.isArray(json) || json.length < 1) return null;
    return json;
  } catch {
    return null;
  }
}

async function fetchChange(pair: string, interval: "1m" | "5m"): Promise<number | null> {
  const c = await fetchCandles(pair, interval, 2);
  if (!c || c.length < 1) return null;
  const last = c[c.length - 1];
  const open = num(last.open);
  const close = num(last.close);
  if (!open) return null;
  return ((close - open) / open) * 100;
}

type Signals = {
  c1m: number | null;
  c5m: number | null;
  c30m: Array<{ pct: number }> | null; // last 3 closed
  c24h: number;
};

function computeRecommendation(
  s: Signals,
  market: "spot" | "futures",
): { rec: Recommendation; confidence: number; reasons: string[]; trend30: Mover["trend30"]; last30: number | null } {
  const reasons: string[] = [];
  let score = 0;

  if (s.c1m != null) {
    if (s.c1m > 0.05) { score += 12; reasons.push(`1m up ${s.c1m.toFixed(2)}%`); }
    else if (s.c1m < -0.05) { score -= 12; reasons.push(`1m down ${s.c1m.toFixed(2)}%`); }
  }

  if (s.c5m != null) {
    if (s.c5m > 0.1) { score += 22; reasons.push(`5m up ${s.c5m.toFixed(2)}%`); }
    else if (s.c5m < -0.1) { score -= 22; reasons.push(`5m down ${s.c5m.toFixed(2)}%`); }
  }

  let trend30: Mover["trend30"] = "unknown";
  let last30: number | null = null;
  if (s.c30m && s.c30m.length >= 3) {
    const last3 = s.c30m.slice(-3);
    last30 = last3[last3.length - 1].pct;
    const ups = last3.filter((x) => x.pct > 0).length;
    const downs = last3.filter((x) => x.pct < 0).length;
    if (ups === 3) {
      trend30 = "up";
      score += 30;
      reasons.push("30m trend: 3/3 green candles");
    } else if (downs === 3) {
      trend30 = "down";
      // Bounce-back exception: sharp last drop but 1m+5m reversing up
      const sharpLastDrop = last30 != null && last30 < -2.5;
      const reversing = (s.c1m ?? 0) > 0.1 && (s.c5m ?? 0) > 0.1;
      if (sharpLastDrop && reversing) {
        score += 15;
        reasons.push(`30m: 3 red candles but last was sharp (${last30.toFixed(2)}%) and 1m/5m reversing — possible bounce`);
      } else {
        score -= 35;
        reasons.push("30m trend: 3/3 red candles (downtrend)");
      }
    } else {
      trend30 = "mixed";
      score += (ups - downs) * 8;
      reasons.push(`30m: ${ups}↑ ${downs}↓ mixed`);
    }
  }

  if (s.c24h > 5) { score += 12; reasons.push(`24h strong +${s.c24h.toFixed(1)}%`); }
  else if (s.c24h > 0) { score += 5; }
  else if (s.c24h < -5) { score -= 12; reasons.push(`24h weak ${s.c24h.toFixed(1)}%`); }

  let rec: Recommendation;
  if (score >= 25) rec = "long";
  else if (score <= -25) rec = market === "spot" ? "neutral" : "short";
  else rec = "neutral";

  const confidence = Math.min(100, Math.round(Math.abs(score)));
  return { rec, confidence, reasons, trend30, last30 };
}

const SPOT_TICKER = "https://api.coindcx.com/exchange/ticker";

type SpotRow = {
  market: string;
  last_price: string;
  change_24_hour: string;
  volume: string;
};

const marketSchema = z.object({ market: z.enum(["spot", "futures"]).optional() });

async function enrichMover(
  base: { symbol: string; price: number; change24h: number; volume24h: number; rank24h: number },
  candlePair: string,
  market: "spot" | "futures",
  withCandles: boolean,
): Promise<Mover> {
  if (!withCandles) {
    const { rec, confidence, reasons, trend30, last30 } = computeRecommendation(
      { c1m: null, c5m: null, c30m: null, c24h: base.change24h },
      market,
    );
    return {
      ...base,
      display: market === "spot" ? base.symbol.replace(/USDT$/, "/USDT") : prettySymbol(base.symbol),
      change1m: null,
      change5m: null,
      change30mLast: last30,
      recommendation: rec,
      confidence,
      reasons,
      trend30,
    };
  }

  const [c1, c5, c30Raw] = await Promise.all([
    fetchChange(candlePair, "1m"),
    fetchChange(candlePair, "5m"),
    fetchCandles(candlePair, "30m", 4),
  ]);

  const c30 = c30Raw
    ? c30Raw.map((k) => {
        const o = num(k.open);
        const c = num(k.close);
        return { pct: o ? ((c - o) / o) * 100 : 0 };
      })
    : null;

  const { rec, confidence, reasons, trend30, last30 } = computeRecommendation(
    { c1m: c1, c5m: c5, c30m: c30, c24h: base.change24h },
    market,
  );

  return {
    ...base,
    display: market === "spot" ? base.symbol.replace(/USDT$/, "/USDT") : prettySymbol(base.symbol),
    change1m: c1,
    change5m: c5,
    change30mLast: last30,
    recommendation: rec,
    confidence,
    reasons,
    trend30,
  };
}

// Map spot market id -> futures candle pair when possible (e.g. BTCUSDT -> B-BTC_USDT)
function spotToCandlePair(market: string): string {
  const m = market.match(/^([A-Z0-9]+)USDT$/);
  return m ? `B-${m[1]}_USDT` : market;
}

export const getTopMovers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => marketSchema.parse(d ?? {}))
  .handler(async ({ data }): Promise<{ ok: true; movers: Mover[] } | { ok: false; error: string }> => {
    const market = data.market ?? "futures";
    try {
      if (market === "spot") {
        const res = await fetch(SPOT_TICKER, {
          headers: PUBLIC_API_HEADERS,
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return { ok: false, error: `Spot HTTP ${res.status}` };
        const raw = (await res.json()) as SpotRow[];
        const rows = raw
          .filter((r) => r.market && r.market.endsWith("USDT"))
          .map((r) => ({
            symbol: r.market,
            price: num(r.last_price),
            change24h: num(r.change_24_hour),
            volume24h: num(r.volume),
          }))
          .filter((r) => r.price > 0);
        rows.sort((a, b) => b.change24h - a.change24h);
        const top = rows.slice(0, 15).map((r, i) => ({ ...r, rank24h: i + 1 }));
        const enriched = await Promise.all(
          top.map((r, i) => enrichMover(r, spotToCandlePair(r.symbol), "spot", i < 10)),
        );
        return { ok: true, movers: enriched };
      }

      const res = await fetch(PUBLIC_FUTURES_TICKER, {
        headers: PUBLIC_API_HEADERS,
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return { ok: false, error: `Ticker HTTP ${res.status}` };
      const raw = (await res.json()) as
        | { prices: Record<string, TickerRow> }
        | Record<string, TickerRow>
        | TickerRow[];

      const rows: Array<{ symbol: string; price: number; change24h: number; volume24h: number }> = [];
      const consume = (sym: string | undefined, r: TickerRow) => {
        const symbol = sym ?? r.s ?? r.pair;
        if (!symbol || !symbol.startsWith("B-") || !symbol.endsWith("_USDT")) return;
        const price = num(r.ls ?? r.c);
        const change = num(r.cp ?? r.pc);
        const vol = num(r.qv ?? r.v);
        if (!price) return;
        rows.push({ symbol, price, change24h: change, volume24h: vol });
      };
      const dict =
        raw && typeof raw === "object" && !Array.isArray(raw) && "prices" in raw
          ? (raw as { prices: Record<string, TickerRow> }).prices
          : raw;
      if (Array.isArray(dict)) {
        dict.forEach((r) => consume(undefined, r));
      } else if (dict && typeof dict === "object") {
        Object.entries(dict).forEach(([k, v]) => {
          if (v && typeof v === "object") consume(k, v as TickerRow);
        });
      }

      rows.sort((a, b) => b.change24h - a.change24h);
      const top = rows.slice(0, 15).map((r, i) => ({ ...r, rank24h: i + 1 }));

      const enriched = await Promise.all(
        top.map((r, i) => enrichMover(r, r.symbol, "futures", i < 10)),
      );

      return { ok: true, movers: enriched };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
    }
  });

const bookSchema = z.object({
  symbol: z.string().min(3).max(40).regex(/^[A-Z0-9_\-]+$/),
  side: z.enum(["long", "short"]),
  price: z.number().positive(),
  market: z.enum(["spot", "futures"]).optional(),
});

export const bookManualTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => bookSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: cfg, error: cfgErr } = await supabaseAdmin
      .from("bot_config")
      .select("mode,leverage,take_profit_pct,stop_loss_pct,risk_per_trade_pct,paper_equity,max_open_positions")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (cfgErr || !cfg) throw new Error(cfgErr?.message ?? "No bot config found");

    const { count } = await supabaseAdmin
      .from("positions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("status", "open");
    if ((count ?? 0) >= cfg.max_open_positions) {
      throw new Error(`Max open positions (${cfg.max_open_positions}) reached`);
    }

    const equity = Number(cfg.paper_equity ?? 0);
    const riskPct = Number(cfg.risk_per_trade_pct ?? 1);
    const lev = Number(cfg.leverage ?? 3);
    const sl = Number(cfg.stop_loss_pct ?? 2);
    const tp = Number(cfg.take_profit_pct ?? 3);

    const notional = Math.min((equity * riskPct) / sl, equity) * lev;
    const qty = notional / data.price;

    const stop_loss = data.side === "long" ? data.price * (1 - sl / 100) : data.price * (1 + sl / 100);
    const take_profit = data.side === "long" ? data.price * (1 + tp / 100) : data.price * (1 - tp / 100);

    const { error } = await supabaseAdmin.from("positions").insert({
      user_id: context.userId,
      mode: cfg.mode,
      symbol: data.symbol,
      side: data.side,
      leverage: lev,
      qty,
      entry_price: data.price,
      mark_price: data.price,
      stop_loss,
      take_profit,
      pnl: 0,
      pnl_pct: 0,
      status: "open",
      exchange_order_id: cfg.mode === "paper" ? `paper-manual-${Date.now()}` : null,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("bot_events").insert({
      user_id: context.userId,
      level: "info",
      message: `Manual ${data.side.toUpperCase()} on ${data.symbol} at ${data.price} (${cfg.mode})`,
    });

    return { ok: true };
  });

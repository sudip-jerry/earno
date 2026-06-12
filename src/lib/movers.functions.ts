import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type Mover = {
  symbol: string;        // e.g. "B-BTC_USDT"
  display: string;       // e.g. "BTC/USDT"
  price: number;
  change1m: number | null;
  change5m: number | null;
  change24h: number;
  rank24h: number;       // 1 = top gainer of the day
  volume24h: number;
};

const PUBLIC_FUTURES_TICKER =
  "https://public.coindcx.com/market_data/v3/current_prices/futures/rt";
const CANDLES = (pair: string, interval: string, limit: number) =>
  `https://public.coindcx.com/market_data/candles?pair=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;

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
  // "B-BTC_USDT" -> "BTC/USDT"
  const m = s.match(/^B-([A-Z0-9]+)_([A-Z0-9]+)$/);
  return m ? `${m[1]}/${m[2]}` : s.replace(/^B-/, "").replace("_", "/");
}

async function fetchChange(pair: string, interval: "1m" | "5m"): Promise<number | null> {
  try {
    const res = await fetch(CANDLES(pair, interval, 2), { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ open: number; close: number }>;
    if (!Array.isArray(json) || json.length < 1) return null;
    const last = json[json.length - 1];
    const open = num(last.open);
    const close = num(last.close);
    if (!open) return null;
    return ((close - open) / open) * 100;
  } catch {
    return null;
  }
}

export const getTopMovers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ ok: true; movers: Mover[] } | { ok: false; error: string }> => {
    try {
      const res = await fetch(PUBLIC_FUTURES_TICKER, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return { ok: false, error: `Ticker HTTP ${res.status}` };
      const raw = (await res.json()) as Record<string, TickerRow> | TickerRow[];

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
      if (Array.isArray(raw)) {
        raw.forEach((r) => consume(undefined, r));
      } else {
        Object.entries(raw).forEach(([k, v]) => consume(k, v));
      }

      // Sort by 24h change desc, take top 15
      rows.sort((a, b) => b.change24h - a.change24h);
      const top = rows.slice(0, 15).map((r, i) => ({ ...r, rank24h: i + 1 }));

      // Fetch 1m/5m for top 10 only (avoid hammering)
      const enriched = await Promise.all(
        top.map(async (r, i) => {
          if (i < 10) {
            const [c1, c5] = await Promise.all([
              fetchChange(r.symbol, "1m"),
              fetchChange(r.symbol, "5m"),
            ]);
            return {
              symbol: r.symbol,
              display: prettySymbol(r.symbol),
              price: r.price,
              change1m: c1,
              change5m: c5,
              change24h: r.change24h,
              rank24h: r.rank24h,
              volume24h: r.volume24h,
            } satisfies Mover;
          }
          return {
            symbol: r.symbol,
            display: prettySymbol(r.symbol),
            price: r.price,
            change1m: null,
            change5m: null,
            change24h: r.change24h,
            rank24h: r.rank24h,
            volume24h: r.volume24h,
          } satisfies Mover;
        }),
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

    // Check open position cap
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

    // Position notional = (equity * riskPct%) / (sl%) * leverage  (cap at equity*lev)
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

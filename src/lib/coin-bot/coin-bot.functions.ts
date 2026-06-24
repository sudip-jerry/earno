/**
 * Coin Paper Bot — server functions.
 * Uses real CoinDCX public market data. Paper trading only. No API keys, no live orders.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  fetchFuturesTickers,
  fetchMultiTimeframe,
  type NormalizedTicker,
} from "@/services/coindcxPublicApi";
import { scoreCoin, type CoinAction } from "./scorer";

type CoinMode = "intraday" | "swing";

type CoinConfigRow = {
  user_id: string;
  enabled: boolean;
  mode: CoinMode;
  allocated_capital_usdt: number;
  available_cash_usdt: number;
  max_holdings: number;
  min_confidence: number;
  scan_interval_min: number;
  max_holding_days: number;
  universe_size: number;
};

const DEFAULT_CFG: Omit<CoinConfigRow, "user_id"> = {
  enabled: false,
  mode: "intraday",
  allocated_capital_usdt: 5000,
  available_cash_usdt: 5000,
  max_holdings: 8,
  min_confidence: 65,
  scan_interval_min: 3,
  max_holding_days: 7,
  universe_size: 50,
};

async function ensureConfig(ctx: { supabase: any; userId: string }): Promise<CoinConfigRow> {
  const { data } = await ctx.supabase
    .from("coin_bot_config")
    .select("*")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (data) return data as CoinConfigRow;
  const insert = { user_id: ctx.userId, ...DEFAULT_CFG };
  await ctx.supabase.from("coin_bot_config").insert(insert);
  return insert;
}

// -------- Config ----------

export const getCoinConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ensureConfig(context));

export const updateCoinConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      enabled: z.boolean().optional(),
      mode: z.enum(["intraday", "swing"]).optional(),
      allocated_capital_usdt: z.number().min(0).max(100_000).optional(),
      available_cash_usdt: z.number().min(0).max(100_000).optional(),
      max_holdings: z.number().int().min(1).max(50).optional(),
      min_confidence: z.number().int().min(0).max(100).optional(),
      scan_interval_min: z.number().int().min(1).max(1440).optional(),
      max_holding_days: z.number().int().min(1).max(365).optional(),
      universe_size: z.number().int().min(1).max(500).optional(),
    }).strict().parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureConfig(context);
    const patch: Partial<Omit<CoinConfigRow, "user_id">> = {};
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.mode !== undefined) patch.mode = data.mode;
    if (data.allocated_capital_usdt !== undefined) patch.allocated_capital_usdt = data.allocated_capital_usdt;
    if (data.available_cash_usdt !== undefined) patch.available_cash_usdt = data.available_cash_usdt;
    if (data.max_holdings !== undefined) patch.max_holdings = data.max_holdings;
    if (data.min_confidence !== undefined) patch.min_confidence = data.min_confidence;
    if (data.scan_interval_min !== undefined) patch.scan_interval_min = data.scan_interval_min;
    if (data.max_holding_days !== undefined) patch.max_holding_days = data.max_holding_days;
    if (data.universe_size !== undefined) patch.universe_size = data.universe_size;
    if (Object.keys(patch).length) {
      await context.supabase.from("coin_bot_config").update(patch).eq("user_id", context.userId);
    }
    return ensureConfig(context);
  });

// -------- Read ----------

type Holding = {
  id: string; symbol: string; display: string; qty: number; avg_buy_price: number;
  last_price: number | null; invested_usdt: number; current_value_usdt: number | null;
  unrealized_pnl_usdt: number; realized_pnl_usdt: number; status: "open" | "closed";
  mode: CoinMode; source: "manual" | "bot"; target_price: number | null;
  stop_price: number | null; opened_at: string; closed_at: string | null;
  exit_price: number | null; exit_reason: string | null; open_reason: string | null;
};

export const getCoinHoldings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: open } = await context.supabase
      .from("coin_positions").select("*")
      .eq("user_id", context.userId).eq("status", "open")
      .order("opened_at", { ascending: false });
    const { data: closed } = await context.supabase
      .from("coin_positions").select("*")
      .eq("user_id", context.userId).eq("status", "closed")
      .order("closed_at", { ascending: false }).limit(50);

    // Refresh mark prices from public ticker
    let priceMap = new Map<string, number>();
    try {
      const tickers = await fetchFuturesTickers();
      priceMap = new Map(tickers.map((t) => [t.symbol, t.price]));
    } catch {
      // tolerate transient public-api hiccup
    }

    const enriched = ((open ?? []) as Holding[]).map((h) => {
      const last = priceMap.get(h.symbol) ?? h.last_price ?? h.avg_buy_price;
      const value = h.qty * last;
      const pnl = value - h.invested_usdt;
      return { ...h, last_price: last, current_value_usdt: value, unrealized_pnl_usdt: pnl };
    });

    const totalInvested = enriched.reduce((a, h) => a + h.invested_usdt, 0);
    const totalValue = enriched.reduce((a, h) => a + (h.current_value_usdt ?? 0), 0);
    const unrealized = totalValue - totalInvested;
    const realized = ((closed ?? []) as Holding[]).reduce((a, h) => a + Number(h.realized_pnl_usdt ?? 0), 0);

    let best: Holding | null = null;
    let worst: Holding | null = null;
    for (const h of enriched) {
      const pnlPct = ((h.last_price! - h.avg_buy_price) / h.avg_buy_price) * 100;
      const bestPct = best ? ((best.last_price! - best.avg_buy_price) / best.avg_buy_price) * 100 : -Infinity;
      const worstPct = worst ? ((worst.last_price! - worst.avg_buy_price) / worst.avg_buy_price) * 100 : Infinity;
      if (pnlPct > bestPct) best = h;
      if (pnlPct < worstPct) worst = h;
    }

    return {
      open: enriched,
      closed: (closed ?? []) as Holding[],
      summary: {
        invested_usdt: totalInvested,
        current_value_usdt: totalValue,
        unrealized_pnl_usdt: unrealized,
        realized_pnl_usdt: realized,
        active_holdings: enriched.length,
        best_symbol: best?.display ?? null,
        best_pnl_pct: best ? ((best.last_price! - best.avg_buy_price) / best.avg_buy_price) * 100 : null,
        worst_symbol: worst?.display ?? null,
        worst_pnl_pct: worst ? ((worst.last_price! - worst.avg_buy_price) / worst.avg_buy_price) * 100 : null,
      },
    };
  });

export const getCoinPortfolio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cfg = await ensureConfig(context);
    const { data: open } = await context.supabase
      .from("coin_positions").select("invested_usdt, qty, avg_buy_price, symbol, last_price")
      .eq("user_id", context.userId).eq("status", "open");
    const { data: closedToday } = await context.supabase
      .from("coin_positions").select("realized_pnl_usdt, closed_at")
      .eq("user_id", context.userId).eq("status", "closed")
      .gte("closed_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
    const invested = (open ?? []).reduce((a: number, r: any) => a + Number(r.invested_usdt ?? 0), 0);
    const realizedToday = (closedToday ?? []).reduce((a: number, r: any) => a + Number(r.realized_pnl_usdt ?? 0), 0);
    return {
      allocated_capital_usdt: cfg.allocated_capital_usdt,
      available_cash_usdt: cfg.available_cash_usdt,
      invested_usdt: invested,
      active_holdings: (open ?? []).length,
      realized_today_usdt: realizedToday,
      enabled: cfg.enabled,
      mode: cfg.mode,
    };
  });

export const getCoinSignals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("coin_signals")
      .select("*")
      .eq("user_id", context.userId)
      .eq("status", "active")
      .order("confidence", { ascending: false })
      .limit(40);
    return (data ?? []) as Array<{
      id: string; symbol: string; display: string; action: CoinAction; confidence: number;
      price: number; buy_zone_low: number | null; buy_zone_high: number | null;
      target: number | null; stop: number | null; reason_short: string; reason_detail: any;
      mode: CoinMode; created_at: string;
    }>;
  });

// -------- Paper buy / sell ----------

export const paperBuyCoin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { symbol: string; display: string; price: number; usdt: number; mode?: CoinMode; reason?: string; target?: number; stop?: number; source?: "manual" | "bot" }) => d)
  .handler(async ({ data, context }) => {
    if (!data.symbol || data.price <= 0 || data.usdt <= 0) {
      return { ok: false as const, error: "Invalid buy parameters" };
    }
    const cfg = await ensureConfig(context);
    if (Number(cfg.available_cash_usdt) < data.usdt) {
      return { ok: false as const, error: "Not enough virtual cash" };
    }
    const { data: existing } = await context.supabase
      .from("coin_positions").select("*")
      .eq("user_id", context.userId).eq("symbol", data.symbol).eq("status", "open")
      .maybeSingle();

    const qty = data.usdt / data.price;
    const mode = data.mode ?? cfg.mode;
    const maxHoldUntil =
      mode === "swing"
        ? new Date(Date.now() + cfg.max_holding_days * 24 * 60 * 60 * 1000).toISOString()
        : null; // no forced intraday close

    if (existing) {
      const totalQty = Number(existing.qty) + qty;
      const totalInvested = Number(existing.invested_usdt) + data.usdt;
      const newAvg = totalInvested / totalQty;
      await context.supabase.from("coin_positions").update({
        qty: totalQty, avg_buy_price: newAvg, invested_usdt: totalInvested,
        last_price: data.price, target_price: data.target ?? existing.target_price,
        stop_price: data.stop ?? existing.stop_price,
      }).eq("id", existing.id);
    } else {
      await context.supabase.from("coin_positions").insert({
        user_id: context.userId, symbol: data.symbol, display: data.display,
        qty, avg_buy_price: data.price, last_price: data.price,
        invested_usdt: data.usdt, current_value_usdt: data.usdt,
        status: "open", mode, source: data.source ?? "manual",
        target_price: data.target ?? null, stop_price: data.stop ?? null,
        max_holding_until: maxHoldUntil, open_reason: data.reason ?? null,
      });
    }
    await context.supabase.from("coin_bot_config").update({
      available_cash_usdt: Number(cfg.available_cash_usdt) - data.usdt,
    }).eq("user_id", context.userId);
    return { ok: true as const };
  });

export const paperSellCoin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { positionId?: string; symbol?: string; price: number; reason?: string }) => d)
  .handler(async ({ data, context }) => {
    if (data.price <= 0) return { ok: false as const, error: "Invalid price" };
    const q = context.supabase.from("coin_positions").select("*")
      .eq("user_id", context.userId).eq("status", "open");
    const { data: row } = data.positionId
      ? await q.eq("id", data.positionId).maybeSingle()
      : await q.eq("symbol", data.symbol!).maybeSingle();
    if (!row) return { ok: false as const, error: "No open position" };

    const proceeds = Number(row.qty) * data.price;
    const realized = proceeds - Number(row.invested_usdt);
    await context.supabase.from("coin_positions").update({
      status: "closed", closed_at: new Date().toISOString(),
      exit_price: data.price, exit_reason: data.reason ?? "manual_paper_sell",
      last_price: data.price, current_value_usdt: proceeds,
      realized_pnl_usdt: realized, unrealized_pnl_usdt: 0,
    }).eq("id", row.id);

    const cfg = await ensureConfig(context);
    await context.supabase.from("coin_bot_config").update({
      available_cash_usdt: Number(cfg.available_cash_usdt) + proceeds,
    }).eq("user_id", context.userId);
    return { ok: true as const, realized_pnl_usdt: realized };
  });

// -------- Scan ----------

export const runCoinScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cfg = await ensureConfig(context);
    let tickers: NormalizedTicker[] = [];
    try {
      tickers = await fetchFuturesTickers();
    } catch (e) {
      return { ok: false as const, error: "Public market data unavailable" };
    }

    // Universe: top N USDT pairs by 24h volume
    const universe = tickers
      .filter((t) => t.symbol.endsWith("_USDT"))
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, Math.max(10, Math.min(150, cfg.universe_size)));

    // Existing open holdings (so scorer knows we hold)
    const { data: openRows } = await context.supabase
      .from("coin_positions").select("symbol, avg_buy_price, id")
      .eq("user_id", context.userId).eq("status", "open");
    const holdings = new Map<string, { id: string; avg_buy_price: number }>(
      (openRows ?? []).map((r: any) => [r.symbol, { id: r.id, avg_buy_price: Number(r.avg_buy_price) }]),
    );

    // Always include held symbols in the scan
    const heldOnly = Array.from(holdings.keys()).filter((s) => !universe.find((u) => u.symbol === s));
    for (const sym of heldOnly) {
      const t = tickers.find((x) => x.symbol === sym);
      if (t) universe.push(t);
    }

    const signalsToInsert: any[] = [];
    const errors: string[] = [];

    // Limit parallelism to be public-API friendly
    const BATCH = 6;
    for (let i = 0; i < universe.length; i += BATCH) {
      const batch = universe.slice(i, i + BATCH);
      await Promise.all(batch.map(async (t) => {
        try {
          const { m1, m5, m30 } = await fetchMultiTimeframe(t.symbol);
          if (m5.length < 10 && m30.length < 10) return;
          const held = holdings.get(t.symbol);
          const score = scoreCoin({
            symbol: t.symbol, display: t.display, price: t.price,
            change24hPct: t.change24hPct, spreadPct: t.spreadPct,
            m1, m5, m30, holding: !!held, avgBuy: held?.avg_buy_price, mode: cfg.mode,
          });
          signalsToInsert.push({
            user_id: context.userId, symbol: t.symbol, display: t.display,
            action: score.action, confidence: score.confidence, price: t.price,
            buy_zone_low: t.price * 0.998, buy_zone_high: t.price * 1.002,
            target: score.target, stop: score.stop,
            reason_short: score.reason_short, reason_detail: score.detail,
            mode: cfg.mode, status: "active",
          });
        } catch (e) {
          errors.push(t.symbol);
        }
      }));
    }

    // Supersede previous active signals
    await context.supabase
      .from("coin_signals").update({ status: "superseded" })
      .eq("user_id", context.userId).eq("status", "active");
    if (signalsToInsert.length) {
      await context.supabase.from("coin_signals").insert(signalsToInsert);
    }

    // Auto-manage open holdings: act on sell signals from scorer
    let autoClosed = 0;
    for (const sig of signalsToInsert) {
      const held = holdings.get(sig.symbol);
      if (!held) continue;
      if (sig.action === "sell") {
        // Reuse paperSell logic inline
        const { data: row } = await context.supabase.from("coin_positions").select("*")
          .eq("id", held.id).maybeSingle();
        if (!row || row.status !== "open") continue;
        const proceeds = Number(row.qty) * Number(sig.price);
        const realized = proceeds - Number(row.invested_usdt);
        await context.supabase.from("coin_positions").update({
          status: "closed", closed_at: new Date().toISOString(),
          exit_price: sig.price, exit_reason: `bot:${sig.reason_short}`,
          last_price: sig.price, current_value_usdt: proceeds,
          realized_pnl_usdt: realized, unrealized_pnl_usdt: 0,
        }).eq("id", row.id);
        const cur = await ensureConfig(context);
        await context.supabase.from("coin_bot_config").update({
          available_cash_usdt: Number(cur.available_cash_usdt) + proceeds,
        }).eq("user_id", context.userId);
        autoClosed += 1;
      }
    }

    // Auto-open buys (only when bot enabled, capacity available, confidence high)
    let autoOpened = 0;
    if (cfg.enabled) {
      const buys = signalsToInsert
        .filter((s) => s.action === "buy" && s.confidence >= cfg.min_confidence && !holdings.has(s.symbol))
        .sort((a, b) => b.confidence - a.confidence);

      let cur = await ensureConfig(context);
      const currentlyOpen = (openRows ?? []).length - autoClosed;
      const slots = Math.max(0, cfg.max_holdings - currentlyOpen);
      const perTradeUsdt = cfg.allocated_capital_usdt / cfg.max_holdings;

      for (const s of buys.slice(0, slots)) {
        if (Number(cur.available_cash_usdt) < perTradeUsdt) break;
        const qty = perTradeUsdt / Number(s.price);
        const maxHoldUntil = cfg.mode === "swing"
          ? new Date(Date.now() + cfg.max_holding_days * 24 * 60 * 60 * 1000).toISOString()
          : null;
        await context.supabase.from("coin_positions").insert({
          user_id: context.userId, symbol: s.symbol, display: s.display,
          qty, avg_buy_price: s.price, last_price: s.price,
          invested_usdt: perTradeUsdt, current_value_usdt: perTradeUsdt,
          status: "open", mode: cfg.mode, source: "bot",
          target_price: s.target, stop_price: s.stop,
          max_holding_until: maxHoldUntil, open_reason: `bot:${s.reason_short}`,
        });
        await context.supabase.from("coin_bot_config").update({
          available_cash_usdt: Number(cur.available_cash_usdt) - perTradeUsdt,
        }).eq("user_id", context.userId);
        cur = { ...cur, available_cash_usdt: Number(cur.available_cash_usdt) - perTradeUsdt };
        autoOpened += 1;
      }
    }

    return {
      ok: true as const,
      scanned: universe.length,
      signals: signalsToInsert.length,
      auto_opened: autoOpened,
      auto_closed: autoClosed,
      errors: errors.length,
    };
  });

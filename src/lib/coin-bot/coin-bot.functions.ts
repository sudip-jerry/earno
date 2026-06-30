/**
 * Coin Paper Bot — server functions.
 * Uses real CoinDCX public market data. Paper trading only. No API keys, no live orders.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchFuturesTickers } from "@/services/coindcxPublicApi";
import type { CoinAction } from "./scorer";

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
  allocated_capital_usdt: 500,
  available_cash_usdt: 500,
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
    z
      .object({
        enabled: z.boolean().optional(),
        mode: z.enum(["intraday", "swing"]).optional(),
        allocated_capital_usdt: z.number().min(0).max(100_000).optional(),
        available_cash_usdt: z.number().min(0).max(100_000).optional(),
        max_holdings: z.number().int().min(1).max(50).optional(),
        min_confidence: z.number().int().min(0).max(100).optional(),
        scan_interval_min: z.number().int().min(1).max(1440).optional(),
        max_holding_days: z.number().int().min(1).max(365).optional(),
        universe_size: z.number().int().min(1).max(500).optional(),
        live_mode: z.boolean().optional(),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureConfig(context);

    // Gate live_mode behind plan tier — mirrors futures updateConfig.
    if (data.live_mode === true) {
      const [{ data: tier }, { data: settings }] = await Promise.all([
        context.supabase.rpc("current_plan_tier", { _user_id: context.userId }),
        context.supabase.from("app_settings").select("paywall_enabled").eq("id", 1).maybeSingle(),
      ]);
      const paywall = settings?.paywall_enabled ?? true;
      const allowed = tier === "auto5" || tier === "unlimited";
      if (paywall && !allowed) {
        throw new Error(
          "PAYMENT_REQUIRED: Upgrade to Auto-Trader or Unlimited to enable Coin bot live mode.",
        );
      }
    }

    const patch: Partial<CoinConfigRow> & { live_mode?: boolean } = {};
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.mode !== undefined) patch.mode = data.mode;
    if (data.allocated_capital_usdt !== undefined)
      patch.allocated_capital_usdt = data.allocated_capital_usdt;
    if (data.available_cash_usdt !== undefined)
      patch.available_cash_usdt = data.available_cash_usdt;
    if (data.max_holdings !== undefined) patch.max_holdings = data.max_holdings;
    if (data.min_confidence !== undefined) patch.min_confidence = data.min_confidence;
    if (data.scan_interval_min !== undefined) patch.scan_interval_min = data.scan_interval_min;
    if (data.max_holding_days !== undefined) patch.max_holding_days = data.max_holding_days;
    if (data.universe_size !== undefined) patch.universe_size = data.universe_size;
    if (data.live_mode !== undefined) patch.live_mode = data.live_mode;
    if (Object.keys(patch).length) {
      await context.supabase.from("coin_bot_config").update(patch).eq("user_id", context.userId);
    }
    return ensureConfig(context);
  });

// -------- Read ----------

type Holding = {
  id: string;
  symbol: string;
  display: string;
  qty: number;
  avg_buy_price: number;
  last_price: number | null;
  invested_usdt: number;
  current_value_usdt: number | null;
  unrealized_pnl_usdt: number;
  realized_pnl_usdt: number;
  status: "open" | "closed";
  mode: CoinMode;
  source: "manual" | "bot";
  target_price: number | null;
  stop_price: number | null;
  opened_at: string;
  closed_at: string | null;
  exit_price: number | null;
  exit_reason: string | null;
  open_reason: string | null;
};

export const getCoinHoldings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: open } = await context.supabase
      .from("coin_positions")
      .select("*")
      .eq("user_id", context.userId)
      .eq("status", "open")
      .order("opened_at", { ascending: false });
    const { data: closed } = await context.supabase
      .from("coin_positions")
      .select("*")
      .eq("user_id", context.userId)
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(50);

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
    const realized = ((closed ?? []) as Holding[]).reduce(
      (a, h) => a + Number(h.realized_pnl_usdt ?? 0),
      0,
    );

    let best: Holding | null = null;
    let worst: Holding | null = null;
    for (const h of enriched) {
      const pnlPct = ((h.last_price! - h.avg_buy_price) / h.avg_buy_price) * 100;
      const bestPct = best
        ? ((best.last_price! - best.avg_buy_price) / best.avg_buy_price) * 100
        : -Infinity;
      const worstPct = worst
        ? ((worst.last_price! - worst.avg_buy_price) / worst.avg_buy_price) * 100
        : Infinity;
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
        best_pnl_pct: best
          ? ((best.last_price! - best.avg_buy_price) / best.avg_buy_price) * 100
          : null,
        worst_symbol: worst?.display ?? null,
        worst_pnl_pct: worst
          ? ((worst.last_price! - worst.avg_buy_price) / worst.avg_buy_price) * 100
          : null,
      },
    };
  });

export const getCoinPortfolio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cfg = await ensureConfig(context);
    const { data: open } = await context.supabase
      .from("coin_positions")
      .select("invested_usdt, qty, avg_buy_price, symbol, last_price")
      .eq("user_id", context.userId)
      .eq("status", "open");
    const { data: closedToday } = await context.supabase
      .from("coin_positions")
      .select("realized_pnl_usdt, closed_at")
      .eq("user_id", context.userId)
      .eq("status", "closed")
      .gte("closed_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
    const invested = (open ?? []).reduce(
      (a: number, r: any) => a + Number(r.invested_usdt ?? 0),
      0,
    );
    const realizedToday = (closedToday ?? []).reduce(
      (a: number, r: any) => a + Number(r.realized_pnl_usdt ?? 0),
      0,
    );
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
      id: string;
      symbol: string;
      display: string;
      action: CoinAction;
      confidence: number;
      price: number;
      buy_zone_low: number | null;
      buy_zone_high: number | null;
      target: number | null;
      stop: number | null;
      reason_short: string;
      reason_detail: any;
      mode: CoinMode;
      created_at: string;
    }>;
  });

// -------- Paper buy / sell ----------

export const paperBuyCoin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        symbol: z
          .string()
          .trim()
          .regex(/^[A-Z0-9_-]+$/i)
          .max(40),
        display: z.string().trim().min(1).max(80),
        price: z.number().positive().max(10_000_000),
        usdt: z.number().positive().max(100_000),
        mode: z.enum(["intraday", "swing"]).optional(),
        reason: z.string().max(500).optional(),
        target: z.number().positive().max(10_000_000).optional(),
        stop: z.number().positive().max(10_000_000).optional(),
        source: z.enum(["manual", "bot"]).optional(),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!data.symbol || data.price <= 0 || data.usdt <= 0) {
      return { ok: false as const, error: "Invalid buy parameters" };
    }
    const cfg = await ensureConfig(context);
    if (Number(cfg.available_cash_usdt) < data.usdt) {
      return { ok: false as const, error: "Not enough virtual cash" };
    }
    const { data: existing } = await context.supabase
      .from("coin_positions")
      .select("*")
      .eq("user_id", context.userId)
      .eq("symbol", data.symbol)
      .eq("status", "open")
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
      await context.supabase
        .from("coin_positions")
        .update({
          qty: totalQty,
          avg_buy_price: newAvg,
          invested_usdt: totalInvested,
          last_price: data.price,
          target_price: data.target ?? existing.target_price,
          stop_price: data.stop ?? existing.stop_price,
        })
        .eq("id", existing.id);
    } else {
      await context.supabase.from("coin_positions").insert({
        user_id: context.userId,
        symbol: data.symbol,
        display: data.display,
        qty,
        avg_buy_price: data.price,
        last_price: data.price,
        invested_usdt: data.usdt,
        current_value_usdt: data.usdt,
        status: "open",
        mode,
        source: data.source ?? "manual",
        target_price: data.target ?? null,
        stop_price: data.stop ?? null,
        max_holding_until: maxHoldUntil,
        open_reason: data.reason ?? null,
      });
    }
    await context.supabase
      .from("coin_bot_config")
      .update({
        available_cash_usdt: Number(cfg.available_cash_usdt) - data.usdt,
      })
      .eq("user_id", context.userId);
    return { ok: true as const };
  });

export const paperSellCoin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        positionId: z.string().uuid().optional(),
        symbol: z
          .string()
          .trim()
          .regex(/^[A-Z0-9_-]+$/i)
          .max(40)
          .optional(),
        price: z.number().positive().max(10_000_000),
        reason: z.string().max(500).optional(),
      })
      .strict()
      .refine((v) => v.positionId || v.symbol, {
        message: "positionId or symbol required",
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (data.price <= 0) return { ok: false as const, error: "Invalid price" };
    const q = context.supabase
      .from("coin_positions")
      .select("*")
      .eq("user_id", context.userId)
      .eq("status", "open");
    const { data: row } = data.positionId
      ? await q.eq("id", data.positionId).maybeSingle()
      : await q.eq("symbol", data.symbol!).maybeSingle();
    if (!row) return { ok: false as const, error: "No open position" };

    const proceeds = Number(row.qty) * data.price;
    const realized = proceeds - Number(row.invested_usdt);
    await context.supabase
      .from("coin_positions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        exit_price: data.price,
        exit_reason: data.reason ?? "manual_paper_sell",
        last_price: data.price,
        current_value_usdt: proceeds,
        realized_pnl_usdt: realized,
        unrealized_pnl_usdt: 0,
      })
      .eq("id", row.id);

    const cfg = await ensureConfig(context);
    await context.supabase
      .from("coin_bot_config")
      .update({
        available_cash_usdt: Number(cfg.available_cash_usdt) + proceeds,
      })
      .eq("user_id", context.userId);
    return { ok: true as const, realized_pnl_usdt: realized };
  });

// -------- Scan ----------

export const runCoinScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cfg = await ensureConfig(context);
    const { runCoinScanFor } = await import("./coin-scan.server");
    return runCoinScanFor(context.supabase, context.userId, cfg as any);
  });

/**
 * Paper trading engine.
 *
 * Simulated-only. Opens, marks, and closes paper trades against the existing
 * `positions` table in Lovable Cloud with `is_paper = true`. NEVER places live
 * orders — that's intentionally out of scope.
 *
 * Designed to be called from server functions (where the authenticated
 * Supabase client is available via middleware). The functions accept the
 * client as an argument so they stay testable and decoupled.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type Side = "long" | "short";

export type OpenPaperInput = {
  userId: string;
  symbol: string;
  display: string;
  side: Side;
  entryPrice: number;
  leverage: number;
  notionalUsdt: number;       // position size in USDT before leverage
  takeProfitPct: number;      // e.g. 0.6 → +0.6%
  stopLossPct: number;        // e.g. 0.4 → -0.4%
  scalpScore?: number;
  reason?: string;
};

export type PaperPosition = {
  id: string;
  symbol: string;
  side: Side;
  leverage: number;
  entry_price: number;
  mark_price: number | null;
  qty: number;
  notional: number;
  take_profit_price: number;
  stop_loss_price: number;
  pnl_pct: number | null;
  pnl_usdt: number | null;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  close_reason: string | null;
};

function priceFromPct(entry: number, pct: number, side: Side, kind: "tp" | "sl"): number {
  const sign =
    kind === "tp" ? (side === "long" ? 1 : -1) : side === "long" ? -1 : 1;
  return entry * (1 + (sign * pct) / 100);
}

function computePnlPct(entry: number, mark: number, side: Side, leverage: number): number {
  const raw = ((mark - entry) / entry) * 100 * (side === "long" ? 1 : -1);
  return raw * leverage;
}

/** Open a simulated position. */
export async function openPaperTrade(
  supabase: SupabaseClient,
  input: OpenPaperInput,
): Promise<{ ok: true; position: PaperPosition } | { ok: false; error: string }> {
  if (input.entryPrice <= 0) return { ok: false, error: "Invalid entry price" };
  if (input.notionalUsdt <= 0) return { ok: false, error: "Invalid notional" };

  const tp = priceFromPct(input.entryPrice, input.takeProfitPct, input.side, "tp");
  const sl = priceFromPct(input.entryPrice, input.stopLossPct, input.side, "sl");
  const qty = (input.notionalUsdt * input.leverage) / input.entryPrice;

  const row = {
    user_id: input.userId,
    symbol: input.symbol,
    display: input.display,
    side: input.side,
    leverage: input.leverage,
    entry_price: input.entryPrice,
    mark_price: input.entryPrice,
    qty,
    notional: input.notionalUsdt,
    take_profit_price: tp,
    stop_loss_price: sl,
    pnl_pct: 0,
    pnl_usdt: 0,
    status: "open" as const,
    is_paper: true,
    scalp_score: input.scalpScore ?? null,
    open_reason: input.reason ?? null,
  };

  const { data, error } = await supabase
    .from("positions")
    .insert(row)
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, position: data as unknown as PaperPosition };
}

/** Update mark prices for a batch of positions. Closes any that hit TP/SL. */
export async function markAndAutoClose(
  supabase: SupabaseClient,
  marks: Record<string, number>, // symbol → latest price
): Promise<{ closed: PaperPosition[]; updated: PaperPosition[] }> {
  const { data: open } = await supabase
    .from("positions")
    .select("*")
    .eq("status", "open")
    .eq("is_paper", true);

  const closed: PaperPosition[] = [];
  const updated: PaperPosition[] = [];

  for (const p of (open ?? []) as PaperPosition[]) {
    const mark = marks[p.symbol];
    if (!mark) continue;
    const pnlPct = computePnlPct(p.entry_price, mark, p.side, p.leverage);
    const pnlUsdt = (pnlPct / 100) * p.notional;

    const hitTp = p.side === "long" ? mark >= p.take_profit_price : mark <= p.take_profit_price;
    const hitSl = p.side === "long" ? mark <= p.stop_loss_price : mark >= p.stop_loss_price;

    if (hitTp || hitSl) {
      const reason = hitTp ? "take_profit" : "stop_loss";
      const { data } = await supabase
        .from("positions")
        .update({
          mark_price: mark,
          pnl_pct: pnlPct,
          pnl_usdt: pnlUsdt,
          status: "closed",
          closed_at: new Date().toISOString(),
          close_reason: reason,
        })
        .eq("id", p.id)
        .select("*")
        .single();
      if (data) closed.push(data as unknown as PaperPosition);
    } else {
      const { data } = await supabase
        .from("positions")
        .update({ mark_price: mark, pnl_pct: pnlPct, pnl_usdt: pnlUsdt })
        .eq("id", p.id)
        .select("*")
        .single();
      if (data) updated.push(data as unknown as PaperPosition);
    }
  }

  return { closed, updated };
}

/** Manually close a paper position at the given price. */
export async function closePaperTrade(
  supabase: SupabaseClient,
  positionId: string,
  exitPrice: number,
  reason: string = "manual",
): Promise<{ ok: true; position: PaperPosition } | { ok: false; error: string }> {
  const { data: p, error: fetchErr } = await supabase
    .from("positions")
    .select("*")
    .eq("id", positionId)
    .single();
  if (fetchErr || !p) return { ok: false, error: fetchErr?.message ?? "Position not found" };

  const pos = p as unknown as PaperPosition;
  const pnlPct = computePnlPct(pos.entry_price, exitPrice, pos.side, pos.leverage);
  const pnlUsdt = (pnlPct / 100) * pos.notional;

  const { data, error } = await supabase
    .from("positions")
    .update({
      mark_price: exitPrice,
      pnl_pct: pnlPct,
      pnl_usdt: pnlUsdt,
      status: "closed",
      closed_at: new Date().toISOString(),
      close_reason: reason,
    })
    .eq("id", positionId)
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, position: data as unknown as PaperPosition };
}

export const PaperTradingEngine = {
  openPaperTrade,
  markAndAutoClose,
  closePaperTrade,
  computePnlPct,
};

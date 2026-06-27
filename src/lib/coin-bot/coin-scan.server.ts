/**
 * Coin Paper Bot — server-only scan engine.
 * Shared by the user-triggered server function (runCoinScan) and the
 * cron hook (/api/public/hooks/coin-scan). Kept separate from futures.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchFuturesTickers,
  fetchMultiTimeframe,
  type NormalizedTicker,
} from "@/services/coindcxPublicApi";
import { scoreCoin } from "./scorer";

export type CoinMode = "intraday" | "swing";

export type CoinCfg = {
  user_id: string;
  enabled: boolean;
  mode: CoinMode;
  allocated_capital_usdt: number;
  available_cash_usdt: number;
  max_holdings: number;
  min_confidence: number;
  scan_interval_min: number;
  max_holding_days: number;
  hold_until_trend_reversal: boolean;
  universe_size: number;
};

export type ScanResult =
  | {
      ok: true;
      scanned: number;
      signals: number;
      auto_opened: number;
      auto_closed: number;
      errors: number;
    }
  | { ok: false; error: string };

export async function runCoinScanFor(
  supabase: SupabaseClient,
  userId: string,
  cfg: CoinCfg,
): Promise<ScanResult> {
  let tickers: NormalizedTicker[] = [];
  try {
    tickers = await fetchFuturesTickers();
  } catch {
    return { ok: false, error: "Public market data unavailable" };
  }

  const universe = tickers
    .filter((t) => t.symbol.endsWith("_USDT"))
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, Math.max(10, Math.min(150, cfg.universe_size)));

  const { data: openRows } = await supabase
    .from("coin_positions")
    .select("symbol, avg_buy_price, id")
    .eq("user_id", userId)
    .eq("status", "open");
  const holdings = new Map<string, { id: string; avg_buy_price: number }>(
    (openRows ?? []).map((r: any) => [
      r.symbol,
      { id: r.id, avg_buy_price: Number(r.avg_buy_price) },
    ]),
  );

  const heldOnly = Array.from(holdings.keys()).filter((s) => !universe.find((u) => u.symbol === s));
  for (const sym of heldOnly) {
    const t = tickers.find((x) => x.symbol === sym);
    if (t) universe.push(t);
  }

  const signalsToInsert: any[] = [];
  let errCount = 0;
  const BATCH = 6;
  for (let i = 0; i < universe.length; i += BATCH) {
    const batch = universe.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (t) => {
        try {
          const { m1, m5, m30 } = await fetchMultiTimeframe(t.symbol);
          if (m5.length < 10 && m30.length < 10) return;
          const held = holdings.get(t.symbol);
          const score = scoreCoin({
            symbol: t.symbol,
            display: t.display,
            price: t.price,
            change24hPct: t.change24hPct,
            spreadPct: t.spreadPct,
            m1,
            m5,
            m30,
            holding: !!held,
            avgBuy: held?.avg_buy_price,
            mode: cfg.mode,
            holdUntilTrendReversal: cfg.hold_until_trend_reversal,
          });
          signalsToInsert.push({
            user_id: userId,
            symbol: t.symbol,
            display: t.display,
            action: score.action,
            confidence: score.confidence,
            price: t.price,
            buy_zone_low: t.price * 0.998,
            buy_zone_high: t.price * 1.002,
            target: score.target,
            stop: score.stop,
            reason_short: score.reason_short,
            reason_detail: score.detail,
            mode: cfg.mode,
            status: "active",
          });
        } catch {
          errCount += 1;
        }
      }),
    );
  }

  await supabase
    .from("coin_signals")
    .update({ status: "superseded" })
    .eq("user_id", userId)
    .eq("status", "active");
  if (signalsToInsert.length) {
    await supabase.from("coin_signals").insert(signalsToInsert);
  }

  // Auto-close on sell signals for held symbols
  let autoClosed = 0;
  let cashDelta = 0;
  for (const sig of signalsToInsert) {
    const held = holdings.get(sig.symbol);
    if (!held || sig.action !== "sell") continue;
    const { data: row } = await supabase
      .from("coin_positions")
      .select("*")
      .eq("id", held.id)
      .maybeSingle();
    if (!row || row.status !== "open") continue;
    const proceeds = Number(row.qty) * Number(sig.price);
    const realized = proceeds - Number(row.invested_usdt);
    await supabase
      .from("coin_positions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        exit_price: sig.price,
        exit_reason: `bot:${sig.reason_short}`,
        last_price: sig.price,
        current_value_usdt: proceeds,
        realized_pnl_usdt: realized,
        unrealized_pnl_usdt: 0,
      })
      .eq("id", row.id);
    cashDelta += proceeds;
    autoClosed += 1;
  }

  // Auto-open buys
  let autoOpened = 0;
  if (cfg.enabled) {
    const buys = signalsToInsert
      .filter(
        (s) => s.action === "buy" && s.confidence >= cfg.min_confidence && !holdings.has(s.symbol),
      )
      .sort((a, b) => b.confidence - a.confidence);

    const currentlyOpen = (openRows ?? []).length - autoClosed;
    const slots = Math.max(0, cfg.max_holdings - currentlyOpen);
    const perTradeUsdt = cfg.allocated_capital_usdt / cfg.max_holdings;

    let cash = Number(cfg.available_cash_usdt) + cashDelta;
    for (const s of buys.slice(0, slots)) {
      if (cash < perTradeUsdt) break;
      const qty = perTradeUsdt / Number(s.price);
      const maxHoldUntil =
        cfg.mode === "swing"
          ? new Date(Date.now() + cfg.max_holding_days * 24 * 60 * 60 * 1000).toISOString()
          : null;
      await supabase.from("coin_positions").insert({
        user_id: userId,
        symbol: s.symbol,
        display: s.display,
        qty,
        avg_buy_price: s.price,
        last_price: s.price,
        invested_usdt: perTradeUsdt,
        current_value_usdt: perTradeUsdt,
        status: "open",
        mode: cfg.mode,
        source: "bot",
        target_price: s.target,
        stop_price: s.stop,
        max_holding_until: maxHoldUntil,
        open_reason: `bot:${s.reason_short}`,
      });
      cash -= perTradeUsdt;
      cashDelta -= perTradeUsdt;
      autoOpened += 1;
    }
  }

  if (cashDelta !== 0) {
    await supabase
      .from("coin_bot_config")
      .update({
        available_cash_usdt: Number(cfg.available_cash_usdt) + cashDelta,
      })
      .eq("user_id", userId);
  }

  return {
    ok: true,
    scanned: universe.length,
    signals: signalsToInsert.length,
    auto_opened: autoOpened,
    auto_closed: autoClosed,
    errors: errCount,
  };
}

export async function runCoinScanAll(supabase: SupabaseClient) {
  const { data: cfgs } = await supabase.from("coin_bot_config").select("*").eq("enabled", true);
  const results: Array<{ user_id: string } & ScanResult> = [];
  for (const cfg of (cfgs ?? []) as CoinCfg[]) {
    try {
      const r = await runCoinScanFor(supabase, cfg.user_id, cfg);
      results.push({ user_id: cfg.user_id, ...r });
    } catch (e) {
      results.push({
        user_id: cfg.user_id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { users: results.length, results };
}

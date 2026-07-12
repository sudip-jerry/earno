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
import { isGloballyBlacklisted } from "@/lib/global-symbol-blacklist";

export type CoinMode = "intraday" | "swing";

export type CoinCfg = {
  user_id: string;
  enabled: boolean;
  mode: CoinMode;
  trading_style?: string;
  allocated_capital_usdt: number;
  available_cash_usdt: number;
  max_holdings: number;
  min_confidence: number;
  scan_interval_min: number;
  max_holding_days: number;
  hold_until_trend_reversal: boolean;
  universe_size: number;
  symbol_blocklist?: string[];
  symbol_stop_cooldown_minutes?: number;
  live_mode?: boolean;
  // Universe-breadth regime gate: when true, NO new buys while most of the coin
  // universe is falling (24h breadth < 45%). Two-window replay showed every
  // long-only entry rule bleeds in a red week (−$268/7d live) while sitting in
  // USDT is free — regime is the first-order effect, entry choice second-order.
  regime_gate_enabled?: boolean | null;
  // Entry-rule A/B: 'donchian' requires a fresh N-bar-high breakout (top of the
  // replay table in every window: PF 1.48-1.51 in up-tapes) instead of the
  // default climax trigger, which replay showed is indistinguishable from
  // random entries. Null/other = current behavior (control arm).
  entry_rule?: string | null;
};

async function logCoinEvent(
  supabase: SupabaseClient,
  userId: string,
  level: "info" | "warn" | "error",
  kind: string,
  message: string,
  meta?: Record<string, unknown>,
) {
  try {
    await supabase.from("coin_bot_events").insert({
      user_id: userId,
      level,
      kind,
      message,
      meta: meta ?? {},
    });
  } catch {
    // never throw from logging
  }
}

/**
 * Detects exchange error strings that mean "this market is not tradeable".
 * Used to auto-mark a symbol inactive in coin_universe so no user's scanner
 * tries to trade it again until market_details flips it back to active.
 */
function isDelistedError(err: string | undefined | null): boolean {
  if (!err) return false;
  const e = err.toLowerCase();
  return (
    e.includes("inactive") ||
    e.includes("invalid market") ||
    e.includes("market not found") ||
    e.includes("not tradeable") ||
    e.includes("not tradable") ||
    e.includes("suspended") ||
    e.includes("delisted") ||
    e.includes("market status")
  );
}

async function markSymbolInactive(supabase: SupabaseClient, symbol: string) {
  try {
    await supabase.from("coin_universe").upsert(
      { symbol, status: "inactive", updated_at: new Date().toISOString() },
      { onConflict: "symbol" },
    );
  } catch {
    // never throw from housekeeping
  }
}




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
  // Defence-in-depth: if live_mode is on, verify the user still has a plan
  // tier that allows live execution. If not, force-disable live and run paper.
  if (cfg.live_mode) {
    try {
      const [{ data: tier }, { data: settings }] = await Promise.all([
        supabase.rpc("current_plan_tier", { _user_id: userId }),
        supabase.from("app_settings").select("paywall_enabled").eq("id", 1).maybeSingle(),
      ]);
      const paywall = (settings as { paywall_enabled?: boolean } | null)?.paywall_enabled ?? true;
      const allowed = tier === "auto5" || tier === "unlimited";
      if (paywall && !allowed) {
        await supabase.from("coin_bot_config").update({ live_mode: false }).eq("user_id", userId);
        await logCoinEvent(supabase, userId, "warn", "live_mode_disabled",
          "Coin bot live mode disabled: current plan does not allow live trading.");
        cfg = { ...cfg, live_mode: false };
      }
    } catch {
      // If the check itself fails, fall back to paper for safety.
      cfg = { ...cfg, live_mode: false };
    }
  }

  let tickers: NormalizedTicker[] = [];
  try {
    tickers = await fetchFuturesTickers();
  } catch {
    await logCoinEvent(supabase, userId, "error", "scan_error", "Public market data unavailable");
    return { ok: false, error: "Public market data unavailable" };
  }


  // Minimum 24h volume threshold — filters out delisted, suspended, or
  // near-zero-liquidity coins that may still appear in the ticker feed
  // but cannot be reliably traded. $50,000 USDT is a conservative floor.
  const MIN_VOLUME_USDT = 50_000;
  // Any symbol with a wider bid/ask spread than this is either dead or
  // has such thin liquidity that market orders will slip badly. Skip.
  const MAX_SPREAD_PCT = 1.5;

  // Load active symbols from coin_universe (nightly cached, zero API overhead)
  // Falls back to no filter if table is empty (first run before nightly cron fires)
  const { data: universeRows } = await supabase
    .from("coin_universe")
    .select("symbol")
    .eq("status", "active");
  const activeSymbols = new Set((universeRows ?? []).map((r) => r.symbol as string));
  const statusFilterEnabled = activeSymbols.size > 0;

  const universe = tickers
    .filter((t) => {
      if (!t.symbol.endsWith("_USDT")) return false;
      // Platform-wide blacklist (e.g. NFP) — never trade regardless of config.
      if (isGloballyBlacklisted(t.symbol)) return false;
      if (t.volume24h < MIN_VOLUME_USDT) return false;
      if (statusFilterEnabled && !activeSymbols.has(t.symbol)) return false;
      // Runtime "dead symbol" filter — works even when market_details is unavailable.
      // A live trading pair always has some price movement over 24h; a symbol with
      // exactly 0.0% change AND tiny volume is delisted/frozen even if the ticker
      // feed still returns a last price.
      if (t.change24hPct === 0 && t.volume24h < 500_000) return false;
      // Wide spread = illiquid or halted. Skip if bid/ask are available.
      if (t.spreadPct != null && t.spreadPct > MAX_SPREAD_PCT) return false;
      // Missing bid/ask on high-volume names is fine (feed sometimes omits them);
      // but missing bid/ask AND low-ish volume is a delisting signature.
      if (t.bid == null && t.ask == null && t.volume24h < 200_000) return false;
      return true;
    })
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
  // Fresh-high (Donchian) flags per symbol for the 'donchian' entry-rule arm —
  // computed here where candles are in scope; NOT persisted on coin_signals.
  const freshHighOk = new Map<string, boolean>();
  let errCount = 0;
  const BATCH = 6;
  for (let i = 0; i < universe.length; i += BATCH) {
    const batch = universe.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (t) => {
        try {
          const { m1, m5, m30 } = await fetchMultiTimeframe(t.symbol);
          let h4: import("@/services/coindcxPublicApi").Candle[] = [];
          let d1: import("@/services/coindcxPublicApi").Candle[] = [];
          if (cfg.mode === "swing") {
            const { fetchH4DailyCandles } = await import("@/services/coindcxPublicApi");
            const swing = await fetchH4DailyCandles(t.symbol).catch(() => ({ h4: [], d1: [] }));
            h4 = swing.h4;
            d1 = swing.d1;
          }
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
            h4,
            d1,
            holding: !!held,
            avgBuy: held?.avg_buy_price,
            mode: cfg.mode,
            holdUntilTrendReversal: cfg.hold_until_trend_reversal,
          });
          // Fresh-high check for the donchian entry arm: price breaking above the
          // prior 20-bar high on the highest-timeframe series available (h4 in
          // swing mode, m30 fallback) — catches expansion early instead of buying
          // stretched momentum late.
          {
            const series = h4.length >= 12 ? h4 : m30;
            if (series.length >= 12) {
              const prior = series.slice(0, -1).slice(-20);
              const hi = Math.max(...prior.map((c) => c.high));
              freshHighOk.set(t.symbol, hi > 0 && t.price > hi);
            } else {
              freshHighOk.set(t.symbol, false);
            }
          }
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

  await logCoinEvent(
    supabase,
    userId,
    "info",
    "scan",
    `Scan complete: ${universe.length} coins, ${signalsToInsert.length} signals`,
    {
      scanned: universe.length,
      signals: signalsToInsert.length,
      mode: cfg.mode,
      trading_style: cfg.trading_style,
    },
  );


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
    const buyFee = Number(row.invested_usdt) * 0.001;
    const sellFee = proceeds * 0.001;
    const realized = proceeds - Number(row.invested_usdt) - buyFee - sellFee;
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
    holdings.delete(sig.symbol);
    await logCoinEvent(
      supabase,
      userId,
      "info",
      "auto_sell",
      `Auto-sold ${row.symbol} · reason: ${sig.reason_short} · realized: ${realized.toFixed(4)} USDT`,
      {
        symbol: row.symbol,
        realized_pnl_usdt: realized,
        exit_reason: sig.reason_short,
        price: sig.price,
      },
    );

    // Live execution for sell
    if (cfg.live_mode) {
      const { loadCoinLiveCreds, placeCoinLiveSell, toSpotPair } = await import("./coin-live-execution.server");
      const creds = await loadCoinLiveCreds(supabase, userId);
      if (creds) {
        const exec = await placeCoinLiveSell({
          creds,
          pair: toSpotPair(row.symbol as string),
          totalQuantity: Number(row.qty),
        });
        if (!exec.ok) {
          await logCoinEvent(supabase, userId, "error", "live_sell_failed",
            `Live sell failed for ${row.symbol}: ${exec.error}`,
            { symbol: row.symbol, error: exec.error });
        } else {
          await logCoinEvent(supabase, userId, "info", "live_sell",
            `Live sell placed for ${row.symbol} · order: ${exec.orderId}`,
            { symbol: row.symbol, order_id: exec.orderId });
        }
      } else {
        await logCoinEvent(supabase, userId, "warn", "live_sell_no_creds",
          `Live mode enabled but no API credentials for ${userId}`);
      }
    }
  }

  // --- Stop-loss and target-price enforcement ---
  // Runs for ALL held positions regardless of signal direction.
  // This is the safety net that sell signals alone cannot provide.
  for (const [sym, held] of holdings) {
    if (!holdings.has(sym)) continue;
    const ticker = universe.find((u) => u.symbol === sym);
    const currentPrice = ticker?.price ?? null;
    if (!currentPrice) continue;

    const { data: row } = await supabase
      .from("coin_positions")
      .select("*")
      .eq("id", held.id)
      .maybeSingle();
    if (!row || row.status !== "open") continue;

    const stopPrice = row.stop_price != null ? Number(row.stop_price) : null;
    const targetPrice = row.target_price != null ? Number(row.target_price) : null;
    const investedUsdt = Number(row.invested_usdt);
    const qty = Number(row.qty);
    const proceeds = qty * currentPrice;
    const buyFee = investedUsdt * 0.001;
    const sellFee = proceeds * 0.001;
    const realized = proceeds - investedUsdt - buyFee - sellFee;

    let exitReason: string | null = null;
    if (stopPrice !== null && currentPrice <= stopPrice) {
      exitReason = "bot:Stop level reached";
    } else if (targetPrice !== null && currentPrice >= targetPrice) {
      exitReason = "bot:Target reached";
    } else if (
      row.max_holding_until &&
      new Date(row.max_holding_until) <= new Date()
    ) {
      exitReason = "bot:Max holding time reached";
    }

    if (!exitReason) continue;

    await supabase
      .from("coin_positions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        exit_price: currentPrice,
        exit_reason: exitReason,
        last_price: currentPrice,
        current_value_usdt: proceeds,
        realized_pnl_usdt: realized,
        unrealized_pnl_usdt: 0,
      })
      .eq("id", row.id);

    cashDelta += proceeds;
    autoClosed += 1;
    holdings.delete(sym);

    await logCoinEvent(
      supabase,
      userId,
      realized >= 0 ? "info" : "warn",
      exitReason.startsWith("bot:Stop")
        ? "stop_hit"
        : exitReason.startsWith("bot:Target")
          ? "target_hit"
          : "time_exit",
      `${exitReason.replace("bot:", "")} ${sym} @ ${currentPrice} · realized: ${realized.toFixed(4)} USDT`,
      {
        symbol: sym,
        realized_pnl_usdt: realized,
        exit_reason: exitReason,
        price: currentPrice,
        stop_price: stopPrice,
        target_price: targetPrice,
      },
    );

    // Live execution for sell
    if (cfg.live_mode) {
      const { loadCoinLiveCreds, placeCoinLiveSell, toSpotPair } = await import("./coin-live-execution.server");
      const creds = await loadCoinLiveCreds(supabase, userId);
      if (creds) {
        const exec = await placeCoinLiveSell({
          creds,
          pair: toSpotPair(sym),
          totalQuantity: qty,
        });
        if (!exec.ok) {
          await logCoinEvent(supabase, userId, "error", "live_sell_failed",
            `Live sell failed for ${sym}: ${exec.error}`,
            { symbol: sym, error: exec.error });
        } else {
          await logCoinEvent(supabase, userId, "info", "live_sell",
            `Live sell placed for ${sym} · order: ${exec.orderId}`,
            { symbol: sym, order_id: exec.orderId });
        }
      } else {
        await logCoinEvent(supabase, userId, "warn", "live_sell_no_creds",
          `Live mode enabled but no API credentials for ${userId}`);
      }
    }
  }
  // --- Mark-to-market: write live prices back to DB for remaining open positions ---
  const markUpdates: Promise<unknown>[] = [];
  for (const [sym, held] of holdings) {
    const ticker = universe.find((u) => u.symbol === sym);
    const currentPrice = ticker?.price;
    if (!currentPrice) continue;

    const { data: row } = await supabase
      .from("coin_positions")
      .select("qty, invested_usdt, avg_buy_price, stop_price, target_price, mode")
      .eq("id", held.id)
      .maybeSingle();
    if (!row || !row.qty) continue;

    const qty = Number(row.qty);
    const invested = Number(row.invested_usdt);
    const currentValue = qty * currentPrice;
    const unrealized = currentValue - invested;

    const update: Record<string, unknown> = {
      last_price: currentPrice,
      current_value_usdt: currentValue,
      unrealized_pnl_usdt: unrealized,
      updated_at: new Date().toISOString(),
    };

    // Breakeven safety net (swing only): ratchet the stop up to entry once the
    // position is far enough in profit. The arm point scales to the position's own
    // target (40% of the way to target, floor +0.8%) — so a low-vol major with a
    // ~+2.5% target arms at +1% (a +1% pop no longer gives back to a loss), while a
    // volatile alt with a +8% target arms at ~+3.2%. Only tightens a winner's stop.
    const avgBuy = Number(row.avg_buy_price);
    const stopPrice = row.stop_price != null ? Number(row.stop_price) : null;
    const targetPrice = row.target_price != null ? Number(row.target_price) : null;
    if (row.mode === "swing" && avgBuy > 0 && stopPrice != null && stopPrice < avgBuy) {
      const pnlPct = ((currentPrice - avgBuy) / avgBuy) * 100;
      const targetPct = targetPrice != null && targetPrice > avgBuy
        ? ((targetPrice / avgBuy) - 1) * 100
        : 8;
      const beArmPct = Math.max(0.8, targetPct * 0.4);
      if (pnlPct >= beArmPct) {
        update.stop_price = avgBuy;
      }
    }

    markUpdates.push(
      Promise.resolve(
        supabase.from("coin_positions").update(update).eq("id", held.id)
      )
    );
  }
  await Promise.all(markUpdates);

  // --- Symbol stop cooldown: track recent stop hits to prevent re-entry ---
  // 6h window (matches the futures hard-SL cooldown) so a coin that stops out is
  // not re-bought later the same session after a short window expires.
  const stopCooldownMs = Math.max(60, Number(cfg.symbol_stop_cooldown_minutes ?? 360)) * 60_000;
  const cooldownSince = new Date(Date.now() - stopCooldownMs).toISOString();
  const { data: recentStops } = await supabase
    .from("coin_positions")
    .select("symbol, closed_at")
    .eq("user_id", userId)
    .eq("exit_reason", "bot:Stop level reached")
    .gte("closed_at", cooldownSince)
    .order("closed_at", { ascending: false });

  const stopHitCount = new Map<string, number>();
  for (const row of recentStops ?? []) {
    const sym = row.symbol as string;
    stopHitCount.set(sym, (stopHitCount.get(sym) ?? 0) + 1);
  }

  // Auto-open buys

  let autoOpened = 0;
  if (cfg.enabled) {
    const blocklist = new Set(cfg.symbol_blocklist ?? []);
    // Block a symbol after its FIRST stop within the cooldown window — re-buying a
    // coin that just stopped (on a falling tape) was the dominant loss driver.
    const MAX_STOPS_BEFORE_COOLDOWN = 1;

    // Universe-breadth regime gate: share of the scanned universe with a positive
    // 24h change. When most of the universe is falling, long-only entries bleed
    // regardless of entry rule (two-window replay: every rule −25..−75 in the red
    // week while USDT was free) — so below the floor, no NEW buys; exits keep
    // managing holdings. Uses ticker data already in hand: zero extra fetches.
    const REGIME_BREADTH_FLOOR = 0.45;
    const breadthUniverse = universe.filter((t) => Number.isFinite(t.change24hPct));
    const breadth = breadthUniverse.length
      ? breadthUniverse.filter((t) => t.change24hPct > 0).length / breadthUniverse.length
      : 1;
    const regimeBlocked = cfg.regime_gate_enabled === true && breadth < REGIME_BREADTH_FLOOR;

    let buys = signalsToInsert
      .filter(
        (s) =>
          s.action === "buy" &&
          s.confidence >= cfg.min_confidence &&
          !holdings.has(s.symbol) &&
          !blocklist.has(s.symbol) &&
          (stopHitCount.get(s.symbol) ?? 0) < MAX_STOPS_BEFORE_COOLDOWN,
      )
      .sort((a, b) => b.confidence - a.confidence);

    if (regimeBlocked && buys.length) {
      await logCoinEvent(
        supabase,
        userId,
        "info",
        "regime_gate_skip",
        `Regime gate: no new buys — only ${(breadth * 100).toFixed(0)}% of universe positive over 24h (< ${REGIME_BREADTH_FLOOR * 100}%)`,
        { breadth: Number(breadth.toFixed(3)), floor: REGIME_BREADTH_FLOOR, blocked_buys: buys.length },
      );
      buys = [];
    }

    // Entry-rule A/B arm: 'donchian' books only fresh 20-bar-high breakouts.
    if (cfg.entry_rule === "donchian" && buys.length) {
      const rejected = buys.filter((s) => !freshHighOk.get(s.symbol));
      buys = buys.filter((s) => freshHighOk.get(s.symbol) === true);
      if (rejected.length) {
        await logCoinEvent(
          supabase,
          userId,
          "info",
          "entry_rule_skip",
          `Entry rule (donchian): ${rejected.length} buy signal(s) skipped — no fresh 20-bar high`,
          { rule: "donchian", skipped: rejected.map((s) => s.symbol).slice(0, 10), passed: buys.length },
        );
      }
    }

    // Log symbols skipped due to stop cooldown
    for (const s of signalsToInsert.filter(
      (s) =>
        s.action === "buy" &&
        s.confidence >= cfg.min_confidence &&
        !holdings.has(s.symbol) &&
        !blocklist.has(s.symbol) &&
        (stopHitCount.get(s.symbol) ?? 0) >= MAX_STOPS_BEFORE_COOLDOWN,
    )) {
      await logCoinEvent(
        supabase,
        userId,
        "warn",
        "stop_cooldown_skip",
        `Skipped ${s.symbol}: ${stopHitCount.get(s.symbol)} stop(s) in last ${Math.round(stopCooldownMs / 60_000)}min cooldown window`,
        {
          symbol: s.symbol,
          stop_count: stopHitCount.get(s.symbol),
          cooldown_minutes: Math.round(stopCooldownMs / 60_000),
        },
      );
    }


    const currentlyOpen = (openRows ?? []).length - autoClosed;
    const slots = Math.max(0, cfg.max_holdings - currentlyOpen);
    const perTradeUsdt = cfg.allocated_capital_usdt / cfg.max_holdings;

    let cash = Number(cfg.available_cash_usdt) + cashDelta;
    for (const s of buys.slice(0, slots)) {
      if (cash < perTradeUsdt) {
        await logCoinEvent(
          supabase,
          userId,
          "warn",
          "skip",
          `Skipped ${s.symbol}: insufficient cash (${cash.toFixed(2)} < ${perTradeUsdt.toFixed(2)} USDT)`,
          { symbol: s.symbol, available_cash: cash, required: perTradeUsdt },
        );
        break;
      }
      const buyFee = perTradeUsdt * 0.001;
      const investedAfterFee = perTradeUsdt - buyFee;
      const qty = investedAfterFee / Number(s.price);
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
      await logCoinEvent(
        supabase,
        userId,
        "info",
        "auto_buy",
        `Auto-bought ${s.symbol} · ${qty.toFixed(6)} units @ ${s.price} · invested: ${perTradeUsdt.toFixed(2)} USDT`,
        {
          symbol: s.symbol,
          qty,
          price: s.price,
          invested_usdt: perTradeUsdt,
          confidence: s.confidence,
          mode: cfg.mode,
        },
      );

      // Live execution for buy
      if (cfg.live_mode) {
        const { loadCoinLiveCreds, placeCoinLiveBuy, toSpotPair } = await import("./coin-live-execution.server");
        const creds = await loadCoinLiveCreds(supabase, userId);
        if (creds) {
          const exec = await placeCoinLiveBuy({
            creds,
            pair: toSpotPair(s.symbol),
            totalQuantity: qty,
          });
          if (!exec.ok) {
            await logCoinEvent(supabase, userId, "error", "live_buy_failed",
              `Live buy failed for ${s.symbol}: ${exec.error}`,
              { symbol: s.symbol, error: exec.error });
            if (isDelistedError(exec.error)) {
              await markSymbolInactive(supabase, s.symbol);
              await logCoinEvent(supabase, userId, "warn", "symbol_auto_inactive",
                `Auto-marked ${s.symbol} inactive after live-buy rejection: ${exec.error}`,
                { symbol: s.symbol, error: exec.error });
            }
          } else {
            await logCoinEvent(supabase, userId, "info", "live_buy",
              `Live buy placed for ${s.symbol} · order: ${exec.orderId}`,
              { symbol: s.symbol, order_id: exec.orderId, qty });
          }
        } else {
          await logCoinEvent(supabase, userId, "warn", "live_buy_no_creds",
            `Live mode enabled but no API credentials for ${userId}`);
        }
      }
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
  const { data: cfgs } = await supabase
    .from("coin_bot_config")
    .select("*")
    .eq("enabled", true);

  const now = Date.now();
  const results: Array<{ user_id: string } & ScanResult> = [];

  for (const cfg of (cfgs ?? []) as CoinCfg[]) {
    const intervalMs = Math.max(1, cfg.scan_interval_min ?? 5) * 60_000;
    const { data: lastScanRow } = await supabase
      .from("coin_bot_events")
      .select("created_at")
      .eq("user_id", cfg.user_id)
      .eq("kind", "scan")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastScanRow?.created_at) {
      const lastScanMs = new Date(lastScanRow.created_at).getTime();
      if (now - lastScanMs < intervalMs) continue;
    }

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

/**
 * Lightweight every-minute stop/target enforcement pass for coin_positions.
 *
 * Decoupled from the heavy 5-minute scoring/universe scan so a coin that
 * breaches its stop is closed within ~1 minute instead of bleeding 5-40
 * minutes past its level. Only checks stop_price / target_price — the full
 * scan still owns scoring, entries, mark-to-market, and everything else.
 *
 * Reads all open positions in a single query, prices them via the futures
 * bulk ticker, and per-symbol falls back to the futures candlestick + spot
 * lookups from the auto-book helpers for anything the bulk ticker omits.
 * A holding that cannot be priced from any source logs a warn
 * "mark_price_unavailable" coin event instead of being silently skipped.
 */
export async function runCoinEnforcePass(supabase: SupabaseClient): Promise<{
  checked: number;
  closed: number;
  unpriced: number;
}> {
  const { data: openRows } = await supabase
    .from("coin_positions")
    .select("*")
    .eq("status", "open");
  const positions = (openRows ?? []) as Array<Record<string, unknown>>;
  if (!positions.length) return { checked: 0, closed: 0, unpriced: 0 };

  const symbols = Array.from(new Set(positions.map((p) => p.symbol as string)));

  // Bulk ticker first (keeps its own 5s timeout).
  const priceMap = new Map<string, number>();
  try {
    const tickers = await fetchFuturesTickers();
    for (const t of tickers) {
      if (t.price > 0) priceMap.set(t.symbol, t.price);
    }
  } catch {
    // fall through to per-symbol fallback
  }

  // Per-symbol fallback for anything still missing — reuse auto-book helpers
  // (futures candles + spot ticker in parallel, 2s each).
  const missing = symbols.filter((s) => !priceMap.has(s));
  if (missing.length) {
    const { fetchMarkPrices } = await import("@/lib/auto-book.server");
    const fallback = await fetchMarkPrices(missing);
    for (const [sym, p] of Object.entries(fallback)) {
      if (p > 0) priceMap.set(sym, p);
    }
  }

  // Load per-user live_mode flag so live sells still route to the exchange.
  const userIds = Array.from(new Set(positions.map((p) => p.user_id as string)));
  const { data: cfgRows } = await supabase
    .from("coin_bot_config")
    .select("user_id, live_mode")
    .in("user_id", userIds);
  const liveByUser = new Map(
    (cfgRows ?? []).map((r) => [r.user_id as string, Boolean(r.live_mode)]),
  );

  let closed = 0;
  let unpriced = 0;
  const warnedKeys = new Set<string>();

  for (const row of positions) {
    const sym = row.symbol as string;
    const userId = row.user_id as string;
    const currentPrice = priceMap.get(sym) ?? 0;

    if (!(currentPrice > 0)) {
      const key = `${userId}:${sym}`;
      if (!warnedKeys.has(key)) {
        warnedKeys.add(key);
        unpriced += 1;
        await logCoinEvent(
          supabase,
          userId,
          "warn",
          "mark_price_unavailable",
          `Could not price ${sym} from any source`,
          { symbol: sym, position_id: row.id },
        );
      }
      continue;
    }

    const stopPrice = row.stop_price != null ? Number(row.stop_price) : null;
    const targetPrice = row.target_price != null ? Number(row.target_price) : null;

    let exitReason: string | null = null;
    if (stopPrice !== null && currentPrice <= stopPrice) {
      exitReason = "bot:Stop level reached";
    } else if (targetPrice !== null && currentPrice >= targetPrice) {
      exitReason = "bot:Target reached";
    }
    if (!exitReason) continue;

    const qty = Number(row.qty);
    const investedUsdt = Number(row.invested_usdt);
    const proceeds = qty * currentPrice;
    const buyFee = investedUsdt * 0.001;
    const sellFee = proceeds * 0.001;
    const realized = proceeds - investedUsdt - buyFee - sellFee;

    // Atomic close: only update if still open, so a concurrent 5m scan
    // can't double-close and double-count cash.
    const { data: updated } = await supabase
      .from("coin_positions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        exit_price: currentPrice,
        exit_reason: exitReason,
        last_price: currentPrice,
        current_value_usdt: proceeds,
        realized_pnl_usdt: realized,
        unrealized_pnl_usdt: 0,
      })
      .eq("id", row.id)
      .eq("status", "open")
      .select("id")
      .maybeSingle();
    if (!updated) continue;

    // Credit cash back to the user's coin bot wallet.
    const { data: cfgCash } = await supabase
      .from("coin_bot_config")
      .select("available_cash_usdt")
      .eq("user_id", userId)
      .maybeSingle();
    if (cfgCash) {
      await supabase
        .from("coin_bot_config")
        .update({
          available_cash_usdt: Number(cfgCash.available_cash_usdt ?? 0) + proceeds,
        })
        .eq("user_id", userId);
    }

    closed += 1;

    await logCoinEvent(
      supabase,
      userId,
      realized >= 0 ? "info" : "warn",
      exitReason.startsWith("bot:Stop") ? "stop_hit" : "target_hit",
      `${exitReason.replace("bot:", "")} ${sym} @ ${currentPrice} · realized: ${realized.toFixed(4)} USDT`,
      {
        symbol: sym,
        realized_pnl_usdt: realized,
        exit_reason: exitReason,
        price: currentPrice,
        stop_price: stopPrice,
        target_price: targetPrice,
        source: "enforce_pass",
      },
    );

    // Live sell if enabled for this user.
    if (liveByUser.get(userId)) {
      try {
        const { loadCoinLiveCreds, placeCoinLiveSell, toSpotPair } = await import(
          "./coin-live-execution.server"
        );
        const creds = await loadCoinLiveCreds(supabase, userId);
        if (creds) {
          const exec = await placeCoinLiveSell({
            creds,
            pair: toSpotPair(sym),
            totalQuantity: qty,
          });
          if (!exec.ok) {
            await logCoinEvent(
              supabase,
              userId,
              "error",
              "live_sell_failed",
              `Live sell failed for ${sym}: ${exec.error}`,
              { symbol: sym, error: exec.error },
            );
          } else {
            await logCoinEvent(
              supabase,
              userId,
              "info",
              "live_sell",
              `Live sell placed for ${sym} · order: ${exec.orderId}`,
              { symbol: sym, order_id: exec.orderId },
            );
          }
        }
      } catch (e) {
        await logCoinEvent(
          supabase,
          userId,
          "error",
          "live_sell_failed",
          `Live sell threw for ${sym}: ${e instanceof Error ? e.message : String(e)}`,
          { symbol: sym },
        );
      }
    }
  }

  return { checked: positions.length, closed, unpriced };
}




/**
 * Write a coin_bot_config_audit row for each changed field.
 * Call this from adminUpdateCoinConfig in plans.functions.ts after applying a patch.
 */
export async function auditCoinConfigChange(
  supabase: SupabaseClient,
  userId: string,
  oldCfg: Record<string, unknown>,
  patch: Record<string, unknown>,
  changedBy: "user" | "admin" | "system" = "admin",
) {
  const rows = Object.entries(patch)
    .filter(([k, v]) => oldCfg[k] !== v)
    .map(([field, newVal]) => ({
      user_id: userId,
      field,
      old_value: oldCfg[field] != null ? String(oldCfg[field]) : null,
      new_value: newVal != null ? String(newVal) : null,
      changed_by: changedBy,
    }));

  if (rows.length === 0) return;
  await supabase.from("coin_bot_config_audit").insert(rows);
}


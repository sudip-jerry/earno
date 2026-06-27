/**
 * Futures exit-policy backtest / replay.
 *
 * Replays the pre-TP1 protective exit policy against historical closed
 * positions and reports how many would have exited via the policy vs the
 * actual hard SL / breakeven / other terminal reasons. Read-only: never
 * writes to positions.
 *
 * Strategy:
 *   - Pull closed positions in the window.
 *   - For each position, fetch 1m candles (aggregated to the user's timeframe
 *     is unnecessary — 1m gives the tightest replay) between opened_at and
 *     closed_at.
 *   - Walk the candle high/low path, track peak ROE and current ROE on each
 *     bar, and call evaluateFuturesExit. The first match wins.
 *   - Bucket results: pre_tp1_policy_exit, hard_sl, breakeven_exit,
 *     take_profit, other.
 *
 * Coin module, live trading, and the production mark pass are untouched.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { evaluateFuturesExit } from "@/lib/futures-exit-policy";
import { fetchCandles } from "@/services/coindcxPublicApi";

export type ReplayBucket =
  | "pre_tp1_policy_exit"
  | "hard_sl"
  | "breakeven_exit"
  | "take_profit"
  | "other";

export type ReplayRow = {
  positionId: string;
  symbol: string;
  side: "long" | "short";
  openedAt: string;
  closedAt: string;
  actualExitReason: string | null;
  actualBucket: ReplayBucket;
  policyTriggered: boolean;
  policyTriggerMinutes: number | null;
  policyPeakRoePct: number | null;
  policyCurrentRoePct: number | null;
  /** Final bucket after applying the replay policy (policy wins over hard SL). */
  replayBucket: ReplayBucket;
};

export type ReplaySummary = {
  total: number;
  windowStart: string;
  windowEnd: string;
  actual: Record<ReplayBucket, number>;
  replay: Record<ReplayBucket, number>;
  /** Net change per bucket (replay - actual). Positive means more in this bucket after policy. */
  delta: Record<ReplayBucket, number>;
  rows: ReplayRow[];
};

function classifyActual(p: {
  exit_reason: string | null;
  pnl_pct: number | null;
}): ReplayBucket {
  const r = String(p.exit_reason ?? "").toLowerCase();
  if (r === "take_profit") return "take_profit";
  if (r === "stop_loss") return "hard_sl";
  if (r === "breakeven_exit") return "breakeven_exit";
  return "other";
}

function emptyCounter(): Record<ReplayBucket, number> {
  return {
    pre_tp1_policy_exit: 0,
    hard_sl: 0,
    breakeven_exit: 0,
    take_profit: 0,
    other: 0,
  };
}

export const replayFuturesExitPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sinceHours?: number; limit?: number }) =>
    z
      .object({
        sinceHours: z.number().int().min(1).max(720).default(72),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<ReplaySummary> => {
    const { supabase, userId } = context;
    const sinceMs = Date.now() - data.sinceHours * 3600_000;
    const windowStart = new Date(sinceMs).toISOString();
    const windowEnd = new Date().toISOString();

    const { data: cfgRow } = await supabase
      .from("bot_config")
      .select("strategy,trading_style")
      .eq("user_id", userId)
      .maybeSingle();

    const { data: rowsRaw, error } = await supabase
      .from("positions")
      .select(
        "id,symbol,side,leverage,entry_price,opened_at,closed_at,exit_reason,pnl_pct,tp1_hit,tp1_hit_at",
      )
      .eq("user_id", userId)
      .eq("status", "closed")
      .eq("mode", "paper")
      .gte("closed_at", windowStart)
      .order("closed_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);

    const rows = (rowsRaw ?? []) as Array<{
      id: string;
      symbol: string;
      side: "long" | "short";
      leverage: number;
      entry_price: number;
      opened_at: string;
      closed_at: string;
      exit_reason: string | null;
      pnl_pct: number | null;
      tp1_hit: boolean | null;
      tp1_hit_at: string | null;
    }>;

    const actual = emptyCounter();
    const replay = emptyCounter();
    const out: ReplayRow[] = [];

    for (const p of rows) {
      const actualBucket = classifyActual(p);
      actual[actualBucket]++;

      const openedAt = new Date(p.opened_at).getTime();
      const closedAt = new Date(p.closed_at).getTime();
      const tp1HitAt = p.tp1_hit_at ? new Date(p.tp1_hit_at).getTime() : null;

      // Fetch 1m candles around the trade. Limit padded to cover window.
      const minutes = Math.max(1, Math.ceil((closedAt - openedAt) / 60_000));
      const limit = Math.min(500, minutes + 5);
      let candles: Awaited<ReturnType<typeof fetchCandles>> = [];
      try {
        candles = await fetchCandles(p.symbol, "1m", limit);
      } catch {
        candles = [];
      }

      // Keep only bars overlapping the trade window.
      const bars = candles
        .filter((c) => typeof c.time === "number" && c.time! >= openedAt && c.time! <= closedAt)
        .sort((a, b) => (a.time! - b.time!));

      const sideMul = p.side === "long" ? 1 : -1;
      const entry = Number(p.entry_price);
      const lev = Number(p.leverage);
      let peakRoe = 0;
      let policyHit: ReplayRow["policyTriggered"] = false;
      let policyMin: number | null = null;
      let policyPeak: number | null = null;
      let policyCur: number | null = null;

      for (const c of bars) {
        const t = c.time!;
        // Pre-TP1 only — stop replay once TP1 was actually hit.
        if (tp1HitAt != null && t >= tp1HitAt) break;

        // Per-bar extremes (favourable then adverse) — adverse wins to be
        // conservative on the "current ROE" leg.
        const extremes = p.side === "long" ? [c.high, c.low] : [c.low, c.high];
        for (const price of extremes) {
          if (entry <= 0) continue;
          const roe = ((price - entry) / entry) * 100 * sideMul * lev;
          peakRoe = Math.max(peakRoe, roe);
          const heldMin = (t - openedAt) / 60_000;
          const decision = evaluateFuturesExit(
            { tp1Hit: false, heldMinutes: heldMin, peakRoePct: peakRoe, currentRoePct: roe },
            { strategyType: cfgRow?.strategy ?? null, tradingStyle: cfgRow?.trading_style ?? null },
          );
          if (decision) {
            policyHit = true;
            policyMin = Math.round(heldMin * 10) / 10;
            policyPeak = Math.round(peakRoe * 100) / 100;
            policyCur = Math.round(roe * 100) / 100;
            break;
          }
        }
        if (policyHit) break;
      }

      // Replay bucket: policy wins if it would have fired before the actual exit;
      // otherwise keep the actual bucket.
      const replayBucket: ReplayBucket = policyHit ? "pre_tp1_policy_exit" : actualBucket;
      replay[replayBucket]++;

      out.push({
        positionId: p.id,
        symbol: p.symbol,
        side: p.side,
        openedAt: p.opened_at,
        closedAt: p.closed_at,
        actualExitReason: p.exit_reason,
        actualBucket,
        policyTriggered: policyHit,
        policyTriggerMinutes: policyMin,
        policyPeakRoePct: policyPeak,
        policyCurrentRoePct: policyCur,
        replayBucket,
      });
    }

    const delta = emptyCounter();
    (Object.keys(delta) as ReplayBucket[]).forEach((k) => {
      delta[k] = replay[k] - actual[k];
    });

    return {
      total: rows.length,
      windowStart,
      windowEnd,
      actual,
      replay,
      delta,
      rows: out,
    };
  });

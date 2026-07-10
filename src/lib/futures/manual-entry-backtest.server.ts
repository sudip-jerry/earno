/**
 * Manual-entry FILTER backtest (server-only; needs CoinDCX network access, so it
 * runs on the deployed edge, not the sandbox).
 *
 * For each REAL closed futures LONG trade, refetch the 30m + 1m candles as they
 * were at entry, evaluate the manual entry rule (manual-entry.ts), and compare
 * the realized outcomes of trades the rule WOULD have taken (pass) vs. skipped
 * (fail). This tells us whether the rule is a good entry filter before we wire
 * it into the live scan — it does NOT generate new entries.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateManualEntry,
  DEFAULT_MANUAL_ENTRY_PARAMS,
  type ManualEntryParams,
  type MECandle,
} from "@/lib/futures/manual-entry";

const HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; Earn'O/1.0; +https://earno.lovable.app)",
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Fetch OHLC candles for a futures pair at a given resolution (minutes). */
async function fetchCandles(
  pair: string,
  fromSec: number,
  toSec: number,
  resolution: number,
): Promise<MECandle[]> {
  if (!pair.startsWith("B-")) return [];
  const url = `https://public.coindcx.com/market_data/candlesticks?pair=${encodeURIComponent(
    pair,
  )}&from=${fromSec}&to=${toSec}&resolution=${resolution}&pcode=f`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const payload = (await res.json()) as { data?: unknown };
    const arr = Array.isArray(payload?.data) ? (payload.data as Record<string, unknown>[]) : [];
    return arr
      .map((r) => {
        const tMs = num(r.time ?? 0);
        return {
          time: Math.floor(tMs > 1e12 ? tMs / 1000 : tMs),
          open: num(r.open),
          high: num(r.high),
          low: num(r.low),
          close: num(r.close),
        };
      })
      .filter((c) => c.time > 0 && c.close > 0)
      .sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}

type Group = { n: number; wins: number; grossWin: number; grossLoss: number; net: number };
type Summary = {
  n: number;
  winRate: number;
  profitFactor: number | null;
  expectancy: number;
  net: number;
};

function summarize(g: Group): Summary {
  return {
    n: g.n,
    winRate: g.n ? Math.round((100 * g.wins) / g.n) : 0,
    profitFactor: g.grossLoss > 0 ? Number((g.grossWin / g.grossLoss).toFixed(2)) : null,
    expectancy: g.n ? Number((g.net / g.n).toFixed(3)) : 0,
    net: Number(g.net.toFixed(1)),
  };
}

export type ManualBacktestOpts = {
  sinceHours?: number;
  limit?: number;
  params?: ManualEntryParams;
};

export async function runManualEntryBacktest(
  supabase: SupabaseClient,
  opts: ManualBacktestOpts = {},
) {
  const sinceHours = opts.sinceHours ?? 24 * 30; // 30 days
  const limit = Math.min(opts.limit ?? 400, 1500);
  const params = opts.params ?? DEFAULT_MANUAL_ENTRY_PARAMS;
  const sinceIso = new Date(Date.now() - sinceHours * 3600_000).toISOString();

  const { data: rows, error } = await supabase
    .from("positions")
    .select("id,symbol,side,opened_at,pnl,instrument")
    .eq("status", "closed")
    .eq("side", "long")
    .gte("opened_at", sinceIso)
    .order("opened_at", { ascending: false })
    .limit(limit);
  if (error) return { ok: false as const, error: error.message };

  const trades = (rows ?? []).filter(
    (r) => (r.instrument ?? "futures") === "futures" && typeof r.symbol === "string",
  );

  const pass: Group = { n: 0, wins: 0, grossWin: 0, grossLoss: 0, net: 0 };
  const fail: Group = { n: 0, wins: 0, grossWin: 0, grossLoss: 0, net: 0 };
  let evaluated = 0;
  let noData = 0;

  const add = (g: Group, pnl: number) => {
    g.n += 1;
    g.net += pnl;
    if (pnl > 0) {
      g.wins += 1;
      g.grossWin += pnl;
    } else {
      g.grossLoss += -pnl;
    }
  };

  const BATCH = 8;
  for (let i = 0; i < trades.length; i += BATCH) {
    const batch = trades.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (t) => {
        const openedSec = Math.floor(new Date(t.opened_at as string).getTime() / 1000);
        const [c30, c1] = await Promise.all([
          fetchCandles(t.symbol as string, openedSec - 30 * 1800, openedSec, 30),
          fetchCandles(t.symbol as string, openedSec - 90 * 60, openedSec, 1),
        ]);
        if (c30.length < params.trend30Lookback + 1 || c1.length < params.stPeriod + 5) {
          noData += 1;
          return;
        }
        evaluated += 1;
        const res = evaluateManualEntry(c30, c1, params);
        add(res.enterLong ? pass : fail, num(t.pnl));
      }),
    );
  }

  return {
    ok: true as const,
    scope: { sinceHours, limit, trades: trades.length, evaluated, noData },
    rulePass: summarize(pass),
    ruleFail: summarize(fail),
    baseline: summarize({
      n: pass.n + fail.n,
      wins: pass.wins + fail.wins,
      grossWin: pass.grossWin + fail.grossWin,
      grossLoss: pass.grossLoss + fail.grossLoss,
      net: pass.net + fail.net,
    }),
  };
}

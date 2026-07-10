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

/** Aggregate a 1m series into 30m buckets (bucket time = bucket end second). */
function aggregate30m(c1: MECandle[]): MECandle[] {
  const buckets = new Map<number, MECandle[]>();
  for (const c of c1) {
    const key = Math.floor((c.time ?? 0) / 1800);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(c);
  }
  const out: MECandle[] = [];
  for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
    const g = buckets.get(key)!;
    out.push({
      time: (key + 1) * 1800,
      open: g[0].open,
      high: Math.max(...g.map((x) => x.high)),
      low: Math.min(...g.map((x) => x.low)),
      close: g[g.length - 1].close,
    });
  }
  return out;
}

/** Fetch a full 1m window in day-chunks (CoinDCX caps per-request results). */
async function fetch1mWindow(pair: string, fromSec: number, toSec: number): Promise<MECandle[]> {
  const DAY = 86400;
  const chunks: Promise<MECandle[]>[] = [];
  for (let s = fromSec; s < toSec; s += DAY) {
    chunks.push(fetchCandles(pair, s, Math.min(s + DAY, toSec), 1));
  }
  const parts = await Promise.all(chunks);
  const seen = new Set<number>();
  const merged: MECandle[] = [];
  for (const p of parts)
    for (const c of p)
      if (!seen.has(c.time!)) {
        seen.add(c.time!);
        merged.push(c);
      }
  return merged.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

export type ManualGenOpts = {
  sinceHours?: number;
  symbols?: string[];
  maxSymbols?: number;
  tpPct?: number; // price % target
  slPct?: number; // price % stop
  maxHoldBars?: number; // 1m bars
  cooldownBars?: number;
  params?: ManualEntryParams;
};

/**
 * Entry-GENERATION backtest: scan historical 1m/30m candles and fire the manual
 * rule to generate the strategy's OWN long entries, then simulate a fixed
 * TP/SL/max-hold exit to measure the entry edge (win rate / PF / avg return).
 */
export async function runManualEntryGeneration(supabase: SupabaseClient, opts: ManualGenOpts = {}) {
  const sinceHours = Math.min(opts.sinceHours ?? 72, 168);
  const tpPct = opts.tpPct ?? 1.5;
  const slPct = opts.slPct ?? 1.0;
  const maxHoldBars = opts.maxHoldBars ?? 240;
  const cooldownBars = opts.cooldownBars ?? 15;
  const params = opts.params ?? DEFAULT_MANUAL_ENTRY_PARAMS;

  let symbols = opts.symbols ?? [];
  if (symbols.length === 0) {
    const { data } = await supabase
      .from("positions")
      .select("symbol")
      .eq("status", "closed")
      .eq("instrument", "futures")
      .gte("opened_at", new Date(Date.now() - 30 * 86400_000).toISOString())
      .limit(2000);
    symbols = [...new Set((data ?? []).map((r) => r.symbol as string).filter(Boolean))];
  }
  symbols = symbols.slice(0, opts.maxSymbols ?? 10);

  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - sinceHours * 3600;
  const g: Group = { n: 0, wins: 0, grossWin: 0, grossLoss: 0, net: 0 };
  const perSymbol: Record<string, { entries: number; wins: number; net: number }> = {};
  let symbolsWithData = 0;

  for (const sym of symbols) {
    const c1 = await fetch1mWindow(sym, fromSec, nowSec);
    if (c1.length < 60) continue;
    symbolsWithData += 1;
    const c30 = aggregate30m(c1);
    perSymbol[sym] = { entries: 0, wins: 0, net: 0 };
    let nextAllowed = 30;

    for (let i = 30; i < c1.length - 1; i++) {
      if (i < nextAllowed) continue;
      const tNow = c1[i].time ?? 0;
      // completed 30m candles up to now
      const c30Slice = c30.filter((c) => (c.time ?? 0) <= tNow);
      if (c30Slice.length < params.trend30Lookback + 1) continue;
      const res = evaluateManualEntry(c30Slice, c1.slice(0, i + 1), params);
      if (!res.enterLong) continue;

      const entry = c1[i].close;
      const tp = entry * (1 + tpPct / 100);
      const sl = entry * (1 - slPct / 100);
      let outcomePct: number | null = null;
      let exitIdx = i;
      for (let j = i + 1; j < c1.length && j <= i + maxHoldBars; j++) {
        exitIdx = j;
        if (c1[j].low <= sl) {
          outcomePct = -slPct;
          break;
        }
        if (c1[j].high >= tp) {
          outcomePct = tpPct;
          break;
        }
      }
      if (outcomePct == null) {
        // max hold — mark to last close
        outcomePct = ((c1[Math.min(i + maxHoldBars, c1.length - 1)].close - entry) / entry) * 100;
      }
      g.n += 1;
      g.net += outcomePct;
      perSymbol[sym].entries += 1;
      perSymbol[sym].net += outcomePct;
      if (outcomePct > 0) {
        g.wins += 1;
        g.grossWin += outcomePct;
        perSymbol[sym].wins += 1;
      } else {
        g.grossLoss += -outcomePct;
      }
      nextAllowed = exitIdx + cooldownBars;
    }
  }

  return {
    ok: true as const,
    mode: "generate" as const,
    scope: { sinceHours, symbols: symbols.length, symbolsWithData, tpPct, slPct, maxHoldBars },
    result: summarize(g),
    perSymbol,
  };
}

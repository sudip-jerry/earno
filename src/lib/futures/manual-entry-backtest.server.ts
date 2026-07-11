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
  evaluateManualEntryShort,
  evaluateExhaustionShort,
  DEFAULT_MANUAL_ENTRY_PARAMS,
  DEFAULT_EXHAUSTION_SHORT_PARAMS,
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
  side?: "long" | "short";
  params?: ManualEntryParams;
};

export async function runManualEntryBacktest(
  supabase: SupabaseClient,
  opts: ManualBacktestOpts = {},
) {
  const sinceHours = opts.sinceHours ?? 24 * 30; // 30 days
  const limit = Math.min(opts.limit ?? 400, 1500);
  const side = opts.side ?? "long";
  const params = opts.params ?? DEFAULT_MANUAL_ENTRY_PARAMS;
  const sinceIso = new Date(Date.now() - sinceHours * 3600_000).toISOString();

  const { data: rows, error } = await supabase
    .from("positions")
    .select("id,symbol,side,opened_at,pnl,instrument")
    .eq("status", "closed")
    .eq("side", side)
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
        const enter =
          side === "short"
            ? evaluateManualEntryShort(c30, c1, params).enterShort
            : evaluateManualEntry(c30, c1, params).enterLong;
        add(enter ? pass : fail, num(t.pnl));
      }),
    );
  }

  return {
    ok: true as const,
    scope: { sinceHours, limit, side, trades: trades.length, evaluated, noData },
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

/** Aggregate a 1m series into fixed-width buckets (bucket time = bucket end second). */
function aggregateTf(c1: MECandle[], widthSec: number): MECandle[] {
  const buckets = new Map<number, MECandle[]>();
  for (const c of c1) {
    const key = Math.floor((c.time ?? 0) / widthSec);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(c);
  }
  const out: MECandle[] = [];
  for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
    const g = buckets.get(key)!;
    out.push({
      time: (key + 1) * widthSec,
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

const FUTURES_TICKER = "https://public.coindcx.com/market_data/v3/current_prices/futures/rt";

/** Fetch the current futures top movers by |24h change| with a volume floor —
 *  the universe the manual method actually trades (biggest movers, real liquidity). */
async function fetchMoversUniverse(
  minVolume: number,
  maxSymbols: number,
): Promise<string[]> {
  try {
    const res = await fetch(FUTURES_TICKER, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const raw = (await res.json()) as Record<string, unknown> | unknown[];
    const dict =
      raw && typeof raw === "object" && !Array.isArray(raw) && "prices" in raw
        ? (raw as { prices: Record<string, Record<string, unknown>> }).prices
        : raw;
    const rows: Array<{ symbol: string; change: number; vol: number }> = [];
    const consume = (sym: string | undefined, r: Record<string, unknown>) => {
      const symbol = sym ?? (r.s as string) ?? (r.pair as string);
      if (!symbol || !symbol.startsWith("B-") || !symbol.endsWith("_USDT")) return;
      const change = num(r.cp ?? r.pc);
      const vol = num(r.qv ?? r.v);
      if (vol < minVolume) return;
      rows.push({ symbol, change, vol });
    };
    if (Array.isArray(dict)) dict.forEach((r) => consume(undefined, r as Record<string, unknown>));
    else
      Object.entries(dict as Record<string, Record<string, unknown>>).forEach(
        ([k, v]) => v && typeof v === "object" && consume(k, v),
      );
    return rows
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, maxSymbols)
      .map((r) => r.symbol);
  } catch {
    return [];
  }
}

/** Trailing 24h % change at bar i from a 1m series (falls back to since-start). */
function change24hAt(c1: MECandle[], i: number): number {
  const back = i - 1440 >= 0 ? i - 1440 : 0;
  const base = c1[back].close;
  return base > 0 ? ((c1[i].close - base) / base) * 100 : 0;
}

export type MoversBacktestOpts = {
  sinceHours?: number;
  minVolume?: number; // 24h quote-volume floor for the universe
  maxSymbols?: number;
  moverGatePct?: number; // |trailing-24h change| a symbol must have to qualify as a "mover"
  tpPct?: number;
  slPct?: number;
  maxHoldBars?: number;
  cooldownBars?: number;
  side?: "long" | "short" | "both";
  shortRule?: "continuation" | "exhaustion"; // continuation = downtrend momentum; exhaustion = fade an overbought rollover (15m/30m)
  gainerPct?: number; // exhaustion: 24h change floor to qualify as a faded mover
  params?: ManualEntryParams;
};

/**
 * MOVERS momentum backtest (both directions). Universe = current futures top
 * movers by |24h change| with a volume floor. Walks 1m candles and, with NO
 * look-ahead, recomputes trailing-24h change at each bar:
 *   • LONG  when the symbol is up >= +moverGate AND the manual long rule fires
 *     (30m up · 1m RSI not overbought · 1m up · Supertrend bullish)
 *   • SHORT when the symbol is a high mover (|24h| >= moverGate) AND the manual
 *     short rule fires (30m down · 1m RSI not oversold · 1m down · Supertrend bearish)
 * Simulates a fixed TP/SL/max-hold exit per entry. Measures the entry edge.
 */
export async function runMoversMomentumBacktest(supabase: SupabaseClient, opts: MoversBacktestOpts = {}) {
  void supabase;
  const sinceHours = Math.min(opts.sinceHours ?? 72, 168);
  const minVolume = opts.minVolume ?? 10_000_000;
  const maxSymbols = opts.maxSymbols ?? 15;
  const moverGatePct = opts.moverGatePct ?? 4;
  const tpPct = opts.tpPct ?? 1.5;
  const slPct = opts.slPct ?? 1.0;
  const maxHoldBars = opts.maxHoldBars ?? 240;
  const cooldownBars = opts.cooldownBars ?? 15;
  const side = opts.side ?? "both";
  const shortRule = opts.shortRule ?? "continuation";
  const params = opts.params ?? DEFAULT_MANUAL_ENTRY_PARAMS;
  const exhaustionParams = { ...DEFAULT_EXHAUSTION_SHORT_PARAMS, gainerPct: opts.gainerPct ?? DEFAULT_EXHAUSTION_SHORT_PARAMS.gainerPct };

  const symbols = await fetchMoversUniverse(minVolume, maxSymbols);
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - sinceHours * 3600;

  const groups = {
    long: { n: 0, wins: 0, grossWin: 0, grossLoss: 0, net: 0 } as Group,
    short: { n: 0, wins: 0, grossWin: 0, grossLoss: 0, net: 0 } as Group,
  };
  const perSymbol: Record<string, { long: number; short: number; net: number }> = {};
  let symbolsWithData = 0;

  const simulate = (c1: MECandle[], i: number, dir: "long" | "short") => {
    const entry = c1[i].close;
    const tp = dir === "long" ? entry * (1 + tpPct / 100) : entry * (1 - tpPct / 100);
    const sl = dir === "long" ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
    let outcomePct: number | null = null;
    let exitIdx = i;
    for (let j = i + 1; j < c1.length && j <= i + maxHoldBars; j++) {
      exitIdx = j;
      if (dir === "long") {
        if (c1[j].low <= sl) { outcomePct = -slPct; break; }
        if (c1[j].high >= tp) { outcomePct = tpPct; break; }
      } else {
        if (c1[j].high >= sl) { outcomePct = -slPct; break; }
        if (c1[j].low <= tp) { outcomePct = tpPct; break; }
      }
    }
    if (outcomePct == null) {
      const last = c1[Math.min(i + maxHoldBars, c1.length - 1)].close;
      outcomePct = ((last - entry) / entry) * 100 * (dir === "long" ? 1 : -1);
    }
    return { outcomePct, exitIdx };
  };

  for (const sym of symbols) {
    const c1 = await fetch1mWindow(sym, fromSec, nowSec);
    if (c1.length < 60) continue;
    symbolsWithData += 1;
    const c30 = aggregate30m(c1);
    const c15 = aggregateTf(c1, 900);
    perSymbol[sym] = { long: 0, short: 0, net: 0 };
    let nextAllowed = 30;

    for (let i = 30; i < c1.length - 1; i++) {
      if (i < nextAllowed) continue;
      const tNow = c1[i].time ?? 0;
      const c30Slice = c30.filter((c) => (c.time ?? 0) <= tNow);
      if (c30Slice.length < params.trend30Lookback + 1) continue;
      const c1Slice = c1.slice(0, i + 1);
      const ch24 = change24hAt(c1, i);

      let dir: "long" | "short" | null = null;
      if ((side === "long" || side === "both") && ch24 >= moverGatePct) {
        if (evaluateManualEntry(c30Slice, c1Slice, params).enterLong) dir = "long";
      }
      if (!dir && (side === "short" || side === "both")) {
        if (shortRule === "exhaustion") {
          // Exhaustion short fades an overbought GAINER rolling over on 15m/30m;
          // it applies its own 24h-gainer gate, so no abs-mover gate here.
          const c15Slice = c15.filter((c) => (c.time ?? 0) <= tNow);
          if (c15Slice.length >= exhaustionParams.swingLookback + 2 &&
              evaluateExhaustionShort(c30Slice, c15Slice, ch24, exhaustionParams).enterShort) dir = "short";
        } else if (Math.abs(ch24) >= moverGatePct) {
          if (evaluateManualEntryShort(c30Slice, c1Slice, params).enterShort) dir = "short";
        }
      }
      if (!dir) continue;

      const { outcomePct, exitIdx } = simulate(c1, i, dir);
      const g = groups[dir];
      g.n += 1;
      g.net += outcomePct;
      perSymbol[sym][dir] += 1;
      perSymbol[sym].net += outcomePct;
      if (outcomePct > 0) { g.wins += 1; g.grossWin += outcomePct; }
      else g.grossLoss += -outcomePct;
      nextAllowed = exitIdx + cooldownBars;
    }
  }

  const combined: Group = {
    n: groups.long.n + groups.short.n,
    wins: groups.long.wins + groups.short.wins,
    grossWin: groups.long.grossWin + groups.short.grossWin,
    grossLoss: groups.long.grossLoss + groups.short.grossLoss,
    net: groups.long.net + groups.short.net,
  };

  return {
    ok: true as const,
    mode: "movers" as const,
    scope: { sinceHours, minVolume, moverGatePct, tpPct, slPct, side, shortRule, gainerPct: exhaustionParams.gainerPct, universe: symbols.length, symbolsWithData },
    universe: symbols,
    long: summarize(groups.long),
    short: summarize(groups.short),
    combined: summarize(combined),
    perSymbol,
  };
}

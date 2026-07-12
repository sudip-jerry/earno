/**
 * Coin-entry benchmark replay. Motivated by the 14d coin-book diagnosis:
 * 1,010 closed positions, ~38% win, −$268/7d — with HEALTHY exits (targets
 * avg +3.37 vs stops −2.47) but late entries (51% of trades die at the stop;
 * the triple-timeframe-aligned entry wins only 27%). This harness replays
 * candidate ENTRY rules over real CoinDCX candles with one shared exit model,
 * so entry logics compete on identical terms, against null benchmarks
 * (random entries, buy&hold) that any real strategy must beat.
 *
 * Analysis-only: no DB writes, no live behavior. Invoked via the
 * /api/public/hooks/coin-entry-backtest hook (CRON_SECRET auth), typically
 * driven server-side through pg_net since the sandbox can't reach CoinDCX.
 */

import { aggregateCandles } from "@/lib/candle-aggregator";

const CANDLES = (pair: string, interval: string, limit: number) =>
  `https://public.coindcx.com/market_data/candles?pair=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;

const HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; Earn'O/1.0; +https://earno.lovable.app)",
};

type C = { open: number; high: number; low: number; close: number; volume: number; time: number };

async function fetchC(pair: string, interval: string, limit: number): Promise<C[] | null> {
  try {
    const res = await fetch(CANDLES(pair, interval, limit), {
      headers: HEADERS,
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw) || raw.length < 10) return null;
    return aggregateCandles(raw as never[], 1).sort((a, b) => a.time - b.time) as C[];
  } catch {
    return null;
  }
}

function sma(vals: number[], n: number, i: number): number | null {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += vals[k];
  return s / n;
}

function rsi14(closes: number[], i: number): number | null {
  if (i < 15) return null;
  let g = 0, l = 0;
  for (let k = i - 13; k <= i; k++) {
    const d = closes[k] - closes[k - 1];
    if (d >= 0) g += d;
    else l -= d;
  }
  if (l === 0) return 100;
  const rs = g / l;
  return 100 - 100 / (1 + rs);
}

/** Deterministic pseudo-random in [0,1) from symbol+bar (replay-stable). */
function hash01(sym: string, i: number): number {
  let h = 2166136261;
  const s = `${sym}:${i}`;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export type CoinBacktestOpts = {
  symbols?: string[];
  sinceDays?: number; // default 14
  tpPct?: number; // default 5.5 (matches realized target avg)
  slPct?: number; // default 4.0 (matches realized stop avg)
  maxHoldHours?: number; // default 26 (matches realized swing hold)
  feeRoundTripPct?: number; // default 0.5 spot taker both sides
  randomRatePct?: number; // random-entry probability per bar, default 1.5
  /** When true, ALL strategies may only enter while BTC 3-day momentum is up —
   * the missing reflex the two-window test exposed: every long-only entry rule
   * bled in the red week because nothing told the bot to stop buying. Applied
   * to every strategy equally (including random) so the comparison stays fair. */
  regimeGate?: boolean;
};

type Group = { n: number; wins: number; gross: number; grossWin: number; grossLoss: number };
const g0 = (): Group => ({ n: 0, wins: 0, gross: 0, grossWin: 0, grossLoss: 0 });

function summarize(g: Group, fee: number) {
  const net = g.gross - g.n * fee;
  return {
    trades: g.n,
    win_pct: g.n ? Number(((100 * g.wins) / g.n).toFixed(1)) : 0,
    avg_gross_pct: g.n ? Number((g.gross / g.n).toFixed(3)) : 0,
    total_net_pct: Number(net.toFixed(2)),
    profit_factor: g.grossLoss > 0 ? Number((g.grossWin / g.grossLoss).toFixed(2)) : null,
  };
}

export async function runCoinEntryBacktest(opts: CoinBacktestOpts = {}) {
  const sinceDays = Math.min(opts.sinceDays ?? 14, 16);
  const tpPct = opts.tpPct ?? 5.5;
  const slPct = opts.slPct ?? 4.0;
  const maxHoldBars = Math.round((opts.maxHoldHours ?? 26));
  const fee = opts.feeRoundTripPct ?? 0.5;
  const randomRate = (opts.randomRatePct ?? 1.5) / 100;
  const symbols = (opts.symbols ?? []).slice(0, 40);
  if (!symbols.length) return { ok: false as const, error: "symbols[] required" };

  const bars1h = sinceDays * 24;
  // Strategy keys — one shared simulate() so entries compete on equal terms.
  const strategies = ["climax", "v2spot", "random", "ema_cross_4h", "donchian"] as const;
  const groups: Record<string, Group> = Object.fromEntries(strategies.map((s) => [s, g0()]));
  const holdBench: { sum: number; n: number } = { sum: 0, n: 0 };
  let btcHold: number | null = null;
  let symbolsWithData = 0;

  // Regime flags from BTC 1h: momentum up = close > close 72 bars (3 days) ago.
  let regimeTimes: number[] = [];
  let regimeUp: boolean[] = [];
  if (opts.regimeGate) {
    const btc = await fetchC("B-BTC_USDT", "1h", 480);
    if (!btc) return { ok: false as const, error: "regimeGate: BTC candles unavailable" };
    regimeTimes = btc.map((c) => c.time);
    regimeUp = btc.map((c, i) => i >= 72 && c.close > btc[i - 72].close);
  }
  const regimeOkAt = (t: number): boolean => {
    if (!opts.regimeGate) return true;
    // Last BTC bar at or before t (both series are ascending 1h bars).
    let lo = 0, hi = regimeTimes.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (regimeTimes[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans >= 0 ? regimeUp[ans] : false;
  };

  for (const sym of symbols) {
    const c1h = await fetchC(sym, "1h", Math.min(bars1h + 60, 480));
    if (!c1h || c1h.length < 120) continue;
    symbolsWithData++;
    const closes = c1h.map((c) => c.close);
    const vols = c1h.map((c) => c.volume);
    // Higher-timeframe context from aggregated 1h (4h = 4 bars, d1 = 24 bars).
    const upHT = (i: number, span: number, look: number): boolean => {
      const past = i - span * look;
      return past >= 0 && closes[i] > closes[past];
    };

    // Buy&hold benchmark per symbol over the window.
    const start = Math.max(0, c1h.length - bars1h);
    const holdPct = ((closes[closes.length - 1] - closes[start]) / closes[start]) * 100;
    holdBench.sum += holdPct;
    holdBench.n++;
    if (sym === "B-BTC_USDT") btcHold = Number(holdPct.toFixed(2));

    const nextAllowed: Record<string, number> = Object.fromEntries(strategies.map((s) => [s, 0]));

    for (let i = Math.max(start, 60); i < c1h.length - 2; i++) {
      const r = rsi14(closes, i);
      const s20 = sma(closes, 20, i);
      const vAvg = sma(vols, 20, i - 1);
      const vRatio = vAvg && vAvg > 0 ? vols[i] / vAvg : 0;
      const d1Up = upHT(i, 24, 3); // ~3 days of progress
      const h4Up = upHT(i, 4, 6); // ~24h of progress
      const ema9 = sma(closes, 9, i);
      const ema21 = sma(closes, 21, i);
      const ema9p = sma(closes, 9, i - 4);
      const ema21p = sma(closes, 21, i - 4);
      let hi80 = 0;
      for (let k = Math.max(0, i - 80); k < i; k++) hi80 = Math.max(hi80, c1h[k].high);

      const fires: Record<(typeof strategies)[number], boolean> = {
        // Current bot's workhorse shape: aligned trend + surging momentum/volume.
        climax: d1Up && h4Up && vRatio >= 1.5 && r != null && r >= 60,
        // Evidence-based candidate: aligned trend, entered on the REST.
        v2spot:
          d1Up && h4Up && r != null && r < 57 && vRatio > 0 && vRatio < 1.2 &&
          s20 != null && closes[i] <= s20 * 1.02,
        // Null control: same exits, dice-roll entries.
        random: hash01(sym, i) < randomRate,
        ema_cross_4h:
          ema9 != null && ema21 != null && ema9p != null && ema21p != null &&
          ema9p <= ema21p && ema9 > ema21,
        donchian: closes[i] > hi80 && hi80 > 0,
      };

      for (const st of strategies) {
        if (!fires[st] || i < nextAllowed[st] || !regimeOkAt(c1h[i].time)) continue;
        // Enter next bar open; walk to stop/target/max-hold.
        const entry = c1h[i + 1].open;
        if (!entry) continue;
        const tp = entry * (1 + tpPct / 100);
        const sl = entry * (1 - slPct / 100);
        let out = 0;
        let exitIdx = Math.min(i + 1 + maxHoldBars, c1h.length - 1);
        for (let k = i + 1; k <= exitIdx; k++) {
          if (c1h[k].low <= sl) { out = -slPct; exitIdx = k; break; }
          if (c1h[k].high >= tp) { out = tpPct; exitIdx = k; break; }
        }
        if (out === 0) out = ((c1h[exitIdx].close - entry) / entry) * 100;
        const g = groups[st];
        g.n++;
        g.gross += out;
        if (out > 0) { g.wins++; g.grossWin += out; } else g.grossLoss += -out;
        nextAllowed[st] = exitIdx + 12; // per-symbol cooldown
      }
    }
  }

  return {
    ok: true as const,
    scope: { sinceDays, tpPct, slPct, maxHoldBars, feeRoundTripPct: fee, symbols: symbols.length, symbolsWithData, regimeGate: !!opts.regimeGate },
    strategies: Object.fromEntries(strategies.map((s) => [s, summarize(groups[s], fee)])),
    benchmarks: {
      hold_equal_weight_pct: holdBench.n ? Number((holdBench.sum / holdBench.n).toFixed(2)) : null,
      hold_btc_pct: btcHold,
    },
  };
}

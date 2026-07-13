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

function rsiN(closes: number[], i: number, period: number): number | null {
  if (i < period + 1) return null;
  let g = 0, l = 0;
  for (let k = i - period + 1; k <= i; k++) {
    const d = closes[k] - closes[k - 1];
    if (d >= 0) g += d;
    else l -= d;
  }
  if (l === 0) return 100;
  const rs = g / l;
  return 100 - 100 / (1 + rs);
}
const rsi14 = (closes: number[], i: number) => rsiN(closes, i, 14);

/** Std-dev of the last n closes ending at i (for Bollinger bands). */
function stdev(vals: number[], n: number, i: number, mean: number): number | null {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += (vals[k] - mean) ** 2;
  return Math.sqrt(s / n);
}

/** Supertrend(10,3) direction per bar: true = uptrend. Standard band-flip logic. */
function supertrendUp(c: C[]): boolean[] {
  const n = c.length;
  const up = new Array<boolean>(n).fill(false);
  if (n < 12) return up;
  const atr: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      c[i].high - c[i].low,
      Math.abs(c[i].high - c[i - 1].close),
      Math.abs(c[i].low - c[i - 1].close),
    );
    atr[i] = i <= 10 ? (atr[i - 1] * (i - 1) + tr) / i : (atr[i - 1] * 9 + tr) / 10;
  }
  let ub = 0, lb = 0, trend = true;
  for (let i = 1; i < n; i++) {
    const mid = (c[i].high + c[i].low) / 2;
    const bub = mid + 3 * atr[i];
    const blb = mid - 3 * atr[i];
    ub = i === 1 ? bub : bub < ub || c[i - 1].close > ub ? bub : ub;
    lb = i === 1 ? blb : blb > lb || c[i - 1].close < lb ? blb : lb;
    if (trend && c[i].close < lb) trend = false;
    else if (!trend && c[i].close > ub) trend = true;
    up[i] = trend;
  }
  return up;
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
  /**
   * Injectable candle source (defaults to the CoinDCX fetch). Lets the replay
   * run where CoinDCX is unreachable (sandbox) with candles supplied via
   * pg_net — same pattern as the futures replay driver.
   */
  candleProvider?: (pair: string, interval: string, limit: number) => Promise<C[] | null>;
  /**
   * Binary universe-breadth gate, mirroring the LIVE coin regime gate: no
   * entries while breadth (share of replay symbols whose close is above their
   * close 24h earlier) < floor. Live floor is 0.45. Backtest breadth is over
   * the replay universe (~30 symbols) — an approximation of the live
   * scan-universe breadth.
   */
  breadthFloor?: number;
  /**
   * Tiered breadth gate: breadth >= full → all strategies may enter;
   * defensive <= breadth < full → only the guarded dip-buy (nfi_dip) may
   * enter; below defensive → nothing. Also activates the synthetic
   * `switched` strategy row: donchian in the full tier, nfi_dip in the
   * defensive tier — the candidate live behavior.
   */
  breadthTiers?: { full: number; defensive: number };
  /**
   * Volume confirmation for donchian breakouts: when set, a fresh 20-bar high
   * only fires if bar volume >= donchianVolMin x the 20-bar average (the
   * standard breakout-quality rule; live donchian arm has no volume check).
   */
  donchianVolMin?: number;
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
  // The last four port the open-source community's consensus shapes:
  // nfi_dip = NostalgiaForInfinity-style dip-buy in an uptrend (guarded mean
  // reversion — the most-forked Freqtrade strategy's core); bb_meanrev =
  // Bollinger lower-band buy with trend filter; supertrend = ST(10,3) flip
  // long (TradingView staple); rsi2 = Connors RSI-2 pullback with trend guard.
  const strategies = [
    "climax", "v2spot", "random", "ema_cross_4h", "donchian",
    "nfi_dip", "bb_meanrev", "supertrend", "rsi2", "switched",
  ] as const;
  const groups: Record<string, Group> = Object.fromEntries(strategies.map((s) => [s, g0()]));
  const holdBench: { sum: number; n: number } = { sum: 0, n: 0 };
  let btcHold: number | null = null;
  let symbolsWithData = 0;
  const provider = opts.candleProvider ?? fetchC;

  // Regime flags from BTC 1h: momentum up = close > close 72 bars (3 days) ago.
  let regimeTimes: number[] = [];
  let regimeUp: boolean[] = [];
  if (opts.regimeGate) {
    const btc = await provider("B-BTC_USDT", "1h", 480);
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

  // Prefetch every symbol's 1h series once — the breadth series below needs
  // the whole universe before any strategy replay starts.
  const seriesBySym = new Map<string, C[]>();
  for (const sym of symbols) {
    const c1h = await provider(sym, "1h", Math.min(bars1h + 60, 480));
    if (c1h && c1h.length >= 120) seriesBySym.set(sym, c1h);
  }

  // Hourly breadth series over the replay universe: breadth(t) = share of
  // symbols whose close at t is above their close 24h earlier. Mirrors the
  // live regime gate's ticker breadth (approximation: replay universe, not
  // the full scan universe). Time unit auto-detected (CoinDCX candles are ms).
  const tiersEnabled = !!opts.breadthTiers;
  const breadthEnabled = opts.breadthFloor != null || tiersEnabled;
  let bTimes: number[] = [];
  let bVals: (number | null)[] = [];
  if (breadthEnabled) {
    const closeBySymTime = new Map<string, Map<number, number>>();
    const grid = new Set<number>();
    for (const [sym, c1h] of seriesBySym) {
      const m = new Map<number, number>();
      for (const c of c1h) { m.set(c.time, c.close); grid.add(c.time); }
      closeBySymTime.set(sym, m);
    }
    bTimes = Array.from(grid).sort((a, b) => a - b);
    bVals = bTimes.map((t) => {
      const day = t > 1e12 ? 86_400_000 : 86_400;
      let pos = 0, counted = 0;
      for (const m of closeBySymTime.values()) {
        const now = m.get(t);
        const then = m.get(t - day);
        if (now == null || then == null) continue;
        counted++;
        if (now > then) pos++;
      }
      return counted >= 5 ? pos / counted : null;
    });
  }
  const breadthAt = (t: number): number | null => {
    if (!bTimes.length) return null;
    let lo = 0, hi = bTimes.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bTimes[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans >= 0 ? bVals[ans] : null;
  };
  // Tier at t: unknown breadth is permissive (matches early-window behavior).
  type Tier = "full" | "defensive" | "none";
  const tierAt = (t: number): Tier => {
    if (!tiersEnabled) return "full";
    const b = breadthAt(t);
    if (b == null) return "full";
    const { full, defensive } = opts.breadthTiers as { full: number; defensive: number };
    return b >= full ? "full" : b >= defensive ? "defensive" : "none";
  };
  const floorOkAt = (t: number): boolean => {
    if (opts.breadthFloor == null) return true;
    const b = breadthAt(t);
    return b == null || b >= opts.breadthFloor;
  };

  for (const sym of symbols) {
    const c1h = seriesBySym.get(sym);
    if (!c1h) continue;
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
    const stUp = supertrendUp(c1h);

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

      const s100 = sma(closes, 100, i);
      const r2 = rsiN(closes, i, 2);
      const sd20 = s20 != null ? stdev(closes, 20, i, s20) : null;

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
        donchian:
          closes[i] > hi80 && hi80 > 0 &&
          (opts.donchianVolMin == null || vRatio >= opts.donchianVolMin),
        // NFI-style guarded dip-buy: long-term uptrend intact, price dipped >=3%
        // below the 20-SMA, RSI oversold-ish, and volume NOT panicking (avoid
        // catching a crash knife) — the community's most-validated spot shape.
        nfi_dip:
          s100 != null && closes[i] > s100 &&
          s20 != null && closes[i] < s20 * 0.97 &&
          r != null && r < 36 && vRatio < 2.0,
        // Bollinger(20,2) lower-band touch with the same long-term trend guard.
        bb_meanrev:
          s100 != null && closes[i] > s100 &&
          s20 != null && sd20 != null && closes[i] < s20 - 2 * sd20,
        // Supertrend(10,3) flip to up on this bar.
        supertrend: i > 0 && stUp[i] && !stUp[i - 1],
        // Connors RSI-2: deep short-term pullback inside a long-term uptrend.
        rsi2: s100 != null && closes[i] > s100 && r2 != null && r2 < 10,
        // Placeholder — set below from the tier (needs the rows above).
        switched: false,
      };
      // Candidate live behavior: offense (donchian) when breadth is strong,
      // guarded dip-buying (nfi_dip) in the middle band, nothing when red.
      const tierBar = tierAt(c1h[i].time);
      fires.switched = tiersEnabled
        ? tierBar === "full"
          ? fires.donchian
          : tierBar === "defensive"
            ? fires.nfi_dip
            : false
        : false;

      for (const st of strategies) {
        // Tier gate: in the defensive band only the dip-buy may enter
        // (`switched` embeds its own tier logic above).
        const tierOk = !tiersEnabled || st === "switched"
          ? true
          : tierBar === "full"
            ? true
            : tierBar === "defensive"
              ? st === "nfi_dip"
              : false;
        if (
          !fires[st] || i < nextAllowed[st] || !regimeOkAt(c1h[i].time) ||
          !tierOk || !floorOkAt(c1h[i].time)
        ) continue;
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

  // Gate activity over the replayed window: how often the gate idled the bot
  // entirely, and the average breadth (context for threshold placement).
  let breadthStats: { avg: number; idle_share: number; defensive_share: number } | null = null;
  if (breadthEnabled && bTimes.length) {
    const maxT = bTimes[bTimes.length - 1];
    const day = maxT > 1e12 ? 86_400_000 : 86_400;
    const fromT = maxT - sinceDays * day;
    let sum = 0, n = 0, idle = 0, def = 0;
    for (let k = 0; k < bTimes.length; k++) {
      if (bTimes[k] < fromT || bVals[k] == null) continue;
      const b = bVals[k] as number;
      sum += b;
      n++;
      if (tiersEnabled) {
        const { full, defensive } = opts.breadthTiers as { full: number; defensive: number };
        if (b < defensive) idle++;
        else if (b < full) def++;
      } else if (opts.breadthFloor != null && b < opts.breadthFloor) idle++;
    }
    breadthStats = n
      ? {
          avg: Number((sum / n).toFixed(3)),
          idle_share: Number((idle / n).toFixed(3)),
          defensive_share: Number((def / n).toFixed(3)),
        }
      : null;
  }

  return {
    ok: true as const,
    scope: {
      sinceDays, tpPct, slPct, maxHoldBars, feeRoundTripPct: fee,
      symbols: symbols.length, symbolsWithData, regimeGate: !!opts.regimeGate,
      breadthFloor: opts.breadthFloor ?? null, breadthTiers: opts.breadthTiers ?? null,
    },
    breadth: breadthStats,
    strategies: Object.fromEntries(strategies.map((s) => [s, summarize(groups[s], fee)])),
    benchmarks: {
      hold_equal_weight_pct: holdBench.n ? Number((holdBench.sum / holdBench.n).toFixed(2)) : null,
      hold_btc_pct: btcHold,
    },
  };
}

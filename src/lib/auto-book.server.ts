/**
 * Server-only auto-book + mark/auto-close engine.
 * Called by /api/public/hooks/auto-book and /api/public/hooks/mark-positions.
 * NEVER import this from anything reachable by the client bundle at module scope.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  atrPctFromCandles,
  computeRiskPlan,
  presetFromConfig,
  applyStrictnessToPreset,
  strictnessFromMinScore,
  tp1PriceFor,
  type StylePreset,
} from "@/lib/risk-engine";
import {
  analyzeSymbol,
  HARD_SPREAD_BLOCK_PCT,
  ALGO_ID,
  ALGO_NAME,
  ALGO_VERSION,
  REGIME_BULLISH_24H,
  REGIME_BEARISH_24H,
  REGIME_SIDEWAYS_24H,
  TREND_STRONG_UP,
  type SignalAnalysis,
} from "@/lib/signal-scoring.server";
import { feeModelRates, DEFAULT_FEE_MODEL } from "@/lib/fees";
import { projectedNetPctAtTp } from "@/lib/entry-gates";
import { fetchSpotPrices } from "@/lib/coindcx-spot.server";
import { perpToSpotMarket } from "@/lib/symbol-map";
import { premiumPct } from "@/lib/funding";
import { classifySetup } from "@/lib/futures/setup-classifier";
import { isGloballyBlacklisted } from "@/lib/global-symbol-blacklist";
import { getBackendStrategyPolicy } from "@/lib/futures/strategy-policy";
import { evaluateTradeEligibility } from "@/lib/futures/trade-eligibility";
import { evaluateManualEntry, evaluateMeanReversionShort } from "@/lib/futures/manual-entry";
import {
  loadLiveCreds,
  placeLiveEntry,
  placeLiveEntryMakerFirst,
  placeLiveExit,
} from "@/lib/futures/live-execution.server";

const FUTURES_TICKER = "https://public.coindcx.com/market_data/v3/current_prices/futures/rt";
// Scan-universe gates. Coins below this 24h quote-volume are never scanned
// (keeps out thin/choppy names). The movers arm takes top GAINERS only (>= this
// positive 24h %) — both live strategies target gainers (longs ride them,
// mean-reversion shorts fade the overextended ones), so the universe no longer
// feeds in big decliners/crashers. The volume arm is kept so majors stay
// scannable; the structure filter gates any weak major longs.
const MIN_SCAN_VOLUME_USDT = 20_000_000;
const MIN_SCAN_GAIN_PCT = 2;

// Entry confirmation (debounce). A filtered entry must clear its structure/short
// filter on TWO consecutive scans before it books, so a coin can't slip in on a
// single lucky 1-minute tick and then whip to the full stop. The window is a bit
// under two scan intervals (~2 min each); a pass older than this resets the streak,
// so a scan blocked in between (e.g. by a wide-spread tick) breaks confirmation.
const ENTRY_CONFIRM_REQUIRED = 2;
const ENTRY_CONFIRM_WINDOW_SECS = 210;
// Min seconds between counted passes. Was briefly 45 for the 1-min hot-list
// pass (2026-07-12, killed same day by its pre-registered bar: 4 hot-only
// admissions in the first hour, −$23.6 — confidence flicker, not climax; see
// docs/algorithm-overview.md). The 2-minute spacing IS part of the debounce's
// value: a 60s re-look is not an independent observation on fast indicators.
const ENTRY_CONFIRM_MIN_GAP_SECS = 60;

// Universe quality gate. A coin whose spread repeatedly trips the hard block in
// the recent past is illiquid junk (thin meme micro-caps) — drop it from the
// universe entirely rather than let it slip in on the odd sub-cap tick. Counted
// as distinct scan-minutes so a single wide scan (logged once per cohort) doesn't
// trigger it; persistent wide spread across scans does.
const SPREAD_EXCLUDE_LOOKBACK_MIN = 20;
const SPREAD_EXCLUDE_MIN_SCANS = 3;
const CANDLES = (pair: string, interval: string, limit: number) =>
  `https://public.coindcx.com/market_data/candles?pair=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;
const PUB_HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; Earn'O/1.0; +https://earno.lovable.app)",
};

async function fetchAtrPct(pair: string): Promise<number | null> {
  try {
    const { resolveInterval, aggregateCandles } = await import("@/lib/candle-aggregator");
    const [base, group] = resolveInterval("5m");
    const res = await fetch(CANDLES(pair, base, 30 * group), {
      headers: PUB_HEADERS,
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw) || raw.length < 16) return null;
    const agg = aggregateCandles(raw as any, group);
    if (agg.length < 16) return null;
    return atrPctFromCandles(agg, 14);
  } catch {
    return null;
  }
}

/**
 * Fetch 30m + 1m candles for the structure entry filter (shadow A/B). Returns
 * chronological ascending arrays, or null on any fetch/shape failure so the
 * caller can skip conservatively rather than book on a blind filter.
 */
/**
 * Short-TTL cache for filter candles. The structure/mean-rev filters run inside
 * the PER-COHORT loop, so without this the same symbol's candles are refetched
 * for every filter-enabled cohort every scan (3 × candidates × cohorts requests
 * against public.coindcx.com — the origin that rate-limits). Candles are
 * user-independent and the filters fail CLOSED on fetch failure ("candle data
 * unavailable" → skip), so a throttled origin would silently block bookings.
 * 90s TTL < the 2-min scan cadence, so every scan still gets fresh candles.
 */
const FILTER_CANDLE_TTL_MS = 90_000;
const filterCandleCache = new Map<string, { at: number; value: unknown }>();
function candleCacheGet<T>(key: string): T | undefined {
  const hit = filterCandleCache.get(key);
  if (hit && Date.now() - hit.at < FILTER_CANDLE_TTL_MS) return hit.value as T;
  if (hit) filterCandleCache.delete(key);
  return undefined;
}
function candleCacheSet(key: string, value: unknown): void {
  // Null results (fetch failure) are deliberately NOT cached: the next cohort
  // retries instead of inheriting a blind skip for 90s.
  if (value != null) filterCandleCache.set(key, { at: Date.now(), value });
  if (filterCandleCache.size > 300) filterCandleCache.clear(); // bounded
}

async function fetchStructureCandles(
  pair: string,
): Promise<{ c30: { open: number; high: number; low: number; close: number }[]; c1: { open: number; high: number; low: number; close: number }[] } | null> {
  const cached = candleCacheGet<{ c30: never[]; c1: never[] }>(`structure:${pair}`);
  if (cached) return cached;
  try {
    const { resolveInterval, aggregateCandles } = await import("@/lib/candle-aggregator");
    const [b30, g30] = resolveInterval("30m"); // ["15m", 2]
    const [res30, res1] = await Promise.all([
      fetch(CANDLES(pair, b30, 24), { headers: PUB_HEADERS, signal: AbortSignal.timeout(3500) }),
      fetch(CANDLES(pair, "1m", 45), { headers: PUB_HEADERS, signal: AbortSignal.timeout(3500) }),
    ]);
    if (!res30.ok || !res1.ok) return null;
    const raw30 = (await res30.json()) as Array<Record<string, unknown>>;
    const raw1 = (await res1.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw30) || !Array.isArray(raw1)) return null;
    const c30 = aggregateCandles(raw30 as any, g30);
    const c1 = aggregateCandles(raw1 as any, 1).sort((a, b) => a.time - b.time);
    if (c30.length < 4 || c1.length < 20) return null;
    const out = { c30, c1 };
    candleCacheSet(`structure:${pair}`, out);
    return out;
  } catch {
    return null;
  }
}

/**
 * Fetch 15m candles (with volume) for the mean-reversion short filter. Returns
 * chronological ascending, or null on any failure so the caller skips
 * conservatively rather than short on a blind filter.
 */
async function fetchMeanRevCandles(
  pair: string,
): Promise<{ open: number; high: number; low: number; close: number; volume: number; time: number }[] | null> {
  const cached = candleCacheGet<{ open: number; high: number; low: number; close: number; volume: number; time: number }[]>(`meanrev:${pair}`);
  if (cached) return cached;
  try {
    const { aggregateCandles } = await import("@/lib/candle-aggregator");
    const res = await fetch(CANDLES(pair, "15m", 45), {
      headers: PUB_HEADERS,
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw)) return null;
    const c15 = aggregateCandles(raw as any, 1).sort((a, b) => a.time - b.time);
    if (c15.length < 24) return null;
    candleCacheSet(`meanrev:${pair}`, c15);
    return c15;
  } catch {
    return null;
  }
}

type PlanTier = "free" | "reco" | "auto5" | "unlimited";

const AUTO_PLAN_DAILY_LIMIT: Record<PlanTier, number> = {
  free: 0,
  reco: 0,
  auto5: 5,
  unlimited: 9999,
};

type TickerEntry = {
  s?: string;
  pair?: string;
  ls?: string | number;
  c?: string | number;
  cp?: string | number;
  pc?: string | number;
  v?: string | number;
  qv?: string | number;
};

function num(x: unknown, d = 0): number {
  const n = typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : d;
}

/**
 * Build a dynamic scan universe from the CoinDCX futures ticker:
 *   • top `nChange` symbols by absolute 24h % change (covers biggest gainers AND losers)
 *   • top `nVolume` symbols by 24h quote volume
 * Returns the de-duplicated union — keeps the watchlist fresh each tick.
 */
/** Returns null when the ticker itself is unreachable (fetch/parse failure) so
 *  the caller can tell "API down" apart from a legitimately empty universe on
 *  a broad red day — both used to return [] and look identical in monitoring. */
async function fetchScanUniverse(
  nChange = 20,
  nVolume = 20,
): Promise<{
  arms: Array<{ symbol: string; price: number; change24h: number; volume24h: number }>;
  /** Top-150-by-volume liquid pool (any 24h direction) — feeds the freshness
   * arm's 4h-momentum ranking + price snapshots. NOT the scan universe. */
  pool: Array<{ symbol: string; price: number; change24h: number; volume24h: number }>;
} | null> {
  let raw: { prices: Record<string, TickerEntry> } | Record<string, TickerEntry> | TickerEntry[];
  try {
    const res = await fetch(FUTURES_TICKER, { headers: PUB_HEADERS, cache: "no-store" });
    if (!res.ok) {
      console.error(`[auto-book] futures ticker fetch failed: HTTP ${res.status}`);
      return null;
    }
    raw = (await res.json()) as typeof raw;
  } catch (e) {
    console.error("[auto-book] futures ticker fetch failed:", e instanceof Error ? e.message : e);
    return null;
  }
  const dict =
    raw && typeof raw === "object" && !Array.isArray(raw) && "prices" in raw
      ? (raw as { prices: Record<string, TickerEntry> }).prices
      : raw;
  const rows: Array<{ symbol: string; price: number; change24h: number; volume24h: number }> = [];
  const consume = (sym: string | undefined, r: TickerEntry) => {
    const symbol = sym ?? r.s ?? r.pair;
    if (!symbol || !symbol.startsWith("B-") || !symbol.endsWith("_USDT")) return;
    const price = num(r.ls ?? r.c);
    // Direction gates below (gainers-only, flat-to-up) need a REAL change
    // value: num() would default a missing/malformed field to 0, letting an
    // actually-falling coin pass the `change24h >= 0` volume arm as "flat".
    const changeRaw = r.cp ?? r.pc;
    const change =
      typeof changeRaw === "string" ? parseFloat(changeRaw) : typeof changeRaw === "number" ? changeRaw : NaN;
    if (!Number.isFinite(change)) return;
    const vol = num(r.qv ?? r.v);
    if (!price) return;
    rows.push({ symbol, price, change24h: change, volume24h: vol });
  };
  if (Array.isArray(dict)) dict.forEach((r) => consume(undefined, r));
  else Object.entries(dict).forEach(([k, v]) => v && typeof v === "object" && consume(k, v));

  // Liquidity floor: never scan thin coins. A low-volume name with a big % swing
  // (e.g. a choppy 24h decliner) otherwise slipped into the movers arm and got
  // traded/squeezed. Require real 24h quote volume for BOTH arms.
  const liquid = rows.filter((r) => r.volume24h >= MIN_SCAN_VOLUME_USDT);
  // Movers arm: top GAINERS only (>= MIN_SCAN_GAIN_PCT). Both live strategies
  // target gainers — longs ride them; the mean-reversion short fades the
  // overextended ones as they roll over — so the universe no longer feeds in
  // big decliners/crashers that the abs-change arm used to surface.
  const byGainers = [...liquid]
    .filter((r) => r.change24h >= MIN_SCAN_GAIN_PCT)
    .sort((a, b) => b.change24h - a.change24h)
    .slice(0, nChange);
  // Volume arm: keep the biggest names scannable (majors like BTC/ETH) on a
  // flat-to-up day — but never a *falling* major. A bleeding major is useless to
  // a long-only cohort and only feeds the losing continuation short, so decliners
  // are now excluded from BOTH arms. Stays dynamic (no hardcoded majors list); the
  // structure filter + 90% major-coin floor still gate any weak major longs.
  const byVolume = [...liquid]
    .filter((r) => r.change24h >= 0)
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, nVolume);
  const seen = new Set<string>();
  const union: typeof rows = [];
  for (const r of [...byGainers, ...byVolume]) {
    if (seen.has(r.symbol)) continue;
    seen.add(r.symbol);
    union.push(r);
  }
  const pool = [...liquid].sort((a, b) => b.volume24h - a.volume24h).slice(0, 150);
  return { arms: union, pool };
}

/**
 * Symbols whose spread has repeatedly tripped the hard-spread block in the recent
 * window — i.e. persistently illiquid junk (thin meme micro-caps). We count the
 * distinct scan-minutes a symbol was spread-blocked (a single wide scan logs one
 * `spread_skip` per cohort, so we dedupe by minute) and exclude a symbol once it
 * has been wide across >= SPREAD_EXCLUDE_MIN_SCANS scans. These are dropped from
 * the scan universe entirely so they never slip in on the odd sub-cap tick and
 * whip to a full stop. Best-effort: on any failure, returns an empty set.
 *
 * Known, accepted limits of this v1 (redesign deferred): (a) an excluded symbol
 * stops producing spread_skip events, so its old events age out of the lookback
 * and it auto-re-enters after ~SPREAD_EXCLUDE_LOOKBACK_MIN minutes — a coin that
 * is STILL wide then needs ~3 more wide scans to be re-excluded (a bounded
 * exclude/re-enter cycle, during which the per-candidate hard-spread block is
 * the backstop); (b) a symbol usually rejected by an earlier gate (neutral
 * bias, cooldown, ...) logs no spread_skip and evades the count — again the
 * per-candidate spread block still protects at booking time.
 */
async function fetchPersistentWideSpreadSymbols(supabase: SupabaseClient): Promise<Set<string>> {
  try {
    const sinceIso = new Date(Date.now() - SPREAD_EXCLUDE_LOOKBACK_MIN * 60_000).toISOString();
    // meta->>kind equality (not JSONB containment) so the partial index
    // bot_events_spread_skip_idx (WHERE meta->>'kind' = 'spread_skip') applies —
    // containment forced a seq-scan of bot_events on every 2-minute pass.
    const { data } = await supabase
      .from("bot_events")
      .select("meta, created_at")
      .gte("created_at", sinceIso)
      .eq("meta->>kind", "spread_skip")
      .limit(5000);
    if (!data) return new Set();
    const minutesBySym = new Map<string, Set<string>>();
    for (const row of data) {
      const meta = (row as { meta?: Record<string, unknown> }).meta;
      const sym = meta && typeof meta.symbol === "string" ? meta.symbol : null;
      if (!sym) continue;
      const minute = String((row as { created_at?: string }).created_at ?? "").slice(0, 16);
      let mins = minutesBySym.get(sym);
      if (!mins) {
        mins = new Set<string>();
        minutesBySym.set(sym, mins);
      }
      mins.add(minute);
    }
    const out = new Set<string>();
    for (const [sym, mins] of minutesBySym) {
      if (mins.size >= SPREAD_EXCLUDE_MIN_SCANS) out.add(sym);
    }
    return out;
  } catch {
    return new Set();
  }
}

/** Last 1m close for a single futures pair (fallback price source). Uses the
 *  futures candlesticks endpoint, which covers pairs the realtime bulk ticker
 *  occasionally omits. Returns 0 on any failure. */
async function fetchSingleFuturesPrice(pair: string, timeoutMs = 2000): Promise<number> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 600; // last ~10 minutes of 1m candles
  const url = `https://public.coindcx.com/market_data/candlesticks?pair=${encodeURIComponent(
    pair,
  )}&from=${from}&to=${to}&resolution=1&pcode=f`;
  try {
    const res = await fetch(url, {
      headers: PUB_HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return 0;
    const payload = (await res.json()) as { data?: Array<{ close?: number | string; time?: number | string }> };
    const arr = Array.isArray(payload?.data) ? payload.data : [];
    let best = 0;
    let bestT = -1;
    for (const k of arr) {
      const t = num(k.time);
      const c = num(k.close);
      if (c > 0 && t >= bestT) {
        bestT = t;
        best = c;
      }
    }
    return best;
  } catch {
    return 0;
  }
}

/** Spot ticker fallback for a single pair. Maps a futures symbol
 * ("B-BTC_USDT") to its spot market ("BTCUSDT") and returns last price, or
 * 0 on any failure. Kept independent from the bulk spot fetch so a single
 * request can't drag the whole pass over the timeout budget. */
async function fetchSingleSpotPrice(pair: string, timeoutMs = 2000): Promise<number> {
  const market = perpToSpotMarket(pair);
  if (!market) return 0;
  try {
    const res = await fetch(
      `https://api.coindcx.com/exchange/ticker`,
      { headers: PUB_HEADERS, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.ok) return 0;
    const raw = (await res.json()) as Array<{ market?: string; last_price?: string | number }>;
    if (!Array.isArray(raw)) return 0;
    const row = raw.find((r) => r.market === market);
    return row ? num(row.last_price) : 0;
  } catch {
    return 0;
  }
}

/**
 * Get live mark prices for the given symbols.
 *
 * Reliability contract (drives stop-loss / take-profit enforcement in the
 * every-minute mark pass — a silent failure means open positions aren't
 * re-priced and losers overshoot far past their level):
 *   - single-attempt bulk realtime ticker with a hard 2s timeout (no long
 *     retry loop that can starve the whole pass)
 *   - per-symbol parallel fallback for anything still missing: futures
 *     candlestick + spot ticker in parallel, 2s each
 *   - never returns empty for all symbols because one endpoint failed —
 *     degrades per-symbol, always returns whatever prices it could resolve
 *   - whole function completes well under 4s
 */
export async function fetchMarkPrices(symbols: string[]): Promise<Record<string, number>> {
  if (!symbols.length) return {};
  const wanted = new Set(symbols);
  const out: Record<string, number> = {};

  const consume = (dict: Record<string, TickerEntry> | TickerEntry[]) => {
    const entries = Array.isArray(dict)
      ? dict.map((v) => [undefined, v] as const)
      : Object.entries(dict);
    for (const [k, v] of entries) {
      if (!v || typeof v !== "object") continue;
      const sym = (v.s as string | undefined) ?? (k as string | undefined) ?? v.pair;
      if (!sym || !wanted.has(sym)) continue;
      const p = num(v.ls ?? v.c);
      if (p > 0) out[sym] = p;
    }
  };

  // Bulk realtime ticker — single attempt, hard 2s timeout.
  try {
    const res = await fetch(FUTURES_TICKER, {
      headers: PUB_HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const raw = (await res.json()) as
        | { prices: Record<string, TickerEntry> }
        | Record<string, TickerEntry>
        | TickerEntry[];
      const dict =
        raw && typeof raw === "object" && !Array.isArray(raw) && "prices" in raw
          ? (raw as { prices: Record<string, TickerEntry> }).prices
          : (raw as Record<string, TickerEntry> | TickerEntry[]);
      consume(dict);
    }
  } catch {
    /* bulk failed — degrade to per-symbol fallback below, don't starve pass */
  }

  // Per-symbol fallback in parallel: futures candles + spot ticker, 2s each.
  // Whichever returns a positive price first wins; a single flaky endpoint
  // must not block the rest of the pass.
  const missing = symbols.filter((s) => !(out[s] > 0));
  if (missing.length) {
    await Promise.all(
      missing.map(async (s) => {
        const [candlePrice, spotPrice] = await Promise.all([
          fetchSingleFuturesPrice(s, 2000).catch(() => 0),
          fetchSingleSpotPrice(s, 2000).catch(() => 0),
        ]);
        const p = candlePrice > 0 ? candlePrice : spotPrice;
        if (p > 0) out[s] = p;
      }),
    );
  }

  return out;
}


/** Coarse market regime computed from BTC 1h trend + last-candle momentum.
 * Used to gate trade direction at open time. Returns null on fetch failure
 * (caller treats null as "neutral"). */
export type MarketRegime = "strong_bullish" | "bullish" | "neutral" | "bearish" | "strong_bearish";

function ema(values: number[], period: number): number | null {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

async function fetch15mMomentum(): Promise<"bullish_lean" | "bearish_lean" | "flat"> {
  try {
    const res = await fetch(CANDLES("B-BTC_USDT", "15m", 20), {
      headers: PUB_HEADERS,
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return "flat";
    const raw = (await res.json()) as Array<{ close: number | string }>;
    if (!Array.isArray(raw) || raw.length < 10) return "flat";
    const closes = raw.map((k) => num(k.close));
    const ema9 = ema(closes.slice(-12), 9);
    const last = closes[closes.length - 1];
    if (!ema9 || !last) return "flat";
    const dist = (last - ema9) / ema9;
    if (dist > 0.004) return "bullish_lean";
    if (dist < -0.004) return "bearish_lean";
    return "flat";
  } catch {
    return "flat";
  }
}

export async function fetchMarketRegime(): Promise<MarketRegime | null> {
  try {
    const res = await fetch(CANDLES("B-BTC_USDT", "1h", 60), {
      headers: PUB_HEADERS,
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Array<{
      open: number | string;
      high: number | string;
      low: number | string;
      close: number | string;
    }>;
    if (!Array.isArray(raw) || raw.length < 22) return null;
    const closes = raw.map((k) => num(k.close));
    const last = closes[closes.length - 1];
    const ema21 = ema(closes.slice(-30), 21);
    const ema50 = ema(closes, 50);
    if (!last || !ema21 || !ema50) return null;
    const slope = ema21 / closes[closes.length - 7] - 1; // 6h slope
    const distEma50Pct = (last - ema50) / ema50;
    let regime: MarketRegime;
    if (distEma50Pct > 0.04 && slope > 0.01) regime = "strong_bullish";
    else if (distEma50Pct < -0.04 && slope < -0.01) regime = "strong_bearish";
    else if (distEma50Pct > 0.012) regime = "bullish";
    else if (distEma50Pct < -0.012) regime = "bearish";
    else regime = "neutral";

    // Multi-timeframe: if 1h says neutral, use 15m to detect faster regime shifts
    if (regime === "neutral") {
      const momentum15m = await fetch15mMomentum();
      if (momentum15m === "bullish_lean") return "bullish";
      if (momentum15m === "bearish_lean") return "bearish";
    }
    return regime;
  } catch {
    return null;
  }
}

// High-liquidity coins where EMA/VWAP signals need stronger confirmation.
// At confidence < major_coin_confidence_floor, these are skipped.
// At confidence >= floor they trade normally — preserving breakout participation.
const MAJOR_COINS = new Set([
  "B-BTC_USDT",
  "B-ETH_USDT",
  "B-BNB_USDT",
  "B-SOL_USDT",
  "B-XRP_USDT",
  "B-ADA_USDT",
  "B-DOGE_USDT",
  "B-NEAR_USDT",
  "B-SUI_USDT",
  "B-AAVE_USDT",
  "B-AVAX_USDT",
  "B-LINK_USDT",
  "B-UNI_USDT",
  "B-DOT_USDT",
  "B-MATIC_USDT",
  "B-LTC_USDT",
]);

type BotConfig = {
  user_id: string;
  mode: string;
  auto_book: boolean;
  is_running: boolean;
  leverage: number;
  risk_per_trade_pct: number;
  paper_equity: number;
  max_open_positions: number;
  cooldown_minutes: number;
  max_trades_per_day: number;
  auto_close_minutes: number;
  daily_loss_cap_pct: number | null;
  min_scalp_score: number | null;
  allow_short: boolean;
  allow_long: boolean;
  strategy: string | null;
  trading_style: string | null;
  min_sl_pct: number | null;
  atr_multiplier: number | null;
  max_auto_sl_pct: number | null;
  target_multiplier: number | null;
  min_rr: number | null;
  symbol_sl_cooldown_minutes: number | null;
  symbol_blacklist_threshold: number | null;
  regime_filter_enabled: boolean | null;
  auto_book_confidence_threshold: number | null;
  display_confidence_threshold: number | null;
  symbol_blocklist: string[] | null;
  live_wallet_source?: string | null;
  live_allocation_mode?: string | null;
  live_allocation_amount?: number | null;
  live_allocation_pct?: number | null;
  timeframe?: string | null;
  minimum_net_profit_to_enter_pct?: number | null;
  minimum_expected_edge_pct?: number | null;
  max_sl_atr_pct?: number | null;
  min_ev_ratio?: number | null;
  slippage_buffer_pct?: number | null;
  blocked_session_hours_ist?: number[] | null;
  major_coin_confidence_floor?: number | null;
  // Maker-first live entry (dormant unless explicitly enabled). Live-only.
  maker_entry_enabled?: boolean | null;
  maker_entry_wait_ms?: number | null;
  // Structure entry filter (shadow A/B): gate LONG entries on the manual
  // structural rule (30m higher-highs · 1m not overbought · 1m rising ·
  // Supertrend). Default false — control cohorts run unchanged.
  structure_entry_filter_enabled?: boolean | null;
  // Mean-reversion SHORT filter (shadow A/B): gate SHORT entries on a fade of an
  // overextended, overbought, volume-spiking 15m move that has rolled over.
  // Default false — control cohorts run unchanged.
  structure_short_filter_enabled?: boolean | null;
  // V2 confluence gate for LONGS (dormant until enabled per cohort). Requires
  // v2LongScore >= 2 to book. Weights are from a 14d component analysis of the
  // live book; flip this flag only after the out-of-sample window validates.
  v2_long_gate_enabled?: boolean | null;
  // Hot-list pass participation (default ON; explicit false disables). The
  // 1-minute pass re-checks a cohort's awaiting-confirmation candidates so the
  // 2nd look lands ~60s after the 1st instead of ~120s. Measured cost of the
  // wait: median 0.048% price adverse drift per booking (28/38 against).
  hotlist_enabled?: boolean | null;
  // Long vetoes (v2's autopsy survivors: no Bullish-24h chase, no RSI>65 longs).
  // Flagged live-arm test with a pre-registered bar — see the gate site.
  long_vetoes_enabled?: boolean | null;
  // Freshness arm (shadow): LONGS only from the top-decile 4h movers not yet
  // labeled Bullish-24h. Bar: n>=30 closed arm longs must beat same-window
  // non-arm longs on win% AND net/trade, or the flag dies.
  freshness_arm_enabled?: boolean | null;
  // Equity circuit breaker (pre-pilot P1). equity_peak = intraday (IST) equity
  // high-water mark maintained by the mark pass; halted_on = the IST date the
  // breaker tripped (book flattened + no new entries for the rest of that day).
  equity_peak?: number | null;
  equity_peak_date?: string | null;
  halted_on?: string | null;
  circuit_breaker_pct?: number | null;
};

/**
 * V2 long-confluence score, from the 14d signal→outcome component analysis:
 * trend STRENGTH is the dominant positive (strong uptrend 47.5% win vs 33.9%
 * plain); entering ON a volume spike is penalized (climax bar — 34-37% win at
 * >=1.5x vs 43% calm); RSI is scored as pullback quality (40-55 best, 55-65
 * worst); a symbol already labeled Bullish 24h is late (37.7% win) while
 * Sideways is early (43.5%). Book longs only at score >= 2. Replay on 424
 * trades: selected 52.6% win (+$32.74) vs rejected 35.8% (−$87.86); still
 * separates within structure-filter survivors (43.8% vs 33.6%).
 */
function v2LongScore(a: {
  trend_status?: string | null;
  volume_spike_ratio?: number | null;
  rsi?: number | null;
  market_regime?: string | null;
}): number {
  let score = 0;
  if (a.trend_status === TREND_STRONG_UP) score += 2;
  const v = a.volume_spike_ratio;
  if (v != null) {
    if (v < 1.0) score += 1;
    else if (v >= 1.5) score -= 2;
  }
  const r = a.rsi;
  if (r != null) {
    if (r >= 40 && r < 55) score += 1;
    else if (r >= 55 && r < 65) score -= 1;
  }
  if (a.market_regime === REGIME_SIDEWAYS_24H) score += 1;
  else if (a.market_regime === REGIME_BULLISH_24H) score -= 1;
  return score;
}

/** Returns the USDT capital to size positions against. Paper uses paper_equity.
 * Live reads the user's CoinDCX wallet (futures or spot) and applies the
 * configured allocation (full / fixed amount / % of wallet). */
async function resolveEquity(supabase: SupabaseClient, cfg: BotConfig): Promise<number> {
  if (cfg.mode !== "live") return Number(cfg.paper_equity ?? 0);

  try {
    const { data: creds } = await supabase
      .from("api_credentials")
      .select("api_key,api_secret")
      .eq("user_id", cfg.user_id)
      .maybeSingle();
    if (!creds) return 0;

    const { coindcxAuthedPost } = await import("@/lib/coindcx.server");
    const source = (cfg.live_wallet_source ?? "futures") as "futures" | "spot";
    let available = 0;
    if (source === "spot") {
      const r = await coindcxAuthedPost<Array<{ currency: string; balance: string }>>(
        "/exchange/v1/users/balances",
        creds.api_key as string,
        creds.api_secret as string,
      );
      if (r.ok) available = Number(r.data.find((b) => b.currency === "USDT")?.balance ?? 0) || 0;
    } else {
      const r = await coindcxAuthedPost<
        Array<{ asset?: string; currency?: string; balance?: string; available_balance?: string }>
      >(
        "/exchange/v1/derivatives/futures/wallets",
        creds.api_key as string,
        creds.api_secret as string,
      );
      if (r.ok) {
        const row = (r.data ?? []).find((b) => (b.asset ?? b.currency) === "USDT");
        available = Number(row?.available_balance ?? row?.balance ?? 0) || 0;
      }
    }

    const mode = (cfg.live_allocation_mode ?? "amount") as "full" | "amount" | "percent";
    if (mode === "full") return available;
    if (mode === "percent")
      return Math.max(0, (available * Number(cfg.live_allocation_pct ?? 100)) / 100);
    return Math.min(Number(cfg.live_allocation_amount ?? 0), available);
  } catch {
    return 0;
  }
}

async function getPlanTier(supabase: SupabaseClient, userId: string): Promise<PlanTier> {
  const { data, error } = await supabase.rpc("current_plan_tier", { _user_id: userId });
  if (error) return "free";
  return data === "auto5" || data === "unlimited" || data === "reco" ? data : "free";
}

async function logEvent(
  supabase: SupabaseClient,
  userId: string,
  level: "info" | "warn" | "error",
  message: string,
  meta?: Record<string, unknown>,
) {
  await supabase.from("bot_events").insert({ user_id: userId, level, message, meta: meta ?? null });
}

/**
 * Records that a filtered entry passed on this scan and returns the current
 * consecutive-pass count (via the `confirm_entry` RPC). The count resets to 1 if
 * the previous pass is older than ENTRY_CONFIRM_WINDOW_SECS, so only genuinely
 * consecutive scans accumulate. Caller books only once the count reaches
 * ENTRY_CONFIRM_REQUIRED. On any RPC error, returns ENTRY_CONFIRM_REQUIRED so a
 * transient DB blip never blocks all entries (fail-open).
 */
async function confirmEntry(
  supabase: SupabaseClient,
  userId: string,
  symbol: string,
  side: "long" | "short",
): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("confirm_entry", {
      _user: userId,
      _symbol: symbol,
      _side: side,
      _window_secs: ENTRY_CONFIRM_WINDOW_SECS,
      _min_gap_secs: ENTRY_CONFIRM_MIN_GAP_SECS,
    });
    if (error || typeof data !== "number") {
      // Fail-open, but LOUDLY: without this event a missing/broken RPC would
      // silently disable the debounce forever (every call would report 2/2).
      void logEvent(
        supabase,
        userId,
        "warn",
        `Entry-confirmation RPC failed for ${symbol} — booking without debounce (fail-open)`,
        { kind: "entry_confirm_rpc_error", symbol, side, error: error?.message ?? "non-numeric result" },
      ).catch(() => {});
      return ENTRY_CONFIRM_REQUIRED;
    }
    return data;
  } catch (e) {
    void logEvent(
      supabase,
      userId,
      "warn",
      `Entry-confirmation RPC failed for ${symbol} — booking without debounce (fail-open)`,
      { kind: "entry_confirm_rpc_error", symbol, side, error: e instanceof Error ? e.message : String(e) },
    ).catch(() => {});
    return ENTRY_CONFIRM_REQUIRED;
  }
}

async function logScanEvent(
  supabase: SupabaseClient,
  userId: string,
  scanned: number,
  opportunities: number,
  opened: number,
  skipped: number,
  topConfidence: number,
) {
  await supabase.from("bot_events").insert({
    user_id: userId,
    level: "info",
    message: `Scan complete: ${scanned} markets, ${opportunities} opportunities`,
    meta: { kind: "scan", scanned, opportunities, opened, skipped, top_confidence: topConfidence },
  });
}

async function logPauseEvent(supabase: SupabaseClient, userId: string, message: string) {
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data } = await supabase
    .from("bot_events")
    .select("id")
    .eq("user_id", userId)
    .eq("message", message)
    .gte("created_at", since)
    .limit(1);
  if (!data?.length) await logEvent(supabase, userId, "warn", message);
}

/** Run one auto-book pass. Optionally restrict to a single user (manual trigger). */
export async function runAutoBookPass(
  supabase: SupabaseClient,
  opts: { userId?: string; hotlistOnly?: boolean } = {},
): Promise<{
  users: number;
  opened: number;
  skipped: number;
  details: Array<{ user: string; opened: number; skipped: number; reason?: string }>;
}> {
  let q = supabase
    .from("bot_config")
    .select(
      "user_id,mode,auto_book,is_running,leverage,risk_per_trade_pct,paper_equity,max_open_positions,cooldown_minutes,max_trades_per_day,auto_close_minutes,daily_loss_cap_pct,min_scalp_score,allow_short,allow_long,strategy,trading_style,min_sl_pct,atr_multiplier,max_auto_sl_pct,target_multiplier,min_rr,symbol_sl_cooldown_minutes,symbol_blacklist_threshold,regime_filter_enabled,auto_book_confidence_threshold,display_confidence_threshold,symbol_blocklist,live_wallet_source,live_allocation_mode,live_allocation_amount,live_allocation_pct,timeframe,minimum_net_profit_to_enter_pct,minimum_expected_edge_pct,max_sl_atr_pct,min_ev_ratio,slippage_buffer_pct,blocked_session_hours_ist,major_coin_confidence_floor,maker_entry_enabled,maker_entry_wait_ms,structure_entry_filter_enabled,structure_short_filter_enabled,v2_long_gate_enabled,hotlist_enabled,long_vetoes_enabled,halted_on,freshness_arm_enabled",
    )
    .eq("auto_book", true)
    .eq("is_running", true);

  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data: cfgs, error: cfgErr } = await q;
  if (cfgErr) {
    // A failed config select (e.g. schema drift: a column in the select string
    // missing from the DB) must be LOUD — otherwise the whole pass silently
    // no-ops with users=0 and the bot looks dead with no error anywhere.
    console.error("[auto-book] bot_config select failed — pass aborted:", cfgErr.message);
  }

  const users = (cfgs ?? []) as BotConfig[];
  const result = {
    users: users.length,
    opened: 0,
    skipped: 0,
    details: [] as Array<{ user: string; opened: number; skipped: number; reason?: string }>,
  };
  if (!users.length) return result;

  // Hot-list pass: re-evaluate ONLY candidates already awaiting their 2nd
  // confirmation, through the IDENTICAL gate chain below, ~60s after the full
  // scan first saw them (instead of ~120s on the next full scan). Cron runs it
  // on odd minutes (full scan runs even minutes) so the two passes never share
  // a minute — that interleave, not locking, is what prevents a double-book
  // race on the same tick. An empty queue exits here, before any market fetch,
  // so the extra per-minute cron is nearly free. Measured prize: median 0.048%
  // price adverse drift per booking during the 2-minute wait (28/38 against).
  let hotSymbolsByUser: Map<string, Set<string>> | null = null;
  if (opts.hotlistOnly) {
    const cutoffIso = new Date(Date.now() - ENTRY_CONFIRM_WINDOW_SECS * 1000).toISOString();
    const { data: pendingRows, error: pendErr } = await supabase
      .from("entry_confirmations")
      .select("user_id,symbol")
      .gte("updated_at", cutoffIso)
      .lt("confirms", ENTRY_CONFIRM_REQUIRED);
    if (pendErr) {
      // Loud abort, same rationale as the config select above.
      console.error("[auto-book] hotlist pending select failed — pass aborted:", pendErr.message);
      return result;
    }
    hotSymbolsByUser = new Map();
    for (const r of pendingRows ?? []) {
      const cfg = users.find((u) => u.user_id === (r.user_id as string));
      if (!cfg || cfg.hotlist_enabled === false) continue;
      let set = hotSymbolsByUser.get(r.user_id as string);
      if (!set) {
        set = new Set();
        hotSymbolsByUser.set(r.user_id as string, set);
      }
      set.add(r.symbol as string);
    }
    if (!hotSymbolsByUser.size) return result;
  }

  const scanId = crypto.randomUUID();

  // Fetch profiles once for user_name on signal rows.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id,display_name,email")
    .in(
      "id",
      users.map((u) => u.user_id),
    );
  const nameByUser = new Map<string, string>(
    (profiles ?? []).map((p) => [
      p.id as string,
      ((p.display_name as string) || (p.email as string) || "") as string,
    ]),
  );

  // Universe + per-timeframe per-symbol analysis (shared across users with the same timeframe).
  const universeFetched = await fetchScanUniverse(25, 25); // null = ticker unreachable
  const universeRaw = universeFetched?.arms ?? [];
  const tickerPool = universeFetched?.pool ?? [];
  // Quality gate: drop coins that have been persistently wide-spread lately. A
  // one-off wide tick is fine; a coin that keeps tripping the spread block across
  // scans is illiquid junk that otherwise slips in on a lucky sub-cap tick.
  const wideSpread = await fetchPersistentWideSpreadSymbols(supabase);
  const dropped = universeRaw.filter((u) => wideSpread.has(u.symbol));
  let universe = dropped.length ? universeRaw.filter((u) => !wideSpread.has(u.symbol)) : universeRaw;
  if (dropped.length) {
    console.log(
      `[auto-book] universe quality gate dropped ${dropped.length} wide-spread symbol(s): ${dropped
        .map((u) => u.symbol)
        .join(", ")}`,
    );
  }
  if (hotSymbolsByUser) {
    // Restrict to the pending candidates — but only AFTER the normal universe
    // build + quality gate, so a symbol that fell out of the universe (or got
    // spread-blacklisted) since the first look cannot book via the hot pass.
    const allHot = new Set<string>();
    for (const set of hotSymbolsByUser.values()) for (const sym of set) allHot.add(sym);
    universe = universe.filter((u) => allHot.has(u.symbol));
    // Empty here means the candidates dropped out of the universe or the
    // ticker fetch failed — exit quietly; the full scan owns alerting.
    if (!universe.length) return result;
  }
  // ---- 4h freshness arm (shadow; flagged per cohort) ----
  // Hypothesis test (14d × 137 syms × 15m closes, two opposite-regime weeks):
  // top-decile 4h movers NOT yet labeled Bullish-24h were the only bucket with
  // positive 2h forward returns in the red week and the best bucket in the
  // green week (+0.20%/2h vs +0.05% base; fee-clear rate 33-35% vs 25%), while
  // top 1h movers were NEGATIVE both weeks (1h spikes mean-revert — refuted).
  // The arm: rank the liquid pool by 4h momentum from price snapshots the pass
  // itself maintains (zero extra API calls), and for arm cohorts allow LONGS
  // only from the fresh set. Fresh symbols outside the normal universe arms are
  // added to the scan but stay invisible to non-arm cohorts (clean control).
  const fresh4hSet = new Set<string>();
  const freshExtras = new Set<string>();
  if (!hotSymbolsByUser && tickerPool.length) {
    try {
      // Snapshot maintenance: at most one snapshot per ~14 min, pruned at 30h.
      const { data: lastSnap } = await supabase
        .from("futures_price_snaps")
        .select("snapped_at")
        .order("snapped_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastMs = lastSnap ? new Date(lastSnap.snapped_at as string).getTime() : 0;
      if (Date.now() - lastMs >= 14 * 60_000) {
        const snapAt = new Date().toISOString();
        await supabase.from("futures_price_snaps").insert(
          tickerPool.map((u) => ({ snapped_at: snapAt, symbol: u.symbol, price: u.price })) as never,
        );
        await supabase
          .from("futures_price_snaps")
          .delete()
          .lt("snapped_at", new Date(Date.now() - 30 * 3600_000).toISOString());
      }

      const anyFreshArm = users.some(
        (u) => (u as BotConfig).freshness_arm_enabled === true,
      );
      if (anyFreshArm) {
        const { data: snaps } = await supabase
          .from("futures_price_snaps")
          .select("symbol,price")
          .gte("snapped_at", new Date(Date.now() - 4 * 3600_000 - 12 * 60_000).toISOString())
          .lte("snapped_at", new Date(Date.now() - 4 * 3600_000 + 12 * 60_000).toISOString());
        const past = new Map((snaps ?? []).map((r) => [r.symbol as string, Number(r.price)]));
        const ranked: Array<{ symbol: string; r4h: number; change24h: number; row: (typeof tickerPool)[number] }> = [];
        for (const u of tickerPool) {
          const p0 = past.get(u.symbol);
          if (p0 && p0 > 0 && u.price > 0) {
            ranked.push({ symbol: u.symbol, r4h: u.price / p0 - 1, change24h: u.change24h, row: u });
          }
        }
        // Need a broad enough pool for a meaningful decile; on cold start
        // (< 4h of snapshots) the arm simply books nothing.
        if (ranked.length >= 40) {
          const cut = [...ranked].sort((a, b) => a.r4h - b.r4h)[Math.floor(ranked.length * 0.9)].r4h;
          for (const r of ranked) {
            if (r.r4h >= cut && r.r4h > 0 && r.change24h < 1) {
              fresh4hSet.add(r.symbol);
            }
          }
          // Admit up to 8 fresh movers that the normal arms missed (flat on
          // 24h + not top-volume). They are analyzed like any symbol but gated
          // to arm cohorts only.
          const inUniverse = new Set(universe.map((u) => u.symbol));
          const missing = ranked
            .filter((r) => fresh4hSet.has(r.symbol) && !inUniverse.has(r.symbol))
            .sort((a, b) => b.r4h - a.r4h)
            .slice(0, 8);
          for (const m of missing) {
            universe.push(m.row);
            freshExtras.add(m.symbol);
          }
        }
      }
    } catch (e) {
      // Freshness is strictly additive — any failure must not touch the normal scan.
      console.error("[auto-book] freshness arm precompute failed", e);
    }
  }

  // An empty universe is ambiguous without this: "ticker API down" and "broad
  // red day (no gainers, nothing flat-to-up)" both used to look like scanned=0.
  const universeEmptyReason =
    universeFetched === null
      ? "Scan universe unavailable: futures ticker fetch failed"
      : universe.length === 0
        ? "Scan universe empty: no gainers or flat-to-up liquid names (broad red market?)"
        : null;
  const scannedCount = universe.length;
  const distinctTimeframes = Array.from(
    new Set(users.map((u) => (u.timeframe && u.timeframe.trim()) || "5m")),
  );
  const analysesByTf = new Map<string, SignalAnalysis[]>();
  if (universe.length) {
    await Promise.all(
      distinctTimeframes.map(async (tf) => {
        const settled = await Promise.allSettled(
          universe.map((u) => analyzeSymbol(u.symbol, u.price, u.change24h, tf)),
        );
        const arr: SignalAnalysis[] = [];
        for (const s of settled) {
          if (s.status === "fulfilled" && s.value) arr.push(s.value);
        }
        arr.sort((a, b) => b.confidence_pct - a.confidence_pct);
        analysesByTf.set(tf, arr);
      }),
    );
  }
  const topConfidenceOverall = Array.from(analysesByTf.values())
    .flat()
    .reduce((m, a) => Math.max(m, a.confidence_pct), 0);

  // Intraday market-pause for LONGS: when >= 50% of the scanned universe is in
  // an intraday downtrend, stop opening NEW longs (shorts and all exits keep
  // running — in red tape the book goes short-only, not dark). Replay on
  // Jul 10-17: the >=50% band was net-negative for longs in BOTH the green
  // window (−$41.87) and the red window (−$9.16); every other band was fine in
  // normal tape. This is the market-level reflex the coin bot's breadth gate
  // provides — built from the INTRADAY trend labels (the 24h labels lag a full
  // day and pointed the wrong way in the Jul 15-17 rollover).
  const LONG_PAUSE_DOWN_SHARE = 0.5;
  const downShareByTf = new Map<string, number>();
  for (const [tf, arr] of analysesByTf) {
    const known = arr.filter((x) => x.trend_status && x.trend_status !== "Unknown");
    const down = known.filter(
      (x) => x.trend_status === "Downtrend" || x.trend_status === "Strong downtrend",
    );
    downShareByTf.set(tf, known.length ? down.length / known.length : 0);
  }

  // Compute market regime once for the whole pass.
  const marketRegime = await fetchMarketRegime();

  // Cross-user hard-SL tracker for Futures paper trades in the last 6h.
  // Hard SL = exit_reason='stop_loss' OR final ROE (pnl_pct, leverage-adjusted) <= -4.5%.
  // 2+ hard SLs on the same symbol globally blocks new auto-book entries for 6h.
  const HARD_SL_WINDOW_MS = 6 * 3600_000;
  const HARD_SL_ROE_THRESHOLD = -4.5;
  const sixHoursAgoIso = new Date(Date.now() - HARD_SL_WINDOW_MS).toISOString();
  const { data: globalRecentClosed } = await supabase
    .from("positions")
    .select("symbol,exit_reason,pnl_pct,closed_at,mode,instrument,status")
    .eq("mode", "paper")
    .eq("instrument", "futures")
    .eq("status", "closed")
    .gte("closed_at", sixHoursAgoIso);
  const globalHardSlCount = new Map<string, number>();
  for (const r of globalRecentClosed ?? []) {
    const isHard = r.exit_reason === "stop_loss" || Number(r.pnl_pct ?? 0) <= HARD_SL_ROE_THRESHOLD;
    if (!isHard) continue;
    const sym = r.symbol as string;
    globalHardSlCount.set(sym, (globalHardSlCount.get(sym) ?? 0) + 1);
  }

  const { data: floorRows } = await supabase
    .from("regime_confidence_floors")
    .select("trading_style, with_trend_floor, counter_trend_floor, neutral_floor_offset");
  const regimeFloorsByStyle = new Map((floorRows ?? []).map((r) => [r.trading_style, r]));
  const DEFAULT_REGIME_FLOORS = {
    with_trend_floor: 88,
    counter_trend_floor: 91,
    neutral_floor_offset: 1,
  };

  // Signal age tracker: age = seconds since start of the CURRENT continuous
  // same-direction streak for that symbol. A gap > ~2 scan intervals or an
  // opposite/neutral side_bias row breaks the streak. Log-only analytics.
  const STREAK_GAP_MS = 5 * 60_000; // ~2 scan intervals (scans run every ~2m)
  const { data: signalAgeRows } = await supabase
    .from("bot_signals")
    .select("symbol, side_bias, created_at")
    .gte("created_at", new Date(Date.now() - 4 * 3600_000).toISOString())
    .order("created_at", { ascending: false });
  const earliestSignalAt = new Map<string, number>();
  {
    const bySymbol = new Map<string, Array<{ ts: number; side: string | null }>>();
    for (const r of signalAgeRows ?? []) {
      const arr = bySymbol.get(r.symbol as string) ?? [];
      arr.push({
        ts: new Date(r.created_at as string).getTime(),
        side: (r.side_bias as string | null) ?? null,
      });
      bySymbol.set(r.symbol as string, arr);
    }
    for (const [symbol, rows] of bySymbol) {
      // rows are newest-first
      const head = rows[0];
      if (!head || (head.side !== "long" && head.side !== "short")) continue;
      let streakStart = head.ts;
      let prevTs = head.ts;
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (r.side !== head.side) break;
        if (prevTs - r.ts > STREAK_GAP_MS) break;
        streakStart = r.ts;
        prevTs = r.ts;
      }
      earliestSignalAt.set(`${symbol}|${head.side}`, streakStart);
    }
  }

  for (const cfg of users) {
    // Hot-list pass: only cohorts with a pending candidate participate; other
    // cohorts see this pass as if it never ran (no signals, no scan events).
    if (hotSymbolsByUser && !hotSymbolsByUser.get(cfg.user_id)?.size) continue;
    let opened = 0;
    let skipped = 0;
    const userName = nameByUser.get(cfg.user_id) ?? "";
    // Mode is the source of truth for the confidence threshold (conservative 78
    // / balanced 72 / aggressive 66); an admin column value still overrides via
    // presetFromConfig. Strictness does not affect confidence, so deriving it
    // here (before the full preset build below) is equivalent.
    const autoConfThreshold = presetFromConfig(cfg).autoBookConfidence;
    const displayConfThreshold = Number(cfg.display_confidence_threshold ?? 55);

    const signalRows: Record<string, unknown>[] = [];
    const pushSignal = (
      a: SignalAnalysis,
      signalId: string,
      final: string,
      bookedTradeId: string | null,
      rejection: string | null,
      gates: {
        cooldown_active: boolean;
        daily_loss_available: boolean;
        max_position_available: boolean;
        risk_reward: number | null;
      },
    ) => {
      // For booked rows we coerce action to LONG/SHORT to match the executed side.
      const finalAction =
        bookedTradeId != null
          ? a.side_bias === "long"
            ? "LONG"
            : a.side_bias === "short"
              ? "SHORT"
              : a.action
          : a.action;
      signalRows.push({
        id: signalId,
        scan_id: scanId,
        user_id: cfg.user_id,
        user_name: userName,
        symbol: a.symbol,
        price: a.price,
        action: finalAction,
        side_bias: a.side_bias,
        confidence_pct: a.confidence_pct,
        confidence_band: a.confidence_band,
        reason: a.reason,
        final_decision: bookedTradeId != null ? "booked" : final,
        booked: bookedTradeId != null,
        booked_trade_id: bookedTradeId,
        rejection_reason: rejection,
        strategy: cfg.strategy ?? "default",
        timeframe: (cfg.timeframe && cfg.timeframe.trim()) || "5m",
        config_id: cfg.user_id,
        trend_status: a.trend_status,
        vwap_status: a.vwap_status,
        ema_alignment: a.ema_alignment,
        rsi: a.rsi,
        volume_spike_ratio: a.volume_spike_ratio,
        spread_pct: a.spread_pct,
        atr_pct: a.atr_pct,
        distance_from_vwap_pct: a.distance_from_vwap_pct,
        distance_from_ema21_pct: a.distance_from_ema21_pct,
        impulse_candle_pct: a.impulse_candle_pct,
        risk_reward: gates.risk_reward,
        market_regime: a.market_regime,
        cooldown_active: gates.cooldown_active,
        daily_loss_available: gates.daily_loss_available,
        max_position_available: gates.max_position_available,
      });
    };

    const planTier = await getPlanTier(supabase, cfg.user_id);
    const planDailyLimit = AUTO_PLAN_DAILY_LIMIT[planTier];

    // Daily loss cap check.
    // IST = UTC+5:30. IST midnight = UTC 18:30 the previous day.
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // 5h30m in ms
    const istNow = new Date(now.getTime() + istOffset);
    const istMidnight = new Date(
      Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0, 0) -
        istOffset,
    );
    const startOfDay = istMidnight;
    const { data: todayPos } = await supabase
      .from("positions")
      .select("pnl,status,opened_at,exchange_order_id")
      .eq("user_id", cfg.user_id)
      .gte("opened_at", startOfDay.toISOString());

    const todayPnl = (todayPos ?? []).reduce((acc, p) => acc + Number(p.pnl ?? 0), 0);
    const equity = await resolveEquity(supabase, cfg);
    let dailyLossAvailable = true;
    if (cfg.daily_loss_cap_pct != null && equity > 0) {
      const cap = (Number(cfg.daily_loss_cap_pct) / 100) * equity;
      if (todayPnl <= -cap) dailyLossAvailable = false;
    }

    const todayAutoCount = (todayPos ?? []).filter((p) =>
      String(p.exchange_order_id ?? "").startsWith("paper-auto-"),
    ).length;
    const dailyLimit = Math.min(cfg.max_trades_per_day ?? 999, planDailyLimit);
    const remainingToday = Math.max(0, dailyLimit - todayAutoCount);

    const { data: openRows, count: openCount } = await supabase
      .from("positions")
      .select("symbol,opened_at", { count: "exact" })
      .eq("user_id", cfg.user_id)
      .eq("status", "open");

    let openSlot = Math.max(0, (cfg.max_open_positions ?? 5) - (openCount ?? 0));
    const openSymbols = new Set((openRows ?? []).map((r) => r.symbol as string));
    const maxPositionAvailable = openSlot > 0;

    // Pause-level reasons → log but still emit per-symbol signals so the
    // operator sees why nothing was booked.
    let userBlockReason: string | null = null;
    // Circuit-breaker halt: the mark pass flattened this user's book earlier
    // today (IST) after a >=circuit_breaker_pct drop from the intraday equity
    // peak. No new entries until the next IST day.
    const istToday = istNow.toISOString().slice(0, 10);
    if (planDailyLimit <= 0) userBlockReason = "Plan does not allow auto-book";
    else if ((cfg.halted_on ?? null) === istToday)
      userBlockReason = "Circuit breaker tripped: halted for the day";
    else if (!dailyLossAvailable) userBlockReason = "Daily loss cap hit";
    else if (remainingToday <= 0)
      userBlockReason = `Daily auto-book limit reached (${todayAutoCount}/${dailyLimit})`;
    else if (!maxPositionAvailable)
      userBlockReason = `Max open positions reached (${openCount ?? 0}/${cfg.max_open_positions ?? 5})`;

    if (userBlockReason) {
      await logPauseEvent(supabase, cfg.user_id, `Auto-book paused: ${userBlockReason}`);
    }

    // Cooldown lookups (last 24h).
    const cooldownMs = (cfg.cooldown_minutes ?? 15) * 60_000;
    const symbolSlCooldownMs = Math.max(0, Number(cfg.symbol_sl_cooldown_minutes ?? 180)) * 60_000;
    const blacklistThreshold = Math.max(1, Number(cfg.symbol_blacklist_threshold ?? 3));
    const { data: recent } = await supabase
      .from("positions")
      .select("symbol,opened_at,closed_at,exit_reason,pnl,pnl_pct,side")
      .eq("user_id", cfg.user_id)
      .gte("opened_at", new Date(Date.now() - 24 * 3600_000).toISOString());
    const lastOpen = new Map<string, number>();
    const lastSlClose = new Map<string, number>();
    const lossCountBySymbol = new Map<string, number>();
    const lastLossAtBySymbol = new Map<string, number>();
    const winCountBySymbol = new Map<string, number>();
    // Per-user hard-SL tracker (last 6h, hard = stop_loss reason OR ROE <= -4.5%).
    const userHardSlAt = new Map<string, number>();
    const hardSlCutoff = Date.now() - HARD_SL_WINDOW_MS;
    for (const r of recent ?? []) {
      const sym = r.symbol as string;
      const t = new Date(r.opened_at as string).getTime();
      const prev = lastOpen.get(sym) ?? 0;
      if (t > prev) lastOpen.set(sym, t);
      const pnl = Number(r.pnl ?? 0);
      const closedTs = r.closed_at ? new Date(r.closed_at as string).getTime() : 0;
      if (r.exit_reason === "stop_loss" && r.closed_at) {
        const prevC = lastSlClose.get(sym) ?? 0;
        if (closedTs > prevC) lastSlClose.set(sym, closedTs);
      }
      if (closedTs >= hardSlCutoff) {
        const isHard =
          r.exit_reason === "stop_loss" || Number(r.pnl_pct ?? 0) <= HARD_SL_ROE_THRESHOLD;
        if (isHard) {
          const prevH = userHardSlAt.get(sym) ?? 0;
          if (closedTs > prevH) userHardSlAt.set(sym, closedTs);
        }
      }
      if (pnl < 0) {
        lossCountBySymbol.set(sym, (lossCountBySymbol.get(sym) ?? 0) + 1);
        const prevL = lastLossAtBySymbol.get(sym) ?? 0;
        if (closedTs > prevL) lastLossAtBySymbol.set(sym, closedTs);
      } else if (pnl > 0) {
        winCountBySymbol.set(sym, (winCountBySymbol.get(sym) ?? 0) + 1);
      }
    }

    // Style-aware execution caps (style + strictness from min_scalp_score).
    const strictness = strictnessFromMinScore(cfg.min_scalp_score);
    const presetRaw: StylePreset = presetFromConfig(cfg);
    const preset: StylePreset = applyStrictnessToPreset(presetRaw, strictness);
    const blockedSymbols = new Set<string>(
      (cfg.symbol_blocklist ?? []).map((s) => String(s).trim().toUpperCase()).filter(Boolean),
    );

    // Today's auto/paper trades for style caps (count opened today regardless of status).
    const openedToday = (todayPos ?? []) as Array<{
      pnl: number | null;
      status: string;
      opened_at: string;
      exchange_order_id: string | null;
    }>;
    const todayAutoRecent =
      (
        await supabase
          .from("positions")
          .select("symbol,side")
          .eq("user_id", cfg.user_id)
          .gte("opened_at", startOfDay.toISOString())
      ).data ?? [];
    const longTodayCount = todayAutoRecent.filter((r) => r.side === "long").length;
    const shortTodayCount = todayAutoRecent.filter((r) => r.side === "short").length;
    const perSymbolTodayCount = new Map<string, number>();
    for (const r of todayAutoRecent) {
      perSymbolTodayCount.set(
        r.symbol as string,
        (perSymbolTodayCount.get(r.symbol as string) ?? 0) + 1,
      );
    }
    // Track in-pass increments so caps account for trades booked earlier in this loop.
    const sameDirOpenedThisPass = { long: 0, short: 0 };
    const symbolOpenedThisPass = new Map<string, number>();
    void openedToday;

    const cfgTimeframe = (cfg.timeframe && cfg.timeframe.trim()) || "5m";
    // Intraday market-pause state for this cohort's timeframe (see the
    // computation above the user loop). One event per cohort per pass.
    const downShare = downShareByTf.get(cfgTimeframe) ?? 0;
    const longsPaused = downShare >= LONG_PAUSE_DOWN_SHARE;
    let longPauseLogged = false;
    let analyses = analysesByTf.get(cfgTimeframe) ?? [];
    if (hotSymbolsByUser) {
      // Each cohort re-checks only ITS OWN pending candidates — another
      // cohort's streak must not start early off this pass.
      const mine = hotSymbolsByUser.get(cfg.user_id) as Set<string>;
      analyses = analyses.filter((a) => mine.has(a.symbol));
    }
    const backendPolicy = getBackendStrategyPolicy({
      strategy: cfg.strategy,
      trading_style: cfg.trading_style,
    });

    for (const a of analyses) {
      const sym = a.symbol;
      // Freshness-arm universe extras exist only for arm cohorts — silently
      // invisible to everyone else so the control stays uncontaminated.
      if (freshExtras.has(sym) && cfg.freshness_arm_enabled !== true) continue;
      const signalId = crypto.randomUUID();
      const cooldownActive =
        (lastOpen.get(sym) != null && Date.now() - (lastOpen.get(sym) as number) < cooldownMs) ||
        (lastSlClose.get(sym) != null &&
          Date.now() - (lastSlClose.get(sym) as number) < symbolSlCooldownMs);

      // Compute risk plan up front so we can include rr on every row.
      // Side-aware: shorts get the tighter fade geometry (see risk-engine).
      const plan = computeRiskPlan({
        atrPct: a.atr_pct,
        preset,
        capital: equity,
        unsupported: a.side_bias === "neutral",
        side: a.side_bias === "short" ? "short" : "long",
      });

      // Decide gating.
      let rejection: string | null = null;
      let final: string = "skip";

      if (isGloballyBlacklisted(sym)) {
        rejection = "Symbol on platform blacklist";
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "platform_blacklist_skip",
            symbol: a.symbol,
          },
        ).catch(() => {});
      } else if (blockedSymbols.has(sym.toUpperCase())) {
        rejection = "Symbol on user blocklist";
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "user_blocklist_skip",
            symbol: a.symbol,
          },
        ).catch(() => {});
      } else if (
        // Global hard-SL cooldown: 2+ hard SLs across Futures paper users in
        // the last 6h blocks new auto-book entries (both long & short) for 6h.
        cfg.mode === "paper" &&
        (globalHardSlCount.get(sym) ?? 0) >= 2
      ) {
        rejection = "Symbol globally cooled (2+ hard SLs across users in 6h)";
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "global_sl_cooldown_skip",
            symbol: a.symbol,
            global_hard_sl_count: globalHardSlCount.get(sym) ?? 0,
          },
        ).catch(() => {});
      } else if (
        // Per-user hard-SL cooldown: 1 hard SL in last 6h blocks re-entry
        // for symbol_sl_cooldown_minutes.
        cfg.mode === "paper" &&
        userHardSlAt.has(sym) &&
        Date.now() - (userHardSlAt.get(sym) as number) < symbolSlCooldownMs
      ) {
        rejection = "Symbol hard-SL cooldown (user, last 6h)";
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "user_sl_cooldown_skip",
            symbol: a.symbol,
            symbol_sl_cooldown_minutes: cfg.symbol_sl_cooldown_minutes,
          },
        ).catch(() => {});
      } else if (a.action === "AVOID" || a.side_bias === "neutral") {
        rejection = "Bias unclear / avoid";
        final = "avoid";
        // Not logged to the activity feed: "bias unclear / avoid" means there was
        // no directional signal at all (the idle state for most symbols every
        // scan) — it floods the feed and is not a gate rejection of a real
        // candidate. Still recorded in bot_signals for analysis; the per-scan
        // "Scan complete" event is the feed's heartbeat.
      } else if (a.side_bias === "short" && cfg.allow_short === false) {
        // Symmetric with allow_long below: only an EXPLICIT false disables a
        // side. The old falsy check (!cfg.allow_short) meant a NULL column —
        // partial insert, old migration — silently ran the cohort long-only
        // while the config read as symmetric.
        rejection = "Shorts disabled in config";
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "shorts_disabled_skip",
            symbol: a.symbol,
          },
        ).catch(() => {});
      } else if (
        // Continuation-short gate: shorts are FADE-ONLY. Measured on 14d of the
        // live book (227 closed shorts): shorting a symbol already in a bearish
        // 24h regime won 34.1% (−$72) and shorting RSI<40 (already dumped) won
        // 31.8% — chased weakness gets squeezed. Shorts against a bullish or
        // sideways 24h symbol with RSI≥40 (the fade shape) won 45.6% (+$18).
        // The global-regime floor below is reconciled with this gate: bearish
        // regimes hold surviving fade shorts to the counter-trend floor (the old
        // with-trend discount was removed — it was calibrated for shorting
        // falling symbols, which the gainers-only universe no longer contains).
        a.side_bias === "short" &&
        (a.market_regime === REGIME_BEARISH_24H || (a.rsi != null && a.rsi < 40))
      ) {
        rejection = "Continuation-short gate (fade-only shorts)";
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "continuation_short_gate",
            symbol: a.symbol,
            market_regime: a.market_regime,
            rsi: a.rsi,
          },
        ).catch(() => {});
      } else if (a.side_bias === "long" && cfg.allow_long === false) {
        rejection = "Longs disabled in config";
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "longs_disabled_skip",
            symbol: a.symbol,
          },
        ).catch(() => {});
        // Loss-based symbol blacklist removed — only delisted symbols (filtered
        // upstream by the market list) remain excluded.
      } else if (cooldownActive) {
        rejection = "Cooldown active";
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "cooldown_skip",
            symbol: a.symbol,
            cooldown_minutes: cfg.cooldown_minutes,
          },
        ).catch(() => {});
      } else if (
        // Rolling symbol cooldown driven by style preset.
        (() => {
          const losses = lossCountBySymbol.get(sym) ?? 0;
          const wins = winCountBySymbol.get(sym) ?? 0;
          const lastLossAt = lastLossAtBySymbol.get(sym) ?? 0;
          if (losses >= 4 && wins === 0) return true;
          if (losses >= preset.lossesBeforeSymbolCooldown && lastLossAt > 0) {
            return Date.now() - lastLossAt < preset.symbolCooldownHours * 3600_000;
          }
          return false;
        })()
      ) {
        rejection = `Rolling cooldown (${preset.lossesBeforeSymbolCooldown}+ losses in 24h, style=${preset.key})`;
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "rolling_cooldown_skip",
            symbol: a.symbol,
            losses: lossCountBySymbol.get(sym) ?? 0,
            wins: winCountBySymbol.get(sym) ?? 0,
            losses_before_cooldown: preset.lossesBeforeSymbolCooldown,
            style: preset.key,
          },
        ).catch(() => {});
        // (Regime-aware direction gate moved below as a standalone check.)
      } else if (a.spread_pct != null && a.spread_pct > HARD_SPREAD_BLOCK_PCT) {
        rejection = `Spread too high (${a.spread_pct.toFixed(2)}%)`;
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "spread_skip",
            symbol: a.symbol,
            spread_pct: a.spread_pct,
            hard_spread_block_pct: HARD_SPREAD_BLOCK_PCT,
          },
        ).catch(() => {});
      } else if (plan.status !== "auto_eligible") {
        rejection = plan.reason ?? "Risk plan rejected";
        final = "skip";
        const gateKind =
          plan.reason === "Risk-reward weak"
            ? "rr_too_low"
            : plan.reason === "Volatility too high for auto-book"
              ? "sl_too_wide"
              : plan.reason === "No capital available"
                ? "no_capital"
                : "risk_plan_rejected";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: gateKind,
            symbol: a.symbol,
            rr: plan.rr,
            min_rr: preset.minRR,
            sl_pct: plan.slPct,
            min_sl_pct: preset.minSL,
            max_auto_sl_pct: preset.maxAutoSL,
            tp_pct: plan.tpPct,
            plan_status: plan.status,
            plan_reason: plan.reason,
          },
        ).catch(() => {});
      } else if (!dailyLossAvailable) {
        rejection = "Daily loss cap hit";
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "daily_loss_cap_skip",
            symbol: a.symbol,
            daily_loss_cap_pct: cfg.daily_loss_cap_pct,
          },
        ).catch(() => {});
      } else if (remainingToday - opened <= 0) {
        rejection = "Daily auto-book limit reached";
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "daily_limit_skip",
            symbol: a.symbol,
            max_trades_per_day: cfg.max_trades_per_day,
          },
        ).catch(() => {});
        // Style trades/day, same-direction, and per-symbol/day hardcaps removed for now.
      } else if (openSlot <= 0) {
        rejection = "Max open positions reached";
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "max_positions_skip",
            symbol: a.symbol,
            max_open_positions: cfg.max_open_positions,
          },
        ).catch(() => {});
      } else if (openSymbols.has(sym)) {
        rejection = "Position already open on symbol";
        final = "skip";
        void logEvent(
          supabase,
          cfg.user_id,
          "info",
          `Auto-book skipped ${a.symbol}: ${rejection}`,
          {
            kind: "open_position_skip",
            symbol: a.symbol,
          },
        ).catch(() => {});
      } else if (a.confidence_pct < autoConfThreshold) {
        rejection = `Below auto-book threshold (${a.confidence_pct} < ${autoConfThreshold})`;
        final = a.confidence_pct >= displayConfThreshold ? "display" : "skip";
        // Only surface display-worthy near-misses in the feed (a real directional
        // setup that just missed the book threshold). Sub-display-confidence
        // signals are the same idle noise as "avoid" — skipped from the feed but
        // still recorded in bot_signals for analysis.
        if (final === "display") {
          void logEvent(
            supabase,
            cfg.user_id,
            "info",
            `Auto-book skipped ${a.symbol}: ${rejection}`,
            {
              kind: "confidence_below_threshold",
              symbol: a.symbol,
              confidence_pct: a.confidence_pct,
              auto_book_confidence_threshold: autoConfThreshold,
              display_conf_threshold: displayConfThreshold,
            },
          ).catch(() => {});
        }
      }

      // Regime-aware direction gate — style-aware thresholds
      // Aggressive: willing to trade on weaker signals (lower floor)
      // Conservative: only trades on strongest signals (higher floor)
      // With-trend trades get lower floors, counter-trend get much higher floors
      if (rejection == null) {
        const isShort = a.side_bias === "short";
        const isLong = a.side_bias === "long";
        const conf = a.confidence_pct;
        const style = (cfg.trading_style ?? "balanced").toLowerCase();

        // DB-backed floors per style (with-trend, counter-trend, neutral offset)
        const floors = regimeFloorsByStyle.get(style) ?? DEFAULT_REGIME_FLOORS;
        const withTrendFloor = floors.with_trend_floor;
        const counterTrendFloor = floors.counter_trend_floor;
        const neutralFloor = autoConfThreshold + floors.neutral_floor_offset;

        let regimeFloor: number | null = null;
        let regimeReason: string | null = null;

        if (marketRegime === "strong_bullish") {
          if (isShort) {
            regimeFloor = counterTrendFloor + 3; // hardest counter-trend
            regimeReason = `Regime: strong_bullish — ${style} shorts need ${regimeFloor}+`;
          } else if (isLong && conf < withTrendFloor) {
            regimeFloor = withTrendFloor;
            regimeReason = `Regime: strong_bullish — ${style} longs need ${withTrendFloor}+`;
          }
        } else if (marketRegime === "bullish") {
          if (isShort && conf < counterTrendFloor) {
            regimeFloor = counterTrendFloor;
            regimeReason = `Regime: bullish — ${style} counter-trend shorts need ${counterTrendFloor}+`;
          } else if (isLong && conf < withTrendFloor) {
            regimeFloor = withTrendFloor;
            regimeReason = `Regime: bullish — ${style} longs need ${withTrendFloor}+`;
          }
        } else if (marketRegime === "neutral" || marketRegime == null) {
          const neutralGate = neutralFloor + 3;
          if (isShort && conf < neutralGate) {
            regimeFloor = neutralGate;
            regimeReason = `Regime: neutral — ${style} shorts need ${neutralGate}+`;
          } else if (isLong && conf < neutralGate) {
            regimeFloor = neutralGate;
            regimeReason = `Regime: neutral — ${style} longs need ${neutralGate}+`;
          }
        } else if (marketRegime === "bearish") {
          if (isLong && conf < counterTrendFloor) {
            regimeFloor = counterTrendFloor;
            regimeReason = `Regime: bearish — ${style} counter-trend longs need ${counterTrendFloor}+`;
          } else if (isShort && conf < counterTrendFloor) {
            // No with-trend discount for shorts anymore: the continuation-short
            // gate means every surviving short is a FADE of a per-symbol gainer,
            // i.e. counter-trend to that symbol — and squeezes on relative-
            // strength names are most violent in a bearish tape. The old
            // withTrendFloor discount was calibrated for shorting falling
            // symbols, which the gainers-only universe no longer contains.
            regimeFloor = counterTrendFloor;
            regimeReason = `Regime: bearish — ${style} fade shorts need ${counterTrendFloor}+`;
          }
        } else if (marketRegime === "strong_bearish") {
          if (isLong) {
            regimeFloor = counterTrendFloor + 3;
            regimeReason = `Regime: strong_bearish — ${style} longs need ${regimeFloor}+`;
          } else if (isShort) {
            regimeFloor = counterTrendFloor + 3;
            regimeReason = `Regime: strong_bearish — ${style} fade shorts need ${regimeFloor}+`;
          }
        }

        if (regimeFloor !== null && conf < regimeFloor && regimeReason !== null) {
          rejection = regimeReason;
          final = conf >= displayConfThreshold ? "display" : "skip";
          void logEvent(
            supabase,
            cfg.user_id,
            "info",
            `Auto-book skipped ${a.symbol}: ${rejection}`,
            {
              kind: "regime_gate_skip",
              symbol: a.symbol,
              market_regime: marketRegime,
              side: a.side_bias,
              confidence_pct: conf,
              regime_floor: regimeFloor,
              trading_style: style,
            },
          ).catch(() => {});
        }
      }

      // Major-coin confidence floor: require higher confidence on liquid coins
      // where institutional flow overwhelms momentum signals below ~90%.
      // Data-derived: majors at conf<90 have PF 0.14-0.24; at conf≥90 PF=1.04.
      if (rejection == null) {
        const majorFloor = Number(cfg.major_coin_confidence_floor ?? 90);
        if (MAJOR_COINS.has(sym) && a.confidence_pct < majorFloor) {
          rejection = `Major coin confidence floor: ${a.confidence_pct} < ${majorFloor} required for ${sym}`;
          final = a.confidence_pct >= displayConfThreshold ? "display" : "skip";
          void logEvent(
            supabase,
            cfg.user_id,
            "info",
            `Auto-book skipped ${a.symbol}: ${rejection}`,
            {
              kind: "major_coin_floor_skip",
              symbol: a.symbol,
              confidence_pct: a.confidence_pct,
              major_coin_confidence_floor: majorFloor,
            },
          ).catch(() => {});
        }
      }

      // Phase 3: Momentum confirmation — require the signal's own momentum indicators
      // to be aligned before booking. Prevents entries at exhaustion.
      if (rejection == null) {
        const rsi = a.rsi ?? 50;
        const volSpike = a.volume_spike_ratio ?? 1.0;
        const isShort = a.side_bias === "short";
        const isLong = a.side_bias === "long";

        const momentumExhausted =
          (isLong && rsi > 72 && volSpike < 1.2) || (isShort && rsi < 28 && volSpike < 1.2);

        if (momentumExhausted) {
          rejection = `Momentum exhaustion: RSI ${rsi.toFixed(1)} extended for ${a.side_bias} with weak volume (${volSpike.toFixed(2)}x)`;
          final = "skip";
          void logEvent(
            supabase,
            cfg.user_id,
            "info",
            `Auto-book skipped ${a.symbol}: ${rejection}`,
            {
              kind: "momentum_exhaustion_skip",
              symbol: a.symbol,
              side: a.side_bias,
              rsi: a.rsi,
              volume_spike_ratio: a.volume_spike_ratio,
            },
          ).catch(() => {});
        }
      }

      // Backend setup classification + policy gate (Futures-only, beginner-invisible).
      const setup = classifySetup(a);
      if (rejection == null) {
        const eligibility = evaluateTradeEligibility(a, setup, backendPolicy);
        if (!eligibility.allowed) {
          rejection = eligibility.reason ?? "Backend policy rejected";
          final = "skip";
          void logEvent(
            supabase,
            cfg.user_id,
            "info",
            `Auto-book skipped ${a.symbol}: ${rejection}`,
            {
              kind: "eligibility_skip",
              symbol: a.symbol,
              ...(eligibility.metadata ?? {}),
            },
          ).catch(() => {});
        }
      }

      // Entry-quality gates (config-driven, all skip-only, none touch exit/sizing).
      // Order: cheapest first so we short-circuit before EV math.
      if (rejection == null) {
        const blockedHours = (cfg.blocked_session_hours_ist ?? []) as number[];
        if (blockedHours.length > 0) {
          const istHourStr = new Date().toLocaleString("en-GB", {
            hour: "2-digit",
            hour12: false,
            timeZone: "Asia/Kolkata",
          });
          const istHour = parseInt(istHourStr, 10);
          if (Number.isFinite(istHour) && blockedHours.includes(istHour)) {
            rejection = `Auto-book blocked: session hour ${istHour} IST in blocked_session_hours_ist`;
            final = "skip";
            void logEvent(
              supabase,
              cfg.user_id,
              "info",
              `Auto-book skipped ${a.symbol}: ${rejection}`,
              {
                kind: "session_hour_skip",
                symbol: a.symbol,
                ist_hour: istHour,
                blocked_hours: blockedHours,
              },
            ).catch(() => {});
          }
        }
      }

      if (rejection == null) {
        const maxSlAtr = Number(cfg.max_sl_atr_pct ?? 0);
        if (maxSlAtr > 0 && plan.slPct > maxSlAtr) {
          rejection = `SL width ${plan.slPct.toFixed(2)}% exceeds max_sl_atr_pct ${maxSlAtr}%`;
          final = "skip";
          void logEvent(
            supabase,
            cfg.user_id,
            "info",
            `Auto-book skipped ${a.symbol}: ${rejection}`,
            {
              kind: "sl_width_skip",
              symbol: a.symbol,
              sl_pct: plan.slPct,
              max_sl_atr_pct: maxSlAtr,
            },
          ).catch(() => {});
        }
      }

      if (rejection == null) {
        const minEv = Number(cfg.min_ev_ratio ?? 0);
        if (minEv > 0 && plan.slPct > 0) {
          const p = a.confidence_pct / 100;
          if (p > 0 && p < 1) {
            const evRatio = (p * plan.tpPct) / ((1 - p) * plan.slPct);
            if (evRatio < minEv) {
              rejection = `EV ratio ${evRatio.toFixed(3)} below min_ev_ratio ${minEv} (conf=${a.confidence_pct}%, tp=${plan.tpPct}%, sl=${plan.slPct}%)`;
              final = "skip";
              void logEvent(
                supabase,
                cfg.user_id,
                "info",
                `Auto-book skipped ${a.symbol}: ${rejection}`,
                {
                  kind: "ev_ratio_skip",
                  symbol: a.symbol,
                  ev_ratio: Number(evRatio.toFixed(4)),
                  min_ev_ratio: minEv,
                  confidence_pct: a.confidence_pct,
                  tp_pct: plan.tpPct,
                  sl_pct: plan.slPct,
                },
              ).catch(() => {});
            }
          }
        }
      }

      if (rejection == null) {
        // Minimum expected-edge gate (fee-aware; perps). The gross target must
        // clear the instrument's minimum viable edge or fees mechanically eat
        // the trade — the classic "0.2% target vs 0.1%/side fees consumes the
        // whole profit" failure. Field guidance: perps ~0.6%, spot ~0.35% (spot
        // lives on the coin-bot path). Unlike a max-trades throttle (which only
        // scales volume), this removes the tiny-target, net-negative subset — it
        // changes the SIGN of expectancy on what remains. plan.tpPct is the
        // gross target move %, the exact quantity the rule speaks in. Active
        // only when configured (> 0); default off until validated on history via
        // the backtest harness.
        const minEdgePct = Number(cfg.minimum_expected_edge_pct ?? 0);
        if (minEdgePct > 0 && plan.tpPct > 0 && plan.tpPct < minEdgePct) {
          rejection = `Expected edge (target ${plan.tpPct}%) below minimum ${minEdgePct}% — fees would dominate`;
          final = "skip";
          void logEvent(
            supabase,
            cfg.user_id,
            "info",
            `Auto-book skipped ${a.symbol}: ${rejection}`,
            {
              kind: "expected_edge_below_min_skip",
              symbol: a.symbol,
              tp_pct: plan.tpPct,
              sl_pct: plan.slPct,
              min_expected_edge_pct: minEdgePct,
            },
          ).catch(() => {});
        }
      }

      let bookedTradeId: string | null = null;

      if (rejection == null) {
        // Book.
        const side = a.side_bias as "long" | "short";
        const { tpPct, slPct } = plan;
        const lev = preset.leverage; // mode-driven (admin column overrides via preset)
        const notional = plan.positionSize;
        if (notional <= 0 || a.price <= 0) {
          rejection = "Position sizing failed";
          final = "skip";
          void logEvent(
            supabase,
            cfg.user_id,
            "info",
            `Auto-book skipped ${a.symbol}: ${rejection}`,
            {
              kind: "sizing_failed_skip",
              symbol: a.symbol,
              notional,
              price: a.price,
            },
          ).catch(() => {});
        } else {
          const qty = notional / a.price;
          const stop_loss =
            side === "long" ? a.price * (1 - slPct / 100) : a.price * (1 + slPct / 100);
          const take_profit =
            side === "long" ? a.price * (1 + tpPct / 100) : a.price * (1 - tpPct / 100);
          // TP1 (partial-profit) from preset; clamp to final TP - never exceed it.
          const tp1PctRaw = Math.min(preset.tp1Pct, Math.max(0.1, tpPct * 0.6));
          const tp1_price = tp1PriceFor(a.price, tp1PctRaw, side);

          // Pre-entry net-profit floor (config-driven, generic across styles).
          // Projects gross PnL at the planned TP, subtracts entry+exit fees + GST
          // using the same fee model as the exit-side check, and skips the trade
          // if the projected net% (on entry notional) is below the configured floor.
          const minNetEnterPct = Number(cfg.minimum_net_profit_to_enter_pct ?? 0);
          if (minNetEnterPct > 0) {
            // Projected net% at TP using the SAME cost model as the exit path
            // (fees + GST + slippage), so the gate isn't optimistic by the
            // slippage the exit later subtracts.
            const slippageBufferPct = Number(cfg.slippage_buffer_pct ?? 0.05);
            const netPctAtTp = projectedNetPctAtTp({
              entryPrice: a.price,
              takeProfit: take_profit,
              qty,
              slippageBufferPct,
            });
            if (netPctAtTp < minNetEnterPct) {
              rejection = `Projected net profit at TP ${netPctAtTp.toFixed(3)}% < min ${minNetEnterPct}%`;
              final = "skip";
              void logEvent(
                supabase,
                cfg.user_id,
                "info",
                `Auto-book skipped ${a.symbol}: ${rejection}`,
                {
                  kind: "pre_entry_net_profit_skip",
                  symbol: a.symbol,
                  tp_pct: tpPct,
                  projected_net_pct: Number(netPctAtTp.toFixed(4)),
                  min_net_profit_to_enter_pct: minNetEnterPct,
                  slippage_buffer_pct: slippageBufferPct,
                },
              ).catch(() => {});
            }
          }

          // Structure entry filter (shadow A/B). When the cohort has the flag
          // on, gate LONG entries on the manual structural rule (30m higher-highs
          // · 1m not overbought · 1m rising · Supertrend bullish). Shorts and
          // flag-off cohorts are unaffected. Backtested PF ~3 as a long filter.
          let structureFilterApplied = false;
          if (!rejection && side === "long" && cfg.structure_entry_filter_enabled === true) {
            const sc = await fetchStructureCandles(a.symbol);
            if (!sc) {
              rejection = "Structure filter: candle data unavailable";
              final = "skip";
              void logEvent(
                supabase,
                cfg.user_id,
                "info",
                `Auto-book skipped ${a.symbol}: ${rejection}`,
                { kind: "structure_filter_no_data", symbol: a.symbol },
              ).catch(() => {});
            } else {
              const me = evaluateManualEntry(sc.c30, sc.c1);
              structureFilterApplied = true;
              if (!me.enterLong) {
                rejection = `Structure filter blocked long: ${me.reasons.join("; ")}`;
                final = "skip";
                void logEvent(
                  supabase,
                  cfg.user_id,
                  "info",
                  `Auto-book skipped ${a.symbol}: ${rejection}`,
                  {
                    kind: "structure_filter_blocked",
                    symbol: a.symbol,
                    trend30_up: me.detail.trend30Up,
                    trend1_up: me.detail.trend1Up,
                    rsi_ok: me.detail.rsiOk,
                    supertrend_up: me.detail.supertrendUp,
                  },
                ).catch(() => {});
              }
            }
          }

          // Intraday market-pause: no NEW longs while the universe is broadly
          // rolling over intraday (see computation above the user loop).
          if (!rejection && side === "long" && longsPaused) {
            rejection = `Market pause: ${Math.round(downShare * 100)}% of universe in intraday downtrend`;
            final = "skip";
            if (!longPauseLogged) {
              longPauseLogged = true;
              void logEvent(
                supabase,
                cfg.user_id,
                "info",
                `Longs paused this scan: ${Math.round(downShare * 100)}% of universe in intraday downtrend (>= ${LONG_PAUSE_DOWN_SHARE * 100}%)`,
                { kind: "long_market_pause", down_share: Number(downShare.toFixed(3)), timeframe: cfgTimeframe },
              ).catch(() => {});
            }
          }

          // Long vetoes (flagged live-arm test; v2's successor). The v2 score
          // died at its out-of-sample bar (selected −$15.57 vs rejected +$64.59
          // at n=32), but its AUTOPSY found exactly two components that
          // replicated across two OPPOSITE regimes: (a) don't chase symbols
          // already labeled Bullish-24h, (b) don't buy RSI>65. Longs surviving
          // both vetoes ran 70.8% win +$70.41 (Jul 10-15) while every vetoed
          // bucket was negative. Pre-registered bar: at n>=30 vetoed-long
          // closures in the passive tally, kept must beat vetoed or this flag
          // dies v2-style. NOT a crash-day defense (nothing symbol-local is) —
          // that's the market-pause gate below.
          if (!rejection && side === "long" && cfg.long_vetoes_enabled === true) {
            const chasing = a.market_regime === REGIME_BULLISH_24H;
            const overheated = a.rsi != null && a.rsi > 65;
            if (chasing || overheated) {
              rejection = chasing
                ? `Long veto: already Bullish-24h (no chasing)`
                : `Long veto: RSI ${Math.round(a.rsi as number)} > 65`;
              final = "skip";
              void logEvent(
                supabase,
                cfg.user_id,
                "info",
                `Auto-book skipped ${a.symbol}: ${rejection}`,
                {
                  kind: "long_veto_blocked",
                  symbol: a.symbol,
                  chasing,
                  overheated,
                  rsi: a.rsi,
                  market_regime: a.market_regime,
                },
              ).catch(() => {});
            }
          }

          // Freshness arm (shadow): arm cohorts take LONGS only from the
          // top-decile 4h movers not yet labeled Bullish-24h (see the fresh-set
          // computation above the user loop; empty set on cold start = arm
          // books no longs). Shorts and exits are untouched. No per-symbol
          // event — the rejection lands on the signal row; bookings are the
          // measured quantity.
          if (!rejection && side === "long" && cfg.freshness_arm_enabled === true) {
            if (!fresh4hSet.has(sym)) {
              rejection = "Freshness arm: not a fresh 4h mover";
              final = "skip";
            }
          }

          // V2 confluence gate (KILLED at its pre-registered bar 2026-07-15;
          // flag off everywhere — code kept for the record/re-test). Books a
          // LONG only when the measured-component score clears the bar.
          if (!rejection && side === "long" && cfg.v2_long_gate_enabled === true) {
            const score = v2LongScore(a);
            if (score < 2) {
              rejection = `V2 confluence gate: score ${score} < 2`;
              final = "skip";
              void logEvent(
                supabase,
                cfg.user_id,
                "info",
                `Auto-book skipped ${a.symbol}: ${rejection}`,
                {
                  kind: "v2_long_gate_blocked",
                  symbol: a.symbol,
                  v2_score: score,
                  trend_status: a.trend_status,
                  volume_spike_ratio: a.volume_spike_ratio,
                  rsi: a.rsi,
                  market_regime: a.market_regime,
                },
              ).catch(() => {});
            }
          }

          // Mean-reversion SHORT filter (shadow A/B). When the cohort has the
          // flag on, gate SHORT entries on a fade of an overextended, overbought,
          // volume-spiking 15m move that has rolled over. Longs and flag-off
          // cohorts are unaffected. Backtest: 56% win / PF 1.52 on liquid coins.
          let structureShortFilterApplied = false;
          if (!rejection && side === "short" && cfg.structure_short_filter_enabled === true) {
            const c15 = await fetchMeanRevCandles(a.symbol);
            if (!c15) {
              rejection = "Mean-rev short filter: candle data unavailable";
              final = "skip";
              void logEvent(
                supabase,
                cfg.user_id,
                "info",
                `Auto-book skipped ${a.symbol}: ${rejection}`,
                { kind: "short_filter_no_data", symbol: a.symbol },
              ).catch(() => {});
            } else {
              const mr = evaluateMeanReversionShort(c15);
              structureShortFilterApplied = true;
              if (!mr.enterShort) {
                rejection = `Mean-rev short filter blocked: ${mr.reasons.join("; ")}`;
                final = "skip";
                void logEvent(
                  supabase,
                  cfg.user_id,
                  "info",
                  `Auto-book skipped ${a.symbol}: ${rejection}`,
                  {
                    kind: "short_filter_blocked",
                    symbol: a.symbol,
                    ext_above_pct: mr.detail.extAbovePct,
                    rsi: mr.detail.rsi,
                    vol_spike: mr.detail.volSpike,
                    stretched: mr.detail.stretched,
                    bear_trigger: mr.detail.bearTrigger,
                  },
                ).catch(() => {});
              }
            }
          }

          // 2-scan entry confirmation — ALL cohorts, BOTH sides, LAST entry gate.
          // An entry must survive every gate above (threshold, regime, spread,
          // structure/v2/mean-rev filters where enabled) on two consecutive scans
          // before it books, so a coin can't slip in on a single lucky 1m tick
          // and whip to the full stop (the HMSTR/VELVET failure mode). Running
          // last means the streak only accrues for fully-approved candidates —
          // a filter or v2 flip can never book on its first passing scan. The
          // RPC enforces a min-gap so overlapping passes can't double-count.
          if (!rejection) {
            const confirms = await confirmEntry(supabase, cfg.user_id, a.symbol, side);
            if (confirms < ENTRY_CONFIRM_REQUIRED) {
              rejection = `Awaiting entry confirmation (${confirms}/${ENTRY_CONFIRM_REQUIRED})`;
              final = "skip";
              void logEvent(
                supabase,
                cfg.user_id,
                "info",
                `Auto-book skipped ${a.symbol}: ${rejection}`,
                {
                  kind: "entry_awaiting_confirmation",
                  symbol: a.symbol,
                  side,
                  confirms,
                  required: ENTRY_CONFIRM_REQUIRED,
                },
              ).catch(() => {});
            }
          }

          // FK requires the signal row to exist first.
          const { error: sigErr } = await supabase.from("bot_signals").insert({
            id: signalId,
            scan_id: scanId,
            user_id: cfg.user_id,
            user_name: userName,
            symbol: a.symbol,
            price: a.price,
            action: side === "long" ? "LONG" : "SHORT",
            side_bias: a.side_bias,
            confidence_pct: a.confidence_pct,
            confidence_band: a.confidence_band,
            reason: a.reason,
            final_decision: "pending",
            booked: false,
            strategy: cfg.strategy ?? "default",
            timeframe: cfgTimeframe,
            config_id: cfg.user_id,
            trend_status: a.trend_status,
            vwap_status: a.vwap_status,
            ema_alignment: a.ema_alignment,
            rsi: a.rsi,
            volume_spike_ratio: a.volume_spike_ratio,
            spread_pct: a.spread_pct,
            atr_pct: a.atr_pct,
            distance_from_vwap_pct: a.distance_from_vwap_pct,
            distance_from_ema21_pct: a.distance_from_ema21_pct,
            impulse_candle_pct: a.impulse_candle_pct,
            risk_reward: plan.rr || null,
            market_regime: a.market_regime,
            cooldown_active: cooldownActive,
            daily_loss_available: dailyLossAvailable,
            max_position_available: maxPositionAvailable,
          });
          if (sigErr) {
            rejection = `Signal pre-insert failed: ${sigErr.message}`;
            final = "skip";
            await logEvent(
              supabase,
              cfg.user_id,
              "error",
              `Auto-book ${a.symbol} failed: ${rejection}`,
            );
          } else {
            // LIVE (wallet) execution: place a real market order before recording
            // the position. On failure we skip the booking so the local DB and
            // the exchange never disagree. Paper mode is unchanged.
            let liveOrderId: string | null = null;
            // Records how the entry filled so exit fee accounting can pick the
            // right model. Live sets this from the actual fill below. Paper models
            // maker-first entry (post-only limit) when maker_entry_enabled.
            // NOTE: CoinDCX charges maker == taker on futures (validated against
            // the user's fee schedule + real trades — see fees.ts header), so a
            // post-only entry saves NO fees here; its only value is execution
            // quality (not crossing the spread). Do not build fee logic on a
            // maker discount.
            let entryFillType: "maker" | "taker" =
              cfg.mode !== "live" && cfg.maker_entry_enabled === true ? "maker" : "taker";
            if (cfg.mode === "live") {
              const creds = await loadLiveCreds(supabase, cfg.user_id);
              if (!creds) {
                rejection = "Live mode: no CoinDCX API credentials configured";
                final = "skip";
                await logEvent(
                  supabase,
                  cfg.user_id,
                  "warn",
                  `Auto-book ${a.symbol} skipped: ${rejection}`,
                );
                await supabase
                  .from("bot_signals")
                  .update({ final_decision: "skip", rejection_reason: rejection })
                  .eq("id", signalId);
              } else {
                // Maker-first (dormant unless maker_entry_enabled): post a passive
                // limit at the signal price, wait ~5s for a maker fill, else cancel
                // and flip to a market (taker) order so the entry still happens.
                const exec =
                  cfg.maker_entry_enabled === true
                    ? await placeLiveEntryMakerFirst({
                        creds,
                        symbol: a.symbol,
                        side,
                        qty,
                        leverage: lev,
                        limitPrice: a.price,
                        makerWaitMs: Number(cfg.maker_entry_wait_ms ?? 5000),
                      })
                    : {
                        ...(await placeLiveEntry({
                          creds,
                          symbol: a.symbol,
                          side,
                          qty,
                          leverage: lev,
                        })),
                        fill: "taker" as const,
                      };
                if (!exec.ok) {
                  rejection = `Live order rejected: ${exec.error}`;
                  final = "skip";
                  await logEvent(
                    supabase,
                    cfg.user_id,
                    "error",
                    `Auto-book ${a.symbol} live order failed: ${exec.error}`,
                    {
                      kind: "live_entry_failed",
                      symbol: a.symbol,
                      side,
                    },
                  );
                  await supabase
                    .from("bot_signals")
                    .update({ final_decision: "skip", rejection_reason: rejection })
                    .eq("id", signalId);
                } else {
                  liveOrderId = exec.orderId;
                  entryFillType = exec.fill;
                }
              }
            }

            if (rejection != null) {
              // live execution or pre-entry gate failed — record skip on the
              // signal row and fall through past the position insert.
              await supabase
                .from("bot_signals")
                .update({ final_decision: "skip", rejection_reason: rejection })
                .eq("id", signalId);
            } else {
              // Log-only entry snapshot: current 1m candle direction + symbol's own 1h trend.
              let entryCandlePct: number | null = null;
              let entryCandleAligned: boolean | null = null;
              let symbol1hTrend: string | null = null;
              try {
                const [c1Res, c1hRes] = await Promise.all([
                  fetch(CANDLES(a.symbol, "1m", 2), {
                    headers: PUB_HEADERS,
                    signal: AbortSignal.timeout(2500),
                  }),
                  fetch(CANDLES(a.symbol, "1h", 30), {
                    headers: PUB_HEADERS,
                    signal: AbortSignal.timeout(2500),
                  }),
                ]);
                if (c1Res.ok) {
                  const c1 = (await c1Res.json()) as Array<{
                    open: number | string;
                    close: number | string;
                  }>;
                  const last = Array.isArray(c1) && c1.length ? c1[c1.length - 1] : null;
                  if (last) {
                    const o = num(last.open);
                    const c = num(last.close);
                    if (o > 0) {
                      entryCandlePct = ((c - o) / o) * 100;
                      entryCandleAligned =
                        side === "long" ? entryCandlePct > 0 : entryCandlePct < 0;
                    }
                  }
                }
                if (c1hRes.ok) {
                  const c1h = (await c1hRes.json()) as Array<{ close: number | string }>;
                  if (Array.isArray(c1h) && c1h.length >= 22) {
                    const closes = c1h.map((k) => num(k.close));
                    const e9 = ema(closes, 9);
                    const e21 = ema(closes, 21);
                    if (e9 != null && e21 != null && e21 > 0) {
                      const d = ((e9 - e21) / e21) * 100;
                      symbol1hTrend = d > 0.15 ? "up" : d < -0.15 ? "down" : "flat";
                    }
                  }
                }
              } catch {
                /* log-only — never block booking */
              }

              const sigKey = `${a.symbol}|${a.side_bias}`;
              const earliestAt = earliestSignalAt.get(sigKey);
              const signalAgeSeconds =
                earliestAt != null ? Math.max(0, Math.round((Date.now() - earliestAt) / 1000)) : 0;

              // Booking-time funding proxy (CoinDCX-native). CoinDCX doesn't publish
              // a funding-rate value, so we reconstruct the funding DIRECTION as the
              // perp-vs-spot premium: (perp - spot)/spot. Uses one bulk, 30s-cached
              // CoinDCX spot fetch shared across the pass — no per-symbol calls, no
              // external exchange, 100% coverage where a spot pair exists.
              // Analytics-only; null on miss; never blocks booking.
              // (open_interest is left null — CoinDCX does not expose it publicly.)
              let fundingRateAtEntry: number | null = null;
              {
                const spotMarket = perpToSpotMarket(a.symbol);
                if (spotMarket) {
                  try {
                    const spot = (await fetchSpotPrices()).get(spotMarket);
                    if (spot != null) fundingRateAtEntry = premiumPct(a.price, spot);
                  } catch {
                    // analytics-only — never block booking
                  }
                }
              }

              const { data: inserted, error } = await supabase

                .from("positions")
                .insert({
                  user_id: cfg.user_id,
                  mode: cfg.mode,
                  symbol: a.symbol,
                  side,
                  leverage: lev,
                  qty,
                  entry_price: a.price,
                  mark_price: a.price,
                  stop_loss,
                  take_profit,
                  pnl: 0,
                  pnl_pct: 0,
                  status: "open",
                  instrument: "futures",
                  exchange_order_id:
                    cfg.mode === "paper" ? `paper-auto-${Date.now()}` : liveOrderId,
                  signal_id: signalId,
                  source: "auto",
                  algo_id: ALGO_ID,
                  algo_name: ALGO_NAME,
                  algo_version: ALGO_VERSION,
                  confidence_at_entry: a.confidence_pct,
                  confidence_band_at_entry: a.confidence_band,
                  entry_reason: a.reason,
                  market_regime: marketRegime ?? a.market_regime,
                  rsi_at_entry: a.rsi,
                  volume_spike_ratio_at_entry: a.volume_spike_ratio,
                  spread_pct_at_entry: a.spread_pct,
                  distance_from_vwap_pct_at_entry: a.distance_from_vwap_pct,
                  distance_from_ema21_pct_at_entry: a.distance_from_ema21_pct,
                  adx_at_entry: a.adx,
                  rvol_at_entry: a.rvol,
                  funding_rate_at_entry: fundingRateAtEntry,
                  open_interest_at_entry: null,
                  entry_candle_pct: entryCandlePct,
                  entry_candle_aligned: entryCandleAligned,
                  symbol_1h_trend: symbol1hTrend,
                  signal_age_seconds: signalAgeSeconds,
                  entry_fill_type: entryFillType,
                  structure_filter_applied: structureFilterApplied,
                  structure_short_filter_applied: structureShortFilterApplied,

                  // New exit-management fields:
                  tp1_price,
                  tp1_pct: tp1PctRaw,
                  tp1_hit: false,
                  remaining_qty: qty,
                  tp1_qty_closed: 0,
                  trail_pct: preset.trailPct,
                  breakeven_moved: false,
                  final_tp_hit: false,
                  peak_unrealized_pnl_pct: 0,
                  max_favourable_excursion_pct: 0,
                  max_adverse_excursion_pct: 0,
                  highest_unrealized_pnl: 0,
                  lowest_unrealized_pnl: 0,
                } as never)
                .select("id")
                .single();

              if (error || !inserted) {
                rejection = error?.message ?? "Insert failed";
                final = "skip";
                await logEvent(
                  supabase,
                  cfg.user_id,
                  "error",
                  `Auto-book ${a.symbol} failed: ${rejection}`,
                );
                // LIVE orphan reconciliation: a real order already filled but
                // the local row failed to write — the exchange holds a position
                // the book doesn't know about. Flatten it immediately
                // (reduce-only market) instead of leaving it to a human.
                if (cfg.mode === "live" && liveOrderId) {
                  const creds = await loadLiveCreds(supabase, cfg.user_id);
                  const undo = creds
                    ? await placeLiveExit({ creds, symbol: a.symbol, side, qty })
                    : ({ ok: false as const, error: "no API credentials" });
                  await logEvent(
                    supabase,
                    cfg.user_id,
                    "error",
                    `Live entry ${liveOrderId} for ${a.symbol} had no local row — compensating flatten ${undo.ok ? `placed (#${undo.orderId})` : `FAILED: ${undo.error} — MANUAL RECONCILE REQUIRED`}`,
                    {
                      kind: undo.ok ? "live_orphan_flattened" : "live_orphan_flatten_failed",
                      symbol: a.symbol,
                      side,
                      order_id: liveOrderId,
                      qty,
                    },
                  );
                }
                // Mark the pre-inserted signal as rejected.
                await supabase
                  .from("bot_signals")
                  .update({ final_decision: "skip", rejection_reason: rejection })
                  .eq("id", signalId);
              } else {
                bookedTradeId = inserted.id as string;
                final = "booked";
                opened++;
                openSlot--;
                openSymbols.add(sym);
                lastOpen.set(sym, Date.now());
                sameDirOpenedThisPass[side]++;
                symbolOpenedThisPass.set(sym, (symbolOpenedThisPass.get(sym) ?? 0) + 1);
                // Write the booking linkage back onto the signal row.
                await supabase
                  .from("bot_signals")
                  .update({
                    booked: true,
                    booked_trade_id: bookedTradeId,
                    final_decision: "booked",
                    action: side === "long" ? "LONG" : "SHORT",
                    confidence_pct: a.confidence_pct,
                    confidence_band: a.confidence_band,
                  })
                  .eq("id", signalId);
                await logEvent(
                  supabase,
                  cfg.user_id,
                  "info",
                  `Auto-booked ${side.toUpperCase()} ${a.symbol} · Confidence ${a.confidence_pct.toFixed(0)}% · Target +${tpPct.toFixed(2)}% · Stop −${slPct.toFixed(2)}% · Stop Type Volatility-based · R:R ${plan.rr.toFixed(2)}:1`,
                  {
                    kind: "auto_book",
                    symbol: a.symbol,
                    side,
                    confidence: Math.round(a.confidence_pct),
                    tpPct,
                    slPct,
                    atrPct: plan.atrPct,
                    rr: plan.rr,
                    riskAmount: plan.riskAmount,
                    positionSize: plan.positionSize,
                    stopType: "Volatility-based",
                    detected_setup: setup.primarySetup,
                    setup_confidence: setup.setupConfidence,
                    momentum_score: setup.momentumScore,
                    pullback_score: setup.pullbackScore,
                    overlap_flags: setup.overlapFlags,
                    backend_risk_profile: backendPolicy.riskProfile,
                  },
                );
              }
            } // close: live-rejection else
          } // close: sigErr else
        }
      } else {
        // Display-quality but not booked: count as an opportunity-skip.
        skipped++;
      }

      // Only push non-booked signals into bulk insert (booked ones were
      // already inserted above so the position FK could resolve).
      if (bookedTradeId == null) {
        pushSignal(a, signalId, final, bookedTradeId, rejection, {
          cooldown_active: cooldownActive,
          daily_loss_available: dailyLossAvailable,
          max_position_available: maxPositionAvailable,
          risk_reward: plan.rr || null,
        });
      }
    }

    // Bulk insert signals for this user (chunked to stay under payload limits).
    if (signalRows.length) {
      const CHUNK = 200;
      for (let i = 0; i < signalRows.length; i += CHUNK) {
        await supabase.from("bot_signals").insert(signalRows.slice(i, i + CHUNK));
      }
    }

    result.opened += opened;
    result.skipped += skipped;
    result.details.push({
      user: cfg.user_id,
      opened,
      skipped,
      reason: userBlockReason ?? undefined,
    });
    await logScanEvent(
      supabase,
      cfg.user_id,
      scannedCount,
      analyses.filter((x) => x.action === "LONG" || x.action === "SHORT").length,
      opened,
      skipped,
      topConfidenceOverall,
    );
    // Distinguish "market red / API down" from "bot broken" in the feed.
    // logPauseEvent dedupes the same message within 30 min, so this doesn't
    // spam during a long red stretch or outage.
    if (universeEmptyReason) {
      await logPauseEvent(supabase, cfg.user_id, universeEmptyReason).catch(() => {});
    }
  }

  return result;
}

/** Update mark_price + pnl for open positions; auto-close TP/SL/trailing/profit-fade.
 *  Also runs shadow-tracking for manually-closed trades so the dashboard can
 *  attribute manual_saved_pnl / manual_missed_pnl. */
export async function runMarkPass(
  supabase: SupabaseClient,
  opts: { userId?: string } = {},
): Promise<{
  updated: number;
  closed: number;
}> {
  let q = supabase.from("positions").select("*").eq("status", "open");
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data: open } = await q;
  const positions = (open ?? []) as Array<Record<string, unknown>>;

  // Also pick manually-closed trades from the last 24h that have no shadow result yet.
  let shadowQ = supabase
    .from("positions")
    .select("*")
    .eq("exit_reason", "manual_limit")
    .is("shadow_exit_reason", null)
    .gte("closed_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  if (opts.userId) shadowQ = shadowQ.eq("user_id", opts.userId);
  const { data: shadowRowsRaw } = await shadowQ;
  const shadowRows = (shadowRowsRaw ?? []) as Array<Record<string, unknown>>;

  if (!positions.length && !(shadowRows ?? []).length) return { updated: 0, closed: 0 };

  const userIds = Array.from(
    new Set([
      ...positions.map((p) => p.user_id as string),
      ...(shadowRows ?? []).map((p) => p.user_id as string),
    ]),
  );
  const { data: cfgRows } = await supabase
    .from("bot_config")
    .select(
      "user_id,auto_close_minutes,trading_style,strategy,min_scalp_score,fee_aware_exits_enabled,minimum_net_profit_to_exit_pct,slippage_buffer_pct,minimum_gross_profit_before_profit_fade_exit_pct,minimum_gross_profit_before_weak_progress_exit_pct,breakeven_arm_roe_pct,mode,paper_equity,live_wallet_source,live_allocation_mode,live_allocation_amount,live_allocation_pct,equity_peak,equity_peak_date,halted_on,circuit_breaker_pct",
    )

    .in("user_id", userIds);
  const cfgByUser = new Map((cfgRows ?? []).map((c) => [c.user_id as string, c]));

  const allSymbols = Array.from(
    new Set([
      ...positions.map((p) => p.symbol as string),
      ...(shadowRows ?? []).map((p) => p.symbol as string),
    ]),
  );
  const marks = await fetchMarkPrices(allSymbols);

  // Warn on any still-open position we couldn't price from any source. Lets
  // us distinguish CoinDCX API flakiness/rate-limiting from a code bug when
  // stops start overshooting again.
  const unpriced = positions.filter((p) => !(marks[p.symbol as string] > 0));
  if (unpriced.length) {
    const seen = new Set<string>();
    await Promise.all(
      unpriced
        .filter((p) => {
          const key = `${p.user_id as string}:${p.symbol as string}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((p) =>
          logEvent(
            supabase,
            p.user_id as string,
            "warn",
            `mark_price_unavailable: ${p.symbol}`,
            { kind: "mark_price_unavailable", symbol: p.symbol, position_id: p.id },
          ).catch(() => undefined),
        ),
    );
  }

  let updated = 0;
  let closed = 0;

  for (const p of positions) {
    const mark = marks[p.symbol as string];
    if (!mark) continue;

    const entry = Number(p.entry_price);
    const qty = Number(p.qty);
    const lev = Number(p.leverage);
    const side = p.side as "long" | "short";
    const sideMul = side === "long" ? 1 : -1;
    const pnl = (mark - entry) * qty * sideMul;
    const pnlPct = entry > 0 ? ((mark - entry) / entry) * 100 * sideMul * lev : 0;
    const tp = p.take_profit != null ? Number(p.take_profit) : null;
    const sl = p.stop_loss != null ? Number(p.stop_loss) : null;
    const tp1 = p.tp1_price != null ? Number(p.tp1_price) : null;
    const tp1Hit = Boolean(p.tp1_hit);
    const tp1Pnl = Number(p.tp1_pnl ?? 0);
    const remainingQty = Number(p.remaining_qty ?? qty);
    const trailPct = p.trail_pct != null ? Number(p.trail_pct) : null;
    let trailAnchor = p.trail_anchor_price != null ? Number(p.trail_anchor_price) : null;
    const breakevenMoved = Boolean(p.breakeven_moved);

    const cfgRow = cfgByUser.get(p.user_id as string) as
      | {
          auto_close_minutes: number;
          trading_style?: string;
          strategy?: string | null;
          min_scalp_score?: number;
          fee_aware_exits_enabled?: boolean | null;
          minimum_net_profit_to_exit_pct?: number | null;
          slippage_buffer_pct?: number | null;
          minimum_gross_profit_before_profit_fade_exit_pct?: number | null;
          minimum_gross_profit_before_weak_progress_exit_pct?: number | null;
          breakeven_arm_roe_pct?: number | null;
        }
      | undefined;
    const autoCloseMinutes = Number(cfgRow?.auto_close_minutes ?? 120);
    const presetRaw = presetFromConfig({
      trading_style: cfgRow?.trading_style ?? "balanced",
      min_sl_pct: null,
      atr_multiplier: null,
      max_auto_sl_pct: null,
      target_multiplier: null,
      min_rr: null,
      risk_per_trade_pct: null,
    });
    const preset = applyStrictnessToPreset(
      presetRaw,
      strictnessFromMinScore(cfgRow?.min_scalp_score),
    );
    const openedAt = new Date(p.opened_at as string).getTime();
    const ageMin = (Date.now() - openedAt) / 60_000;

    // MFE / MAE on the open leg (uses live pnlPct).
    const prevPeak = Number(p.peak_unrealized_pnl_pct ?? 0);
    const peak = Math.max(prevPeak, pnlPct);
    const mfePct = Math.max(Number(p.max_favourable_excursion_pct ?? 0), pnlPct);
    const maePct = Math.min(Number(p.max_adverse_excursion_pct ?? 0), pnlPct);
    const highPnl = Math.max(Number(p.highest_unrealized_pnl ?? 0), pnl);
    const lowPnl = Math.min(Number(p.lowest_unrealized_pnl ?? 0), pnl);
    const giveback = peak >= preset.profitFadeMinPct ? Math.max(0, peak - pnlPct) : 0;

    // ----- ROE-based profit protection (style-aware) -----
    // pnlPct is already leverage-adjusted, so it IS ROE %.
    const styleKey = String(cfgRow?.trading_style ?? "balanced").toLowerCase();
    // Only "hard" threshold is used — for a last-resort unprotected-trade exit.
    const ROE_HARD: Record<string, number> = {
      conservative: 1.6,
      balanced: 1.8,
      aggressive: 2.0,
    };
    const roeHard = ROE_HARD[styleKey] ?? ROE_HARD.balanced;
    const currentRoe = pnlPct;
    const peakRoe = peak;
    const trailingEnabled = trailPct != null && trailPct > 0;

    // ----- Resolve exit decision (priority order) -----
    let finalExitReason: string | null = null;
    let exitProtectionReason: string | null = null;
    let tp1JustHit = false;
    let newBreakeven = breakevenMoved;

    // 1a) TP1 by price target only. No ROE-based TP1 trigger.
    if (!tp1Hit && tp1 != null) {
      const crossed = side === "long" ? mark >= tp1 : mark <= tp1;
      if (crossed) {
        tp1JustHit = true;
        newBreakeven = true;
        trailAnchor = mark;
      }
    }

    // 1b) Early breakeven (config-gated, OFF by default). Once a trade's
    // unrealized ROE reaches breakeven_arm_roe_pct, move the stop to entry so a
    // trade that went favorable can't round-trip into a loss — independent of
    // TP1. Only arms the existing breakeven mechanism earlier (no new exit
    // path); a later SL-at-entry hit is labeled breakeven_exit via the
    // `newBreakeven` check below. Persisted in the update block so it sticks
    // across mark passes. Used to A/B-test tighter gain-protection per cohort.
    const beArmRoe = Number(cfgRow?.breakeven_arm_roe_pct ?? 0);
    const armedEarlyBreakeven = beArmRoe > 0 && !newBreakeven && !tp1Hit && currentRoe >= beArmRoe;
    if (armedEarlyBreakeven) newBreakeven = true;

    // Breakeven only armed when TP1 fires (or by early-breakeven above).
    const profitProtected = newBreakeven || tp1Hit || tp1JustHit;

    // Fee constants (hoisted — also used by the fee-aware evaluation below).
    const exitFeeModel = DEFAULT_FEE_MODEL;
    const feeRates = feeModelRates(exitFeeModel);
    const roundTripFeePct =
      (feeRates.entry_fee_pct + feeRates.exit_fee_pct) * (1 + feeRates.gst_pct / 100);
    const slippageBufferPct = Number(cfgRow?.slippage_buffer_pct ?? 0.05);

    // 2) Final TP.
    const hitTp = tp != null && (side === "long" ? mark >= tp : mark <= tp);
    // 3) SL: before TP1 use original SL; after breakeven arms, the stop sits at
    // NET breakeven — entry shifted by round-trip fees + slippage in the trade's
    // favor — so a "Breakeven Protected" round-trip closes at net ≈ 0 instead of
    // gross 0 minus the full fee (measured: −₹96/trade on ₹81.7k notional, 29
    // such round-trips in the prior 7d).
    const feeFloorPct = roundTripFeePct + slippageBufferPct;
    const netBreakevenPrice =
      side === "long" ? entry * (1 + feeFloorPct / 100) : entry * (1 - feeFloorPct / 100);
    const effSlPrice = newBreakeven ? netBreakevenPrice : (sl ?? null);
    const hitSl =
      effSlPrice != null &&
      (side === "long" ? mark <= (effSlPrice as number) : mark >= (effSlPrice as number));

    // 4) Trailing exit (after TP1, on the runner).
    let hitTrail = false;
    if (tp1Hit && trailingEnabled && trailAnchor != null) {
      trailAnchor = side === "long" ? Math.max(trailAnchor, mark) : Math.min(trailAnchor, mark);
      const retrace =
        side === "long"
          ? ((trailAnchor - mark) / trailAnchor) * 100
          : ((mark - trailAnchor) / trailAnchor) * 100;
      const effTrail = p.weak_progress ? (trailPct as number) / 2 : (trailPct as number);
      if (retrace >= effTrail) hitTrail = true;
    }

    // 4b) Post-TP1 style-aware runner protection.
    // Activate only after a meaningful peak and exit on giveback from that peak.
    // Conservative: peak >= 3%, giveback 35%
    // Balanced:     peak >= 4%, giveback 45%
    // Aggressive:   peak >= 5%, giveback 55%
    const postTp1 = tp1Hit || tp1JustHit;
    const RUNNER_PROT: Record<string, { minPeak: number; givebackFrac: number }> = {
      conservative: { minPeak: 3.0, givebackFrac: 0.35 },
      balanced: { minPeak: 4.0, givebackFrac: 0.45 },
      aggressive: { minPeak: 5.0, givebackFrac: 0.55 },
    };
    const runnerProt = RUNNER_PROT[styleKey] ?? RUNNER_PROT.balanced;
    const givebackFromPeakFrac = peakRoe > 0 ? (peakRoe - currentRoe) / peakRoe : 0;
    const hitRunnerProtect =
      postTp1 && peakRoe >= runnerProt.minPeak && givebackFromPeakFrac >= runnerProt.givebackFrac;

    // 4c) Micro peak-lock: PRE-TP1 giveback protection for the dead zone where
    // a trade peaks below TP1 (2.65% ROE) so no partial is banked, the fade exit
    // can't fire (it requires postTp1), and a fast reversal skips the 1-minute
    // marks straight to the breakeven stop. Measured failure mode: peaks of
    // +1.6-1.7% ROE (≈₹400 unrealized) round-tripping to net ≈ 0. Once peak ROE
    // >= 1.2, lock ~40% of the peak (floor 0.35% ROE); the net-breakeven stop
    // above backstops the worst case.
    // SIDE-AWARE thresholds (2026-07-24 sweep on 334 real shorts, deltas vs
    // live): shorts peak ~1.2 ROE on average — just under the 1.2 arm — so 42%
    // round-tripped to the full stop with no ratchet. Arming shorts at 0.6
    // (lock floor 0.5) improved BOTH groups: aggressive twins +$81.5/10d,
    // all other cohorts +$208.1/10d (locks 47→80) with no damage to the
    // profit-fade harvest. Longs keep the original 1.2/0.35 (untested lower).
    const mlArm = side === "short" ? 0.6 : 1.2;
    const mlFloor = side === "short" ? 0.5 : 0.35;
    const hitMicroLock =
      !postTp1 && peakRoe >= mlArm && currentRoe <= Math.max(mlFloor, peakRoe * 0.4);

    // 5a) Price-% profit fade: only allowed after TP1 has been hit.
    const hitProfitFade =
      postTp1 &&
      peak >= preset.profitFadeMinPct &&
      peak > 0 &&
      giveback / peak >= preset.profitFadeGivebackPct;

    // 5b) Pre-TP1 failed momentum: rare, strict exit before TP1 is hit.
    // Only fires when all conditions are met — otherwise let trade reach TP1/SL/time_exit.
    const hitPreTp1FailedMomentum =
      !tp1Hit && !tp1JustHit && ageMin >= 30 && peakRoe >= 1.0 && currentRoe <= -2.0;

    // 5c) Hard profit-protection fallback: unprotected trade that hit the ROE hard cap.
    const hitHardProfitExit = postTp1 && !profitProtected && currentRoe >= roeHard;

    // 6) Weak progress flag.
    let newWeakProgress: { weak_progress: boolean; weak_progress_marked_at: string } | null = null;
    if (
      !p.weak_progress &&
      ageMin >= 45 &&
      ageMin <= preset.weakProgressWindowMin + 5 &&
      peak < preset.weakProgressMinPct
    ) {
      newWeakProgress = { weak_progress: true, weak_progress_marked_at: new Date().toISOString() };
    }

    // 7) Weak-progress time exit.
    const weakNegative = p.weak_progress && (side === "long" ? mark < entry : mark > entry);
    const hitTimeExit =
      autoCloseMinutes > 0 &&
      Number.isFinite(openedAt) &&
      Date.now() - openedAt >= autoCloseMinutes * 60_000;

    // Fee-aware evaluation (fee constants hoisted above the SL section).
    // CoinDCX charges maker == taker on futures (no maker discount — validated
    // against real trades), so both legs use the taker/taker model regardless of
    // how the entry filled. See src/lib/fees.ts header note.
    const grossPctPrice = entry > 0 ? ((mark - entry) / entry) * 100 * sideMul : 0;
    const fundingEstimatePct = 0;
    const netPctPrice = grossPctPrice - roundTripFeePct - slippageBufferPct - fundingEstimatePct;
    const feeAwareEnabled = cfgRow?.fee_aware_exits_enabled !== false;
    const minNetExitPct = Number(cfgRow?.minimum_net_profit_to_exit_pct ?? 0.18);
    const minGrossFadePct = Number(cfgRow?.minimum_gross_profit_before_profit_fade_exit_pct ?? 0.3);
    const minGrossWeakPct = Number(
      cfgRow?.minimum_gross_profit_before_weak_progress_exit_pct ?? 0.25,
    );

    const notionalEntry = qty * entry;
    const notionalExit = qty * mark;
    const estimatedTotalFee =
      ((notionalEntry * feeRates.entry_fee_pct) / 100 +
        (notionalExit * feeRates.exit_fee_pct) / 100) *
      (1 + feeRates.gst_pct / 100);
    const estimatedSlippage = (notionalExit * slippageBufferPct) / 100;
    const estimatedNetPnl = pnl - estimatedTotalFee - estimatedSlippage;

    let exitBlockedReason: string | null = null;
    let originalExitReason: string | null = null;

    // Pre-TP1 protective exits (run before hard SL so failing trades exit
    // on policy and hard SL stays an emergency fallback).
    const { evaluateFuturesExit } = await import("@/lib/futures/exit-policy");
    const policyDecision = evaluateFuturesExit(
      {
        tp1Hit: tp1Hit || tp1JustHit,
        heldMinutes: ageMin,
        peakRoePct: peakRoe,
        currentRoePct: currentRoe,
      },
      {
        strategyType: cfgRow?.strategy ?? null,
        tradingStyle: cfgRow?.trading_style ?? null,
      },
    );

    if (hitTp) {
      finalExitReason = "take_profit";
    } else if (hitHardProfitExit) {
      finalExitReason = "profit_protection_exit";
      exitProtectionReason = "profit_protection";
    } else if (policyDecision) {
      finalExitReason = policyDecision.exitReason;
      exitProtectionReason = policyDecision.protectionReason ?? policyDecision.rule;
    } else if (hitSl) {
      // If TP1 was banked, SL has moved to entry — degrade to breakeven_exit.
      if (newBreakeven || tp1Hit || tp1JustHit) {
        finalExitReason = "breakeven_exit";
        exitProtectionReason = "breakeven_protected";
      } else {
        finalExitReason = "stop_loss";
      }
    } else if (hitRunnerProtect) {
      finalExitReason = "profit_fade_exit";
      exitProtectionReason = "runner_protection";
    } else if (hitTrail) {
      finalExitReason = "trailing_exit";
    } else if (hitMicroLock) {
      // No fee gate: at the trigger floor the trade is at worst ≈ net 0, and
      // the net-breakeven stop backstops anything faster.
      finalExitReason = "profit_fade_exit";
      exitProtectionReason = "micro_peak_lock";
    } else if (hitProfitFade) {
      const isActuallyLosing = grossPctPrice < 0;
      if (
        !isActuallyLosing &&
        feeAwareEnabled &&
        (grossPctPrice < minGrossFadePct || netPctPrice < minNetExitPct)
      ) {
        originalExitReason = "profit_fade_exit";
        exitBlockedReason = "fee_blocked_profit_fade";
      } else {
        finalExitReason = "profit_fade_exit";
      }
    } else if (hitPreTp1FailedMomentum) {
      finalExitReason = "profit_fade_exit";
      exitProtectionReason = "pre_tp1_failed_momentum";
    } else if (weakNegative) {
      // Fee-blocking must only delay exits on a small PROFIT that fees would erase.
      // Never delay an exit on a position that is already at a loss — that traps
      // a deteriorating trade open while the loss grows toward full stop loss.
      const isActuallyLosing = grossPctPrice < 0;
      if (
        !isActuallyLosing &&
        feeAwareEnabled &&
        (grossPctPrice < minGrossWeakPct || netPctPrice < minNetExitPct)
      ) {
        originalExitReason = "weak_progress_time_exit";
        exitBlockedReason = "fee_blocked_weak_progress";
      } else {
        finalExitReason = "weak_progress_time_exit";
      }
    } else if (hitTimeExit) {
      finalExitReason = "time_exit";
    }

    // ----- Apply update -----
    const roeGiveback = peakRoe > 0 ? Math.max(0, peakRoe - currentRoe) : 0;
    const baseUpdate: Record<string, unknown> = {
      mark_price: mark,
      pnl,
      pnl_pct: pnlPct,
      peak_unrealized_pnl_pct: peak,
      giveback_pct: Math.max(giveback, roeGiveback),
      max_favourable_excursion_pct: mfePct,
      max_adverse_excursion_pct: maePct,
      highest_unrealized_pnl: highPnl,
      lowest_unrealized_pnl: lowPnl,
    };
    // LIVE TP1: the 50% partial close must be REAL in live mode — previously
    // TP1 only booked in the DB while the exchange kept full size, so the
    // "runner" carried twice the risk the book showed. Order first, book only
    // on success; on failure TP1 stays unbooked and the next mark pass retries
    // (price is still beyond tp1, so tp1JustHit fires again). When the final
    // exit fires in the SAME pass, skip the partial — the final-exit branch
    // flattens the still-full remaining_qty in one order.
    if (tp1JustHit && finalExitReason == null && p.mode === "live") {
      const creds = await loadLiveCreds(supabase, p.user_id as string);
      const exec = creds
        ? await placeLiveExit({ creds, symbol: p.symbol as string, side, qty: qty / 2 })
        : ({ ok: false as const, error: "no API credentials" });
      if (!exec.ok) {
        await logEvent(
          supabase,
          p.user_id as string,
          "error",
          `Live TP1 partial for ${p.symbol} failed: ${exec.error} — TP1 not booked, retrying next pass`,
          { kind: "live_tp1_failed", symbol: p.symbol, side },
        );
        tp1JustHit = false;
      } else {
        await logEvent(
          supabase,
          p.user_id as string,
          "info",
          `Live TP1 partial placed for ${p.symbol}: ${qty / 2} (#${exec.orderId})`,
          { kind: "live_tp1_placed", symbol: p.symbol, order_id: exec.orderId },
        );
      }
    }
    if (tp1JustHit) {
      const halfQty = qty / 2;
      const tp1AbsPnl = (mark - entry) * halfQty * sideMul;
      baseUpdate.tp1_hit = true;
      baseUpdate.tp1_hit_at = new Date().toISOString();
      baseUpdate.tp1_roe_pct = currentRoe;
      // Simulated 50% close: bank half the pnl_pct at TP1 price, leverage-adjusted.
      const tp1PctRealized = entry > 0 ? ((mark - entry) / entry) * 100 * sideMul * lev : 0;
      baseUpdate.tp1_pnl = tp1PctRealized * 0.5;
      baseUpdate.tp1_booked_pnl = tp1AbsPnl;
      baseUpdate.tp1_qty_closed = halfQty;
      baseUpdate.remaining_qty = halfQty;
      baseUpdate.stop_loss = entry;
      baseUpdate.breakeven_moved = true;
      baseUpdate.breakeven_armed_at = new Date().toISOString();
      baseUpdate.profit_protection_active = true;
      baseUpdate.trail_anchor_price = mark;
    } else if (tp1Hit) {
      baseUpdate.trail_anchor_price = trailAnchor;
    }
    // Persist an early (pre-TP1) breakeven arm so the stop stays at entry on the
    // next mark pass. (tp1JustHit already persists this in its own block; the two
    // are mutually exclusive since early-arm requires !newBreakeven.)
    if (armedEarlyBreakeven) {
      baseUpdate.breakeven_moved = true;
      baseUpdate.breakeven_armed_at = new Date().toISOString();
      baseUpdate.stop_loss = entry;
    }
    if (newWeakProgress) Object.assign(baseUpdate, newWeakProgress);

    if (finalExitReason != null) {
      // Paper mode SL fill price: use the configured SL price, not the current mark.
      // For stop_loss: exit at effSlPrice (the original configured SL).
      // For breakeven_exit: exit at entry (SL moved to breakeven after TP1).
      const isSLExit = finalExitReason === "stop_loss" || finalExitReason === "breakeven_exit";
      const exitPrice =
        isSLExit && p.mode === "paper" && effSlPrice != null ? (effSlPrice as number) : mark;

      // Final pnl = TP1 booked leg (absolute) + runner leg (absolute on remaining qty).
      const hadTp1 = tp1Hit || tp1JustHit;
      const runnerQty = hadTp1 ? qty / 2 : qty;
      const runnerAbsPnl = (exitPrice - entry) * runnerQty * sideMul;
      const tp1BookedAbs = hadTp1
        ? Number(
            (baseUpdate.tp1_booked_pnl as number | undefined) ??
              p.tp1_booked_pnl ??
              // Fallback for legacy rows: derive from tp1 price if available.
              (p.tp1_price != null ? (Number(p.tp1_price) - entry) * (qty / 2) * sideMul : 0),
          )
        : 0;
      const combinedPnl = tp1BookedAbs + runnerAbsPnl;
      const remainingShare = hadTp1 ? runnerQty / qty : 1;
      const tp1LegPct = tp1JustHit ? Number(baseUpdate.tp1_pnl ?? 0) : tp1Pnl;
      const exitPnlPct = entry > 0 ? ((exitPrice - entry) / entry) * 100 * sideMul * lev : 0;
      const combinedPnlPct = tp1LegPct + exitPnlPct * remainingShare;
      const netPnl = combinedPnl - estimatedTotalFee - estimatedSlippage;

      Object.assign(baseUpdate, {
        status: "closed",
        exit_price: exitPrice,
        exit_reason: finalExitReason,
        final_exit_reason: finalExitReason,
        original_exit_reason: finalExitReason,
        final_tp_hit: finalExitReason === "take_profit",
        pnl: combinedPnl,
        pnl_pct: combinedPnlPct,
        gross_pnl: combinedPnl,
        runner_pnl: runnerAbsPnl,
        tp1_booked_pnl: tp1BookedAbs,
        estimated_total_fee: estimatedTotalFee,
        estimated_slippage: estimatedSlippage,
        estimated_net_pnl: netPnl,
        exit_fee_aware: feeAwareEnabled,
        exit_blocked_reason: null,
        exit_protection_reason: exitProtectionReason,
        closed_at: new Date().toISOString(),
      });

      // LIVE exit: flatten the position on the exchange before recording the
      // closure locally. Failure is logged but does NOT block the local close
      // (price has already crossed our exit; the operator must reconcile).
      if (p.mode === "live") {
        const remainQ = Number(p.remaining_qty ?? qty);
        const creds = await loadLiveCreds(supabase, p.user_id as string);
        if (!creds) {
          await logEvent(
            supabase,
            p.user_id as string,
            "warn",
            `Live exit ${p.symbol}: no API credentials — local close only`,
          );
        } else if (remainQ > 0) {
          const exec = await placeLiveExit({
            creds,
            symbol: p.symbol as string,
            side,
            qty: remainQ,
          });
          if (!exec.ok) {
            await logEvent(
              supabase,
              p.user_id as string,
              "error",
              `Live exit ${p.symbol} failed: ${exec.error} — local close only`,
              { kind: "live_exit_failed", symbol: p.symbol, side },
            );
          } else {
            await logEvent(
              supabase,
              p.user_id as string,
              "info",
              `Live exit order placed for ${p.symbol} (#${exec.orderId})`,
            );
          }
        }
      }

      const { error } = await supabase
        .from("positions")
        .update(baseUpdate as never)
        .eq("id", p.id as string);

      if (!error) {
        closed++;
        await logEvent(
          supabase,
          p.user_id as string,
          "info",
          `Auto-closed ${side.toUpperCase()} ${p.symbol} at ${exitPrice} (${finalExitReason}) net=${(combinedPnl - estimatedTotalFee - estimatedSlippage).toFixed(4)} fee=${estimatedTotalFee.toFixed(4)}`,
        );
      }
    } else {
      Object.assign(baseUpdate, {
        gross_pnl: pnl,
        estimated_total_fee: estimatedTotalFee,
        estimated_slippage: estimatedSlippage,
        estimated_net_pnl: estimatedNetPnl,
      });
      if (exitBlockedReason) {
        Object.assign(baseUpdate, {
          exit_blocked_reason: exitBlockedReason,
          original_exit_reason: originalExitReason,
        });
        await logEvent(
          supabase,
          p.user_id as string,
          "info",
          `Exit blocked (${exitBlockedReason}) ${side.toUpperCase()} ${p.symbol}: gross=${grossPctPrice.toFixed(3)}% net=${netPctPrice.toFixed(3)}% min=${minNetExitPct}%`,
        );
      }
      const { error } = await supabase
        .from("positions")
        .update(baseUpdate as never)
        .eq("id", p.id as string);
      if (!error) updated++;
    }
  }

  // ----- Shadow tracking for manually-closed trades -----
  for (const p of shadowRows ?? []) {
    const mark = marks[p.symbol as string];
    if (!mark) continue;
    const entry = Number(p.entry_price);
    const lev = Number(p.leverage);
    const side = p.side as "long" | "short";
    const sideMul = side === "long" ? 1 : -1;
    const tp = p.take_profit != null ? Number(p.take_profit) : null;
    const sl = p.stop_loss != null ? Number(p.stop_loss) : null;
    const tp1 = p.tp1_price != null ? Number(p.tp1_price) : null;
    const trail = p.trail_pct != null ? Number(p.trail_pct) : null;

    const manualPnl = Number(p.pnl ?? 0);

    // Shadow logic: pretend trade was still open; check whether mark has hit
    // any target since manual close. Limited heuristic — no candle replay.
    let shadowReason: string | null = null;
    if (tp != null && (side === "long" ? mark >= tp : mark <= tp)) shadowReason = "take_profit";
    else if (sl != null && (side === "long" ? mark <= sl : mark >= sl)) shadowReason = "stop_loss";
    else if (tp1 != null && (side === "long" ? mark >= tp1 : mark <= tp1))
      shadowReason = "tp1_only";

    if (shadowReason) {
      const shadowExitPrice =
        shadowReason === "take_profit"
          ? (tp as number)
          : shadowReason === "stop_loss"
            ? (sl as number)
            : (tp1 as number);
      const shadowPnlPct =
        entry > 0 ? ((shadowExitPrice - entry) / entry) * 100 * sideMul * lev : 0;
      const shadowPnl = (shadowExitPrice - entry) * Number(p.qty) * sideMul;
      const saved = manualPnl > shadowPnl ? manualPnl - shadowPnl : 0;
      const missed = shadowPnl > manualPnl ? shadowPnl - manualPnl : 0;
      void trail;
      await supabase
        .from("positions")
        .update({
          shadow_exit_reason: shadowReason,
          shadow_exit_pnl: shadowPnl,
          shadow_closed_at: new Date().toISOString(),
          manual_saved_pnl: saved,
          manual_missed_pnl: missed,
        } as never)
        .eq("id", p.id as string);
      void shadowPnlPct;
    }
  }

  // ---- Equity circuit breaker (pre-pilot P1) ----
  // Hard floor under a runaway day: when a user's equity (wallet/paper base +
  // today's realized + open PnL) falls circuit_breaker_pct below its intraday
  // (IST) peak, flatten the whole book — real reduce-only orders in live mode —
  // and halt NEW entries for the rest of the IST day (entry pass checks
  // halted_on). The peak resets each IST day so one bad day can't arm a
  // permanently unreachable high-water mark. If a live flatten order fails,
  // the row is left OPEN so the normal exit stack keeps managing it — a DB
  // close that hides real exchange exposure is worse than a lingering row.
  try {
    const istOffsetMs = 5.5 * 3600_000;
    const istNowMark = new Date(Date.now() + istOffsetMs);
    const istToday = istNowMark.toISOString().slice(0, 10);
    const istDayStartIso = new Date(
      Date.UTC(
        istNowMark.getUTCFullYear(),
        istNowMark.getUTCMonth(),
        istNowMark.getUTCDate(),
      ) - istOffsetMs,
    ).toISOString();

    for (const breakerUserId of userIds) {
      const bCfg = cfgByUser.get(breakerUserId) as unknown as BotConfig | undefined;
      if (!bCfg) continue;
      if ((bCfg.halted_on ?? null) === istToday) continue; // already tripped today
      const trippct = Number(bCfg.circuit_breaker_pct ?? 10);
      if (!(trippct > 0)) continue; // explicit 0/negative disables the breaker

      const base = await resolveEquity(supabase, bCfg);
      if (!(base > 0)) continue;

      const { data: todayClosed } = await supabase
        .from("positions")
        .select("pnl")
        .eq("user_id", breakerUserId)
        .eq("instrument", "futures")
        .eq("status", "closed")
        .gte("closed_at", istDayStartIso);
      const realizedToday = (todayClosed ?? []).reduce((s, r) => s + Number(r.pnl ?? 0), 0);

      const { data: openNow } = await supabase
        .from("positions")
        .select("id,symbol,side,qty,remaining_qty,pnl,mark_price,mode")
        .eq("user_id", breakerUserId)
        .eq("instrument", "futures")
        .eq("status", "open");
      const openPnl = (openNow ?? []).reduce((s, r) => s + Number(r.pnl ?? 0), 0);

      const equityNow = base + realizedToday + openPnl;
      const storedPeak =
        bCfg.equity_peak != null && bCfg.equity_peak_date === istToday
          ? Number(bCfg.equity_peak)
          : null;
      const peak = Math.max(storedPeak ?? equityNow, equityNow);
      if (storedPeak == null || peak > storedPeak) {
        await supabase
          .from("bot_config")
          .update({ equity_peak: peak, equity_peak_date: istToday } as never)
          .eq("user_id", breakerUserId);
      }

      const floor = peak * (1 - trippct / 100);
      if (equityNow > floor) continue;

      // ---- TRIP: halt first (so a crash mid-flatten still blocks entries),
      // then flatten every open position. ----
      await supabase
        .from("bot_config")
        .update({ halted_on: istToday } as never)
        .eq("user_id", breakerUserId);
      await logEvent(
        supabase,
        breakerUserId,
        "error",
        `CIRCUIT BREAKER: equity ${equityNow.toFixed(2)} is ${trippct}% below today's peak ${peak.toFixed(2)} — flattening ${(openNow ?? []).length} position(s); no new entries until tomorrow (IST)`,
        {
          kind: "circuit_breaker_tripped",
          equity: Number(equityNow.toFixed(2)),
          peak: Number(peak.toFixed(2)),
          trip_pct: trippct,
          open_positions: (openNow ?? []).length,
        },
      );

      for (const r of openNow ?? []) {
        if (r.mode === "live") {
          const creds = await loadLiveCreds(supabase, breakerUserId);
          const remainQ = Number(r.remaining_qty ?? r.qty);
          const exec =
            creds && remainQ > 0
              ? await placeLiveExit({
                  creds,
                  symbol: r.symbol as string,
                  side: r.side as "long" | "short",
                  qty: remainQ,
                })
              : ({ ok: false as const, error: creds ? "zero qty" : "no API credentials" });
          if (!exec.ok) {
            await logEvent(
              supabase,
              breakerUserId,
              "error",
              `Circuit-breaker flatten FAILED for ${r.symbol}: ${exec.error} — row left open for the exit stack`,
              { kind: "circuit_breaker_flatten_failed", symbol: r.symbol, position_id: r.id },
            );
            continue; // do NOT close the DB row over live exposure we failed to flatten
          }
        }
        await supabase
          .from("positions")
          .update({
            status: "closed",
            closed_at: new Date().toISOString(),
            exit_price: r.mark_price ?? null,
            exit_reason: "circuit_breaker",
            final_exit_reason: "circuit_breaker",
            estimated_net_pnl: Number(r.pnl ?? 0),
            gross_pnl: Number(r.pnl ?? 0),
          } as never)
          .eq("id", r.id as string)
          .eq("status", "open");
        closed++;
      }
    }
  } catch (e) {
    // The breaker must never take down the mark pass itself.
    console.error("circuit breaker sweep failed", e);
  }

  return { updated, closed };
}

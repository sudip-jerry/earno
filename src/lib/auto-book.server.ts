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
  type SignalAnalysis,
} from "@/lib/signal-scoring.server";
import { feeModelRates, DEFAULT_FEE_MODEL } from "@/lib/fees";
import { classifySetup } from "@/lib/futures/setup-classifier";
import { isGloballyBlacklisted } from "@/lib/global-symbol-blacklist";
import { getBackendStrategyPolicy } from "@/lib/futures/strategy-policy";
import { evaluateTradeEligibility } from "@/lib/futures/trade-eligibility";
import { loadLiveCreds, placeLiveEntry, placeLiveExit } from "@/lib/futures/live-execution.server";

const FUTURES_TICKER = "https://public.coindcx.com/market_data/v3/current_prices/futures/rt";
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
async function fetchScanUniverse(
  nChange = 20,
  nVolume = 20,
): Promise<Array<{ symbol: string; price: number; change24h: number; volume24h: number }>> {
  const res = await fetch(FUTURES_TICKER, { headers: PUB_HEADERS, cache: "no-store" });
  if (!res.ok) return [];
  const raw = (await res.json()) as
    | { prices: Record<string, TickerEntry> }
    | Record<string, TickerEntry>
    | TickerEntry[];
  const dict =
    raw && typeof raw === "object" && !Array.isArray(raw) && "prices" in raw
      ? (raw as { prices: Record<string, TickerEntry> }).prices
      : raw;
  const rows: Array<{ symbol: string; price: number; change24h: number; volume24h: number }> = [];
  const consume = (sym: string | undefined, r: TickerEntry) => {
    const symbol = sym ?? r.s ?? r.pair;
    if (!symbol || !symbol.startsWith("B-") || !symbol.endsWith("_USDT")) return;
    const price = num(r.ls ?? r.c);
    const change = num(r.cp ?? r.pc);
    const vol = num(r.qv ?? r.v);
    if (!price) return;
    rows.push({ symbol, price, change24h: change, volume24h: vol });
  };
  if (Array.isArray(dict)) dict.forEach((r) => consume(undefined, r));
  else Object.entries(dict).forEach(([k, v]) => v && typeof v === "object" && consume(k, v));

  const byChange = [...rows]
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
    .slice(0, nChange);
  const byVolume = [...rows].sort((a, b) => b.volume24h - a.volume24h).slice(0, nVolume);
  const seen = new Set<string>();
  const union: typeof rows = [];
  for (const r of [...byChange, ...byVolume]) {
    if (seen.has(r.symbol)) continue;
    seen.add(r.symbol);
    union.push(r);
  }
  return union;
}

/** Get live mark prices for the given symbols using the same ticker. */
export async function fetchMarkPrices(symbols: string[]): Promise<Record<string, number>> {
  if (!symbols.length) return {};
  const res = await fetch(FUTURES_TICKER, { headers: PUB_HEADERS, cache: "no-store" });
  if (!res.ok) return {};
  const raw = (await res.json()) as
    | { prices: Record<string, TickerEntry> }
    | Record<string, TickerEntry>;
  const dict =
    raw && typeof raw === "object" && "prices" in raw
      ? (raw as { prices: Record<string, TickerEntry> }).prices
      : (raw as Record<string, TickerEntry>);
  const wanted = new Set(symbols);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(dict)) {
    const sym = (v && (v.s as string | undefined)) ?? k;
    if (!sym || !wanted.has(sym)) continue;
    const p = num(v?.ls ?? v?.c);
    if (p > 0) out[sym] = p;
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
  "B-BTC_USDT","B-ETH_USDT","B-BNB_USDT","B-SOL_USDT",
  "B-XRP_USDT","B-ADA_USDT","B-DOGE_USDT","B-NEAR_USDT",
  "B-SUI_USDT","B-AAVE_USDT","B-AVAX_USDT","B-LINK_USDT",
  "B-UNI_USDT","B-DOT_USDT","B-MATIC_USDT","B-LTC_USDT",
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
  max_sl_atr_pct?: number | null;
  min_ev_ratio?: number | null;
  blocked_session_hours_ist?: number[] | null;
  major_coin_confidence_floor?: number | null;
};

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
  opts: { userId?: string } = {},
): Promise<{
  users: number;
  opened: number;
  skipped: number;
  details: Array<{ user: string; opened: number; skipped: number; reason?: string }>;
}> {
  let q = supabase
    .from("bot_config")
    .select(
      "user_id,mode,auto_book,is_running,leverage,risk_per_trade_pct,paper_equity,max_open_positions,cooldown_minutes,max_trades_per_day,auto_close_minutes,daily_loss_cap_pct,min_scalp_score,allow_short,allow_long,strategy,trading_style,min_sl_pct,atr_multiplier,max_auto_sl_pct,target_multiplier,min_rr,symbol_sl_cooldown_minutes,symbol_blacklist_threshold,regime_filter_enabled,auto_book_confidence_threshold,display_confidence_threshold,symbol_blocklist,live_wallet_source,live_allocation_mode,live_allocation_amount,live_allocation_pct,timeframe,minimum_net_profit_to_enter_pct,max_sl_atr_pct,min_ev_ratio,blocked_session_hours_ist,major_coin_confidence_floor",
    )
    .eq("auto_book", true)
    .eq("is_running", true);

  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data: cfgs } = await q;

  const users = (cfgs ?? []) as BotConfig[];
  const result = {
    users: users.length,
    opened: 0,
    skipped: 0,
    details: [] as Array<{ user: string; opened: number; skipped: number; reason?: string }>,
  };
  if (!users.length) return result;

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
  const universe = await fetchScanUniverse(25, 25);
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
  const regimeFloorsByStyle = new Map(
    (floorRows ?? []).map((r) => [r.trading_style, r]),
  );
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
    let opened = 0;
    let skipped = 0;
    const userName = nameByUser.get(cfg.user_id) ?? "";
    const autoConfThreshold = Number(cfg.auto_book_confidence_threshold ?? 70);
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
      Date.UTC(
        istNow.getUTCFullYear(),
        istNow.getUTCMonth(),
        istNow.getUTCDate(),
        0, 0, 0, 0
      ) - istOffset
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
    if (planDailyLimit <= 0) userBlockReason = "Plan does not allow auto-book";
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
    const analyses = analysesByTf.get(cfgTimeframe) ?? [];
    const backendPolicy = getBackendStrategyPolicy({
      strategy: cfg.strategy,
      trading_style: cfg.trading_style,
    });


    for (const a of analyses) {
      const sym = a.symbol;
      const signalId = crypto.randomUUID();
      const cooldownActive =
        (lastOpen.get(sym) != null && Date.now() - (lastOpen.get(sym) as number) < cooldownMs) ||
        (lastSlClose.get(sym) != null &&
          Date.now() - (lastSlClose.get(sym) as number) < symbolSlCooldownMs);

      // Compute risk plan up front so we can include rr on every row.
      const plan = computeRiskPlan({
        atrPct: a.atr_pct,
        preset,
        capital: equity,
        unsupported: a.side_bias === "neutral",
      });

      // Decide gating.
      let rejection: string | null = null;
      let final: string = "skip";

      if (isGloballyBlacklisted(sym)) {
        rejection = "Symbol on platform blacklist";
        final = "skip";
      } else if (blockedSymbols.has(sym.toUpperCase())) {
        rejection = "Symbol on user blocklist";
        final = "skip";
      } else if (
        // Global hard-SL cooldown: 2+ hard SLs across Futures paper users in
        // the last 6h blocks new auto-book entries (both long & short) for 6h.
        cfg.mode === "paper" &&
        (globalHardSlCount.get(sym) ?? 0) >= 2
      ) {
        rejection = "Symbol globally cooled (2+ hard SLs across users in 6h)";
        final = "skip";
      } else if (
        // Per-user hard-SL cooldown: 1 hard SL in last 6h blocks re-entry
        // for symbol_sl_cooldown_minutes.
        cfg.mode === "paper" &&
        userHardSlAt.has(sym) &&
        Date.now() - (userHardSlAt.get(sym) as number) < symbolSlCooldownMs
      ) {
        rejection = "Symbol hard-SL cooldown (user, last 6h)";
        final = "skip";
      } else if (a.action === "AVOID" || a.side_bias === "neutral") {
        rejection = "Bias unclear / avoid";
        final = "avoid";
      } else if (a.side_bias === "short" && !cfg.allow_short) {
        rejection = "Shorts disabled in config";
        final = "skip";
      } else if (a.side_bias === "long" && cfg.allow_long === false) {
        rejection = "Longs disabled in config";
        final = "skip";
        // Loss-based symbol blacklist removed — only delisted symbols (filtered
        // upstream by the market list) remain excluded.
      } else if (cooldownActive) {
        rejection = "Cooldown active";
        final = "skip";
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
      // (Regime-aware direction gate moved below as a standalone check.)
      } else if (a.spread_pct != null && a.spread_pct > HARD_SPREAD_BLOCK_PCT) {
        rejection = `Spread too high (${a.spread_pct.toFixed(2)}%)`;
        final = "skip";
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
        await logEvent(supabase, cfg.user_id, "info", `Auto-book skipped ${a.symbol}: ${rejection}`, {
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
        });
      } else if (!dailyLossAvailable) {
        rejection = "Daily loss cap hit";
        final = "skip";
      } else if (remainingToday - opened <= 0) {
        rejection = "Daily auto-book limit reached";
        final = "skip";
        // Style trades/day, same-direction, and per-symbol/day hardcaps removed for now.
      } else if (openSlot <= 0) {
        rejection = "Max open positions reached";
        final = "skip";
      } else if (openSymbols.has(sym)) {
        rejection = "Position already open on symbol";
        final = "skip";
      } else if (a.confidence_pct < autoConfThreshold) {
        rejection = `Below auto-book threshold (${a.confidence_pct} < ${autoConfThreshold})`;
        final = a.confidence_pct >= displayConfThreshold ? "display" : "skip";
        await logEvent(supabase, cfg.user_id, "info", `Auto-book skipped ${a.symbol}: ${rejection}`, {
          kind: "confidence_below_threshold",
          symbol: a.symbol,
          confidence_pct: a.confidence_pct,
          auto_book_confidence_threshold: autoConfThreshold,
          display_conf_threshold: displayConfThreshold,
        });
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
          } else if (isShort && conf < withTrendFloor) {
            regimeFloor = withTrendFloor;
            regimeReason = `Regime: bearish — ${style} shorts need ${withTrendFloor}+`;
          }
        } else if (marketRegime === "strong_bearish") {
          if (isLong) {
            regimeFloor = counterTrendFloor + 3;
            regimeReason = `Regime: strong_bearish — ${style} longs need ${regimeFloor}+`;
          } else if (isShort && conf < withTrendFloor) {
            regimeFloor = withTrendFloor;
            regimeReason = `Regime: strong_bearish — ${style} shorts need ${withTrendFloor}+`;
          }
        }

        if (regimeFloor !== null && conf < regimeFloor && regimeReason !== null) {
          rejection = regimeReason;
          final = conf >= displayConfThreshold ? "display" : "skip";
          await logEvent(supabase, cfg.user_id, "info", `Auto-book skipped ${a.symbol}: ${rejection}`, {
            kind: "regime_gate_skip",
            symbol: a.symbol,
            market_regime: marketRegime,
            side: a.side_bias,
            confidence_pct: conf,
            regime_floor: regimeFloor,
            trading_style: style,
          });
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
          await logEvent(supabase, cfg.user_id, "info", `Auto-book skipped ${a.symbol}: ${rejection}`, {
            kind: "major_coin_floor_skip",
            symbol: a.symbol,
            confidence_pct: a.confidence_pct,
            major_coin_confidence_floor: majorFloor,
          });
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
          (isLong && rsi > 72 && volSpike < 1.2) ||
          (isShort && rsi < 28 && volSpike < 1.2);

        if (momentumExhausted) {
          rejection = `Momentum exhaustion: RSI ${rsi.toFixed(1)} extended for ${a.side_bias} with weak volume (${volSpike.toFixed(2)}x)`;
          final = "skip";
          await logEvent(supabase, cfg.user_id, "info", `Auto-book skipped ${a.symbol}: ${rejection}`, {
            kind: "momentum_exhaustion_skip",
            symbol: a.symbol,
            side: a.side_bias,
            rsi: a.rsi,
            volume_spike_ratio: a.volume_spike_ratio,
          });
        }
      }

      // Backend setup classification + policy gate (Futures-only, beginner-invisible).
      const setup = classifySetup(a);
      if (rejection == null) {
        const eligibility = evaluateTradeEligibility(a, setup, backendPolicy);
        if (!eligibility.allowed) {
          rejection = eligibility.reason ?? "Backend policy rejected";
          final = "skip";
          await logEvent(supabase, cfg.user_id, "info", `Auto-book skipped ${a.symbol}: ${rejection}`, {
            kind: "eligibility_skip",
            symbol: a.symbol,
            ...(eligibility.metadata ?? {}),
          });
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
            await logEvent(supabase, cfg.user_id, "info", `Auto-book skipped ${a.symbol}: ${rejection}`, {
              kind: "session_hour_skip",
              symbol: a.symbol,
              ist_hour: istHour,
              blocked_hours: blockedHours,
            });
          }
        }
      }

      if (rejection == null) {
        const maxSlAtr = Number(cfg.max_sl_atr_pct ?? 0);
        if (maxSlAtr > 0 && plan.slPct > maxSlAtr) {
          rejection = `SL width ${plan.slPct.toFixed(2)}% exceeds max_sl_atr_pct ${maxSlAtr}%`;
          final = "skip";
          await logEvent(supabase, cfg.user_id, "info", `Auto-book skipped ${a.symbol}: ${rejection}`, {
            kind: "sl_width_skip",
            symbol: a.symbol,
            sl_pct: plan.slPct,
            max_sl_atr_pct: maxSlAtr,
          });
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
              await logEvent(supabase, cfg.user_id, "info", `Auto-book skipped ${a.symbol}: ${rejection}`, {
                kind: "ev_ratio_skip",
                symbol: a.symbol,
                ev_ratio: Number(evRatio.toFixed(4)),
                min_ev_ratio: minEv,
                confidence_pct: a.confidence_pct,
                tp_pct: plan.tpPct,
                sl_pct: plan.slPct,
              });
            }
          }
        }
      }

      let bookedTradeId: string | null = null;

      if (rejection == null) {
        // Book.
        const side = a.side_bias as "long" | "short";
        const { tpPct, slPct } = plan;
        const lev = Number(cfg.leverage ?? 3);
        const notional = plan.positionSize;
        if (notional <= 0 || a.price <= 0) {
          rejection = "Position sizing failed";
          final = "skip";
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
            const fees = feeModelRates(DEFAULT_FEE_MODEL);
            const entryNotional = qty * a.price;
            const exitNotionalAtTp = qty * take_profit;
            const grossAtTp = qty * Math.abs(take_profit - a.price);
            const feesAtTp =
              ((entryNotional * fees.entry_fee_pct) / 100 +
                (exitNotionalAtTp * fees.exit_fee_pct) / 100) *
              (1 + fees.gst_pct / 100);
            const netPctAtTp =
              entryNotional > 0 ? ((grossAtTp - feesAtTp) / entryNotional) * 100 : 0;
            if (netPctAtTp < minNetEnterPct) {
              rejection = `Projected net profit at TP ${netPctAtTp.toFixed(3)}% < min ${minNetEnterPct}%`;
              final = "skip";
              await logEvent(
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
                  fees_at_tp: Number(feesAtTp.toFixed(4)),
                  gross_at_tp: Number(grossAtTp.toFixed(4)),
                },
              );
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
            await logEvent(supabase, cfg.user_id, "error", `Auto-book ${a.symbol} failed: ${rejection}`);
          } else {
          // LIVE (wallet) execution: place a real market order before recording
          // the position. On failure we skip the booking so the local DB and
          // the exchange never disagree. Paper mode is unchanged.
          let liveOrderId: string | null = null;
          if (cfg.mode === "live") {
            const creds = await loadLiveCreds(supabase, cfg.user_id);
            if (!creds) {
              rejection = "Live mode: no CoinDCX API credentials configured";
              final = "skip";
              await logEvent(supabase, cfg.user_id, "warn", `Auto-book ${a.symbol} skipped: ${rejection}`);
              await supabase
                .from("bot_signals")
                .update({ final_decision: "skip", rejection_reason: rejection })
                .eq("id", signalId);
            } else {
              const exec = await placeLiveEntry({
                creds,
                symbol: a.symbol,
                side,
                qty,
                leverage: lev,
              });
              if (!exec.ok) {
                rejection = `Live order rejected: ${exec.error}`;
                final = "skip";
                await logEvent(supabase, cfg.user_id, "error", `Auto-book ${a.symbol} live order failed: ${exec.error}`, {
                  kind: "live_entry_failed", symbol: a.symbol, side,
                });
                await supabase
                  .from("bot_signals")
                  .update({ final_decision: "skip", rejection_reason: rejection })
                  .eq("id", signalId);
              } else {
                liveOrderId = exec.orderId;
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
              fetch(CANDLES(a.symbol, "1m", 2), { headers: PUB_HEADERS, signal: AbortSignal.timeout(2500) }),
              fetch(CANDLES(a.symbol, "1h", 30), { headers: PUB_HEADERS, signal: AbortSignal.timeout(2500) }),
            ]);
            if (c1Res.ok) {
              const c1 = (await c1Res.json()) as Array<{ open: number | string; close: number | string }>;
              const last = Array.isArray(c1) && c1.length ? c1[c1.length - 1] : null;
              if (last) {
                const o = num(last.open); const c = num(last.close);
                if (o > 0) {
                  entryCandlePct = ((c - o) / o) * 100;
                  entryCandleAligned = side === "long" ? entryCandlePct > 0 : entryCandlePct < 0;
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
          } catch { /* log-only — never block booking */ }

          const sigKey = `${a.symbol}|${a.side_bias}`;
          const earliestAt = earliestSignalAt.get(sigKey);
          const signalAgeSeconds = earliestAt != null ? Math.max(0, Math.round((Date.now() - earliestAt) / 1000)) : 0;

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
              entry_candle_pct: entryCandlePct,
              entry_candle_aligned: entryCandleAligned,
              symbol_1h_trend: symbol1hTrend,
              signal_age_seconds: signalAgeSeconds,

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
            await logEvent(supabase, cfg.user_id, "error", `Auto-book ${a.symbol} failed: ${rejection}`);
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
    .select("user_id,auto_close_minutes,trading_style,strategy,min_scalp_score,fee_aware_exits_enabled,minimum_net_profit_to_exit_pct,slippage_buffer_pct,minimum_gross_profit_before_profit_fade_exit_pct,minimum_gross_profit_before_weak_progress_exit_pct")

    .in("user_id", userIds);
  const cfgByUser = new Map((cfgRows ?? []).map((c) => [c.user_id as string, c]));

  const allSymbols = Array.from(
    new Set([
      ...positions.map((p) => p.symbol as string),
      ...(shadowRows ?? []).map((p) => p.symbol as string),
    ]),
  );
  const marks = await fetchMarkPrices(allSymbols);

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

    // Breakeven only armed when TP1 fires. No pre-TP1 breakeven move.
    const profitProtected = newBreakeven || tp1Hit || tp1JustHit;

    // 2) Final TP.
    const hitTp = tp != null && (side === "long" ? mark >= tp : mark <= tp);
    // 3) SL: before TP1 use original SL; after TP1 SL has moved to entry (breakeven).
    const effSlPrice = newBreakeven ? entry : (sl ?? null);
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

    // Fee-aware evaluation (unchanged).
    const grossPctPrice = entry > 0 ? ((mark - entry) / entry) * 100 * sideMul : 0;
    const feeRates = feeModelRates(DEFAULT_FEE_MODEL);
    const roundTripFeePct =
      (feeRates.entry_fee_pct + feeRates.exit_fee_pct) * (1 + feeRates.gst_pct / 100);
    const slippageBufferPct = Number(cfgRow?.slippage_buffer_pct ?? 0.05);
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
    } else if (hitProfitFade) {
      const isActuallyLosing = grossPctPrice < 0;
      if (!isActuallyLosing && feeAwareEnabled && (grossPctPrice < minGrossFadePct || netPctPrice < minNetExitPct)) {
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
      if (!isActuallyLosing && feeAwareEnabled && (grossPctPrice < minGrossWeakPct || netPctPrice < minNetExitPct)) {
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
          await logEvent(supabase, p.user_id as string, "warn",
            `Live exit ${p.symbol}: no API credentials — local close only`);
        } else if (remainQ > 0) {
          const exec = await placeLiveExit({
            creds, symbol: p.symbol as string, side, qty: remainQ,
          });
          if (!exec.ok) {
            await logEvent(supabase, p.user_id as string, "error",
              `Live exit ${p.symbol} failed: ${exec.error} — local close only`,
              { kind: "live_exit_failed", symbol: p.symbol, side });
          } else {
            await logEvent(supabase, p.user_id as string, "info",
              `Live exit order placed for ${p.symbol} (#${exec.orderId})`);
          }
        }
      }

      const { error } = await supabase.from("positions").update(baseUpdate as never).eq("id", p.id as string);

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

  return { updated, closed };
}

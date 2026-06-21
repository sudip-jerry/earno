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
import { analyzeSymbol, HARD_SPREAD_BLOCK_PCT, ALGO_ID, ALGO_NAME, ALGO_VERSION, type SignalAnalysis } from "@/lib/signal-scoring.server";


const FUTURES_TICKER = "https://public.coindcx.com/market_data/v3/current_prices/futures/rt";
const CANDLES = (pair: string, interval: string, limit: number) =>
  `https://public.coindcx.com/market_data/candles?pair=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;
const PUB_HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; Earn'O/1.0; +https://earno.lovable.app)",
};

async function fetchAtrPct(pair: string): Promise<number | null> {
  try {
    const res = await fetch(CANDLES(pair, "5m", 30), {
      headers: PUB_HEADERS,
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Array<{ open: number | string; high: number | string; low: number | string; close: number | string }>;
    if (!Array.isArray(raw) || raw.length < 16) return null;
    const candles = raw.map((k) => ({
      open: num(k.open),
      high: num(k.high),
      low: num(k.low),
      close: num(k.close),
    }));
    return atrPctFromCandles(candles, 14);
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

  const byChange = [...rows].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)).slice(0, nChange);
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
export type MarketRegime =
  | "strong_bullish"
  | "bullish"
  | "neutral"
  | "bearish"
  | "strong_bearish";

function ema(values: number[], period: number): number | null {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export async function fetchMarketRegime(): Promise<MarketRegime | null> {
  try {
    const res = await fetch(CANDLES("B-BTC_USDT", "1h", 60), {
      headers: PUB_HEADERS,
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as Array<{ open: number | string; high: number | string; low: number | string; close: number | string }>;
    if (!Array.isArray(raw) || raw.length < 22) return null;
    const closes = raw.map((k) => num(k.close));
    const last = closes[closes.length - 1];
    const ema21 = ema(closes.slice(-30), 21);
    const ema50 = ema(closes, 50);
    if (!last || !ema21 || !ema50) return null;
    const slope = ema21 / closes[closes.length - 7] - 1; // 6h slope
    const distEma50Pct = (last - ema50) / ema50;
    if (distEma50Pct > 0.04 && slope > 0.01) return "strong_bullish";
    if (distEma50Pct < -0.04 && slope < -0.01) return "strong_bearish";
    if (distEma50Pct > 0.012) return "bullish";
    if (distEma50Pct < -0.012) return "bearish";
    return "neutral";
  } catch {
    return null;
  }
}


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
      const r = await coindcxAuthedPost<Array<{ asset?: string; currency?: string; balance?: string; available_balance?: string }>>(
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
    if (mode === "percent") return Math.max(0, (available * Number(cfg.live_allocation_pct ?? 100)) / 100);
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
      "user_id,mode,auto_book,is_running,leverage,risk_per_trade_pct,paper_equity,max_open_positions,cooldown_minutes,max_trades_per_day,auto_close_minutes,daily_loss_cap_pct,min_scalp_score,allow_short,allow_long,strategy,trading_style,min_sl_pct,atr_multiplier,max_auto_sl_pct,target_multiplier,min_rr,symbol_sl_cooldown_minutes,symbol_blacklist_threshold,regime_filter_enabled,auto_book_confidence_threshold,display_confidence_threshold,symbol_blocklist,live_wallet_source,live_allocation_mode,live_allocation_amount,live_allocation_pct",
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
    (profiles ?? []).map((p) => [p.id as string, ((p.display_name as string) || (p.email as string) || "") as string]),
  );

  // Universe + per-symbol analysis (shared across users in this pass).
  const universe = await fetchScanUniverse(25, 25);
  const scannedCount = universe.length;
  const analyses: SignalAnalysis[] = [];
  if (universe.length) {
    const settled = await Promise.allSettled(
      universe.map((u) => analyzeSymbol(u.symbol, u.price, u.change24h)),
    );
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) analyses.push(s.value);
    }
  }
  // Sort by confidence so booking targets highest-conviction setups first.
  analyses.sort((a, b) => b.confidence_pct - a.confidence_pct);
  const topConfidenceOverall = analyses[0]?.confidence_pct ?? 0;

  // Compute market regime once for the whole pass.
  const marketRegime = await fetchMarketRegime();


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
        timeframe: "5m",
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
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
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
      .select("symbol,opened_at,closed_at,exit_reason,pnl,side")
      .eq("user_id", cfg.user_id)
      .gte("opened_at", new Date(Date.now() - 24 * 3600_000).toISOString());
    const lastOpen = new Map<string, number>();
    const lastSlClose = new Map<string, number>();
    const lossCountBySymbol = new Map<string, number>();
    const lastLossAtBySymbol = new Map<string, number>();
    const winCountBySymbol = new Map<string, number>();
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
    const openedToday = (todayPos ?? []) as Array<{ pnl: number | null; status: string; opened_at: string; exchange_order_id: string | null }>;
    const todayAutoRecent = (await supabase
      .from("positions")
      .select("symbol,side")
      .eq("user_id", cfg.user_id)
      .gte("opened_at", startOfDay.toISOString())).data ?? [];
    const longTodayCount = todayAutoRecent.filter((r) => r.side === "long").length;
    const shortTodayCount = todayAutoRecent.filter((r) => r.side === "short").length;
    const perSymbolTodayCount = new Map<string, number>();
    for (const r of todayAutoRecent) {
      perSymbolTodayCount.set(r.symbol as string, (perSymbolTodayCount.get(r.symbol as string) ?? 0) + 1);
    }
    // Track in-pass increments so caps account for trades booked earlier in this loop.
    const sameDirOpenedThisPass = { long: 0, short: 0 };
    const symbolOpenedThisPass = new Map<string, number>();
    void openedToday;



    for (const a of analyses) {
      const sym = a.symbol;
      const signalId = crypto.randomUUID();
      const cooldownActive =
        (lastOpen.get(sym) != null && Date.now() - (lastOpen.get(sym) as number) < cooldownMs) ||
        (lastSlClose.get(sym) != null && Date.now() - (lastSlClose.get(sym) as number) < symbolSlCooldownMs);

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

      if (blockedSymbols.has(sym.toUpperCase())) {
        rejection = "Symbol on user blocklist";
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
      } else if (
        // Market regime guard.
        marketRegime === "strong_bullish" &&
        a.side_bias === "short" &&
        a.confidence_pct < 90
      ) {
        rejection = "Regime guard: shorts blocked in strong-bullish";
        final = "skip";
      } else if (
        marketRegime === "strong_bearish" &&
        a.side_bias === "long" &&
        a.confidence_pct < 90
      ) {
        rejection = "Regime guard: longs blocked in strong-bearish";
        final = "skip";
      } else if (
        marketRegime === "bullish" &&
        a.side_bias === "short" &&
        a.confidence_pct < autoConfThreshold + 5
      ) {
        rejection = "Regime: bullish — stricter short confirmation required";
        final = "skip";
      } else if (
        marketRegime === "bearish" &&
        a.side_bias === "long" &&
        a.confidence_pct < autoConfThreshold + 5
      ) {
        rejection = "Regime: bearish — stricter long confirmation required";
        final = "skip";
      } else if (a.spread_pct != null && a.spread_pct > HARD_SPREAD_BLOCK_PCT) {
        rejection = `Spread too high (${a.spread_pct.toFixed(2)}%)`;
        final = "skip";
      } else if (plan.status !== "auto_eligible") {
        rejection = plan.reason ?? "Risk plan rejected";
        final = "skip";
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
            timeframe: "5m",
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
              exchange_order_id: cfg.mode === "paper" ? `paper-auto-${Date.now()}` : null,
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
              },
            );
          }
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
    result.details.push({ user: cfg.user_id, opened, skipped, reason: userBlockReason ?? undefined });
    await logScanEvent(supabase, cfg.user_id, scannedCount, analyses.filter((x) => x.action === "LONG" || x.action === "SHORT").length, opened, skipped, topConfidenceOverall);
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
  let q = supabase
    .from("positions")
    .select("*")
    .eq("status", "open");
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
    new Set([...positions.map((p) => p.user_id as string), ...((shadowRows ?? []).map((p) => p.user_id as string))]),
  );
  const { data: cfgRows } = await supabase
    .from("bot_config")
    .select("user_id,auto_close_minutes,trading_style,min_scalp_score")
    .in("user_id", userIds);
  const cfgByUser = new Map((cfgRows ?? []).map((c) => [c.user_id as string, c]));

  const allSymbols = Array.from(
    new Set([
      ...positions.map((p) => p.symbol as string),
      ...((shadowRows ?? []).map((p) => p.symbol as string)),
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
      | { auto_close_minutes: number; trading_style?: string; min_scalp_score?: number }
      | undefined;
    const autoCloseMinutes = Number(cfgRow?.auto_close_minutes ?? 120);
    const presetRaw = presetFromConfig({
      trading_style: cfgRow?.trading_style ?? "balanced",
      min_sl_pct: null, atr_multiplier: null, max_auto_sl_pct: null,
      target_multiplier: null, min_rr: null, risk_per_trade_pct: null,
    });
    const preset = applyStrictnessToPreset(presetRaw, strictnessFromMinScore(cfgRow?.min_scalp_score));
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

    // ----- Resolve exit decision (priority order) -----
    let finalExitReason: string | null = null;
    let tp1JustHit = false;
    let newSl = sl;
    let newBreakeven = breakevenMoved;

    // 1) TP1 (partial close: simulated 50%).
    if (!tp1Hit && tp1 != null) {
      const crossed = side === "long" ? mark >= tp1 : mark <= tp1;
      if (crossed) {
        tp1JustHit = true;
        newSl = entry; // move stop to breakeven on remaining
        newBreakeven = true;
        trailAnchor = mark;
      }
    }

    // 2) Final TP (closes full remaining).
    const hitTp = tp != null && (side === "long" ? mark >= tp : mark <= tp);
    // 3) SL (could be at breakeven).
    const hitSl =
      (tp1Hit || tp1JustHit ? entry : (sl ?? null)) != null &&
      (side === "long"
        ? mark <= (tp1Hit || tp1JustHit ? entry : (sl as number))
        : mark >= (tp1Hit || tp1JustHit ? entry : (sl as number)));

    // 4) Trailing exit (only after TP1 hit, on the runner).
    let hitTrail = false;
    if (tp1Hit && trailPct != null && trailAnchor != null) {
      // Update anchor to best favourable price.
      trailAnchor = side === "long" ? Math.max(trailAnchor, mark) : Math.min(trailAnchor, mark);
      const retrace =
        side === "long"
          ? ((trailAnchor - mark) / trailAnchor) * 100
          : ((mark - trailAnchor) / trailAnchor) * 100;
      const effTrail = (p.weak_progress ? trailPct / 2 : trailPct);
      if (retrace >= effTrail) hitTrail = true;
    }

    // 5) Profit-fade.
    const hitProfitFade =
      peak >= preset.profitFadeMinPct &&
      peak > 0 &&
      giveback / peak >= preset.profitFadeGivebackPct;

    // 6) Weak progress detection (flag only — does NOT force SL).
    let newWeakProgress: { weak_progress: boolean; weak_progress_marked_at: string } | null = null;
    if (!p.weak_progress && ageMin >= 45 && ageMin <= preset.weakProgressWindowMin + 5 && peak < preset.weakProgressMinPct) {
      newWeakProgress = { weak_progress: true, weak_progress_marked_at: new Date().toISOString() };
    }

    // 7) Weak-progress time exit when momentum turns negative post-flag.
    const weakNegative = p.weak_progress && (side === "long" ? mark < entry : mark > entry);
    const hitTimeExit =
      autoCloseMinutes > 0 && Number.isFinite(openedAt) && Date.now() - openedAt >= autoCloseMinutes * 60_000;

    if (hitTp) finalExitReason = "take_profit";
    else if (hitSl) finalExitReason = newBreakeven ? "breakeven_exit" : "stop_loss";
    else if (hitTrail) finalExitReason = "trailing_exit";
    else if (hitProfitFade) finalExitReason = "profit_fade_exit";
    else if (weakNegative) finalExitReason = "weak_progress_time_exit";
    else if (hitTimeExit) finalExitReason = "time_exit";

    // ----- Apply update -----
    const baseUpdate: Record<string, unknown> = {
      mark_price: mark,
      pnl,
      pnl_pct: pnlPct,
      peak_unrealized_pnl_pct: peak,
      giveback_pct: giveback,
      max_favourable_excursion_pct: mfePct,
      max_adverse_excursion_pct: maePct,
      highest_unrealized_pnl: highPnl,
      lowest_unrealized_pnl: lowPnl,
    };
    if (tp1JustHit) {
      baseUpdate.tp1_hit = true;
      baseUpdate.tp1_hit_at = new Date().toISOString();
      // Simulated 50% close: bank half the pnl_pct at TP1 price, leverage-adjusted.
      const tp1PctRealized = entry > 0 ? ((mark - entry) / entry) * 100 * sideMul * lev : 0;
      baseUpdate.tp1_pnl = tp1PctRealized * 0.5;
      baseUpdate.tp1_qty_closed = qty / 2;
      baseUpdate.remaining_qty = qty / 2;
      baseUpdate.stop_loss = entry;
      baseUpdate.breakeven_moved = true;
      baseUpdate.trail_anchor_price = mark;
    } else if (tp1Hit) {
      baseUpdate.trail_anchor_price = trailAnchor;
    }
    if (newWeakProgress) Object.assign(baseUpdate, newWeakProgress);

    if (finalExitReason != null) {
      // Final pnl combines TP1 leg (50%) + remaining leg pnl based on qty share.
      const remainingShare = (tp1Hit || tp1JustHit) ? (remainingQty / qty) : 1;
      const tp1Leg = tp1JustHit ? Number(baseUpdate.tp1_pnl ?? 0) : tp1Pnl;
      const combinedPnlPct = tp1Leg + pnlPct * remainingShare;
      const combinedPnl =
        (tp1JustHit ? (mark - entry) * (qty / 2) * sideMul : 0) +
        (mark - entry) * (remainingShare === 1 ? qty : qty / 2) * sideMul;

      Object.assign(baseUpdate, {
        status: "closed",
        exit_price: mark,
        exit_reason: finalExitReason,
        final_exit_reason: finalExitReason,
        final_tp_hit: finalExitReason === "take_profit",
        pnl: combinedPnl,
        pnl_pct: combinedPnlPct,
        closed_at: new Date().toISOString(),
      });
      const { error } = await supabase.from("positions").update(baseUpdate as never).eq("id", p.id as string);
      if (!error) {
        closed++;
        await logEvent(
          supabase,
          p.user_id as string,
          "info",
          `Auto-closed ${side.toUpperCase()} ${p.symbol} at ${mark} (${finalExitReason})`,
        );
      }
    } else {
      const { error } = await supabase.from("positions").update(baseUpdate as never).eq("id", p.id as string);
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
    else if (tp1 != null && (side === "long" ? mark >= tp1 : mark <= tp1)) shadowReason = "tp1_only";

    if (shadowReason) {
      const shadowExitPrice =
        shadowReason === "take_profit" ? (tp as number)
        : shadowReason === "stop_loss" ? (sl as number)
        : (tp1 as number);
      const shadowPnlPct = entry > 0 ? ((shadowExitPrice - entry) / entry) * 100 * sideMul * lev : 0;
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


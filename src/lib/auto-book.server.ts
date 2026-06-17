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
  type StylePreset,
} from "@/lib/risk-engine";


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


type Strictness = "less" | "moderate" | "strict";
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

import { analyzeSymbol, HARD_SPREAD_BLOCK_PCT, type SignalAnalysis } from "@/lib/signal-scoring.server";

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
      "user_id,mode,auto_book,is_running,leverage,risk_per_trade_pct,paper_equity,max_open_positions,cooldown_minutes,max_trades_per_day,auto_close_minutes,daily_loss_cap_pct,min_scalp_score,allow_short,allow_long,strategy,trading_style,min_sl_pct,atr_multiplier,max_auto_sl_pct,target_multiplier,min_rr,symbol_sl_cooldown_minutes,symbol_blacklist_threshold,regime_filter_enabled,auto_book_confidence_threshold,display_confidence_threshold,live_wallet_source,live_allocation_mode,live_allocation_amount,live_allocation_pct",
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

  for (const cfg of users) {
    let opened = 0;
    let skipped = 0;
    const userName = nameByUser.get(cfg.user_id) ?? "";
    const autoConfThreshold = Number(cfg.auto_book_confidence_threshold ?? 70);
    const displayConfThreshold = Number(cfg.display_confidence_threshold ?? 55);

    const signalRows: Record<string, unknown>[] = [];
    const pushSignal = (
      a: SignalAnalysis,
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
      signalRows.push({
        scan_id: scanId,
        user_id: cfg.user_id,
        user_name: userName,
        symbol: a.symbol,
        price: a.price,
        action: a.action,
        side_bias: a.side_bias,
        confidence_pct: a.confidence_pct,
        confidence_band: a.confidence_band,
        reason: a.reason,
        final_decision: final,
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
    for (const r of recent ?? []) {
      const sym = r.symbol as string;
      const t = new Date(r.opened_at as string).getTime();
      const prev = lastOpen.get(sym) ?? 0;
      if (t > prev) lastOpen.set(sym, t);
      const pnl = Number(r.pnl ?? 0);
      if (r.exit_reason === "stop_loss" && r.closed_at) {
        const ct = new Date(r.closed_at as string).getTime();
        const prevC = lastSlClose.get(sym) ?? 0;
        if (ct > prevC) lastSlClose.set(sym, ct);
      }
      if (pnl < 0) lossCountBySymbol.set(sym, (lossCountBySymbol.get(sym) ?? 0) + 1);
    }

    const preset: StylePreset = presetFromConfig(cfg);

    for (const a of analyses) {
      const sym = a.symbol;
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

      if (a.action === "AVOID" || a.side_bias === "neutral") {
        rejection = "Bias unclear / avoid";
        final = "avoid";
      } else if (a.side_bias === "short" && !cfg.allow_short) {
        rejection = "Shorts disabled in config";
        final = "skip";
      } else if (a.side_bias === "long" && cfg.allow_long === false) {
        rejection = "Longs disabled in config";
        final = "skip";
      } else if ((lossCountBySymbol.get(sym) ?? 0) >= blacklistThreshold) {
        rejection = `Symbol blacklisted (${lossCountBySymbol.get(sym)} losses in 24h)`;
        final = "skip";
      } else if (cooldownActive) {
        rejection = "Cooldown active";
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
            })
            .select("id")
            .single();
          if (error || !inserted) {
            rejection = error?.message ?? "Insert failed";
            final = "skip";
            await logEvent(supabase, cfg.user_id, "error", `Auto-book ${a.symbol} failed: ${rejection}`);
          } else {
            bookedTradeId = inserted.id as string;
            final = "booked";
            opened++;
            openSlot--;
            openSymbols.add(sym);
            lastOpen.set(sym, Date.now());
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
        }
      } else {
        // Display-quality but not booked: count as an opportunity-skip.
        skipped++;
      }

      pushSignal(a, final, bookedTradeId, rejection, {
        cooldown_active: cooldownActive,
        daily_loss_available: dailyLossAvailable,
        max_position_available: maxPositionAvailable,
        risk_reward: plan.rr || null,
      });
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

/** Update mark_price + pnl for open positions; auto-close TP/SL. Scope to a user when given. */
export async function runMarkPass(
  supabase: SupabaseClient,
  opts: { userId?: string } = {},
): Promise<{
  updated: number;
  closed: number;
}> {
  let q = supabase
    .from("positions")
    .select("id,user_id,symbol,side,leverage,qty,entry_price,take_profit,stop_loss,opened_at")
    .eq("status", "open");
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data: open } = await q;
  const positions = open ?? [];
  if (!positions.length) return { updated: 0, closed: 0 };

  const userIds = Array.from(new Set(positions.map((p) => p.user_id as string)));
  const { data: cfgRows } = await supabase
    .from("bot_config")
    .select("user_id,auto_close_minutes")
    .in("user_id", userIds);
  const autoCloseByUser = new Map(
    (cfgRows ?? []).map((c) => [c.user_id as string, Number(c.auto_close_minutes ?? 30)]),
  );

  const symbols = Array.from(new Set(positions.map((p) => p.symbol as string)));
  const marks = await fetchMarkPrices(symbols);

  let updated = 0;
  let closed = 0;
  for (const p of positions) {
    const mark = marks[p.symbol as string];
    if (!mark) continue;
    const entry = Number(p.entry_price);
    const qty = Number(p.qty);
    const lev = Number(p.leverage);
    const sideMul = p.side === "long" ? 1 : -1;
    const pnl = (mark - entry) * qty * sideMul;
    const pnlPct = entry > 0 ? ((mark - entry) / entry) * 100 * sideMul * lev : 0;
    const tp = p.take_profit != null ? Number(p.take_profit) : null;
    const sl = p.stop_loss != null ? Number(p.stop_loss) : null;
    const autoCloseMinutes = autoCloseByUser.get(p.user_id as string) ?? 30;
    const openedAt = new Date(p.opened_at as string).getTime();
    const hitTimeExit =
      autoCloseMinutes > 0 && Number.isFinite(openedAt) && Date.now() - openedAt >= autoCloseMinutes * 60_000;

    const hitTp = tp != null && (p.side === "long" ? mark >= tp : mark <= tp);
    const hitSl = sl != null && (p.side === "long" ? mark <= sl : mark >= sl);

    if (hitTp || hitSl || hitTimeExit) {
      const reason = hitTp ? "take_profit" : hitSl ? "stop_loss" : "time_exit";
      const { error } = await supabase
        .from("positions")
        .update({
          mark_price: mark,
          pnl,
          pnl_pct: pnlPct,
          status: "closed",
          exit_price: mark,
          exit_reason: reason,
          closed_at: new Date().toISOString(),
        })
        .eq("id", p.id);
      if (!error) {
        closed++;
        await logEvent(
          supabase,
          p.user_id as string,
          "info",
          `Auto-closed ${p.side === "long" ? "LONG" : "SHORT"} ${p.symbol} at ${mark} (${reason})`,
        );
      }
    } else {
      const { error } = await supabase
        .from("positions")
        .update({ mark_price: mark, pnl, pnl_pct: pnlPct })
        .eq("id", p.id);
      if (!error) updated++;
    }
  }
  return { updated, closed };
}

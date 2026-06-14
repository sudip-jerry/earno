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

const STRICT_PRESETS: Record<Strictness, { autoConf: number; volMin: number; change5mMin: number }> = {
  less: { autoConf: 60, volMin: 250_000, change5mMin: 0.05 },
  moderate: { autoConf: 70, volMin: 500_000, change5mMin: 0.08 },
  strict: { autoConf: 80, volMin: 1_000_000, change5mMin: 0.12 },
};

/**
 * Lightweight scoring used by the cron worker. Uses ticker-only signals
 * (no candle fetch per symbol — keeps the cron under its 10s budget).
 * Returns up to `topN` auto-eligible setups in confidence order.
 */
function pickAutoEligibleSetupsFromUniverse(
  universe: Array<{ symbol: string; price: number; change24h: number; volume24h: number }>,
  strictness: Strictness,
  topN: number,
  allowShort: boolean,
) {
  const preset = STRICT_PRESETS[strictness];
  const candidates: Array<{ symbol: string; price: number; side: "long" | "short"; confidence: number }> = [];
  for (const row of universe) {
    if (row.volume24h < preset.volMin) continue;
    const abs24 = Math.abs(row.change24h);
    if (abs24 < preset.change5mMin) continue;
    const side: "long" | "short" = row.change24h >= 0 ? "long" : "short";
    if (side === "short" && !allowShort) continue;
    const confidence = Math.min(100, 50 + abs24 * 6);
    if (confidence < preset.autoConf) continue;
    candidates.push({ symbol: row.symbol, price: row.price, side, confidence });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, topN);
}

function bestConfidenceFromUniverse(
  universe: Array<{ symbol: string; price: number; change24h: number; volume24h: number }>,
): number {
  let best = 0;
  for (const row of universe) {
    const c = Math.min(100, 50 + Math.abs(row.change24h) * 6);
    if (c > best) best = c;
  }
  return best;
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
  strategy: string | null;
  trading_style: string | null;
  min_sl_pct: number | null;
  atr_multiplier: number | null;
  max_auto_sl_pct: number | null;
  target_multiplier: number | null;
  min_rr: number | null;
  live_wallet_source?: string | null;
  live_allocation_mode?: string | null;
  live_allocation_amount?: number | null;
  live_allocation_pct?: number | null;
};


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
      "user_id,mode,auto_book,is_running,leverage,risk_per_trade_pct,paper_equity,max_open_positions,cooldown_minutes,max_trades_per_day,auto_close_minutes,daily_loss_cap_pct,min_scalp_score,allow_short,strategy,trading_style,min_sl_pct,atr_multiplier,max_auto_sl_pct,target_multiplier,min_rr",
    )
    .eq("auto_book", true)
    .eq("is_running", true);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data: cfgs } = await q;

  const users = (cfgs ?? []) as BotConfig[];
  const result = { users: users.length, opened: 0, skipped: 0, details: [] as Array<{ user: string; opened: number; skipped: number; reason?: string }> };
  if (!users.length) return result;

  // Single ticker fetch shared across users.
  const universe = await fetchScanUniverse(20, 20);
  const setups = pickAutoEligibleSetupsFromUniverse(universe, "moderate", 15, true);
  const topConfidenceOverall = setups[0]?.confidence ?? bestConfidenceFromUniverse(universe);
  const scannedCount = universe.length;
  if (!setups.length) {
    for (const u of users) {
      result.details.push({ user: u.user_id, opened: 0, skipped: 0, reason: "no setups" });
      await logScanEvent(supabase, u.user_id, scannedCount, 0, 0, 0, topConfidenceOverall);
    }
    return result;
  }

  for (const cfg of users) {
    let opened = 0;
    let skipped = 0;

    const planTier = await getPlanTier(supabase, cfg.user_id);
    const planDailyLimit = AUTO_PLAN_DAILY_LIMIT[planTier];
    if (planDailyLimit <= 0) {
      await logPauseEvent(supabase, cfg.user_id, "Auto-book skipped: current plan does not include automation");
      result.details.push({ user: cfg.user_id, opened: 0, skipped: setups.length, reason: "plan does not allow auto-book" });
      result.skipped += setups.length;
      continue;
    }

    // Daily loss cap check.
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data: todayPos } = await supabase
      .from("positions")
      .select("pnl,status,opened_at,exchange_order_id")
      .eq("user_id", cfg.user_id)
      .gte("opened_at", startOfDay.toISOString());

    const todayPnl = (todayPos ?? []).reduce((acc, p) => acc + Number(p.pnl ?? 0), 0);
    const equity = Number(cfg.paper_equity ?? 0);
    if (cfg.daily_loss_cap_pct != null && equity > 0) {
      const cap = (Number(cfg.daily_loss_cap_pct) / 100) * equity;
      if (todayPnl <= -cap) {
        await logPauseEvent(supabase, cfg.user_id, `Auto-book paused: daily loss cap hit (${todayPnl.toFixed(2)} USDT)`);
        result.details.push({ user: cfg.user_id, opened: 0, skipped: setups.length, reason: "daily loss cap" });
        result.skipped += setups.length;
        continue;
      }
    }

    const todayAutoCount = (todayPos ?? []).filter((p) =>
      String(p.exchange_order_id ?? "").startsWith("paper-auto-"),
    ).length;
    const dailyLimit = Math.min(cfg.max_trades_per_day ?? 999, planDailyLimit);
    const remainingToday = Math.max(0, dailyLimit - todayAutoCount);
    if (remainingToday <= 0) {
      await logPauseEvent(supabase, cfg.user_id, `Auto-book paused: daily auto-book limit reached (${todayAutoCount}/${dailyLimit})`);
      result.details.push({ user: cfg.user_id, opened: 0, skipped: setups.length, reason: "daily trade limit" });
      result.skipped += setups.length;
      continue;
    }

    const { data: openRows, count: openCount } = await supabase
      .from("positions")
      .select("symbol,opened_at", { count: "exact" })
      .eq("user_id", cfg.user_id)
      .eq("status", "open");

    let openSlot = Math.max(0, (cfg.max_open_positions ?? 5) - (openCount ?? 0));
    const openSymbols = new Set((openRows ?? []).map((r) => r.symbol as string));
    if (openSlot <= 0) {
      await logPauseEvent(supabase, cfg.user_id, `Auto-book paused: max open positions reached (${openCount ?? 0}/${cfg.max_open_positions ?? 5})`);
      result.details.push({ user: cfg.user_id, opened: 0, skipped: setups.length, reason: "max open positions" });
      result.skipped += setups.length;
      continue;
    }

    // Cooldown: last opened time per symbol (last 24h window covers any sensible cooldown).
    const cooldownMs = (cfg.cooldown_minutes ?? 15) * 60_000;
    const { data: recent } = await supabase
      .from("positions")
      .select("symbol,opened_at")
      .eq("user_id", cfg.user_id)
      .gte("opened_at", new Date(Date.now() - 24 * 3600_000).toISOString());
    const lastOpen = new Map<string, number>();
    for (const r of recent ?? []) {
      const t = new Date(r.opened_at as string).getTime();
      const prev = lastOpen.get(r.symbol as string) ?? 0;
      if (t > prev) lastOpen.set(r.symbol as string, t);
    }

    const preset: StylePreset = presetFromConfig(cfg);

    for (const s of setups) {
      if (openSlot <= 0 || remainingToday <= opened) break;
      if (openSymbols.has(s.symbol)) {
        skipped++;
        continue;
      }
      if (s.side === "short" && !cfg.allow_short) {
        skipped++;
        continue;
      }
      if (cfg.min_scalp_score != null && s.confidence < Number(cfg.min_scalp_score)) {
        skipped++;
        continue;
      }
      const last = lastOpen.get(s.symbol);
      if (last && Date.now() - last < cooldownMs) {
        skipped++;
        continue;
      }

      // Volatility-adjusted risk plan
      const atrPct = await fetchAtrPct(s.symbol);
      const plan = computeRiskPlan({ atrPct, preset, capital: equity });

      if (plan.status !== "auto_eligible") {
        skipped++;
        const reasonText =
          plan.reason === "Volatility too high for auto-book"
            ? `Skipped ${s.symbol} · Reason Volatility too high · Required Stop ${plan.requiredSL.toFixed(2)}% · Allowed ${preset.maxAutoSL.toFixed(2)}%`
            : plan.reason === "Risk-reward weak"
              ? `Skipped ${s.symbol} · Reason Risk-reward weak · R:R ${plan.rr.toFixed(2)}:1 · Required ${preset.minRR.toFixed(1)}:1`
              : `Skipped ${s.symbol} · ${plan.reason ?? "Risk rejected"}`;
        await logEvent(supabase, cfg.user_id, "warn", reasonText, {
          kind: "skip",
          symbol: s.symbol,
          side: s.side,
          confidence: Math.round(s.confidence),
          atrPct: plan.atrPct,
          requiredSL: plan.requiredSL,
          allowedSL: preset.maxAutoSL,
          rr: plan.rr,
          reason: plan.reason,
        });
        continue;
      }

      const { tpPct, slPct } = plan;
      const lev = Number(cfg.leverage ?? 3);
      // Position size derives from risk amount, NOT from leverage.
      const notional = plan.positionSize;
      if (notional <= 0 || s.price <= 0) {
        skipped++;
        continue;
      }
      const qty = notional / s.price;
      const stop_loss = s.side === "long" ? s.price * (1 - slPct / 100) : s.price * (1 + slPct / 100);
      const take_profit = s.side === "long" ? s.price * (1 + tpPct / 100) : s.price * (1 - tpPct / 100);

      const { error } = await supabase.from("positions").insert({
        user_id: cfg.user_id,
        mode: cfg.mode,
        symbol: s.symbol,
        side: s.side,
        leverage: lev,
        qty,
        entry_price: s.price,
        mark_price: s.price,
        stop_loss,
        take_profit,
        pnl: 0,
        pnl_pct: 0,
        status: "open",
        instrument: "futures",
        exchange_order_id: cfg.mode === "paper" ? `paper-auto-${Date.now()}` : null,
      });

      if (error) {
        skipped++;
        await logEvent(supabase, cfg.user_id, "error", `Auto-book ${s.symbol} failed: ${error.message}`);
        continue;
      }

      opened++;
      openSlot--;
      openSymbols.add(s.symbol);
      lastOpen.set(s.symbol, Date.now());
      await logEvent(
        supabase,
        cfg.user_id,
        "info",
        `Auto-booked ${s.side.toUpperCase()} ${s.symbol} · Confidence ${s.confidence.toFixed(0)}% · Target +${tpPct.toFixed(2)}% · Stop −${slPct.toFixed(2)}% · Stop Type Volatility-based · R:R ${plan.rr.toFixed(2)}:1`,
        {
          kind: "auto_book",
          symbol: s.symbol,
          side: s.side,
          confidence: Math.round(s.confidence),
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


    result.opened += opened;
    result.skipped += skipped;
    result.details.push({ user: cfg.user_id, opened, skipped });
    await logScanEvent(supabase, cfg.user_id, scannedCount, setups.length, opened, skipped, topConfidenceOverall);
  }

  return result;
}

/** Update mark_price + pnl for every open position; auto-close TP/SL. */
export async function runMarkPass(supabase: SupabaseClient): Promise<{
  updated: number;
  closed: number;
}> {
  const { data: open } = await supabase
    .from("positions")
    .select("id,user_id,symbol,side,leverage,qty,entry_price,take_profit,stop_loss,opened_at")
    .eq("status", "open");
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

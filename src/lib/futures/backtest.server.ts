/**
 * Futures backtest harness — "Replay" mode (Mode A).
 *
 * WHY THIS EXISTS
 * ---------------
 * Positions store only max_favourable_excursion_pct / max_adverse_excursion_pct
 * — the PEAK and TROUGH of the post-entry path, never the path itself. You
 * cannot replay an exit stack (TP1 → breakeven → trailing → stops → time exit)
 * from a peak/trough, because the ORDER prices are hit in decides the outcome.
 * So no exit/fee/entry change could be validated from stored history.
 *
 * This harness closes that gap: for each REAL booked trade it fetches the true
 * 1m candle path for the trade's window and re-runs the SAME exit stack the
 * live mark-pass runs (this file mirrors runMarkPass in auto-book.server.ts).
 * That lets us A/B the levers we actually care about — early breakeven, maker
 * entry (fee model), wider TP, slippage — on real entries, deterministically,
 * before flipping anything on live.
 *
 * ⚠️ KEEP IN SYNC: the exit logic below is a faithful copy of the exit stack in
 * runMarkPass(). If that stack changes, mirror the change here or the backtest
 * stops predicting live behavior.
 *
 * INTRABAR CONVENTION (documented limitation): 1m is the finest candle CoinDCX
 * serves, so wick sequencing inside a minute is unknowable. We evaluate the
 * full stack at the ADVERSE extreme first, then the FAVORABLE extreme, then the
 * close — a pessimistic ordering (a stop already in place fires before any
 * favorable arming), so results under-estimate rather than flatter.
 *
 * Network note: candle fetch must run where CoinDCX is reachable (deployed
 * server / edge), not the sandbox.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { feeModelRates, type FeeModel } from "@/lib/fees";
import { evaluateFuturesExit } from "@/lib/futures/exit-policy";
import {
  presetFromConfig,
  applyStrictnessToPreset,
  strictnessFromMinScore,
} from "@/lib/risk-engine";

const HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; Earn'O/1.0; +https://earno.lovable.app)",
};

type Candle = { time: number; open: number; high: number; low: number; close: number };

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fetch 1m candles covering [fromSec, toSec] for a futures pair. Uses the
 * CoinDCX candlesticks endpoint (from/to/resolution) for futures (B-*) symbols
 * and the plain candles endpoint (recent, limit-based) as a fallback for spot.
 */
async function fetchPathCandles(pair: string, fromSec: number, toSec: number): Promise<Candle[]> {
  const parse = (raw: unknown): Candle[] => {
    const arr = Array.isArray(raw) ? raw : [];
    return arr
      .map((k) => {
        const r = k as Record<string, unknown>;
        const tMs = num(r.time ?? 0);
        return {
          time: Math.floor(tMs > 1e12 ? tMs / 1000 : tMs),
          open: num(r.open),
          high: num(r.high),
          low: num(r.low),
          close: num(r.close),
        };
      })
      .filter((c) => c.time > 0 && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)
      .sort((a, b) => a.time - b.time);
  };

  if (pair.startsWith("B-")) {
    const url = `https://public.coindcx.com/market_data/candlesticks?pair=${encodeURIComponent(
      pair,
    )}&from=${fromSec}&to=${toSec}&resolution=1&pcode=f`;
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const payload = (await res.json()) as { data?: unknown };
        const candles = parse(payload?.data);
        if (candles.length) return dedupe(candles);
      }
    } catch {
      /* fall through */
    }
  }
  // Spot / fallback: recent limit-based fetch, filtered to the window.
  try {
    const url = `https://public.coindcx.com/market_data/candles?pair=${encodeURIComponent(
      pair,
    )}&interval=1m&limit=1000`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const candles = parse(await res.json()).filter((c) => c.time >= fromSec && c.time <= toSec);
    return dedupe(candles);
  } catch {
    return [];
  }
}

function dedupe(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  let last = 0;
  for (const c of candles) {
    if (c.time <= last) continue;
    out.push(c);
    last = c.time;
  }
  return out;
}

/** A stored position row (subset of columns the replay needs). */
export type BacktestPosition = {
  id: string;
  user_id: string;
  symbol: string;
  side: "long" | "short";
  entry_price: number;
  qty: number;
  leverage: number;
  take_profit: number | null;
  stop_loss: number | null;
  tp1_price: number | null;
  trail_pct: number | null;
  opened_at: string;
  closed_at: string | null;
};

/** Per-user config knobs the exit stack reads (mirrors runMarkPass cfgRow). */
export type BacktestConfig = {
  trading_style?: string | null;
  strategy?: string | null;
  min_scalp_score?: number | null;
  auto_close_minutes?: number | null;
  fee_aware_exits_enabled?: boolean | null;
  minimum_net_profit_to_exit_pct?: number | null;
  slippage_buffer_pct?: number | null;
  minimum_gross_profit_before_profit_fade_exit_pct?: number | null;
  minimum_gross_profit_before_weak_progress_exit_pct?: number | null;
  breakeven_arm_roe_pct?: number | null;
};

/** Overrides applied to a single replay pass to test a lever. */
export type BacktestVariant = {
  name: string;
  /** Override early-breakeven arm threshold (ROE %). 0/undefined = use config. */
  breakevenArmRoePct?: number;
  /** Fee model on the entry leg: maker fill pays maker fee. Default taker. */
  entryFill?: "maker" | "taker";
  /** Override slippage buffer % (per exit leg). */
  slippageBufferPct?: number;
  /** Scale the TP/TP1 distance from entry (e.g. 2 = twice as far). Default 1. */
  tpScale?: number;
  /** Scale the SL distance from entry (ratio-matched wider stop). Default 1. */
  slScale?: number;
  /**
   * Entry-edge gate: exclude trades whose gross target move % (|tp - entry| /
   * entry) is below this floor, mirroring the live minimum_expected_edge_pct
   * gate. Lets us measure, on real history, whether the fee-clearing floor
   * (perps ~0.6%) flips the surviving set net-positive and how many trades it
   * culls. Undefined = no entry filter.
   */
  minExpectedEdgePct?: number;
};

/** Gross target move % of a position (the quantity the edge gate compares). */
function targetEdgePct(pos: BacktestPosition): number {
  const entry = num(pos.entry_price);
  if (!(entry > 0) || pos.take_profit == null) return Infinity;
  return (Math.abs(num(pos.take_profit) - entry) / entry) * 100;
}

export type ReplayResult = {
  id: string;
  symbol: string;
  side: "long" | "short";
  exitReason: string;
  holdMinutes: number;
  grossPct: number; // ROE %
  netPct: number; // ROE % after fees + slippage
  grossPnl: number; // USDT
  netPnl: number; // USDT
  fees: number;
};

function feeModelFor(entryFill: "maker" | "taker" | undefined): FeeModel {
  return entryFill === "maker" ? "maker_taker_with_gst" : "taker_taker_with_gst";
}

/**
 * Replay one position over its candle path under a variant. Returns null when
 * there is no usable candle path (can't be scored).
 *
 * Mirrors the exit stack in runMarkPass. State (peak, tp1, breakeven, trail
 * anchor, weak progress) carries forward candle-by-candle; within each candle
 * the stack is evaluated adverse-extreme → favorable-extreme → close.
 */
export function replayPosition(
  pos: BacktestPosition,
  candles: Candle[],
  cfg: BacktestConfig,
  variant: BacktestVariant,
): ReplayResult | null {
  if (!candles.length) return null;

  const entry = num(pos.entry_price);
  const qty = num(pos.qty);
  const lev = num(pos.leverage) || 1;
  const side = pos.side;
  const sideMul = side === "long" ? 1 : -1;
  if (!(entry > 0) || !(qty > 0)) return null;

  const tpScale = variant.tpScale ?? 1;
  const slScale = variant.slScale ?? 1;
  const scaleFromEntry = (price: number | null, scale: number): number | null =>
    price == null ? null : entry + (num(price) - entry) * scale;

  const tp = scaleFromEntry(pos.take_profit, tpScale);
  const tp1 = scaleFromEntry(pos.tp1_price, tpScale);
  const slBase = scaleFromEntry(pos.stop_loss, slScale);
  const trailPct = pos.trail_pct != null ? num(pos.trail_pct) : null;
  const trailingEnabled = trailPct != null && trailPct > 0;

  const preset = applyStrictnessToPreset(
    presetFromConfig({
      trading_style: cfg.trading_style ?? "balanced",
      min_sl_pct: null,
      atr_multiplier: null,
      max_auto_sl_pct: null,
      target_multiplier: null,
      min_rr: null,
      risk_per_trade_pct: null,
    }),
    strictnessFromMinScore(cfg.min_scalp_score ?? null),
  );

  const styleKey = String(cfg.trading_style ?? "balanced").toLowerCase();
  const ROE_HARD: Record<string, number> = { conservative: 1.6, balanced: 1.8, aggressive: 2.0 };
  const roeHard = ROE_HARD[styleKey] ?? ROE_HARD.balanced;
  const RUNNER_PROT: Record<string, { minPeak: number; givebackFrac: number }> = {
    conservative: { minPeak: 3.0, givebackFrac: 0.35 },
    balanced: { minPeak: 4.0, givebackFrac: 0.45 },
    aggressive: { minPeak: 5.0, givebackFrac: 0.55 },
  };
  const runnerProt = RUNNER_PROT[styleKey] ?? RUNNER_PROT.balanced;

  const autoCloseMinutes = num(cfg.auto_close_minutes ?? 120);
  const beArmRoe = variant.breakevenArmRoePct ?? num(cfg.breakeven_arm_roe_pct ?? 0);
  const feeAwareEnabled = cfg.fee_aware_exits_enabled !== false;
  const minNetExitPct = num(cfg.minimum_net_profit_to_exit_pct ?? 0.18);
  const minGrossFadePct = num(cfg.minimum_gross_profit_before_profit_fade_exit_pct ?? 0.3);
  const minGrossWeakPct = num(cfg.minimum_gross_profit_before_weak_progress_exit_pct ?? 0.25);
  const slippageBufferPct = variant.slippageBufferPct ?? num(cfg.slippage_buffer_pct ?? 0.05);
  const feeModel = feeModelFor(variant.entryFill);
  const feeRates = feeModelRates(feeModel);

  const openedAtMs = new Date(pos.opened_at).getTime();

  // Mutable replay state.
  let tp1Hit = false;
  let breakevenMoved = false;
  let weakProgress = false;
  let trailAnchor: number | null = null;
  let peak = 0; // peak ROE %
  let remainingQty = qty;
  let realizedPnl = 0; // banked TP1 leg (USDT)

  const roeAt = (price: number) => ((price - entry) / entry) * 100 * sideMul * lev;
  const favorableExtreme = (c: Candle) => (side === "long" ? c.high : c.low);
  const adverseExtreme = (c: Candle) => (side === "long" ? c.low : c.high);

  let exitReason: string | null = null;
  let exitPrice = entry;
  let exitAgeMin = 0;

  outer: for (const c of candles) {
    const ageMin = (c.time * 1000 - openedAtMs) / 60_000;
    if (ageMin < -1) continue; // candle before entry

    // Weak-progress flag (set once in-window, mirrors runMarkPass §6).
    if (
      !weakProgress &&
      ageMin >= 45 &&
      ageMin <= preset.weakProgressWindowMin + 5 &&
      peak < preset.weakProgressMinPct
    ) {
      weakProgress = true;
    }

    // Evaluate the stack at adverse extreme, then favorable, then close.
    for (const mark of [adverseExtreme(c), favorableExtreme(c), c.close]) {
      const currentRoe = roeAt(mark);
      peak = Math.max(peak, currentRoe);
      const peakRoe = peak;

      // §1a TP1 by price.
      let tp1JustHit = false;
      if (!tp1Hit && tp1 != null) {
        const crossed = side === "long" ? mark >= tp1 : mark <= tp1;
        if (crossed) {
          tp1JustHit = true;
          breakevenMoved = true;
          trailAnchor = mark;
          // Bank half the qty at tp1 price.
          const halfQty = qty / 2;
          realizedPnl += (tp1 - entry) * halfQty * sideMul;
          remainingQty = halfQty;
        }
      }
      // §1b early breakeven (config/variant gated).
      if (beArmRoe > 0 && !breakevenMoved && !tp1Hit && currentRoe >= beArmRoe) {
        breakevenMoved = true;
      }
      const profitProtected = breakevenMoved || tp1Hit || tp1JustHit;
      const postTp1 = tp1Hit || tp1JustHit;

      // §2 final TP.
      const hitTp = tp != null && (side === "long" ? mark >= tp : mark <= tp);
      // §3 SL (moves to entry once breakeven armed).
      const effSlPrice = breakevenMoved ? entry : slBase;
      const hitSl =
        effSlPrice != null && (side === "long" ? mark <= effSlPrice : mark >= effSlPrice);

      // §4 trailing (post-TP1 runner).
      let hitTrail = false;
      if (tp1Hit && trailingEnabled && trailAnchor != null) {
        trailAnchor = side === "long" ? Math.max(trailAnchor, mark) : Math.min(trailAnchor, mark);
        const retrace =
          side === "long"
            ? ((trailAnchor - mark) / trailAnchor) * 100
            : ((mark - trailAnchor) / trailAnchor) * 100;
        const effTrail = weakProgress ? (trailPct as number) / 2 : (trailPct as number);
        if (retrace >= effTrail) hitTrail = true;
      }

      // §4b runner protection.
      const givebackFromPeakFrac = peakRoe > 0 ? (peakRoe - currentRoe) / peakRoe : 0;
      const hitRunnerProtect =
        postTp1 && peakRoe >= runnerProt.minPeak && givebackFromPeakFrac >= runnerProt.givebackFrac;

      // §5a profit fade (post-TP1).
      const giveback = peak >= preset.profitFadeMinPct ? Math.max(0, peak - currentRoe) : 0;
      const hitProfitFade =
        postTp1 &&
        peak >= preset.profitFadeMinPct &&
        peak > 0 &&
        giveback / peak >= preset.profitFadeGivebackPct;

      // §5c hard profit-protection fallback.
      const hitHardProfitExit = postTp1 && !profitProtected && currentRoe >= roeHard;

      // §7 time exit.
      const hitTimeExit = autoCloseMinutes > 0 && ageMin >= autoCloseMinutes;
      // weak-progress time exit trigger.
      const weakNegative = weakProgress && (side === "long" ? mark < entry : mark > entry);

      // §5b pre-TP1 policy exit (shared pure function).
      const policyDecision = evaluateFuturesExit(
        {
          tp1Hit: tp1Hit || tp1JustHit,
          heldMinutes: ageMin,
          peakRoePct: peakRoe,
          currentRoePct: currentRoe,
        },
        { strategyType: cfg.strategy ?? null, tradingStyle: cfg.trading_style ?? null },
      );

      // Fee-aware gross for the blocking checks (price %, not ROE — matches live).
      const grossPctPrice = ((mark - entry) / entry) * 100 * sideMul;
      const roundTripFeePct =
        (feeRates.entry_fee_pct + feeRates.exit_fee_pct) * (1 + feeRates.gst_pct / 100);
      const netPctPrice = grossPctPrice - roundTripFeePct - slippageBufferPct;

      // ----- priority-ordered resolution (mirrors runMarkPass) -----
      let reason: string | null = null;
      if (hitTp) reason = "take_profit";
      else if (hitHardProfitExit) reason = "profit_protection_exit";
      else if (policyDecision) reason = policyDecision.exitReason;
      else if (hitSl)
        reason = breakevenMoved || tp1Hit || tp1JustHit ? "breakeven_exit" : "stop_loss";
      else if (hitRunnerProtect) reason = "profit_fade_exit";
      else if (hitTrail) reason = "trailing_exit";
      else if (hitProfitFade) {
        const isLosing = grossPctPrice < 0;
        const blocked =
          !isLosing &&
          feeAwareEnabled &&
          (grossPctPrice < minGrossFadePct || netPctPrice < minNetExitPct);
        if (!blocked) reason = "profit_fade_exit";
      } else if (weakNegative) {
        const isLosing = grossPctPrice < 0;
        const blocked =
          !isLosing &&
          feeAwareEnabled &&
          (grossPctPrice < minGrossWeakPct || netPctPrice < minNetExitPct);
        if (!blocked) reason = "weak_progress_time_exit";
      } else if (hitTimeExit) reason = "time_exit";

      // Persist arming state for subsequent marks/candles.
      if (tp1JustHit) tp1Hit = true;

      if (reason) {
        exitReason = reason;
        exitPrice = hitTp && tp != null ? tp : mark;
        exitAgeMin = Math.max(0, ageMin);
        break outer;
      }
    }
  }

  // No exit fired within the path → close at the last candle's close (open-ended
  // trade truncated by data horizon; labeled data_horizon).
  if (exitReason == null) {
    const lastC = candles[candles.length - 1];
    exitReason = "data_horizon";
    exitPrice = lastC.close;
    exitAgeMin = Math.max(0, (lastC.time * 1000 - openedAtMs) / 60_000);
  }

  // Settle remaining leg + fees. Entry fee on full notional; exit fee on each
  // exit leg (TP1 half already banked into realizedPnl at tp1 price, remaining
  // at exitPrice).
  const finalLegPnl = (exitPrice - entry) * remainingQty * sideMul;
  const grossPnl = realizedPnl + finalLegPnl;

  const notionalEntry = qty * entry;
  const tp1ExitNotional = tp1Hit && tp1 != null ? (qty / 2) * tp1 : 0;
  const finalExitNotional = remainingQty * exitPrice;
  const totalExitNotional = tp1ExitNotional + finalExitNotional;
  const fees =
    ((notionalEntry * feeRates.entry_fee_pct) / 100 +
      (totalExitNotional * feeRates.exit_fee_pct) / 100) *
    (1 + feeRates.gst_pct / 100);
  const slippage = (totalExitNotional * slippageBufferPct) / 100;
  const netPnl = grossPnl - fees - slippage;

  // ROE %: PnL as a fraction of margin (notionalEntry / lev).
  const margin = notionalEntry / lev;
  const grossPct = margin > 0 ? (grossPnl / margin) * 100 : 0;
  const netPct = margin > 0 ? (netPnl / margin) * 100 : 0;

  return {
    id: pos.id,
    symbol: pos.symbol,
    side,
    exitReason,
    holdMinutes: Math.round(exitAgeMin),
    grossPct,
    netPct,
    grossPnl,
    netPnl,
    fees,
  };
}

export type BacktestSummary = {
  variant: string;
  knobs: Record<string, unknown>;
  trades: number;
  replayed: number;
  wins: number;
  winRate: number;
  grossPct: number;
  netPct: number;
  avgNetPct: number;
  grossPnl: number;
  netPnl: number;
  totalFees: number;
  expectancy: number;
  maxDrawdown: number;
  exitBreakdown: Record<string, number>;
  details: ReplayResult[];
};

function summarize(
  variant: BacktestVariant,
  results: ReplayResult[],
  trades: number,
): BacktestSummary {
  const replayed = results.length;
  const wins = results.filter((r) => r.netPnl > 0).length;
  const grossPct = results.reduce((s, r) => s + r.grossPct, 0);
  const netPct = results.reduce((s, r) => s + r.netPct, 0);
  const grossPnl = results.reduce((s, r) => s + r.grossPnl, 0);
  const netPnl = results.reduce((s, r) => s + r.netPnl, 0);
  const totalFees = results.reduce((s, r) => s + r.fees, 0);
  const exitBreakdown: Record<string, number> = {};
  for (const r of results) exitBreakdown[r.exitReason] = (exitBreakdown[r.exitReason] ?? 0) + 1;

  // Max cumulative net-PnL drawdown across the trade sequence.
  let cum = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const r of results) {
    cum += r.netPnl;
    peak = Math.max(peak, cum);
    maxDrawdown = Math.min(maxDrawdown, cum - peak);
  }

  const { name, ...knobs } = variant;
  return {
    variant: name,
    knobs,
    trades,
    replayed,
    wins,
    winRate: replayed ? wins / replayed : 0,
    grossPct,
    netPct,
    avgNetPct: replayed ? netPct / replayed : 0,
    grossPnl,
    netPnl,
    totalFees,
    expectancy: replayed ? netPnl / replayed : 0,
    maxDrawdown,
    exitBreakdown,
    details: results,
  };
}

export type RunBacktestOpts = {
  userId?: string;
  symbol?: string;
  sinceHours?: number; // default 168 (7 days)
  limit?: number; // max trades, default 500
  label?: string;
  variants?: BacktestVariant[]; // default: baseline + early-breakeven + maker
  persist?: boolean; // write summaries to backtest_runs (default true)
};

/**
 * Run the harness: select real futures trades, fetch each one's candle path,
 * replay every variant, aggregate, and (by default) persist one backtest_runs
 * row per variant. Returns the summaries.
 */
export async function runBacktest(
  supabase: SupabaseClient,
  opts: RunBacktestOpts = {},
): Promise<{ summaries: BacktestSummary[]; scope: Record<string, unknown> }> {
  const sinceHours = opts.sinceHours ?? 168;
  const limit = Math.min(opts.limit ?? 500, 2000);
  const sinceIso = new Date(Date.now() - sinceHours * 3600_000).toISOString();

  let q = supabase
    .from("positions")
    .select(
      "id,user_id,symbol,side,entry_price,qty,leverage,take_profit,stop_loss,tp1_price,trail_pct,opened_at,closed_at",
    )
    .eq("instrument", "futures")
    .gte("opened_at", sinceIso)
    .order("opened_at", { ascending: true })
    .limit(limit);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  if (opts.symbol) q = q.eq("symbol", opts.symbol);
  const { data: rows } = await q;
  const positions = (rows ?? []) as BacktestPosition[];

  // Config per user (mirrors runMarkPass cfgRow selection).
  const userIds = Array.from(new Set(positions.map((p) => p.user_id)));
  const { data: cfgRows } = await supabase
    .from("bot_config")
    .select(
      "user_id,trading_style,strategy,min_scalp_score,auto_close_minutes,fee_aware_exits_enabled,minimum_net_profit_to_exit_pct,slippage_buffer_pct,minimum_gross_profit_before_profit_fade_exit_pct,minimum_gross_profit_before_weak_progress_exit_pct,breakeven_arm_roe_pct",
    )
    .in("user_id", userIds.length ? userIds : ["__none__"]);
  const cfgByUser = new Map(
    ((cfgRows ?? []) as Array<BacktestConfig & { user_id: string }>).map(
      (c) => [c.user_id, c as BacktestConfig] as const,
    ),
  );

  const variants: BacktestVariant[] = opts.variants ?? [
    { name: "baseline" },
    { name: "be_arm_2pct", breakevenArmRoePct: 2 },
    { name: "maker_entry", entryFill: "maker" },
    { name: "tp_1_5x", tpScale: 1.5, slScale: 1.5 },
    { name: "edge_gate_0_6", minExpectedEdgePct: 0.6 },
  ];

  // Fetch each position's candle path ONCE, reused across all variants.
  const paths = new Map<string, Candle[]>();
  for (const p of positions) {
    const openedSec = Math.floor(new Date(p.opened_at).getTime() / 1000);
    const cfg: BacktestConfig = cfgByUser.get(p.user_id) ?? {};
    const holdMin = num(cfg.auto_close_minutes ?? 120);
    const fromSec = openedSec - 120;
    const toSec = openedSec + Math.ceil(holdMin * 60) + 300;
    const candles = await fetchPathCandles(p.symbol, fromSec, toSec);
    paths.set(p.id, candles);
  }

  const summaries = variants.map((variant) => {
    // Entry-edge gate: for edge-gate variants, only trades whose target clears
    // the floor are "eligible" — the rest are culled at entry, exactly as the
    // live gate would. eligible.length is the post-gate trade count.
    const eligible = positions.filter(
      (p) => variant.minExpectedEdgePct == null || targetEdgePct(p) >= variant.minExpectedEdgePct,
    );
    const results: ReplayResult[] = [];
    for (const p of eligible) {
      const candles = paths.get(p.id) ?? [];
      const cfg: BacktestConfig = cfgByUser.get(p.user_id) ?? {};
      const r = replayPosition(p, candles, cfg, variant);
      if (r) results.push(r);
    }
    return summarize(variant, results, eligible.length);
  });

  const scope = {
    userId: opts.userId ?? null,
    symbol: opts.symbol ?? null,
    sinceHours,
    trades: positions.length,
  };

  if (opts.persist !== false && summaries.length) {
    await supabase.from("backtest_runs").insert(
      summaries.map((s) => ({
        label: opts.label ?? null,
        variant: s.variant,
        scope,
        knobs: s.knobs,
        trades: s.trades,
        replayed: s.replayed,
        wins: s.wins,
        win_rate: s.winRate,
        gross_pct: s.grossPct,
        net_pct: s.netPct,
        avg_net_pct: s.avgNetPct,
        gross_pnl: s.grossPnl,
        net_pnl: s.netPnl,
        total_fees: s.totalFees,
        expectancy: s.expectancy,
        max_drawdown: s.maxDrawdown,
        exit_breakdown: s.exitBreakdown,
        // Keep details compact to avoid bloating the row.
        details: s.details.slice(0, 200),
      })) as never,
    );
  }

  return { summaries, scope };
}

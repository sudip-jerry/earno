import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { netPnl, computeFees, tradeFee } from "@/lib/fees";


type AnySupa = { rpc: (...a: unknown[]) => Promise<{ data: unknown }> };

async function assertAdmin(supabase: AnySupa, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Forbidden — admin only");
}

type Pos = {
  user_id: string;
  symbol: string;
  side: "long" | "short";
  status: "open" | "closed";
  pnl: number | null;
  pnl_pct: number | null;
  exit_reason: string | null;
  final_exit_reason: string | null;
  tp1_hit: boolean | null;
  tp1_pnl: number | null;
  peak_unrealized_pnl_pct: number | null;
  manual_saved_pnl: number | null;
  manual_missed_pnl: number | null;
  source: string | null;
  opened_at: string;
  closed_at: string | null;
  entry_price: number | null;
  exit_price: number | null;
  qty: number | null;
  confidence_at_entry: number | null;
  estimated_total_fee: number | null;
};



type Cfg = {
  user_id: string;
  mode: string;
  is_running: boolean;
  auto_book: boolean;
  atr_multiplier: number;
  target_multiplier: number;
  max_open_positions: number;
  auto_close_minutes: number;
  risk_per_trade_pct: number;
  min_scalp_score: number;
  allow_short: boolean;
  leverage: number;
  trading_style: string;
  strategy: string | null;
};

export type BucketStats = {
  bucket: "top_10" | "top_30" | "all_50";
  trades: number;
  grossPnl: number;
  estimatedFees: number;
  netPnl: number;
  winRate: number;
  profitFactor: number;
  slCount: number;
  tpCount: number;
  avgHoldMinutes: number;
  avgConfidence: number;
};

export type BucketComparison = {
  strategy: string | null;
  source: "auto" | "all"; // analysis cohort actually used
  totalAutoBooked: number; // raw count of qualifying auto trades today (capped at 50)
  top10: BucketStats;
  top30: BucketStats;
  all50: BucketStats;
};


export type TuneSuggestion = {
  key: string;
  label: string;
  rationale: string;
  patch: Partial<Cfg>;
};

export type DiagnosisStatus = "Healthy" | "Watch" | "Needs Tuning" | "Risk Locked";
export type DiagnosisItem = {
  status: DiagnosisStatus;
  issue: string;
  evidence: string;
  action: string;
};

export type TuningActionKind =
  | "edge-weak"
  | "stop-loss-top"
  | "short-weak-today"
  | "long-weak-today"
  | "losing-symbols"
  | "safer-preset"
  | "loss-cap-hit"
  | "improve-filters"
  | "overtrading";

export type TuningAction = {
  id: string;
  kind: TuningActionKind;
  priority: "High" | "Medium" | "Low";
  issue: string;
  evidence: string;
  action: string;
  affected: string;
  affectedUserIds: string[];
  applyable: boolean;
  applyHint: string;
};

export type DayStats = {
  closed: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  avgPnlPct: number;
  bestTrade: number;
  worstTrade: number;
  longTrades: number;
  longWins: number;
  longPnl: number;
  longWinRate: number;
  shortTrades: number;
  shortWins: number;
  shortPnl: number;
  shortWinRate: number;
  topCloseReason: string | null;
};

export type TesterReport = {
  userId: string;
  email: string | null;
  name: string | null;
  closed: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnl: number;
  avgPnlPct: number;
  longPnl: number;
  shortPnl: number;
  longTrades: number;
  shortTrades: number;
  longWinRate: number;
  shortWinRate: number;
  avgHoldMinutes: number;
  maxDrawdown: number;
  profitFactor: number;
  maxConsecutiveLosses: number;
  settings: Cfg | null;
  today: DayStats;
  buckets: BucketComparison;
  diagnosis: DiagnosisItem[];
  diagnosisStage: "none" | "early" | "ready";
  suggestions: TuneSuggestion[];
};


function emptyDay(): DayStats {
  return {
    closed: 0, open: 0, wins: 0, losses: 0, winRate: 0, pnl: 0, avgPnlPct: 0,
    bestTrade: 0, worstTrade: 0,
    longTrades: 0, longWins: 0, longPnl: 0, longWinRate: 0,
    shortTrades: 0, shortWins: 0, shortPnl: 0, shortWinRate: 0,
    topCloseReason: null,
  };
}

function computeDayStats(positions: Pos[], sinceIso: string): DayStats {
  const since = new Date(sinceIso).getTime();
  const closedToday = positions.filter(
    (t) => t.status === "closed" && t.closed_at && new Date(t.closed_at).getTime() >= since,
  );
  const openedToday = positions.filter((t) => new Date(t.opened_at).getTime() >= since);
  if (closedToday.length === 0 && openedToday.length === 0) return emptyDay();
  const wins = closedToday.filter((t) => netPnl(t) > 0).length;
  const losses = closedToday.filter((t) => netPnl(t) < 0).length;
  const pnl = closedToday.reduce((s, t) => s + netPnl(t), 0);
  const avgPnlPct = closedToday.length
    ? closedToday.reduce((s, t) => s + Number(t.pnl_pct ?? 0), 0) / closedToday.length
    : 0;
  const longs = closedToday.filter((t) => t.side === "long");
  const shorts = closedToday.filter((t) => t.side === "short");
  const longWins = longs.filter((t) => netPnl(t) > 0).length;
  const shortWins = shorts.filter((t) => netPnl(t) > 0).length;
  const pnls = closedToday.map((t) => netPnl(t));
  return {
    closed: closedToday.length,
    open: openedToday.filter((t) => t.status === "open").length,
    wins, losses,
    winRate: closedToday.length ? (wins / closedToday.length) * 100 : 0,
    pnl, avgPnlPct,
    bestTrade: pnls.length ? Math.max(...pnls) : 0,
    worstTrade: pnls.length ? Math.min(...pnls) : 0,
    longTrades: longs.length, longWins,
    longPnl: longs.reduce((s, t) => s + netPnl(t), 0),
    longWinRate: longs.length ? (longWins / longs.length) * 100 : 0,
    shortTrades: shorts.length, shortWins,
    shortPnl: shorts.reduce((s, t) => s + netPnl(t), 0),
    shortWinRate: shorts.length ? (shortWins / shorts.length) * 100 : 0,
    topCloseReason: topMode(closedToday.map((t) => t.exit_reason)),
  };
}

function profitFactor(closed: Pos[]): number {
  let gain = 0,
    loss = 0;
  for (const t of closed) {
    const p = netPnl(t);
    if (p >= 0) gain += p;
    else loss += -p;
  }
  if (loss === 0) return gain > 0 ? Infinity : 0;
  return gain / loss;
}

function maxDrawdown(closed: Pos[]): number {
  // chronological order
  const sorted = [...closed].sort((a, b) =>
    (a.closed_at ?? "").localeCompare(b.closed_at ?? ""),
  );
  let peak = 0,
    cum = 0,
    dd = 0;
  for (const t of sorted) {
    cum += netPnl(t);
    if (cum > peak) peak = cum;
    const draw = peak - cum;
    if (draw > dd) dd = draw;
  }
  return dd;
}

function topMode(arr: (string | null)[]): string | null {
  const m = new Map<string, number>();
  for (const v of arr) {
    if (!v) continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of m) if (n > bestN) ((best = k), (bestN = n));
  return best;
}

function maxConsecLosses(closed: Pos[]): number {
  const sorted = [...closed].sort((a, b) =>
    (a.closed_at ?? "").localeCompare(b.closed_at ?? ""),
  );
  let cur = 0, best = 0;
  for (const t of sorted) {
    if (netPnl(t) < 0) { cur++; if (cur > best) best = cur; }
    else cur = 0;
  }
  return best;
}

function emptyBucket(bucket: BucketStats["bucket"]): BucketStats {
  return {
    bucket,
    trades: 0,
    grossPnl: 0,
    estimatedFees: 0,
    netPnl: 0,
    winRate: 0,
    profitFactor: 0,
    slCount: 0,
    tpCount: 0,
    avgHoldMinutes: 0,
    avgConfidence: 0,
  };
}

function bucketStats(trades: Pos[], bucket: BucketStats["bucket"]): BucketStats {
  if (trades.length === 0) return emptyBucket(bucket);
  const closed = trades.filter((t) => t.status === "closed");
  let gross = 0, fees = 0, net = 0, wins = 0, gain = 0, loss = 0;
  let sl = 0, tp = 0, holdMs = 0, holdN = 0, confSum = 0, confN = 0;
  for (const t of trades) {
    const conf = Number(t.confidence_at_entry ?? 0);
    if (conf > 0) { confSum += conf; confN++; }
  }
  for (const t of closed) {
    const grossPnl = Number(t.pnl ?? 0);
    const fee = Number(t.estimated_total_fee ?? NaN);
    const f = Number.isFinite(fee) ? fee : tradeFee(t);
    const n = grossPnl - f;
    gross += grossPnl; fees += f; net += n;
    if (n > 0) { wins++; gain += n; } else if (n < 0) { loss += -n; }
    const reason = t.final_exit_reason ?? t.exit_reason ?? "";
    if (reason === "stop_loss") sl++;
    if (reason === "take_profit" || t.tp1_hit) tp++;
    if (t.closed_at) {
      holdMs += new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime();
      holdN++;
    }
  }
  return {
    bucket,
    trades: trades.length,
    grossPnl: gross,
    estimatedFees: fees,
    netPnl: net,
    winRate: closed.length ? (wins / closed.length) * 100 : 0,
    profitFactor: loss === 0 ? (gain > 0 ? Infinity : 0) : gain / loss,
    slCount: sl,
    tpCount: tp,
    avgHoldMinutes: holdN ? Math.round(holdMs / holdN / 60_000) : 0,
    avgConfidence: confN ? confSum / confN : 0,
  };
}

const MAX_PAPER_TRADES_PER_DAY = 50;

function computeBuckets(
  trades: Pos[],
  sinceIso: string,
  strategy: string | null,
): BucketComparison {
  const sinceMs = new Date(sinceIso).getTime();
  // Auto-booked trades opened today, hard-capped at 50 per spec.
  const isManual = (t: Pos) =>
    t.source === "manual" ||
    (t.final_exit_reason ?? "").startsWith("manual") ||
    (t.exit_reason ?? "").startsWith("manual");
  const todayAuto = trades.filter(
    (t) => new Date(t.opened_at).getTime() >= sinceMs && !isManual(t),
  );
  // Highest-confidence first; tie-breaker by earliest opened_at.
  const ranked = [...todayAuto].sort((a, b) => {
    const ca = Number(a.confidence_at_entry ?? 0);
    const cb = Number(b.confidence_at_entry ?? 0);
    if (cb !== ca) return cb - ca;
    return a.opened_at.localeCompare(b.opened_at);
  });
  const capped = ranked.slice(0, MAX_PAPER_TRADES_PER_DAY);
  return {
    strategy,
    source: "auto",
    totalAutoBooked: capped.length,
    top10: bucketStats(capped.slice(0, 10), "top_10"),
    top30: bucketStats(capped.slice(0, 30), "top_30"),
    all50: bucketStats(capped, "all_50"),
  };
}


function buildDiagnosis(
  r: Omit<TesterReport, "diagnosis" | "diagnosisStage" | "suggestions">,
): { diagnosis: DiagnosisItem[]; suggestions: TuneSuggestion[] } {
  const out: DiagnosisItem[] = [];
  const sugg: TuneSuggestion[] = [];
  const s = r.settings;
  const today = r.today;
  const pf = r.profitFactor;
  const fmtMoney = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}`;
  const pfText = Number.isFinite(pf) ? pf.toFixed(2) : "∞";

  // 1. Risk Locked — consecutive losses streak
  if (r.maxConsecutiveLosses >= 5) {
    out.push({
      status: "Risk Locked",
      issue: "Loss streak protection should engage.",
      evidence: `Max consecutive losses: ${r.maxConsecutiveLosses}. Today PnL ${fmtMoney(today.pnl)} over ${today.closed} trades.`,
      action: "Pause auto-book, review recent stop-outs and confirmation rules.",
    });
  }

  // 2. Stop-loss dominated losing day
  if (today.closed >= 3 && today.pnl < 0 && today.topCloseReason === "stop_loss") {
    out.push({
      status: "Needs Tuning",
      issue: "Stop losses are driving today's loss.",
      evidence: `Today PnL ${fmtMoney(today.pnl)}, top exit reason: stop_loss (${today.losses}/${today.closed} losses).`,
      action: "Tighten entry confirmation or reduce max trades per day.",
    });
    if (s && s.min_scalp_score < 80) {
      sugg.push({
        key: "score-up-sl",
        label: "Raise minimum confidence",
        rationale: "Stop-outs dominate — filter weaker entries.",
        patch: { min_scalp_score: Math.min(85, s.min_scalp_score + 5) },
      });
    }
  }

  // 3. Directional underperformance (today)
  const longAvg = today.longTrades ? today.longPnl / today.longTrades : 0;
  const shortAvg = today.shortTrades ? today.shortPnl / today.shortTrades : 0;
  if (today.shortTrades >= 3 && today.shortPnl < 0 && today.shortPnl <= today.longPnl - Math.abs(today.longPnl) * 0.5) {
    out.push({
      status: "Watch",
      issue: "Shorts are underperforming today.",
      evidence: `Short PnL ${fmtMoney(today.shortPnl)} (win ${today.shortWinRate.toFixed(0)}%) vs long ${fmtMoney(today.longPnl)} (win ${today.longWinRate.toFixed(0)}%).`,
      action: "Raise short confidence threshold or disable short auto-book temporarily.",
    });
    if (s?.allow_short) {
      sugg.push({
        key: "disable-short",
        label: "Disable short auto-book",
        rationale: "Short side is bleeding today.",
        patch: { allow_short: false },
      });
    }
  } else if (today.longTrades >= 3 && today.longPnl < 0 && today.longPnl <= today.shortPnl - Math.abs(today.shortPnl) * 0.5) {
    out.push({
      status: "Watch",
      issue: "Longs are underperforming today.",
      evidence: `Long PnL ${fmtMoney(today.longPnl)} (win ${today.longWinRate.toFixed(0)}%) vs short ${fmtMoney(today.shortPnl)} (win ${today.shortWinRate.toFixed(0)}%).`,
      action: "Raise long confidence threshold or pause long auto-book temporarily.",
    });
  }

  // 4. Lifetime directional underperformance
  if (r.longTrades >= 10 && r.shortTrades >= 10) {
    if (r.longWinRate < 40 && r.shortWinRate > r.longWinRate + 15) {
      out.push({
        status: "Watch",
        issue: "Long side weak over lifetime sample.",
        evidence: `Long win ${r.longWinRate.toFixed(0)}% (${r.longTrades} trades, ${fmtMoney(r.longPnl)}) vs short ${r.shortWinRate.toFixed(0)}% (${fmtMoney(r.shortPnl)}).`,
        action: "Tighten long entry filter or reduce long position sizing.",
      });
    } else if (r.shortWinRate < 40 && r.longWinRate > r.shortWinRate + 15) {
      out.push({
        status: "Watch",
        issue: "Short side weak over lifetime sample.",
        evidence: `Short win ${r.shortWinRate.toFixed(0)}% (${r.shortTrades} trades, ${fmtMoney(r.shortPnl)}) vs long ${r.longWinRate.toFixed(0)}% (${fmtMoney(r.longPnl)}).`,
        action: "Tighten short entry filter or disable short auto-book.",
      });
    }
  }

  // 5. Profit factor below 1
  if (r.closed >= 20 && pf < 1) {
    out.push({
      status: "Needs Tuning",
      issue: "Profit factor is below 1.",
      evidence: `Profit factor ${pfText}, lifetime PnL ${fmtMoney(r.realizedPnl)} across ${r.closed} trades.`,
      action: "Reduce trade frequency and review symbol allowlist.",
    });
    if (s && s.min_scalp_score < 75) {
      sugg.push({
        key: "score-up-pf",
        label: "Raise minimum confidence",
        rationale: "Profit factor < 1 — filter weaker signals.",
        patch: { min_scalp_score: Math.min(80, s.min_scalp_score + 10) },
      });
    }
  } else if (r.closed >= 20 && pf < 1.1) {
    out.push({
      status: "Watch",
      issue: "Profit factor is marginal.",
      evidence: `Profit factor ${pfText} on ${r.closed} trades. Lifetime PnL ${fmtMoney(r.realizedPnl)}.`,
      action: "Monitor closely; consider tightening entry score by +5.",
    });
  }

  // 6. Drawdown disproportionate to PnL
  if (r.closed >= 20 && r.realizedPnl > 0 && r.maxDrawdown > r.realizedPnl * 1.5) {
    out.push({
      status: "Watch",
      issue: "Drawdown is large relative to net PnL.",
      evidence: `Max drawdown ${fmtMoney(-r.maxDrawdown)} vs realized ${fmtMoney(r.realizedPnl)}.`,
      action: "Reduce risk per trade or lower max open positions.",
    });
    if (s && s.risk_per_trade_pct > 0.75) {
      sugg.push({
        key: "risk-dn",
        label: "Reduce risk per trade",
        rationale: "Drawdown is large relative to net PnL.",
        patch: { risk_per_trade_pct: Math.max(0.5, Number(s.risk_per_trade_pct) - 0.25) },
      });
    }
  }

  // 7. Overtrading with negative day
  if (s && today.closed >= s.max_open_positions * 4 && today.pnl < 0) {
    out.push({
      status: "Needs Tuning",
      issue: "High trade count with negative day.",
      evidence: `${today.closed} trades today, PnL ${fmtMoney(today.pnl)}, top exit ${today.topCloseReason ?? "n/a"}.`,
      action: "Lower max trades per day or raise minimum confidence.",
    });
  }

  // Default Healthy gating
  const longNegStrong = r.longTrades >= 10 && r.longPnl < 0 && Math.abs(r.longPnl) > Math.abs(r.realizedPnl) * 0.5;
  const shortNegStrong = r.shortTrades >= 10 && r.shortPnl < 0 && Math.abs(r.shortPnl) > Math.abs(r.realizedPnl) * 0.5;
  void longAvg; void shortAvg;
  if (out.length === 0) {
    if (pf > 1.1 && r.realizedPnl > 0 && !longNegStrong && !shortNegStrong) {
      out.push({
        status: "Healthy",
        issue: "Settings look balanced.",
        evidence: `Profit factor ${pfText}, lifetime PnL ${fmtMoney(r.realizedPnl)}, long ${fmtMoney(r.longPnl)} / short ${fmtMoney(r.shortPnl)}.`,
        action: "Continue monitoring; no change required.",
      });
    } else {
      out.push({
        status: "Watch",
        issue: "Mixed performance signals.",
        evidence: `Profit factor ${pfText}, lifetime PnL ${fmtMoney(r.realizedPnl)}, today ${fmtMoney(today.pnl)} over ${today.closed} trades.`,
        action: "Keep current settings under observation before tuning.",
      });
    }
  }

  return { diagnosis: out, suggestions: sugg };
}

export const getBetaReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: profiles }, { data: positions }, { data: cfgs }, { data: skips }] =
      await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("id,email,display_name,created_at"),
        supabaseAdmin
          .from("positions")
          .select(
            "user_id,symbol,side,status,pnl,pnl_pct,exit_reason,final_exit_reason,tp1_hit,tp1_pnl,peak_unrealized_pnl_pct,manual_saved_pnl,manual_missed_pnl,source,opened_at,closed_at,entry_price,exit_price,qty,confidence_at_entry,estimated_total_fee",
          )
          .eq("mode", "paper")
          .order("opened_at", { ascending: false })
          .limit(5000),
        supabaseAdmin.from("bot_config").select("*"),
        supabaseAdmin
          .from("bot_events")
          .select("user_id,message,meta,created_at")
          .eq("level", "signal")
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);

    const allPos = (positions ?? []) as Pos[];
    const cfgMap = new Map<string, Cfg>(((cfgs ?? []) as Cfg[]).map((c) => [c.user_id, c]));
    const byUser = new Map<string, Pos[]>();
    for (const p of allPos) {
      const a = byUser.get(p.user_id) ?? [];
      a.push(p);
      byUser.set(p.user_id, a);
    }

    const sinceIso = (() => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    })();

    const testers: TesterReport[] = [];
    for (const p of profiles ?? []) {
      const trades = byUser.get(p.id) ?? [];
      if (trades.length === 0 && !cfgMap.get(p.id)?.is_running) continue;
      const closed = trades.filter((t) => t.status === "closed");
      const wins = closed.filter((t) => netPnl(t) > 0).length;
      const losses = closed.filter((t) => netPnl(t) < 0).length;
      const realizedPnl = closed.reduce((s, t) => s + netPnl(t), 0);
      const avgPnlPct =
        closed.length === 0
          ? 0
          : closed.reduce((s, t) => s + Number(t.pnl_pct ?? 0), 0) / closed.length;
      const longs = closed.filter((t) => t.side === "long");
      const shorts = closed.filter((t) => t.side === "short");
      const longPnl = longs.reduce((s, t) => s + netPnl(t), 0);
      const shortPnl = shorts.reduce((s, t) => s + netPnl(t), 0);
      const longWins = longs.filter((t) => netPnl(t) > 0).length;
      const shortWins = shorts.filter((t) => netPnl(t) > 0).length;
      const avgHoldMs =
        closed.length === 0
          ? 0
          : closed.reduce((s, t) => {
              if (!t.closed_at) return s;
              return s + (new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime());
            }, 0) / closed.length;

      const base = {
        userId: p.id,
        email: p.email ?? null,
        name: p.display_name ?? null,
        closed: closed.length,
        wins,
        losses,
        winRate: closed.length ? (wins / closed.length) * 100 : 0,
        realizedPnl,
        avgPnlPct,
        longPnl,
        shortPnl,
        longTrades: longs.length,
        shortTrades: shorts.length,
        longWinRate: longs.length ? (longWins / longs.length) * 100 : 0,
        shortWinRate: shorts.length ? (shortWins / shorts.length) * 100 : 0,
        avgHoldMinutes: Math.round(avgHoldMs / 60_000),
        maxDrawdown: maxDrawdown(closed),
        profitFactor: profitFactor(closed),
        maxConsecutiveLosses: maxConsecLosses(closed),
        settings: cfgMap.get(p.id) ?? null,
        today: computeDayStats(trades, sinceIso),
        buckets: computeBuckets(trades, sinceIso, cfgMap.get(p.id)?.strategy ?? null),
      };

      const stage: TesterReport["diagnosisStage"] =
        closed.length < 30 ? "none" : closed.length <= 50 ? "early" : "ready";
      const { diagnosis, suggestions } =
        stage === "ready" ? buildDiagnosis(base) : { diagnosis: [], suggestions: [] };
      testers.push({ ...base, diagnosisStage: stage, diagnosis, suggestions });
    }


    testers.sort((a, b) => b.realizedPnl - a.realizedPnl);

    // Global aggregates
    const closedAll = allPos.filter((t) => t.status === "closed");
    const totalRealized = closedAll.reduce((s, t) => s + netPnl(t), 0);
    const longsAll = closedAll.filter((t) => t.side === "long");
    const shortsAll = closedAll.filter((t) => t.side === "short");
    const longPnlAll = longsAll.reduce((s, t) => s + netPnl(t), 0);
    const shortPnlAll = shortsAll.reduce((s, t) => s + netPnl(t), 0);

    // ----- Exit attribution: manual vs bot, by exit reason -----
    const exitAttribution = (() => {
      const sum = (rows: Pos[]) => rows.reduce((s, t) => s + netPnl(t), 0);
      const isManual = (t: Pos) =>
        t.final_exit_reason === "manual" ||
        (t.exit_reason ?? "").startsWith("manual") ||
        t.source === "manual";
      const manualTrades = closedAll.filter(isManual);
      const botTrades = closedAll.filter((t) => !isManual(t));
      const byReason = (reason: string) =>
        botTrades.filter((t) => (t.final_exit_reason ?? t.exit_reason) === reason);
      const tp1Hits = closedAll.filter((t) => t.tp1_hit === true).length;
      const finalTpHits = closedAll.filter((t) => (t.final_exit_reason ?? t.exit_reason) === "take_profit").length;
      const slAfterPositive = closedAll.filter(
        (t) =>
          netPnl(t) < 0 &&
          Number(t.peak_unrealized_pnl_pct ?? 0) > 0.3,
      ).length;
      return {
        total_pnl: sum(closedAll),
        bot_exit_pnl: sum(botTrades),
        manual_exit_pnl: sum(manualTrades),
        manual_saved_pnl: closedAll.reduce((s, t) => s + Number(t.manual_saved_pnl ?? 0), 0),
        manual_missed_pnl: closedAll.reduce((s, t) => s + Number(t.manual_missed_pnl ?? 0), 0),
        take_profit_pnl: sum(byReason("take_profit")),
        tp1_pnl: closedAll.reduce((s, t) => s + Number(t.tp1_pnl ?? 0), 0),
        stop_loss_pnl: sum(byReason("stop_loss")),
        time_exit_pnl: sum(byReason("time_exit")),
        trailing_exit_pnl: sum(byReason("trailing_exit")),
        profit_fade_exit_pnl: sum(byReason("profit_fade_exit")),
        breakeven_exit_pnl: sum(byReason("breakeven_exit")),
        manual_exit_count: manualTrades.length,
        bot_exit_count: botTrades.length,
        tp1_hit_rate: closedAll.length ? (tp1Hits / closedAll.length) * 100 : 0,
        final_tp_hit_rate: closedAll.length ? (finalTpHits / closedAll.length) * 100 : 0,
        sl_after_positive_count: slAfterPositive,
      };
    })();

    const bySymbol = new Map<string, number>();
    for (const t of closedAll) {
      bySymbol.set(t.symbol, (bySymbol.get(t.symbol) ?? 0) + netPnl(t));
    }
    let bestPair: string | null = null,
      worstPair: string | null = null,
      bestPairPnl = -Infinity,
      worstPairPnl = Infinity;
    for (const [s, p] of bySymbol) {
      if (p > bestPairPnl) ((bestPair = s), (bestPairPnl = p));
      if (p < worstPairPnl) ((worstPair = s), (worstPairPnl = p));
    }

    const skipReasons = (skips ?? [])
      .map((e) => {
        const m = e.message ?? "";
        const idx = m.indexOf("skip");
        if (idx < 0) return null;
        return m.slice(idx, idx + 80);
      })
      .filter(Boolean) as string[];

    const todayGlobal = computeDayStats(allPos, sinceIso);
    const todayBySymbol = new Map<string, number>();
    const todayClosed = allPos.filter(
      (t) => t.status === "closed" && t.closed_at && new Date(t.closed_at).getTime() >= new Date(sinceIso).getTime(),
    );
    for (const t of todayClosed) {
      todayBySymbol.set(t.symbol, (todayBySymbol.get(t.symbol) ?? 0) + netPnl(t));
    }
    let todayBestPair: string | null = null,
      todayWorstPair: string | null = null,
      tbp = -Infinity,
      twp = Infinity;
    for (const [s, p] of todayBySymbol) {
      if (p > tbp) ((todayBestPair = s), (tbp = p));
      if (p < twp) ((todayWorstPair = s), (twp = p));
    }
    const todayActiveTesters = testers.filter(
      (t) => t.today.closed > 0 || t.today.open > 0,
    ).length;

    // ===== Tuning Actions =====
    const tuningActions: TuningAction[] = [];
    const avgPF =
      testers.length === 0
        ? 0
        : testers
            .map((t) => (Number.isFinite(t.profitFactor) ? t.profitFactor : 0))
            .reduce((a, b) => a + b, 0) / testers.length;

    // Rule 1 — global PF weak
    if (closedAll.length >= 30 && avgPF < 1.1) {
      tuningActions.push({
        id: "edge-weak",
        kind: "edge-weak",
        priority: "High",
        issue: "Edge is weak. Do not switch to live.",
        evidence: `Average profit factor ${avgPF.toFixed(2)} across ${testers.length} testers, ${closedAll.length} closed trades.`,
        action: "Keep cohort on paper. Tighten entry filters before promoting any tester.",
        affected: "All testers",
        affectedUserIds: testers.map((t) => t.userId),
        applyable: true,
        applyHint: "Raises auto-book confidence threshold by +5 for every tester (max 95).",
      });
    }

    // Rule 2 — stop_loss dominant
    const topReason = topMode(closedAll.map((t) => t.exit_reason));
    if (topReason === "stop_loss" && closedAll.length >= 20) {
      const losersList = testers.filter(
        (t) => t.today.topCloseReason === "stop_loss" && t.today.closed >= 3,
      );
      const losers = losersList.map((t) => t.email ?? t.userId.slice(0, 6)).slice(0, 4);
      tuningActions.push({
        id: "stop-loss-top",
        kind: "stop-loss-top",
        priority: "High",
        issue: "Stop-loss is the top exit reason.",
        evidence: `Top close reason across ${closedAll.length} trades is stop_loss. ${losersList.length} testers stopped out repeatedly today.`,
        action: "Require stricter entry confirmation (raise minimum confidence or add VWAP/EMA filter).",
        affected: losers.length ? losers.join(", ") : "Cohort-wide",
        affectedUserIds: (losersList.length ? losersList : testers).map((t) => t.userId),
        applyable: true,
        applyHint: "Raises auto-book confidence threshold by +5 for affected testers.",
      });
    }

    // Rule 3 — directional underperformance today
    if (todayGlobal.closed >= 5) {
      if (todayGlobal.shortPnl < 0 && todayGlobal.shortTrades >= 3 && todayGlobal.shortPnl < todayGlobal.longPnl) {
        const shortList = testers.filter((t) => t.today.shortPnl < 0 && t.today.shortTrades >= 1);
        const users = shortList.map((t) => t.email ?? t.userId.slice(0, 6)).slice(0, 4);
        tuningActions.push({
          id: "short-weak-today",
          kind: "short-weak-today",
          priority: "Medium",
          issue: "Shorts are bleeding today.",
          evidence: `Short PnL ${todayGlobal.shortPnl.toFixed(2)} over ${todayGlobal.shortTrades} trades vs long ${todayGlobal.longPnl.toFixed(2)}.`,
          action: "Tighten short entry threshold or disable short auto-book until session recovers.",
          affected: users.length ? users.join(", ") : "Cohort-wide",
          affectedUserIds: (shortList.length ? shortList : testers).map((t) => t.userId),
          applyable: true,
          applyHint: "Disables short auto-book (allow_short = off) for affected testers.",
        });
      }
      if (todayGlobal.longPnl < 0 && todayGlobal.longTrades >= 3 && todayGlobal.longPnl < todayGlobal.shortPnl) {
        const longList = testers.filter((t) => t.today.longPnl < 0 && t.today.longTrades >= 1);
        const users = longList.map((t) => t.email ?? t.userId.slice(0, 6)).slice(0, 4);
        tuningActions.push({
          id: "long-weak-today",
          kind: "long-weak-today",
          priority: "Medium",
          issue: "Longs are bleeding today.",
          evidence: `Long PnL ${todayGlobal.longPnl.toFixed(2)} over ${todayGlobal.longTrades} trades vs short ${todayGlobal.shortPnl.toFixed(2)}.`,
          action: "Tighten long entry threshold or pause long auto-book until session recovers.",
          affected: users.length ? users.join(", ") : "Cohort-wide",
          affectedUserIds: (longList.length ? longList : testers).map((t) => t.userId),
          applyable: true,
          applyHint: "Disables long auto-book (allow_long = off) for affected testers.",
        });
      }
    }

    // Rule 4 — losing symbols (5+ trades, negative)
    const symbolAgg = new Map<string, { trades: number; pnl: number }>();
    for (const t of closedAll) {
      const cur = symbolAgg.get(t.symbol) ?? { trades: 0, pnl: 0 };
      cur.trades += 1;
      cur.pnl += netPnl(t);
      symbolAgg.set(t.symbol, cur);
    }
    const losingSymbols = [...symbolAgg.entries()]
      .filter(([, v]) => v.trades >= 5 && v.pnl < 0)
      .sort((a, b) => a[1].pnl - b[1].pnl)
      .slice(0, 5);
    if (losingSymbols.length > 0) {
      tuningActions.push({
        id: "losing-symbols",
        kind: "losing-symbols",
        priority: "Medium",
        issue: "Symbols repeatedly losing money.",
        evidence: losingSymbols
          .map(([s, v]) => `${s}: ${v.trades} trades, ${v.pnl >= 0 ? "+" : "−"}$${Math.abs(v.pnl).toFixed(2)}`)
          .join(" · "),
        action: "Make the dynamic auto-blacklist trigger sooner and hold longer per symbol.",
        affected: `${losingSymbols.length} symbols · cohort-wide`,
        affectedUserIds: testers.map((t) => t.userId),
        applyable: true,
        applyHint: "Lowers symbol_blacklist_threshold to ≤ 2 losses/24h and extends SL cooldown to ≥ 6h. Auto-rolls off; no static list.",
      });
    }

    // Rule 5 — testers with negative PnL and PF < 1
    const safer = testers.filter(
      (t) => t.closed >= 20 && t.realizedPnl < 0 && Number.isFinite(t.profitFactor) && t.profitFactor < 1,
    );
    if (safer.length > 0) {
      tuningActions.push({
        id: "safer-preset",
        kind: "safer-preset",
        priority: "High",
        issue: "Testers running unprofitable config.",
        evidence: safer
          .slice(0, 4)
          .map((t) => `${t.email ?? t.userId.slice(0, 6)}: PF ${t.profitFactor.toFixed(2)}, PnL ${t.realizedPnl >= 0 ? "+" : "−"}$${Math.abs(t.realizedPnl).toFixed(2)}`)
          .join(" · "),
        action: "Apply safer config preset (lower risk per trade, raise min confidence, cap trades/day).",
        affected: safer.map((t) => t.email ?? t.userId.slice(0, 6)).join(", "),
        affectedUserIds: safer.map((t) => t.userId),
        applyable: true,
        applyHint: "Halves risk-per-trade, +10 confidence threshold, caps max trades/day at 8.",
      });
    }

    // Rule 6 — daily loss cap likely hit (Risk Locked diagnosis)
    const lockedTesters = testers.filter((t) =>
      t.diagnosis.some((d) => d.status === "Risk Locked"),
    );
    if (lockedTesters.length > 0) {
      tuningActions.push({
        id: "loss-cap-hit",
        kind: "loss-cap-hit",
        priority: "High",
        issue: "Daily loss protection engaged for testers.",
        evidence: lockedTesters
          .slice(0, 4)
          .map((t) => `${t.email ?? t.userId.slice(0, 6)}: streak ${t.maxConsecutiveLosses}, today ${t.today.pnl >= 0 ? "+" : "−"}$${Math.abs(t.today.pnl).toFixed(2)}`)
          .join(" · "),
        action: "Reduce max trades per day or extend cooldown after losses.",
        affected: lockedTesters.map((t) => t.email ?? t.userId.slice(0, 6)).join(", "),
        affectedUserIds: lockedTesters.map((t) => t.userId),
        applyable: true,
        applyHint: "Sets cooldown ≥ 30 min and caps max trades/day at 6.",
      });
    }

    // Rule 7 — near 50% win rate but positive PnL
    const filterCandidates = testers.filter(
      (t) =>
        t.closed >= 30 &&
        t.realizedPnl > 0 &&
        t.winRate >= 45 &&
        t.winRate <= 55,
    );
    if (filterCandidates.length > 0) {
      tuningActions.push({
        id: "improve-filters",
        kind: "improve-filters",
        priority: "Low",
        issue: "Win rate near coin-flip but PnL positive.",
        evidence: filterCandidates
          .slice(0, 4)
          .map((t) => `${t.email ?? t.userId.slice(0, 6)}: win ${t.winRate.toFixed(0)}%, PnL +$${t.realizedPnl.toFixed(2)}`)
          .join(" · "),
        action: "Preserve current TP/SL; improve entry filters to lift win rate without shrinking R:R.",
        affected: filterCandidates.map((t) => t.email ?? t.userId.slice(0, 6)).join(", "),
        affectedUserIds: filterCandidates.map((t) => t.userId),
        applyable: true,
        applyHint: "Nudges auto-book confidence threshold by +3 for affected testers.",
      });
    }

    // Rule 8 — overtrading (today closed >> max_open_positions)
    const overtraders = testers.filter(
      (t) => t.settings && t.today.closed >= Math.max(8, t.settings.max_open_positions * 4),
    );
    if (overtraders.length > 0) {
      tuningActions.push({
        id: "overtrading",
        kind: "overtrading",
        priority: "Medium",
        issue: "Trade frequency is very high today.",
        evidence: overtraders
          .slice(0, 4)
          .map((t) => `${t.email ?? t.userId.slice(0, 6)}: ${t.today.closed} trades, PnL ${t.today.pnl >= 0 ? "+" : "−"}$${Math.abs(t.today.pnl).toFixed(2)}`)
          .join(" · "),
        action: "Reduce auto-book frequency: raise min confidence or lower max trades per day.",
        affected: overtraders.map((t) => t.email ?? t.userId.slice(0, 6)).join(", "),
        affectedUserIds: overtraders.map((t) => t.userId),
        applyable: true,
        applyHint: "+5 confidence threshold and caps max trades/day at 6.",
      });
    }


    // Sort by priority
    const prioRank = { High: 0, Medium: 1, Low: 2 } as const;
    tuningActions.sort((a, b) => prioRank[a.priority] - prioRank[b.priority]);

    return {
      testers,
      tuningActions,
      summary: {
        activeTesters: testers.filter((t) => t.settings?.is_running).length,
        totalTesters: testers.length,
        totalTrades: allPos.length,
        totalClosed: closedAll.length,
        totalRealized,
        avgWinRate:
          testers.length === 0
            ? 0
            : testers.reduce((s, t) => s + t.winRate, 0) / testers.length,
        avgProfitFactor:
          testers.length === 0
            ? 0
            : testers
                .map((t) => (Number.isFinite(t.profitFactor) ? t.profitFactor : 0))
                .reduce((s, n) => s + n, 0) / testers.length,
        avgMaxDrawdown:
          testers.length === 0
            ? 0
            : testers.reduce((s, t) => s + t.maxDrawdown, 0) / testers.length,
        bestTester: testers[0]
          ? { email: testers[0].email, pnl: testers[0].realizedPnl }
          : null,
        weakestTester:
          testers.length > 1
            ? {
                email: testers[testers.length - 1].email,
                pnl: testers[testers.length - 1].realizedPnl,
              }
            : null,
        bestDirection:
          longPnlAll === shortPnlAll
            ? null
            : longPnlAll > shortPnlAll
              ? "long"
              : "short",
        worstDirection:
          longPnlAll === shortPnlAll
            ? null
            : longPnlAll < shortPnlAll
              ? "long"
              : "short",
        longPnl: longPnlAll,
        shortPnl: shortPnlAll,
        bestPair,
        worstPair,
        topCloseReason: topMode(closedAll.map((t) => t.exit_reason)),
        topSkipReason: topMode(skipReasons),
        today: todayGlobal,
        todayActiveTesters,
        todayBestPair,
        todayWorstPair,
        todaySinceIso: sinceIso,
        exitAttribution,
      },
    };
  });


const tunePatchSchema = z.object({
  userId: z.string().uuid(),
  patch: z
    .object({
      atr_multiplier: z.number().min(0.5).max(5).optional(),
      target_multiplier: z.number().min(0.5).max(5).optional(),
      max_open_positions: z.number().int().min(1).max(10).optional(),
      auto_close_minutes: z.number().int().min(5).max(720).optional(),
      risk_per_trade_pct: z.number().min(0.1).max(10).optional(),
      min_scalp_score: z.number().int().min(0).max(100).optional(),
      allow_short: z.boolean().optional(),
      // NOTE: strategy and trading_style are deliberately NOT tuneable here.
      // They are identity-level choices and must not be auto-flipped.
    })
    .strict()
    .refine((p) => Object.keys(p).length > 0, "empty patch"),
});

// Derive an auto_close_minutes value that gives a TP target time to print.
// Heuristic: typical 5m scalp ATR ~ 0.4%/candle. Time-to-TP scales with
// (atr_multiplier * target_multiplier). 30 min per "unit" of expected
// movement, clamped to [30, 180].
function alignedAutoCloseMinutes(atrMult: number, targetMult: number): number {
  const minutes = Math.round(atrMult * targetMult * 30);
  return Math.max(30, Math.min(180, minutes));
}

export const adminApplyTune = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => tunePatchSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const patch: Record<string, unknown> = { ...data.patch };

    // Auto-align auto_close_minutes whenever atr_multiplier or
    // target_multiplier changes and the admin hasn't set auto_close
    // explicitly in the same patch. Stops TP from being starved by a
    // too-short time exit.
    if (
      (patch.atr_multiplier !== undefined || patch.target_multiplier !== undefined) &&
      patch.auto_close_minutes === undefined
    ) {
      const { data: cur } = await supabaseAdmin
        .from("bot_config")
        .select("atr_multiplier,target_multiplier")
        .eq("user_id", data.userId)
        .eq("mode", "paper")
        .maybeSingle();
      const atrMult = Number(patch.atr_multiplier ?? cur?.atr_multiplier ?? 2);
      const tgtMult = Number(patch.target_multiplier ?? cur?.target_multiplier ?? 2);
      patch.auto_close_minutes = alignedAutoCloseMinutes(atrMult, tgtMult);
    }

    // Only touch paper-mode config
    const { error } = await supabaseAdmin
      .from("bot_config")
      .update(patch as never)
      .eq("user_id", data.userId)
      .eq("mode", "paper");
    if (error) { console.error("DB error", error); throw new Error("Operation failed. Please try again."); }
    await supabaseAdmin.from("bot_events").insert({
      user_id: data.userId,
      level: "info",
      message: `Admin applied tune: ${Object.keys(patch).join(", ")}`,
      meta: patch as never,
    });
    return { ok: true };
  });

// ---------- Apply Tuning Action (bulk per-user) ----------

const tuningKinds = [
  "edge-weak",
  "stop-loss-top",
  "short-weak-today",
  "long-weak-today",
  "losing-symbols",
  "safer-preset",
  "loss-cap-hit",
  "improve-filters",
  "overtrading",
] as const;

const applyActionSchema = z.object({
  kind: z.enum(tuningKinds),
  userIds: z.array(z.string().uuid()).min(1).max(200),
});

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

type CfgRow = {
  user_id: string;
  auto_book_confidence_threshold: number | null;
  risk_per_trade_pct: number | null;
  max_trades_per_day: number | null;
  cooldown_minutes: number | null;
  allow_short: boolean | null;
  allow_long: boolean | null;
  symbol_blacklist_threshold: number | null;
  symbol_sl_cooldown_minutes: number | null;
};

function buildPatch(kind: typeof tuningKinds[number], cur: CfgRow): Record<string, unknown> | null {
  const conf = cur.auto_book_confidence_threshold ?? 70;
  switch (kind) {
    case "edge-weak":
    case "stop-loss-top":
      return { auto_book_confidence_threshold: clamp(conf + 5, 50, 95) };
    case "improve-filters":
      return { auto_book_confidence_threshold: clamp(conf + 3, 50, 95) };
    case "short-weak-today":
      return { allow_short: false };
    case "long-weak-today":
      return { allow_long: false };
    case "losing-symbols":
      // Tighten the dynamic auto-blacklist (no static list).
      return {
        symbol_blacklist_threshold: Math.min(cur.symbol_blacklist_threshold ?? 3, 2),
        symbol_sl_cooldown_minutes: Math.max(cur.symbol_sl_cooldown_minutes ?? 180, 360),
      };
    case "safer-preset":
      return {
        risk_per_trade_pct: clamp(Number(cur.risk_per_trade_pct ?? 1) * 0.5, 0.25, 10),
        auto_book_confidence_threshold: clamp(conf + 10, 50, 95),
        max_trades_per_day: Math.min(cur.max_trades_per_day ?? 10, 50),
      };
    case "loss-cap-hit":
      return {
        cooldown_minutes: Math.max(cur.cooldown_minutes ?? 0, 30),
        max_trades_per_day: Math.min(cur.max_trades_per_day ?? 10, 50),
      };
    case "overtrading":
      return {
        auto_book_confidence_threshold: clamp(conf + 5, 50, 95),
        max_trades_per_day: Math.min(cur.max_trades_per_day ?? 10, 50),
      };
    default:
      return null;
  }
}

export const adminApplyTuningAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => applyActionSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: cfgs, error: e1 } = await supabaseAdmin
      .from("bot_config")
      .select(
        "user_id, auto_book_confidence_threshold, risk_per_trade_pct, max_trades_per_day, cooldown_minutes, allow_short, allow_long, symbol_blacklist_threshold, symbol_sl_cooldown_minutes",
      )
      .in("user_id", data.userIds)
      .eq("mode", "paper");
    if (e1) throw new Error(e1.message);

    // Min-sample guard: only tune users with >=100 closed paper trades.
    // Prevents config thrashing from small-sample noise.
    const MIN_CLOSED_TRADES = 100;
    const { data: closedRows } = await supabaseAdmin
      .from("positions")
      .select("user_id")
      .in("user_id", data.userIds)
      .eq("mode", "paper")
      .eq("status", "closed");
    const closedByUser = new Map<string, number>();
    for (const r of (closedRows ?? []) as { user_id: string }[]) {
      closedByUser.set(r.user_id, (closedByUser.get(r.user_id) ?? 0) + 1);
    }

    let updated = 0;
    let insufficientSample = 0;
    let thrashSkipped = 0;
    const errors: string[] = [];
    // 24h per-field anti-thrash: load recent audit rows for the cohort once.
    const cooldownSince = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: recentAudit } = await supabaseAdmin
      .from("bot_config_audit")
      .select("user_id, field")
      .in("user_id", data.userIds)
      .gte("changed_at", cooldownSince);
    const recentByUser = new Map<string, Set<string>>();
    for (const r of (recentAudit ?? []) as Array<{ user_id: string; field: string }>) {
      const s = recentByUser.get(r.user_id) ?? new Set<string>();
      s.add(r.field);
      recentByUser.set(r.user_id, s);
    }
    for (const cfg of (cfgs ?? []) as CfgRow[]) {
      if ((closedByUser.get(cfg.user_id) ?? 0) < MIN_CLOSED_TRADES) {
        insufficientSample += 1;
        continue;
      }
      const patch = buildPatch(data.kind, cfg);
      if (!patch || Object.keys(patch).length === 0) continue;
      // Safety: never auto-flip strategy or trading_style.
      delete (patch as Record<string, unknown>).strategy;
      delete (patch as Record<string, unknown>).trading_style;
      // Drop fields touched by any actor in the last 24h.
      const recent = recentByUser.get(cfg.user_id);
      if (recent) {
        for (const f of Object.keys(patch)) {
          if (recent.has(f)) delete (patch as Record<string, unknown>)[f];
        }
      }
      if (Object.keys(patch).length === 0) {
        thrashSkipped += 1;
        continue;
      }
      const { error: e2 } = await supabaseAdmin
        .from("bot_config")
        .update(patch as never)
        .eq("user_id", cfg.user_id)
        .eq("mode", "paper");
      if (e2) {
        errors.push(`${cfg.user_id.slice(0, 6)}: ${e2.message}`);
        continue;
      }
      updated += 1;
      await supabaseAdmin.from("bot_events").insert({
        user_id: cfg.user_id,
        level: "info",
        message: `Admin applied tuning action: ${data.kind}`,
        meta: { kind: data.kind, patch: patch as Record<string, string | number | boolean | null> },
      });
    }
    return {
      ok: true,
      updated,
      skipped: (cfgs?.length ?? 0) - updated - insufficientSample - thrashSkipped,
      insufficientSample,
      thrashSkipped,
      minClosedTrades: MIN_CLOSED_TRADES,
      errors,
    };
  });

// ---------- CSV exports (admin) ----------


function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return `"${s.replace(/"/g, '""')}"`;
  }
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return (columns ?? []).join(",") + "\n";
  const cols = columns ?? Array.from(
    rows.reduce((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  );
  const head = cols.join(",");
  const body = rows
    .map((r) => cols.map((c) => csvCell(r[c])).join(","))
    .join("\n");
  return head + "\n" + body + "\n";
}

export const exportAllTradesCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: positions, error: e1 }, { data: profiles, error: e2 }] =
      await Promise.all([
        supabaseAdmin
          .from("positions")
          .select("*")
          .order("opened_at", { ascending: false })
          .limit(50000),
        supabaseAdmin.from("profiles").select("id,email,display_name"),
      ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const pMap = new Map<string, { email: string | null; name: string | null }>();
    for (const p of profiles ?? []) {
      pMap.set(p.id, { email: p.email ?? null, name: p.display_name ?? null });
    }

    const rows = (positions ?? []).map((t) => {
      const u = pMap.get(t.user_id);
      const opened = t.opened_at ? new Date(t.opened_at).getTime() : null;
      const closed = t.closed_at ? new Date(t.closed_at).getTime() : null;
      return {
        user_email: u?.email ?? "",
        user_name: u?.name ?? "",
        user_id: t.user_id,
        position_id: t.id,
        signal_id: t.signal_id ?? "",
        source: t.source ?? "",
        algo_id: t.algo_id ?? "",
        algo_name: t.algo_name ?? "",
        algo_version: t.algo_version ?? "",
        confidence_at_entry: t.confidence_at_entry ?? "",
        confidence_band_at_entry: t.confidence_band_at_entry ?? "",
        entry_reason: t.entry_reason ?? "",
        market_regime: t.market_regime ?? "",
        rsi_at_entry: t.rsi_at_entry ?? "",
        volume_spike_ratio_at_entry: t.volume_spike_ratio_at_entry ?? "",
        spread_pct_at_entry: t.spread_pct_at_entry ?? "",
        distance_from_vwap_pct_at_entry: t.distance_from_vwap_pct_at_entry ?? "",
        distance_from_ema21_pct_at_entry: t.distance_from_ema21_pct_at_entry ?? "",
        mode: t.mode,
        symbol: t.symbol,
        instrument: t.instrument ?? "",
        side: t.side,
        status: t.status,
        leverage: t.leverage,
        qty: t.qty,
        entry_price: t.entry_price,
        mark_price: t.mark_price ?? "",
        stop_loss: t.stop_loss ?? "",
        take_profit: t.take_profit ?? "",
        exit_price: t.exit_price ?? "",
        exit_reason: t.exit_reason ?? "",
        pnl: t.pnl ?? "",
        pnl_pct: t.pnl_pct ?? "",
        ...(() => {
          if (t.status !== "closed") {
            return {
              fee_model: "",
              entry_fee_pct: "",
              exit_fee_pct: "",
              gst_pct: "",
              entry_fee: "",
              exit_fee: "",
              gst_fee: "",
              total_fee: "",
              fee_paid: "",
              gross_pnl: "",
              net_pnl: "",
            };
          }
          const f = computeFees(t);
          const r = (n: number) => Number(n.toFixed(6));
          return {
            fee_model: f.fee_model,
            entry_fee_pct: f.entry_fee_pct,
            exit_fee_pct: f.exit_fee_pct,
            gst_pct: f.gst_pct,
            entry_fee: r(f.entry_fee),
            exit_fee: r(f.exit_fee),
            gst_fee: r(f.gst_fee),
            total_fee: r(f.total_fee),
            fee_paid: r(f.total_fee),
            gross_pnl: r(f.gross_pnl),
            net_pnl: r(f.net_pnl),
          };
        })(),
        exchange_order_id: t.exchange_order_id ?? "",
        opened_at: t.opened_at,
        closed_at: t.closed_at ?? "",
        hold_minutes:
          opened && closed ? Math.round((closed - opened) / 60_000) : "",
        updated_at: t.updated_at,
        sl_floor_applied: t.sl_floor_applied ?? "",
        calculated_sl_pct: t.calculated_sl_pct ?? "",
        final_sl_pct: t.final_sl_pct ?? "",
        atr_multiplier_used: t.atr_multiplier_used ?? "",
        sl_floor_experiment_version: t.sl_floor_experiment_version ?? "",
        auto_close_minutes_used: t.auto_close_minutes_used ?? "",
        auto_close_reason: t.auto_close_reason ?? "",
        auto_close_experiment_version: t.auto_close_experiment_version ?? "",
        experiment_id: t.experiment_id ?? "",
      };
    });

    return { csv: toCsv(rows), count: rows.length };
  });

export const exportSignalsCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // One row per scanned symbol per user per scan — driven by bot_signals.
    const [{ data: signals, error: e1 }, { data: profiles, error: e2 }, { data: configs }] =
      await Promise.all([
        supabaseAdmin
          .from("bot_signals")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50000),
        supabaseAdmin.from("profiles").select("id,email,display_name"),
        supabaseAdmin
          .from("bot_config")
          .select(
            "user_id,mode,trading_style,atr_multiplier,target_multiplier,min_rr,min_scalp_score,auto_book_confidence_threshold,display_confidence_threshold,risk_per_trade_pct,leverage,max_open_positions,max_trades_per_day,auto_close_minutes,allow_long,allow_short,is_running,auto_book",
          ),
      ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const pMap = new Map<string, { email: string | null; name: string | null }>();
    for (const p of profiles ?? []) {
      pMap.set(p.id, { email: p.email ?? null, name: p.display_name ?? null });
    }
    const cMap = new Map<string, Record<string, unknown>>();
    for (const c of configs ?? []) cMap.set(c.user_id, c as Record<string, unknown>);

    const rows = (signals ?? []).map((s) => {
      const u = pMap.get(s.user_id);
      const cfg = cMap.get(s.user_id) ?? {};
      return {
        created_at: s.created_at,
        scan_id: s.scan_id,
        user_id: s.user_id,
        user_name: s.user_name ?? u?.name ?? "",
        user_email: u?.email ?? "",
        symbol: s.symbol,
        price: s.price ?? "",
        action: s.action,
        side_bias: s.side_bias ?? "",
        confidence_pct: s.confidence_pct ?? "",
        confidence_band: s.confidence_band ?? "",
        reason: s.reason ?? "",
        final_decision: s.final_decision ?? "",
        booked: s.booked,
        booked_trade_id: s.booked_trade_id ?? "",
        rejection_reason: s.rejection_reason ?? "",
        strategy: s.strategy ?? "",
        timeframe: s.timeframe ?? "",
        config_id: s.config_id ?? "",
        // indicators
        trend_status: s.trend_status ?? "",
        vwap_status: s.vwap_status ?? "",
        ema_alignment: s.ema_alignment ?? "",
        rsi: s.rsi ?? "",
        volume_spike_ratio: s.volume_spike_ratio ?? "",
        spread_pct: s.spread_pct ?? "",
        atr_pct: s.atr_pct ?? "",
        distance_from_vwap_pct: s.distance_from_vwap_pct ?? "",
        distance_from_ema21_pct: s.distance_from_ema21_pct ?? "",
        impulse_candle_pct: s.impulse_candle_pct ?? "",
        risk_reward: s.risk_reward ?? "",
        market_regime: s.market_regime ?? "",
        cooldown_active: s.cooldown_active ?? "",
        daily_loss_available: s.daily_loss_available ?? "",
        max_position_available: s.max_position_available ?? "",
        // tester config snapshot
        cfg_mode: (cfg.mode as string) ?? "",
        cfg_trading_style: (cfg.trading_style as string) ?? "",
        cfg_is_running: cfg.is_running ?? "",
        cfg_auto_book: cfg.auto_book ?? "",
        cfg_auto_book_confidence_threshold: cfg.auto_book_confidence_threshold ?? "",
        cfg_display_confidence_threshold: cfg.display_confidence_threshold ?? "",
        cfg_atr_multiplier: cfg.atr_multiplier ?? "",
        cfg_target_multiplier: cfg.target_multiplier ?? "",
        cfg_min_rr: cfg.min_rr ?? "",
        cfg_min_scalp_score: cfg.min_scalp_score ?? "",
        cfg_risk_per_trade_pct: cfg.risk_per_trade_pct ?? "",
        cfg_leverage: cfg.leverage ?? "",
        cfg_max_open_positions: cfg.max_open_positions ?? "",
        cfg_max_trades_per_day: cfg.max_trades_per_day ?? "",
        cfg_auto_close_minutes: cfg.auto_close_minutes ?? "",
        cfg_allow_long: cfg.allow_long ?? "",
        cfg_allow_short: cfg.allow_short ?? "",
        signal_id: s.id,
      };
    });

    return { csv: toCsv(rows), count: rows.length };
  });


export const exportAlgoConfigsCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: cfgs, error: e1 }, { data: profiles, error: e2 }] =
      await Promise.all([
        supabaseAdmin.from("bot_config").select("*").order("updated_at", { ascending: false }),
        supabaseAdmin.from("profiles").select("id,email,display_name"),
      ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const pMap = new Map<string, { email: string | null; name: string | null }>();
    for (const p of profiles ?? []) {
      pMap.set(p.id, { email: p.email ?? null, name: p.display_name ?? null });
    }

    const rows = (cfgs ?? []).map((c) => ({
      user_email: pMap.get(c.user_id)?.email ?? "",
      user_name: pMap.get(c.user_id)?.name ?? "",
      ...c,
    }));

    return { csv: toCsv(rows), count: rows.length };
  });

export const getAlgoConfigsOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: cfgs, error: e1 }, { data: profiles, error: e2 }, { data: tuneEvents }] =
      await Promise.all([
        supabaseAdmin.from("bot_config").select("*").order("updated_at", { ascending: false }),
        supabaseAdmin.from("profiles").select("id,email,display_name"),
        supabaseAdmin
          .from("bot_events")
          .select("user_id,message,meta,created_at")
          .ilike("message", "Admin applied tune%")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const pMap = new Map<string, { email: string | null; name: string | null }>();
    for (const p of profiles ?? []) {
      pMap.set(p.id, { email: p.email ?? null, name: p.display_name ?? null });
    }

    return {
      configs: (cfgs ?? []).map((c) => ({
        user_id: c.user_id,
        user_email: pMap.get(c.user_id)?.email ?? null,
        user_name: pMap.get(c.user_id)?.name ?? null,
        mode: c.mode,
        is_running: c.is_running,
        trading_style: c.trading_style,
        atr_multiplier: Number(c.atr_multiplier),
        target_multiplier: Number(c.target_multiplier),
        min_rr: Number(c.min_rr),
        risk_per_trade_pct: Number(c.risk_per_trade_pct),
        max_open_positions: c.max_open_positions,
        max_trades_per_day: c.max_trades_per_day,
        auto_close_minutes: c.auto_close_minutes,
        min_scalp_score: c.min_scalp_score,
        allow_long: c.allow_long,
        allow_short: c.allow_short,
        leverage: c.leverage,
        cooldown_minutes: c.cooldown_minutes,
        daily_loss_cap_pct: Number(c.daily_loss_cap_pct),
        scan_interval_minutes: c.scan_interval_minutes,
        updated_at: c.updated_at,
      })),
      recentTunes: (tuneEvents ?? []).map((e) => ({
        user_email: pMap.get(e.user_id)?.email ?? null,
        user_id: e.user_id,
        message: e.message,
        meta: e.meta,
        created_at: e.created_at,
      })),
    };
  });

export const getAlgoAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: audit, error: e1 }, { data: profiles, error: e2 }] =
      await Promise.all([
        supabaseAdmin
          .from("bot_config_audit")
          .select("*")
          .order("changed_at", { ascending: false })
          .limit(500),
        supabaseAdmin.from("profiles").select("id,email,display_name"),
      ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const pMap = new Map<string, { email: string | null; name: string | null }>();
    for (const p of profiles ?? []) {
      pMap.set(p.id, { email: p.email ?? null, name: p.display_name ?? null });
    }

    return (audit ?? []).map((a) => ({
      id: a.id,
      changed_at: a.changed_at,
      user_id: a.user_id,
      user_email: pMap.get(a.user_id)?.email ?? null,
      changed_by: a.changed_by,
      changed_by_email: a.changed_by ? pMap.get(a.changed_by)?.email ?? null : null,
      source: a.source,
      field: a.field,
      old_value: a.old_value,
      new_value: a.new_value,
    }));
  });

export const exportAlgoAuditCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: audit, error: e1 }, { data: profiles, error: e2 }] =
      await Promise.all([
        supabaseAdmin
          .from("bot_config_audit")
          .select("*")
          .order("changed_at", { ascending: false })
          .limit(50000),
        supabaseAdmin.from("profiles").select("id,email,display_name"),
      ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const pMap = new Map<string, { email: string | null }>();
    for (const p of profiles ?? []) pMap.set(p.id, { email: p.email ?? null });

    const rows = (audit ?? []).map((a) => ({
      changed_at: a.changed_at,
      user_email: pMap.get(a.user_id)?.email ?? "",
      user_id: a.user_id,
      changed_by_email: a.changed_by ? pMap.get(a.changed_by)?.email ?? "" : "",
      changed_by: a.changed_by ?? "",
      source: a.source,
      field: a.field,
      old_value: a.old_value ?? "",
      new_value: a.new_value ?? "",
    }));

    return { csv: toCsv(rows), count: rows.length };
  });

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EquityPoint = { t: string; equity: number };

export type ActivityMeta = {
  kind?: string;
  symbol?: string;
  side?: string;
  confidence?: number;
  tpPct?: number;
  slPct?: number;
  atrPct?: number | null;
  rr?: number;
  riskAmount?: number;
  positionSize?: number;
  stopType?: string;
  requiredSL?: number;
  allowedSL?: number;
  reason?: string | null;
  scanned?: number;
  opportunities?: number;
  opened?: number;
  skipped?: number;
  top_confidence?: number;
};

export type ActivityItem = {
  id: string;
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  meta?: ActivityMeta | null;
};

export type EngineStatus = "active" | "paused" | "cooldown";
export type HealthState = "healthy" | "monitoring" | "paused" | "cooldown";

export type DashboardStats = {
  todayPnl: number;
  todayPnlPct: number;
  tradesToday: number;
  winRateAllTime: number;
  closedAllTime: number;
  maxDrawdown: number;
  dailyLossUsedPct: number;
  openCount: number;
  consecutiveLosses: number;
  realizedPnlAllTime: number;
  portfolioValue: number;

  // Period changes (replace CAGR)
  weekChangeAbs: number;
  weekChangePct: number;
  monthlyGrowthPct: number;
  monthlyGrowthAbs: number;

  // Wealth metrics
  consistencyPct: number;
  tradingDays30d: number;
  nextMilestone: number;
  prevMilestone: number;
  milestoneProgressPct: number;
  equityCurve: EquityPoint[];

  // Engine status
  engineStatus: EngineStatus;
  isRunning: boolean;
  marketsScannedToday: number;
  opportunitiesFoundToday: number;
  tradesExecutedToday: number;
  lastAnalysisAt: string | null;
  riskHealthy: boolean;
  riskReason: string | null;

  // Why no trade
  topConfidenceToday: number;
  minConfidenceRequired: number;
  noTradeReason: string;

  // Health pills
  scannerHealth: HealthState;
  dataFeedHealth: HealthState;
  riskEngineHealth: HealthState;
  automationHealth: HealthState;
  lastSuccessfulScanAt: string | null;

  // Recent activity
  recentActivity: ActivityItem[];
};

const MILESTONES = [
  1_000, 2_500, 5_000, 10_000, 25_000, 50_000,
  100_000, 250_000, 500_000, 1_000_000,
];

type ScanMeta = {
  kind?: string;
  scanned?: number;
  opportunities?: number;
  opened?: number;
  skipped?: number;
  top_confidence?: number;
};

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardStats> => {
    const { supabase } = context;
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    // Read mode first so positions queries can be scoped to the active mode.
    const { data: cfg } = await supabase
      .from("bot_config")
      .select("daily_loss_cap_pct,paper_equity,live_allocation_amount,is_running,min_scalp_score,auto_book,mode,max_trades_per_day,max_open_positions,cooldown_minutes")
      .eq("user_id", context.userId)
      .maybeSingle();

    const mode = (cfg?.mode === "live" ? "live" : "paper") as "paper" | "live";

    const [{ data: today }, { data: closedAll }, { data: openRows }, { data: events }] = await Promise.all([
      supabase
        .from("positions")
        .select("pnl,closed_at,status")
        .eq("status", "closed")
        .eq("mode", mode)
        .gte("closed_at", startOfDay.toISOString()),
      supabase
        .from("positions")
        .select("pnl,closed_at,status")
        .eq("status", "closed")
        .eq("mode", mode)
        .order("closed_at", { ascending: true }),
      supabase.from("positions").select("id").eq("status", "open").eq("mode", mode),
      supabase
        .from("bot_events")
        .select("id,created_at,level,message,meta")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(60),
    ]);

    const todayRows = today ?? [];
    const allRows = closedAll ?? [];
    const allEvents = events ?? [];

    const todayPnl = todayRows.reduce((a, r) => a + Number(r.pnl ?? 0), 0);
    const baselineEquity =
      mode === "live" ? Number(cfg?.live_allocation_amount ?? 0) : Number(cfg?.paper_equity ?? 1000);
    const equity = baselineEquity;
    const todayPnlPct = equity > 0 ? (todayPnl / equity) * 100 : 0;
    const tradesToday = todayRows.length;

    const wins = allRows.filter((r) => Number(r.pnl ?? 0) > 0).length;
    const winRate = allRows.length ? wins / allRows.length : 0;

    let peak = 0, cum = 0, mdd = 0;
    for (const r of allRows) {
      cum += Number(r.pnl ?? 0);
      if (cum > peak) peak = cum;
      const dd = peak - cum;
      if (dd > mdd) mdd = dd;
    }

    const cap = Number(cfg?.daily_loss_cap_pct ?? 6);
    const dailyLossUsedPct = todayPnl < 0 && cap > 0 ? Math.min(100, (Math.abs(todayPnlPct) / cap) * 100) : 0;

    let streak = 0;
    for (let i = allRows.length - 1; i >= 0; i--) {
      if (Number(allRows[i].pnl ?? 0) < 0) streak++;
      else break;
    }

    const realizedPnlAllTime = allRows.reduce((a, r) => a + Number(r.pnl ?? 0), 0);
    const portfolioValue = equity + realizedPnlAllTime;

    const now = Date.now();
    const ms30 = 30 * 24 * 3600 * 1000;
    const ms7 = 7 * 24 * 3600 * 1000;
    const cutoff30 = now - ms30;
    const cutoff7 = now - ms7;

    const monthlyGrowthAbs = allRows
      .filter((r) => r.closed_at && new Date(r.closed_at).getTime() >= cutoff30)
      .reduce((a, r) => a + Number(r.pnl ?? 0), 0);
    const realizedBefore30 = realizedPnlAllTime - monthlyGrowthAbs;
    const equity30 = equity + realizedBefore30;
    const monthlyGrowthPct = equity30 > 0 ? (monthlyGrowthAbs / equity30) * 100 : 0;

    const weekChangeAbs = allRows
      .filter((r) => r.closed_at && new Date(r.closed_at).getTime() >= cutoff7)
      .reduce((a, r) => a + Number(r.pnl ?? 0), 0);
    const realizedBefore7 = realizedPnlAllTime - weekChangeAbs;
    const equity7 = equity + realizedBefore7;
    const weekChangePct = equity7 > 0 ? (weekChangeAbs / equity7) * 100 : 0;

    const dayMap = new Map<string, number>();
    for (const r of allRows) {
      if (!r.closed_at) continue;
      const t = new Date(r.closed_at).getTime();
      if (t < cutoff30) continue;
      const key = new Date(t).toISOString().slice(0, 10);
      dayMap.set(key, (dayMap.get(key) ?? 0) + Number(r.pnl ?? 0));
    }
    const tradingDays30d = dayMap.size;
    const winDays = [...dayMap.values()].filter((v) => v > 0).length;
    const consistencyPct = tradingDays30d ? (winDays / tradingDays30d) * 100 : 0;

    const nextMilestone =
      MILESTONES.find((m) => m > portfolioValue) ?? Math.max(portfolioValue * 2, 1000);
    const prevMilestone =
      [...MILESTONES].reverse().find((m) => m <= portfolioValue) ?? 0;
    const milestoneProgressPct =
      nextMilestone > prevMilestone
        ? Math.min(100, Math.max(0, ((portfolioValue - prevMilestone) / (nextMilestone - prevMilestone)) * 100))
        : 0;

    // Equity curve
    const equityCurve: EquityPoint[] = [];
    if (allRows.length > 0) {
      let running = equity;
      const points: EquityPoint[] = [];
      const firstT = new Date(allRows[0].closed_at as string).getTime() - 1;
      points.push({ t: new Date(firstT).toISOString(), equity: running });
      for (const r of allRows) {
        running += Number(r.pnl ?? 0);
        points.push({ t: String(r.closed_at), equity: running });
      }
      const target = 24;
      if (points.length <= target) equityCurve.push(...points);
      else {
        const step = (points.length - 1) / (target - 1);
        for (let i = 0; i < target; i++) equityCurve.push(points[Math.round(i * step)]);
      }
    } else {
      equityCurve.push({ t: new Date(now).toISOString(), equity });
    }

    // -------------- Engine status & activity --------------
    const todayStartMs = startOfDay.getTime();
    const scanEventsToday = allEvents.filter((e) => {
      const meta = (e.meta as ScanMeta | null) ?? null;
      return meta?.kind === "scan" && new Date(e.created_at).getTime() >= todayStartMs;
    });

    const marketsScannedToday = scanEventsToday.reduce((a, e) => a + Number((e.meta as ScanMeta)?.scanned ?? 0), 0);
    const opportunitiesFoundToday = scanEventsToday.reduce((a, e) => a + Number((e.meta as ScanMeta)?.opportunities ?? 0), 0);
    const topConfidenceToday = scanEventsToday.reduce((a, e) => {
      const c = Number((e.meta as ScanMeta)?.top_confidence ?? 0);
      return c > a ? c : a;
    }, 0);
    const lastScan = scanEventsToday[0] ?? null;
    const lastAnalysisAt = lastScan?.created_at ?? allEvents[0]?.created_at ?? null;
    const lastSuccessfulScanAt = lastScan?.created_at ?? null;

    const isRunning = !!cfg?.is_running;
    const minConfidenceRequired = Number(cfg?.min_scalp_score ?? 70);

    // Cooldown detection — recent "paused" event within last 15 minutes
    const recentPause = allEvents.find(
      (e) => e.level === "warn" && /pause|cooldown|cap hit|limit/i.test(e.message) &&
        now - new Date(e.created_at).getTime() < 15 * 60_000,
    );

    let engineStatus: EngineStatus = "active";
    let riskReason: string | null = null;
    if (!isRunning) engineStatus = "paused";
    else if (recentPause) {
      engineStatus = "cooldown";
      riskReason = recentPause.message;
    }

    const riskHealthy =
      dailyLossUsedPct < 80 && streak < 3 && engineStatus !== "cooldown";

    // No-trade reason (user-facing copy)
    let noTradeReason = "Waiting for better entry.";
    if (!isRunning) noTradeReason = "Bot is paused.";
    else if (engineStatus === "cooldown") noTradeReason = "Bot is in cooldown after recent trades.";
    else if (dailyLossUsedPct >= 80) noTradeReason = "Risk limit is active — protecting your capital.";
    else if (topConfidenceToday > 0 && topConfidenceToday < minConfidenceRequired)
      noTradeReason = "No setup is above minimum confidence yet.";
    else if (opportunitiesFoundToday === 0 && marketsScannedToday > 0)
      noTradeReason = "Market conditions are not suitable right now.";
    else if (marketsScannedToday === 0) noTradeReason = "Waiting for next scan cycle.";

    // Health pills
    const scanFresh = lastSuccessfulScanAt && now - new Date(lastSuccessfulScanAt).getTime() < 10 * 60_000;
    const scannerHealth: HealthState = !isRunning ? "paused" : scanFresh ? "healthy" : "monitoring";
    const dataFeedHealth: HealthState = scanFresh ? "healthy" : "monitoring";
    const riskEngineHealth: HealthState = engineStatus === "cooldown" ? "cooldown" : riskHealthy ? "healthy" : "monitoring";
    const automationHealth: HealthState = isRunning ? (engineStatus === "cooldown" ? "cooldown" : "healthy") : "paused";

    // Recent activity (cap to 12 for the feed)
    const recentActivity: ActivityItem[] = allEvents.slice(0, 12).map((e) => ({
      id: e.id as string,
      at: e.created_at as string,
      level: (e.level as ActivityItem["level"]) ?? "info",
      message: e.message as string,
      meta: (e.meta as ActivityItem["meta"]) ?? null,
    }));

    return {
      todayPnl, todayPnlPct, tradesToday,
      winRateAllTime: winRate,
      closedAllTime: allRows.length,
      maxDrawdown: mdd,
      dailyLossUsedPct,
      openCount: openRows?.length ?? 0,
      consecutiveLosses: streak,
      realizedPnlAllTime,
      portfolioValue,
      weekChangeAbs, weekChangePct,
      monthlyGrowthPct, monthlyGrowthAbs,
      consistencyPct, tradingDays30d,
      nextMilestone, prevMilestone, milestoneProgressPct,
      equityCurve,
      engineStatus, isRunning,
      marketsScannedToday,
      opportunitiesFoundToday,
      tradesExecutedToday: tradesToday,
      lastAnalysisAt,
      riskHealthy, riskReason,
      topConfidenceToday,
      minConfidenceRequired,
      noTradeReason,
      scannerHealth, dataFeedHealth, riskEngineHealth, automationHealth,
      lastSuccessfulScanAt,
      recentActivity,
    };
  });

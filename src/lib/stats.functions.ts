import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type EquityPoint = { t: string; equity: number };

export type DashboardStats = {
  todayPnl: number;
  todayPnlPct: number;
  tradesToday: number;
  winRateAllTime: number; // 0..1
  closedAllTime: number;
  maxDrawdown: number; // absolute USDT-equivalent
  dailyLossUsedPct: number; // 0..100 of cap
  openCount: number;
  consecutiveLosses: number;
  realizedPnlAllTime: number;
  portfolioValue: number;
  // Wealth metrics
  monthlyGrowthPct: number; // realized PnL last 30d vs equity 30d ago
  monthlyGrowthAbs: number;
  cagrPct: number; // annualized since first closed trade
  consistencyPct: number; // % profitable trading days in last 30d
  tradingDays30d: number;
  nextMilestone: number; // USDT
  prevMilestone: number; // USDT
  milestoneProgressPct: number; // 0..100
  projected6m: number | null;
  projected12m: number | null;
  projected24m: number | null;
  equityCurve: EquityPoint[];
};

const MILESTONES = [
  1_000, 2_500, 5_000, 10_000, 25_000, 50_000,
  100_000, 250_000, 500_000, 1_000_000,
];

export const getDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardStats> => {
    const { supabase } = context;
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);

    const [{ data: today }, { data: closedAll }, { data: openRows }, { data: cfg }] = await Promise.all([
      supabase
        .from("positions")
        .select("pnl,closed_at,status")
        .eq("status", "closed")
        .gte("closed_at", since.toISOString()),
      supabase
        .from("positions")
        .select("pnl,closed_at,status")
        .eq("status", "closed")
        .order("closed_at", { ascending: true }),
      supabase.from("positions").select("id").eq("status", "open"),
      supabase
        .from("bot_config")
        .select("daily_loss_cap_pct,paper_equity")
        .eq("user_id", context.userId)
        .maybeSingle(),
    ]);

    const todayRows = today ?? [];
    const allRows = closedAll ?? [];

    const todayPnl = todayRows.reduce((a, r) => a + Number(r.pnl ?? 0), 0);
    const equity = Number(cfg?.paper_equity ?? 1000);
    const todayPnlPct = equity > 0 ? (todayPnl / equity) * 100 : 0;
    const tradesToday = todayRows.length;

    const wins = allRows.filter((r) => Number(r.pnl ?? 0) > 0).length;
    const winRate = allRows.length ? wins / allRows.length : 0;

    // Max drawdown over equity curve from closed PnLs
    let peak = 0;
    let cum = 0;
    let mdd = 0;
    for (const r of allRows) {
      cum += Number(r.pnl ?? 0);
      if (cum > peak) peak = cum;
      const dd = peak - cum;
      if (dd > mdd) mdd = dd;
    }

    const cap = Number(cfg?.daily_loss_cap_pct ?? 6);
    const dailyLossUsedPct = todayPnl < 0 && cap > 0 ? Math.min(100, (Math.abs(todayPnlPct) / cap) * 100) : 0;

    // Consecutive losses streak from the tail
    let streak = 0;
    for (let i = allRows.length - 1; i >= 0; i--) {
      if (Number(allRows[i].pnl ?? 0) < 0) streak++;
      else break;
    }

    const realizedPnlAllTime = allRows.reduce((a, r) => a + Number(r.pnl ?? 0), 0);
    const portfolioValue = equity + realizedPnlAllTime;

    // ---------------- Wealth metrics ----------------
    const now = Date.now();
    const ms30 = 30 * 24 * 3600 * 1000;
    const cutoff30 = now - ms30;

    // Monthly growth: realized PnL in last 30d vs equity 30d ago
    const monthlyGrowthAbs = allRows
      .filter((r) => r.closed_at && new Date(r.closed_at).getTime() >= cutoff30)
      .reduce((a, r) => a + Number(r.pnl ?? 0), 0);
    const realizedBefore30 = realizedPnlAllTime - monthlyGrowthAbs;
    const equity30 = equity + realizedBefore30;
    const monthlyGrowthPct = equity30 > 0 ? (monthlyGrowthAbs / equity30) * 100 : 0;

    // CAGR since first closed trade
    let cagrPct = 0;
    if (allRows.length > 0 && allRows[0].closed_at && equity > 0 && portfolioValue > 0) {
      const t0 = new Date(allRows[0].closed_at).getTime();
      const years = Math.max((now - t0) / (365.25 * 24 * 3600 * 1000), 1 / 365);
      cagrPct = (Math.pow(portfolioValue / equity, 1 / years) - 1) * 100;
    }

    // Consistency: % profitable trading days in last 30d
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

    // Capital milestones
    const nextMilestone =
      MILESTONES.find((m) => m > portfolioValue) ?? Math.max(portfolioValue * 2, 1000);
    const prevMilestone =
      [...MILESTONES].reverse().find((m) => m <= portfolioValue) ?? 0;
    const milestoneProgressPct =
      nextMilestone > prevMilestone
        ? Math.min(100, Math.max(0, ((portfolioValue - prevMilestone) / (nextMilestone - prevMilestone)) * 100))
        : 0;

    // Projected wealth path (only when growth is positive)
    const cagrFrac = cagrPct / 100;
    const proj = (yrs: number): number | null =>
      cagrFrac > 0 && portfolioValue > 0 ? portfolioValue * Math.pow(1 + cagrFrac, yrs) : null;

    // Equity curve (downsampled to ~24 points)
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
      if (points.length <= target) {
        equityCurve.push(...points);
      } else {
        const step = (points.length - 1) / (target - 1);
        for (let i = 0; i < target; i++) {
          equityCurve.push(points[Math.round(i * step)]);
        }
      }
    } else {
      equityCurve.push({ t: new Date(now).toISOString(), equity });
    }

    return {
      todayPnl,
      todayPnlPct,
      tradesToday,
      winRateAllTime: winRate,
      closedAllTime: allRows.length,
      maxDrawdown: mdd,
      dailyLossUsedPct,
      openCount: openRows?.length ?? 0,
      consecutiveLosses: streak,
      realizedPnlAllTime,
      portfolioValue,
      monthlyGrowthPct,
      monthlyGrowthAbs,
      cagrPct,
      consistencyPct,
      tradingDays30d,
      nextMilestone,
      prevMilestone,
      milestoneProgressPct,
      projected6m: proj(0.5),
      projected12m: proj(1),
      projected24m: proj(2),
      equityCurve,
    };
  });

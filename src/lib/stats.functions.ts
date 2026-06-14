import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
};

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
    };
  });

import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { updateConfig, killAll } from "@/lib/bot.functions";
import { getDashboardStats } from "@/lib/stats.functions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TabBar } from "@/components/tab-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { PositionsStrip } from "@/components/positions-strip";
import { toast } from "sonner";
import {
  Settings,
  HelpCircle,
  Power,
  AlertTriangle,
} from "lucide-react";


export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — EarnO" },
      { name: "description", content: "Live status of your EarnO automated CoinDCX futures scalping bot." },
    ],
  }),
  component: Home,
});

type ConfigRow = {
  mode: "paper" | "live";
  is_running: boolean;
  leverage: number;
  take_profit_pct: number;
  stop_loss_pct: number;
  paper_equity: number;
  daily_loss_cap_pct: number;
  auto_book: boolean;
};
type PositionRow = {
  id: string;
  symbol: string;
  side: "long" | "short";
  leverage: number;
  entry_price: number;
  mark_price: number | null;
  pnl_pct: number | null;
  opened_at: string;
};

function pct(n: number | null | undefined, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}
function momentumClass(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "text-muted-foreground";
  return n >= 0 ? "text-emerald-500" : "text-destructive";
}

function Home() {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateConfig);
  const killFn = useServerFn(killAll);
  const statsFn = useServerFn(getDashboardStats);

  const cfg = useQuery({
    queryKey: ["bot_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_config")
        .select("mode,is_running,leverage,take_profit_pct,stop_loss_pct,paper_equity,daily_loss_cap_pct,auto_book,risk_per_trade_pct")
        .maybeSingle();
      if (error) throw error;
      return data as (ConfigRow & { risk_per_trade_pct: number }) | null;
    },
  });

  const positions = useQuery({
    queryKey: ["positions_open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("id,symbol,side,leverage,entry_price,mark_price,pnl_pct,opened_at")
        .eq("status", "open")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PositionRow[];
    },
    refetchInterval: 5000,
  });

  const stats = useQuery({
    queryKey: ["dashboard_stats"],
    queryFn: () => statsFn({ data: undefined }),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const ch = supabase
      .channel("home")
      .on("postgres_changes", { event: "*", schema: "public", table: "positions" }, () => {
        qc.invalidateQueries({ queryKey: ["positions_open"] });
        qc.invalidateQueries({ queryKey: ["dashboard_stats"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_config" }, () => {
        qc.invalidateQueries({ queryKey: ["bot_config"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const toggleMode = useMutation({
    mutationFn: async (live: boolean) => updateFn({ data: { mode: live ? "live" : "paper" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bot_config"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const toggleRun = useMutation({
    mutationFn: async (run: boolean) => updateFn({ data: { is_running: run } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bot_config"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const kill = useMutation({
    mutationFn: async () => killFn({ data: undefined }),
    onSuccess: () => {
      toast.success("Emergency stop: bot halted, positions closed.");
      qc.invalidateQueries();
    },
  });

  const c = cfg.data;
  const isLive = c?.mode === "live";
  const isRunning = c?.is_running ?? false;
  const equity = Number(c?.paper_equity ?? 0);
  const s = stats.data;
  const dailyCap = Number(c?.daily_loss_cap_pct ?? 6);


  return (
    <div className="min-h-svh bg-background pb-44">
      <PositionsStrip />
      {/* Header */}
      <header className="px-5 pt-6 pb-4 flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">EarnO</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className={`inline-flex items-center gap-1 text-[11px] px-1.5 h-5 rounded-full ${
                isRunning ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
              }`}
            >
              <span className={`size-1.5 rounded-full ${isRunning ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
              Bot {isRunning ? "running" : "stopped"}
            </span>
            <span
              className={`text-[11px] px-1.5 h-5 inline-flex items-center rounded-full ${
                isLive ? "bg-destructive/15 text-destructive border border-destructive/40" : "bg-muted text-muted-foreground"
              }`}
            >
              {isLive ? "LIVE" : "PAPER"}
            </span>
            {c?.auto_book ? (
              <span className="text-[11px] px-1.5 h-5 inline-flex items-center rounded-full bg-primary/10 text-primary">
                Auto-book
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Link to="/help" className="size-10 grid place-items-center rounded-full hover:bg-muted">
            <HelpCircle className="size-5 text-muted-foreground" />
          </Link>
          <Link to="/settings" className="size-10 grid place-items-center rounded-full hover:bg-muted">
            <Settings className="size-5 text-muted-foreground" />
          </Link>
        </div>
      </header>

      {isLive ? (
        <div className="mx-5 mb-4 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0" />
          Live mode active. Real funds at risk.
        </div>
      ) : null}

      {/* Mode toggle */}
      <section className="px-5">
        <div className="rounded-2xl border bg-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`size-2 rounded-full shrink-0 ${isLive ? "bg-destructive" : "bg-emerald-500"}`} />
            <div className="min-w-0">
              <p className="font-medium text-sm">{isLive ? "Live mode" : "Paper mode"}</p>
              <p className="text-xs text-muted-foreground truncate">
                {isLive ? "Real orders on CoinDCX" : "Simulated, no real money"}
              </p>
            </div>
          </div>
          <Switch
            checked={isLive}
            onCheckedChange={(v) => {
              if (v && !confirm("Switch to LIVE? Real money will be at risk.")) return;
              toggleMode.mutate(v);
            }}
          />
        </div>
      </section>

      {/* Equity */}
      <section className="px-5 mt-4">
        <div className="rounded-2xl border bg-card p-5">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            {isLive ? "Account" : "Virtual capital"}
          </p>
          <p className="text-3xl font-semibold tracking-tight mt-1 tabular-nums">
            ${equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
          <div className="flex items-center gap-3 mt-1 text-sm tabular-nums">
            <span className={momentumClass(s?.todayPnl)}>
              {s ? `${s.todayPnl >= 0 ? "+" : ""}$${s.todayPnl.toFixed(2)}` : "—"} today
            </span>
            <span className="text-muted-foreground">·</span>
            <span className={momentumClass(s?.todayPnlPct)}>{pct(s?.todayPnlPct, 2)}</span>
          </div>

          {/* Daily loss bar */}
          <div className="mt-4">
            <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              <span>Daily loss used</span>
              <span className="tabular-nums">{(s?.dailyLossUsedPct ?? 0).toFixed(0)}% of {dailyCap}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full ${
                  (s?.dailyLossUsedPct ?? 0) > 80 ? "bg-destructive" : (s?.dailyLossUsedPct ?? 0) > 50 ? "bg-amber-500" : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(100, s?.dailyLossUsedPct ?? 0)}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Stat tiles */}
      <section className="px-5 mt-3 grid grid-cols-2 gap-2">
        <StatTile label="Open positions" value={`${s?.openCount ?? positions.data?.length ?? 0}`} />
        <StatTile label="Trades today" value={`${s?.tradesToday ?? 0}`} />
        <StatTile
          label="Win rate"
          value={s && s.closedAllTime > 0 ? `${(s.winRateAllTime * 100).toFixed(0)}%` : "—"}
          sub={s ? `${s.closedAllTime} closed` : undefined}
        />
        <StatTile
          label="Max drawdown"
          value={s ? `$${s.maxDrawdown.toFixed(2)}` : "—"}
          sub={s && s.consecutiveLosses > 0 ? `${s.consecutiveLosses} loss streak` : undefined}
        />
      </section>

      <section className="px-5 mt-6">
        <Link
          to="/scanner"
          className="block rounded-2xl border bg-card p-4 hover:bg-muted/40 transition"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Open scanner</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Auto-book, watchlist and weak setups ranked by confidence
              </p>
            </div>
            <span className="text-[11px] px-2 h-6 inline-flex items-center rounded-full border text-muted-foreground">
              View
            </span>
          </div>
        </Link>
      </section>



      {/* Bottom action bar */}
      <div className="fixed bottom-14 inset-x-0 bg-background/85 backdrop-blur border-t px-5 py-3 flex items-center gap-3 z-20">
        <Button
          variant={isRunning ? "outline" : "default"}
          className="flex-1 h-12 rounded-xl"
          onClick={() => toggleRun.mutate(!isRunning)}
          disabled={toggleRun.isPending}
        >
          <Power className="size-4 mr-2" />
          {isRunning ? "Stop bot" : "Start bot"}
        </Button>
        <Button
          variant="destructive"
          className="h-12 px-4 rounded-xl"
          onClick={() => {
            if (confirm("Emergency stop: halt bot AND close all open positions at market. Continue?"))
              kill.mutate();
          }}
          disabled={kill.isPending}
          aria-label="Emergency stop"
        >
          <AlertTriangle className="size-4 mr-1" />
          Stop
        </Button>
      </div>

      <TabBar />
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums mt-0.5 leading-tight">{value}</p>
      {sub ? <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p> : null}
    </div>
  );
}

function TierTile({ label, value, tone }: { label: string; value: number; tone: "primary" | "amber" | "muted" }) {
  const cls =
    tone === "primary" ? "text-primary"
    : tone === "amber" ? "text-amber-500"
    : "text-muted-foreground";
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums mt-0.5 leading-tight ${cls}`}>{value}</p>
    </div>
  );
}

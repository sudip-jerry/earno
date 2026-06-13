import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { updateConfig, killAll } from "@/lib/bot.functions";
import { getTopMovers, bookManualTrade, type Mover } from "@/lib/movers.functions";
import { getDashboardStats } from "@/lib/stats.functions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TabBar } from "@/components/tab-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { OpportunityCard } from "@/components/opportunity-card";
import { toast } from "sonner";
import {
  Settings,
  HelpCircle,
  Power,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Flame,
  RefreshCw,
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
  const moversFn = useServerFn(getTopMovers);
  const bookFn = useServerFn(bookManualTrade);
  const statsFn = useServerFn(getDashboardStats);
  const [pendingTrade, setPendingTrade] = useState<string | null>(null);

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

  const movers = useQuery({
    queryKey: ["dashboard_top_movers"],
    queryFn: () => moversFn({ data: { market: "futures" } }),
    refetchInterval: 30_000,
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

  const book = useMutation({
    mutationFn: async (input: { m: Mover; side: "long" | "short" }) =>
      bookFn({ data: { symbol: input.m.symbol, side: input.side, price: input.m.price, market: "futures" } }),
    onMutate: (v) => setPendingTrade(`${v.m.symbol}:${v.side}`),
    onSettled: () => setPendingTrade(null),
    onSuccess: (_d, v) => {
      toast.success(`${v.side === "long" ? "Long" : "Short"} ${v.m.display} booked`);
      qc.invalidateQueries({ queryKey: ["positions_open"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Booking failed"),
  });

  const c = cfg.data;
  const isLive = c?.mode === "live";
  const isRunning = c?.is_running ?? false;
  const equity = Number(c?.paper_equity ?? 0);
  const s = stats.data;
  const dailyCap = Number(c?.daily_loss_cap_pct ?? 6);

  const opportunities: Mover[] = movers.data?.ok
    ? movers.data.movers.filter((m) => m.action !== "wait").slice(0, 5)
    : [];
  const moversError = movers.data && !movers.data.ok ? movers.data.error : null;

  const tpPct = Number(c?.take_profit_pct ?? 0.6);
  const slPct = Number(c?.stop_loss_pct ?? 0.4);
  const riskPct = Number(c?.risk_per_trade_pct ?? 1);
  const riskAmount = (equity * riskPct) / 100;
  const dailyRiskAvailable = (s?.dailyLossUsedPct ?? 0) < 100;

  return (
    <div className="min-h-svh bg-background pb-44">
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

      {/* Best Opportunities */}
      <section className="px-5 mt-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Flame className="size-4 text-primary" />
            <div className="min-w-0">
              <h2 className="text-sm font-medium">Best opportunities now</h2>
              <p className="text-xs text-muted-foreground truncate">
                Ranked by confidence
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Link
              to="/scanner"
              className="h-7 px-2.5 inline-flex items-center text-[11px] rounded-full border text-muted-foreground hover:text-foreground"
            >
              Open scanner
            </Link>
            <button
              onClick={() => movers.refetch()}
              className="size-8 grid place-items-center rounded-full border hover:bg-muted"
              aria-label="Refresh"
            >
              <RefreshCw className={`size-3.5 ${movers.isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {moversError ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {moversError}
          </div>
        ) : null}

        <ul className="space-y-2">
          {movers.isLoading && !movers.data
            ? Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="h-28 rounded-2xl border bg-card animate-pulse" />
              ))
            : null}

          {opportunities.map((m) => {
            const side: "long" | "short" = m.bias === "short" ? "short" : "long";
            const booking = pendingTrade === `${m.symbol}:${side}`;
            return (
              <li key={m.symbol}>
                <OpportunityCard
                  mover={m}
                  tpPct={tpPct}
                  slPct={slPct}
                  riskAmountUsd={riskAmount}
                  dailyRiskAvailable={dailyRiskAvailable}
                  booking={booking}
                  onBook={(s) => book.mutate({ m, side: s })}
                />
              </li>
            );
          })}

          {!movers.isLoading && opportunities.length === 0 && !moversError ? (
            <li className="rounded-2xl border border-dashed bg-card/50 p-6 text-center text-sm text-muted-foreground">
              No clear setups right now.
            </li>
          ) : null}
        </ul>
      </section>

      {/* Positions */}
      <section className="px-5 mt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium">
            Open positions <span className="text-muted-foreground">({positions.data?.length ?? 0})</span>
          </h2>
        </div>
        {positions.data && positions.data.length > 0 ? (
          <ul className="space-y-2">
            {positions.data.map((p) => {
              const pnl = Number(p.pnl_pct ?? 0);
              const up = pnl >= 0;
              return (
                <li key={p.id} className="rounded-2xl border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-sm">{p.symbol}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          p.side === "long" ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"
                        }`}
                      >
                        {p.side.toUpperCase()} {p.leverage}x
                      </span>
                    </div>
                    <div className={`flex items-center gap-1 font-medium tabular-nums text-sm ${up ? "text-emerald-500" : "text-destructive"}`}>
                      {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                      {up ? "+" : ""}{pnl.toFixed(2)}%
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Entry </span>
                      <span className="tabular-nums">{Number(p.entry_price).toFixed(4)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-muted-foreground">Mark </span>
                      <span className="tabular-nums">{p.mark_price != null ? Number(p.mark_price).toFixed(4) : "—"}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center">
            <p className="text-sm text-muted-foreground">No open positions yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isRunning ? "Scanning the market for setups." : "Start the bot to begin scanning."}
            </p>
          </div>
        )}
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

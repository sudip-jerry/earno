import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { killAll, updateConfig } from "@/lib/bot.functions";
import { getDashboardStats } from "@/lib/stats.functions";
import { getMyEntitlements } from "@/lib/plans.functions";
import { PLAN_NAME, type PlanTier } from "@/lib/plans";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TabBar } from "@/components/tab-bar";
import { WealthHero, MilestoneCard, PerformanceHistoryCard } from "@/components/wealth-hero";
import { RecentActivity } from "@/components/recent-activity";
import {
  AlertTriangle,
  ChevronRight,
  ShieldCheck,
  Activity,
  Sparkles,
  MessageCircle,
  Crown,
} from "lucide-react";
import { toast } from "sonner";
import { useMarketMode, type MarketMode } from "@/hooks/use-market-mode";
import earnoStacked from "@/assets/earno-stacked.jpg.asset.json";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Earn'O" },
      { name: "description", content: "Your Earn'O Wealth Engine at a glance — portfolio, status, and what's next." },
    ],
  }),
  component: Home,
});

type ConfigRow = {
  mode: "paper" | "live";
  is_running: boolean;
  paper_equity: number;
  daily_loss_cap_pct: number;
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Home() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const updateFn = useServerFn(updateConfig);
  const killFn = useServerFn(killAll);
  const statsFn = useServerFn(getDashboardStats);
  const entFn = useServerFn(getMyEntitlements);

  const [hideBalance, setHideBalance] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => entFn() });

  const cfg = useQuery({
    queryKey: ["bot_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_config")
        .select("mode,is_running,paper_equity,daily_loss_cap_pct")
        .maybeSingle();
      if (error) throw error;
      return data as ConfigRow | null;
    },
  });

  const currentMode = (cfg.data?.mode ?? "paper") as "paper" | "live";

  const stats = useQuery({
    queryKey: ["dashboard_stats", currentMode],
    queryFn: () => statsFn({ data: undefined }),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const ch = supabase
      .channel("home")
      .on("postgres_changes", { event: "*", schema: "public", table: "positions" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard_stats"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_config" }, () => {
        qc.invalidateQueries({ queryKey: ["bot_config"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bot_events" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard_stats"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const toggleMode = useMutation({
    mutationFn: async (live: boolean) => updateFn({ data: { mode: live ? "live" : "paper" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot_config"] });
      qc.invalidateQueries({ queryKey: ["dashboard_stats"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const kill = useMutation({
    mutationFn: async () => killFn({ data: undefined }),
    onSuccess: () => {
      toast.success("Emergency stop: bot halted, positions closed.");
      qc.invalidateQueries();
    },
  });

  const tier: PlanTier = ent.data?.tier ?? "free";

  const c = cfg.data;
  const isLive = c?.mode === "live";
  const isRunning = c?.is_running ?? false;
  const equity = Number(c?.paper_equity ?? 0);
  const s = stats.data;

  const insight = useMemo(() => {
    if (!isRunning) {
      return {
        title: "Bot is paused",
        body: "earn'O is not scanning markets right now. Resume the bot to begin auto-booking trades.",
        next: "Tap View Bot Details to resume.",
      };
    }
    if ((s?.dailyLossUsedPct ?? 0) >= 80) {
      return {
        title: "Daily safety limit reached",
        body: "Your daily loss limit was reached. earn'O has paused new trades to protect your capital. It will resume tomorrow.",
        next: "No action needed.",
      };
    }
    const reason = s?.noTradeReason?.trim();
    if (reason && /limit|cap|max trades|reached/i.test(reason)) {
      return {
        title: "Daily auto-booking limit reached",
        body: "earn'O will continue scanning markets, but no more trades will be opened today.",
        next: "No action needed.",
      };
    }
    if ((s?.openCount ?? 0) > 0) {
      return {
        title: `Managing ${s?.openCount} open position${(s?.openCount ?? 0) === 1 ? "" : "s"}`,
        body: "earn'O is monitoring your live trades and will close them at the right moment based on your strategy.",
        next: "No action needed.",
      };
    }
    return {
      title: "Scanning markets calmly",
      body: reason || "earn'O is watching the market for setups that match your strategy and risk profile.",
      next: "No action needed.",
    };
  }, [isRunning, s]);

  const showEmergencyOnHome = isLive && (s?.openCount ?? 0) > 0;

  return (
    <div className="min-h-svh bg-background pb-28">
      {/* Calm header — brand · market toggle · mode pill */}
      <header className="px-5 pt-5 pb-2 flex items-center justify-between gap-3">
        <img
          src={earnoStacked.url}
          alt="earn'O"
          className="h-11 w-auto select-none"
          draggable={false}
        />
        <div className="flex items-center gap-2 shrink-0">
          <MarketTogglePill />
          <button
            type="button"
            onClick={() => {
              if (isLive) toggleMode.mutate(false);
              else setConfirmLive(true);
            }}
            className={`inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wider px-2.5 h-7 rounded-full transition ${
              isLive
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"
            }`}
            aria-label="Toggle paper or live trading"
          >
            <span className={`size-1.5 rounded-full ${isLive ? "bg-emerald-500" : "bg-amber-500"}`} />
            {isLive ? "LIVE" : "PAPER"}
          </button>
        </div>
      </header>

      {/* Lean upgrade strip — only for free tier, sits high but stays subtle */}
      {tier === "free" && (
        <Link
          to="/upgrade"
          className="mx-5 mt-2 flex items-center justify-between gap-3 rounded-xl border border-primary/15 bg-primary/[0.04] px-3 py-2 hover:bg-primary/[0.07] transition"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Crown className="size-3.5 text-primary shrink-0" />
            <p className="text-[12px] font-medium truncate">
              Unlock 24/7 auto-trading
            </p>
          </div>
          <span className="text-[11px] font-semibold text-primary shrink-0">Upgrade →</span>
        </Link>
      )}

      {/* 1. Portfolio summary (mode banner hidden, 30-day hidden until enough history) */}
      <WealthHero
        stats={s}
        equityFallback={equity}
        isLive={isLive}
        hideBalance={hideBalance}
        onToggleHide={() => setHideBalance((v) => !v)}
        hideModeBanner
        hide30d={!s || s.closedAllTime < 30}
      />


      {/* 2. Wealth Engine status — calm */}
      <section className="px-5 mt-6">
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2.5">
            <span className={`size-8 grid place-items-center rounded-full ${isRunning ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
              <Activity className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {isRunning ? "Running safely" : "Paused"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Wealth Engine · {currentMode === "live" ? "Live" : "Paper"} mode
              </p>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-3">
            <Metric label="Trades today" value={`${s?.tradesToday ?? 0}`} />
            <Metric label="Open positions" value={`${s?.openCount ?? 0}`} />
            <Metric
              label="Risk protection"
              value={s?.riskHealthy ?? true ? "Active" : "Engaged"}
              icon={<ShieldCheck className="size-3 text-emerald-500" />}
            />
          </dl>

          <p className="mt-4 text-[11px] text-muted-foreground">
            Last analysis {timeAgo(s?.lastAnalysisAt ?? null)}
          </p>
        </div>
      </section>

      {/* 3. Today's insight */}
      <section className="px-5 mt-4">
        <div className="rounded-2xl bg-primary/5 border border-primary/10 p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <p className="text-[11px] uppercase tracking-wider font-semibold text-primary">Today's insight</p>
          </div>
          <p className="mt-3 text-sm font-semibold leading-snug">{insight.title}</p>
          <p className="mt-1.5 text-[13px] text-muted-foreground leading-relaxed">{insight.body}</p>
          <div className="mt-3 pt-3 border-t border-primary/10 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">Next action:</span> {insight.next}
            </p>
            <Link
              to="/help"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline shrink-0"
            >
              <MessageCircle className="size-3" />
              Ask earn'O
            </Link>
          </div>
        </div>
      </section>

      {/* 4. Primary action */}
      <section className="px-5 mt-4">
        <Button
          className="w-full h-12 rounded-xl"
          onClick={() => navigate({ to: "/bot" })}
        >
          View Bot Details
          <ChevronRight className="size-4 ml-1" />
        </Button>
        {showEmergencyOnHome && (
          <Button
            variant="ghost"
            className="w-full h-11 mt-2 rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setConfirmStop(true)}
            disabled={kill.isPending}
          >
            <AlertTriangle className="size-4 mr-2" />
            Emergency Stop
          </Button>
        )}
      </section>


      {/* Secondary content — moved below the fold */}
      <div className="mt-8 space-y-2">
        <p className="px-5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          Progress
        </p>
        <MilestoneCard stats={s} equityFallback={equity} hideBalance={hideBalance} />
        <PerformanceHistoryCard stats={s} />
      </div>

      <div className="mt-6 space-y-2">
        <p className="px-5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
          Activity
        </p>
        <RecentActivity items={s?.recentActivity ?? []} />
      </div>

      <TabBar />

      <AlertDialog open={confirmLive} onOpenChange={setConfirmLive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              Switch to Live trading?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Real orders will be placed on CoinDCX using your funds. Your daily-loss cap is
              {" "}{Number(c?.daily_loss_cap_pct ?? 6)}%. You can switch back to Paper anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay on Paper</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toggleMode.mutate(true)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Go Live
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              Emergency Stop
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately halt the bot and force-close every open position at market price.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => kill.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Stop &amp; close all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-semibold tabular-nums inline-flex items-center gap-1">
        {icon}
        {value}
      </dd>
    </div>
  );
}

function MarketTogglePill() {
  const { market, setMarket } = useMarketMode();
  const opts: { v: MarketMode; label: string }[] = [
    { v: "futures", label: "Futures" },
    { v: "spot", label: "Coins" },
  ];
  return (
    <div className="inline-flex rounded-full bg-muted/60 p-0.5 text-[11px] font-medium">
      {opts.map((o) => {
        const active = market === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => setMarket(o.v)}
            className={`px-2.5 h-6 rounded-full transition ${
              active ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}


import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { killAll, updateConfig } from "@/lib/bot.functions";
import { getDashboardStats } from "@/lib/stats.functions";
import { getMyEntitlements } from "@/lib/plans.functions";
import { type PlanTier } from "@/lib/plans";
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
import { RecentActivityFeed } from "@/components/recent-activity";
import { KpiStrip } from "@/components/market/market-hero";
import { ModeBanner } from "@/components/market/mode-banner";
import { OpenPositionsBanner } from "@/components/market/open-positions-banner";
import { useCurrency } from "@/hooks/use-currency";
import { AlertTriangle, ShieldCheck, Activity, Crown, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { DailyChart, CompactRiskRow, RiskRow, timeAgo, type StatsExtras } from "./futures-widgets";

type ConfigRow = {
  mode: "paper" | "live";
  is_running: boolean;
  paper_equity: number;
  daily_loss_cap_pct: number;
};

export function FuturesHome() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const updateFn = useServerFn(updateConfig);
  const killFn = useServerFn(killAll);
  const statsFn = useServerFn(getDashboardStats);
  const entFn = useServerFn(getMyEntitlements);
  const { fmt } = useCurrency();

  const [confirmLive, setConfirmLive] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [hideBalance, setHideBalance] = useState(false);

  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => entFn() });
  const tier: PlanTier = ent.data?.tier ?? "free";

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

  const toggleMode = useMutation({
    mutationFn: async (live: boolean) => updateFn({ data: { mode: live ? "live" : "paper" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot_config"] });
      qc.invalidateQueries({ queryKey: ["dashboard_stats"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const togglePause = useMutation({
    mutationFn: async (run: boolean) => updateFn({ data: { is_running: run } }),
    onSuccess: (_d, run) => {
      toast.success(run ? "Bot resumed" : "Bot paused");
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

  const c = cfg.data;
  const isLive = c?.mode === "live";
  const isRunning = c?.is_running ?? false;
  const s = stats.data as StatsExtras | undefined;
  const openCount = s?.openCount ?? 0;

  const statusLabel = !isRunning
    ? "Paused"
    : (s?.dailyLossUsedPct ?? 0) >= 80
      ? "Cooldown"
      : "Running";
  const statusTone =
    statusLabel === "Running"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : statusLabel === "Cooldown"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-muted text-muted-foreground";

  const reason = useMemo(() => {
    if (!isRunning) return "Bot paused — resume to begin scanning.";
    if ((s?.dailyLossUsedPct ?? 0) >= 80) return "Cooldown after daily loss limit reached.";
    if (openCount > 0) return `Managing ${openCount} open position${openCount === 1 ? "" : "s"}.`;
    return s?.noTradeReason?.trim() || "Scanning markets calmly.";
  }, [isRunning, s, openCount]);

  // KPI values, mapped to the same 4-up shape the Coins screen uses.
  const futInvested = Number(s?.baselineEquity ?? c?.paper_equity ?? 0);
  const futRealized = Number(s?.realizedPnlAllTime ?? 0);
  const futRetPct = futInvested > 0 ? (futRealized / futInvested) * 100 : 0;
  const futWinPct =
    (s?.closedAllTime ?? 0) > 0 ? Math.round(Number(s?.winRateAllTime ?? 0) * 100) : null;

  return (
    <>
      {/* ===== Mode banner — shared across All / Futures / Coins ===== */}
      <ModeBanner
        isLive={isLive}
        onToggle={() => (isLive ? toggleMode.mutate(false) : setConfirmLive(true))}
      />

      {/* ===== Open positions banner — unrealized PnL + count ===== */}
      <OpenPositionsBanner
        count={openCount}
        pnl={Number(s?.openPnl ?? 0)}
        pnlPct={Number(s?.openPnlPct ?? 0)}
        fmt={fmt}
      />

      {/* ===== Portfolio summary card — equity + line chart ===== */}
      <div className="px-5 mt-3">
        <DailyChart
          portfolioValue={Number(s?.portfolioValue ?? c?.paper_equity ?? 0)}
          todayPnl={Number(s?.todayPnl ?? 0)}
          totalPnl={Number(s?.realizedPnlAllTime ?? 0)}
          totalPnlPct={
            s?.baselineEquity ? (Number(s.realizedPnlAllTime ?? 0) / s.baselineEquity) * 100 : 0
          }
          weekChangeAbs={Number(s?.weekChangeAbs ?? 0)}
          dailyPnl={s?.dailyPnl ?? []}
          hideBalance={hideBalance}
          onToggleHide={() => setHideBalance((v) => !v)}
          fmt={fmt}
        />
      </div>

      {/* ===== KPI strip — uniform with the Coins screen ===== */}
      <div className="px-5 mt-3">
        <KpiStrip
          items={[
            { label: "Win rate", value: futWinPct == null ? "—" : `${futWinPct}%` },
            { label: "Trades today", value: String(s?.tradesToday ?? 0) },
            { label: "Open", value: String(openCount) },
            {
              label: "Return",
              value: `${futRetPct >= 0 ? "+" : ""}${futRetPct.toFixed(1)}%`,
              tone: futRetPct >= 0 ? "pos" : "neg",
            },
          ]}
        />
      </div>

      {tier === "free" && (
        <Link
          to="/upgrade"
          className="mx-5 mt-3 flex items-center justify-between gap-3 rounded-xl border border-primary/15 bg-primary/[0.04] px-3 py-2 hover:bg-primary/[0.07] transition"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Crown className="size-3.5 text-primary shrink-0" />
            <p className="text-[12px] font-medium truncate">Unlock 24/7 auto-trading</p>
          </div>
          <span className="text-[11px] font-semibold text-primary shrink-0">Upgrade →</span>
        </Link>
      )}

      {/* ===== Wealth Engine status ===== */}
      <section className="px-5 mt-5">
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2.5">
            <span className={`size-8 grid place-items-center rounded-full ${statusTone}`}>
              <Activity className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Wealth Engine · {statusLabel}</p>
              <p className="text-[11px] text-muted-foreground">
                {currentMode === "live" ? "Live" : "Paper"} mode · {reason}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <CompactRiskRow
              label="Daily loss used"
              value={`${(s?.dailyLossUsedPct ?? 0).toFixed(0)}% of cap`}
              warn={(s?.dailyLossUsedPct ?? 0) >= 80}
            />
            <CompactRiskRow
              label="Trades today"
              value={`${s?.tradesExecutedToday ?? 0} / ${s?.maxTradesPerDay ?? 0}`}
              warn={(s?.tradesExecutedToday ?? 0) >= (s?.maxTradesPerDay ?? 999)}
            />
            <CompactRiskRow
              label="Open positions"
              value={`${s?.openCount ?? 0} / ${s?.maxOpenPositions ?? 0}`}
              warn={(s?.openCount ?? 0) >= (s?.maxOpenPositions ?? 999)}
            />
            <CompactRiskRow
              label="Consecutive losses"
              value={`${s?.consecutiveLosses ?? 0}`}
              warn={(s?.consecutiveLosses ?? 0) >= 3}
            />
            <CompactRiskRow label="Last scan" value={timeAgo(s?.lastAnalysisAt ?? null)} />
            <CompactRiskRow
              label="Min confidence"
              value={`${s?.minConfidenceRequired ?? 0}`}
              sub={`Top today: ${s?.topConfidenceToday ?? 0}`}
            />
          </div>

          <button
            type="button"
            onClick={() => setRiskOpen(true)}
            className="mt-3 text-[11px] font-medium text-primary hover:underline"
          >
            Full risk details →
          </button>
        </div>
      </section>

      {/* ===== Safety controls — always reachable during beta ===== */}
      <section className="px-5 mt-5">
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            variant="outline"
            className="h-12 rounded-xl"
            onClick={() => togglePause.mutate(!isRunning)}
            disabled={togglePause.isPending}
          >
            {isRunning ? <Pause className="size-4 mr-1.5" /> : <Play className="size-4 mr-1.5" />}
            {isRunning ? "Pause Bot" : "Resume Bot"}
          </Button>
          <Button
            variant="outline"
            className={`h-12 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive ${
              isLive ? "bg-destructive/5" : ""
            }`}
            onClick={() => setConfirmStop(true)}
            disabled={kill.isPending}
          >
            <AlertTriangle className="size-4 mr-1.5" />
            Emergency Stop
          </Button>
        </div>
        <p className="mt-2 text-[10.5px] text-muted-foreground leading-snug px-1">
          Emergency Stop immediately closes or blocks bot actions based on configured safety rules.
        </p>
      </section>

      {/* ===== Recent activity ===== */}
      <div className="mt-6">
        <RecentActivityFeed />
      </div>

      <AlertDialog open={confirmLive} onOpenChange={setConfirmLive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              Switch to Live trading?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Real orders will be placed on CoinDCX using your funds. Your daily-loss cap is{" "}
              {Number(c?.daily_loss_cap_pct ?? 6)}%. You can switch back to Paper anytime.
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
              This will immediately halt the bot and force-close every open position at market
              price. This action cannot be undone.
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

      <AlertDialog open={riskOpen} onOpenChange={setRiskOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {(s?.riskHealthy ?? true) ? (
                <ShieldCheck className="size-5 text-emerald-500" />
              ) : (
                <AlertTriangle className="size-5 text-amber-500" />
              )}
              Risk Protection — {(s?.riskHealthy ?? true) ? "Active" : "Warning"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left">
              {s?.riskReason ??
                (s?.riskHealthy
                  ? "All guardrails healthy. Bot is trading within safe limits."
                  : "A guardrail is currently engaged. Details below.")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 text-sm">
            <RiskRow
              label="Daily loss used"
              value={`${(s?.dailyLossUsedPct ?? 0).toFixed(0)}% of cap`}
              sub={`Cap: -${s?.dailyLossCapPct ?? 0}% of equity`}
              warn={(s?.dailyLossUsedPct ?? 0) >= 80}
            />
            <RiskRow
              label="Trades today"
              value={`${s?.tradesExecutedToday ?? 0} / ${s?.maxTradesPerDay ?? 0}`}
              warn={(s?.tradesExecutedToday ?? 0) >= (s?.maxTradesPerDay ?? 999)}
            />
            <RiskRow
              label="Open positions"
              value={`${s?.openCount ?? 0} / ${s?.maxOpenPositions ?? 0}`}
              warn={(s?.openCount ?? 0) >= (s?.maxOpenPositions ?? 999)}
            />
            <RiskRow
              label="Consecutive losses"
              value={`${s?.consecutiveLosses ?? 0}`}
              warn={(s?.consecutiveLosses ?? 0) >= 3}
            />
            <RiskRow
              label="Min confidence"
              value={`${s?.minConfidenceRequired ?? 0}`}
              sub={`Top today: ${s?.topConfidenceToday ?? 0}`}
            />
            <RiskRow label="Cooldown after loss" value={`${s?.cooldownMinutes ?? 0} min`} />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction onClick={() => navigate({ to: "/settings" })}>
              Change risk settings
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

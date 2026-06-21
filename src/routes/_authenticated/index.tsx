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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TabBar } from "@/components/tab-bar";
import { WealthHero, MilestoneCard, PerformanceHistoryCard } from "@/components/wealth-hero";
import { RecentActivity } from "@/components/recent-activity";
import { RecommendationsPanel } from "@/components/recommendations-panel";
import {
  AlertTriangle,
  ChevronRight,
  ShieldCheck,
  Activity,
  Sparkles,
  MessageCircle,
  Crown,
  Settings as Cog,
  RefreshCw,
  MoreVertical,
  Bot as BotIcon,
  Radar,
  Briefcase,
  Pause,
  Play,
  FlaskConical,
  BadgeCheck,
  HelpCircle,
  Info,
  LineChart,
} from "lucide-react";
import { toast } from "sonner";
import { useMarketMode, type MarketMode } from "@/hooks/use-market-mode";
import { CoinPortfolioCard, CoinHoldingsCard, CoinSignalsList } from "@/components/coin-bot/coin-panels";
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
  const [riskOpen, setRiskOpen] = useState(false);

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

  const tier: PlanTier = ent.data?.tier ?? "free";
  const isAdmin = !!ent.data?.isAdmin;

  const c = cfg.data;
  const isLive = c?.mode === "live";
  const isRunning = c?.is_running ?? false;
  const equity = Number(c?.paper_equity ?? 0);
  const s = stats.data;
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

  return (
    <div className="min-h-svh bg-background pb-28">
      {/* ===== TOP BAR — brand + ops controls ===== */}
      <header className="px-5 pt-5">
        <div className="flex items-center gap-3">
          <img
            src={earnoStacked.url}
            alt="earn'O"
            className="h-11 w-auto select-none"
            draggable={false}
          />
          <div className="ml-auto flex items-center gap-1">
            {/* Open positions chip */}
            <Link
              to="/positions"
              className="hidden xs:inline-flex items-center gap-1 px-2 h-7 rounded-full bg-muted/60 text-[11px] font-medium text-foreground hover:bg-muted"
              aria-label={`${openCount} open positions`}
            >
              <Briefcase className="size-3" />
              <span className="tabular-nums">{openCount}</span>
            </Link>
            <MarketTogglePill />
            <IconBtn
              ariaLabel="Refresh"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ["dashboard_stats"] });
                qc.invalidateQueries({ queryKey: ["bot_config"] });
              }}
            >
              <RefreshCw className={`size-4 ${stats.isFetching ? "animate-spin" : ""}`} />
            </IconBtn>
            {isAdmin && (
              <IconBtn ariaLabel="Admin" onClick={() => navigate({ to: "/admin" })}>
                <Crown className="size-4 text-primary" />
              </IconBtn>
            )}
            <IconBtn ariaLabel="Settings" onClick={() => navigate({ to: "/settings" })}>
              <Cog className="size-4" />
            </IconBtn>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More"
                  className="size-8 grid place-items-center rounded-full hover:bg-muted text-foreground"
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {PLAN_NAME[tier]} plan {isAdmin && "· Admin"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate({ to: "/upgrade" })}>
                  <Crown className="size-4 mr-2" /> Plan & Upgrade
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate({ to: "/movers" })}>
                  <LineChart className="size-4 mr-2" /> Movers
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate({ to: "/help" })}>
                  <HelpCircle className="size-4 mr-2" /> Help & Support
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate({ to: "/about" })}>
                  <Info className="size-4 mr-2" /> About
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate({ to: "/admin" })}>
                      <Crown className="size-4 mr-2 text-primary" /> Admin console
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* ===== Mode banner — prominent ===== */}
      <div className="px-5 mt-4">
        <button
          type="button"
          onClick={() => {
            if (isLive) toggleMode.mutate(false);
            else setConfirmLive(true);
          }}
          className={`w-full text-left flex items-center gap-3 rounded-2xl border px-4 py-3 transition ${
            isLive
              ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
              : "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15"
          }`}
          aria-label="Toggle paper or live trading"
        >
          <span
            className={`inline-flex items-center justify-center size-9 rounded-full shrink-0 ${
              isLive
                ? "bg-destructive/15 text-destructive"
                : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
            }`}
          >
            {isLive ? <BadgeCheck className="size-4" /> : <FlaskConical className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={`text-[13px] font-semibold leading-tight ${
                isLive ? "text-destructive" : "text-amber-700 dark:text-amber-300"
              }`}
            >
              {isLive ? "LIVE trading active" : "PAPER — practice mode"}
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              {isLive
                ? "Real funds are at risk. Tap to switch back to Paper."
                : "All numbers reflect simulated trading. Tap to go Live."}
            </p>
          </div>
          <span
            className={`text-[10px] font-semibold tracking-wider px-2 h-6 inline-flex items-center rounded-full ${
              isLive
                ? "bg-destructive text-destructive-foreground"
                : "bg-amber-500 text-white"
            }`}
          >
            {isLive ? "LIVE" : "PAPER"}
          </span>
        </button>
      </div>

      {/* ===== Open positions banner — unrealized PnL + count ===== */}
      {openCount > 0 && (
        <div className="px-5 mt-3">
          <Link
            to="/positions"
            className="w-full flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 hover:bg-muted/40 transition"
          >
            <span
              className={`inline-flex items-center justify-center size-8 rounded-full shrink-0 ${
                (s?.openPnl ?? 0) >= 0
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
              }`}
            >
              <Briefcase className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-muted-foreground leading-tight">
                {openCount} open position{openCount === 1 ? "" : "s"} · unrealized
              </p>
              <p
                className={`text-[14px] font-semibold leading-tight tabular-nums mt-0.5 ${
                  (s?.openPnl ?? 0) >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400"
                }`}
              >
                {(s?.openPnl ?? 0) >= 0 ? "+" : "−"}${Math.abs(s?.openPnl ?? 0).toFixed(2)}
                <span className="ml-1.5 text-[11px] font-medium opacity-80">
                  ({(s?.openPnlPct ?? 0) >= 0 ? "+" : ""}
                  {(s?.openPnlPct ?? 0).toFixed(2)}%)
                </span>
              </p>
            </div>
            <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          </Link>
        </div>
      )}

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

      {/* ===== Portfolio hero (banner suppressed — own banner above) ===== */}
      <WealthHero
        stats={s}
        equityFallback={equity}
        isLive={isLive}
        hideBalance={hideBalance}
        onToggleHide={() => setHideBalance((v) => !v)}
        hideModeBanner
        hide30d={!s || s.closedAllTime < 30}
      />

      {/* ===== Personalized recommendations (RAG) ===== */}
      <RecommendationsPanel />

      {/* ===== Quick actions ===== */}
      <section className="px-5 mt-6">
        <div className="grid grid-cols-3 gap-2.5">
          <QuickAction
            to="/bot"
            label="Bot Panel"
            icon={<BotIcon className="size-5" />}
            accent
          />
          <QuickAction to="/scanner" label="Scanner" icon={<Radar className="size-5" />} />
          <QuickAction
            to="/positions"
            label="Positions"
            icon={<Briefcase className="size-5" />}
            badge={openCount > 0 ? openCount : undefined}
          />
        </div>
      </section>

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

          <dl className="mt-4 grid grid-cols-4 gap-3">
            <Metric label="Trades today" value={`${s?.tradesToday ?? 0}`} />
            <Metric label="Open" value={`${openCount}`} />
            <button type="button" onClick={() => setRiskOpen(true)} className="text-left">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-0.5">
                Risk <Info className="size-2.5 opacity-60" />
              </dt>
              <dd className="mt-1 text-[13px] font-semibold tabular-nums inline-flex items-center gap-1">
                {s?.riskHealthy ?? true ? (
                  <ShieldCheck className="size-3 text-emerald-500" />
                ) : (
                  <AlertTriangle className="size-3 text-amber-500" />
                )}
                {s?.riskHealthy ?? true ? "Active" : "Warning"}
              </dd>
            </button>
            <Metric label="Last scan" value={timeAgo(s?.lastAnalysisAt ?? null)} />
          </dl>

          <Button
            variant="outline"
            className="w-full h-10 mt-4 rounded-xl"
            onClick={() => navigate({ to: "/bot" })}
          >
            View Bot Details
            <ChevronRight className="size-4 ml-1" />
          </Button>
        </div>
      </section>

      {/* ===== Today's insight ===== */}
      <section className="px-5 mt-4">
        <div className="rounded-2xl bg-primary/5 border border-primary/10 p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <p className="text-[11px] uppercase tracking-wider font-semibold text-primary">
              Today's insight
            </p>
            <Link
              to="/help"
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <MessageCircle className="size-3" />
              Ask earn'O
            </Link>
          </div>
          <p className="mt-2 text-[13px] text-foreground leading-relaxed">{reason}</p>
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

      {/* ===== Secondary content ===== */}
      <div className="mt-7 space-y-2">
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

      <AlertDialog open={riskOpen} onOpenChange={setRiskOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {s?.riskHealthy ?? true ? (
                <ShieldCheck className="size-5 text-emerald-500" />
              ) : (
                <AlertTriangle className="size-5 text-amber-500" />
              )}
              Risk Protection — {s?.riskHealthy ?? true ? "Active" : "Warning"}
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
            <RiskRow
              label="Cooldown after loss"
              value={`${s?.cooldownMinutes ?? 0} min`}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction onClick={() => navigate({ to: "/settings" })}>
              Change risk settings
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RiskRow({
  label, value, sub, warn,
}: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-background/40 px-3 py-2">
      <div>
        <p className="text-xs font-medium">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <span
        className={`text-sm font-semibold tabular-nums ${
          warn ? "text-amber-600 dark:text-amber-400" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function IconBtn({
  children,
  ariaLabel,
  onClick,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="size-8 grid place-items-center rounded-full hover:bg-muted text-foreground"
    >
      {children}
    </button>
  );
}

function QuickAction({
  to,
  label,
  icon,
  accent,
  badge,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  accent?: boolean;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      className={`relative rounded-2xl border p-3.5 flex flex-col items-start gap-2 transition hover:shadow-sm ${
        accent ? "border-primary/20 bg-primary/[0.04]" : "bg-card"
      }`}
    >
      <span
        className={`size-8 grid place-items-center rounded-lg ${
          accent ? "bg-primary/10 text-primary" : "bg-muted text-foreground"
        }`}
      >
        {icon}
      </span>
      <span className="text-[12px] font-semibold">{label}</span>
      {badge != null && (
        <span className="absolute top-2 right-2 min-w-5 h-5 px-1.5 grid place-items-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums">
          {badge}
        </span>
      )}
    </Link>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-[13px] font-semibold tabular-nums inline-flex items-center gap-1">
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

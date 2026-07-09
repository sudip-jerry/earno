import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { killAll, updateConfig } from "@/lib/bot.functions";
import { getDashboardStats, type DashboardStats } from "@/lib/stats.functions";
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
import { useCurrency } from "@/hooks/use-currency";
import { RecentActivityFeed } from "@/components/recent-activity";
import { RecommendationsPanel } from "@/components/recommendations-panel";
import {
  AlertTriangle,
  ChevronRight,
  ShieldCheck,
  Activity,
  Crown,
  Settings as Cog,
  RefreshCw,
  MoreVertical,
  Bot as BotIcon,
  Radar,
  Home as HomeIcon,
  Briefcase,
  Pause,
  Play,
  FlaskConical,
  BadgeCheck,
  HelpCircle,
  Info,
  LineChart,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { useMarketMode, type MarketMode } from "@/hooks/use-market-mode";
import {
  CoinPortfolioCard,
  CoinHoldingsCard,
  CoinSignalsList,
} from "@/components/coin-bot/coin-panels";
import { CoinHero } from "@/components/coin-bot/coin-hero";
import { CoinKpiStrip } from "@/components/coin-bot/coin-kpi-strip";
import { CoinBotHealth } from "@/components/coin-bot/coin-bot-health";
import { CoinRecentActivity } from "@/components/coin-bot/coin-recent-activity";
import earnoStacked from "@/assets/earno-stacked.jpg.asset.json";
import { getCoinPortfolio, getCoinHoldings } from "@/lib/coin-bot/coin-bot.functions";
import { SimpleView } from "@/components/home-simple/simple-view";
import { SimpleEarnings } from "@/components/home-simple/simple-earnings";
import { SimpleTrades } from "@/components/home-simple/simple-trades";
import { SimpleMore } from "@/components/home-simple/simple-more";
import { SimpleTabBar, type SimpleTab } from "@/components/home-simple/simple-tab-bar";

const HOME_VIEW_MODE_KEY = "earno_home_view_mode_v2";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Earn'O" },
      {
        name: "description",
        content: "Your Earn'O Wealth Engine at a glance — portfolio, status, and what's next.",
      },
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

type StatsExtras = DashboardStats & {
  weeklyNetPnl?: number;
  totalNetPnl?: number;
  winRate?: number;
  totalWins?: number;
  totalClosed?: number;
  profitFactor?: number;
  totalFees?: number;
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
  const { fmt } = useCurrency();

  const [confirmLive, setConfirmLive] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [hideBalance, setHideBalance] = useState(false);
  const [viewMode, setViewMode] = useState<"simple" | "detail">(() => {
    if (typeof window === "undefined") return "simple";
    const v = window.localStorage.getItem(HOME_VIEW_MODE_KEY);
    return v === "detail" ? "detail" : "simple";
  });
  useEffect(() => {
    try { window.localStorage.setItem(HOME_VIEW_MODE_KEY, viewMode); } catch {}
  }, [viewMode]);
  const [simpleTab, setSimpleTab] = useState<SimpleTab>("home");


  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => entFn() });

  const profile = useQuery({
    queryKey: ["home_profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("display_name,email")
        .eq("id", u.user.id)
        .maybeSingle();
      const displayName =
        (data?.display_name as string | null) ??
        (u.user.user_metadata?.full_name as string | undefined) ??
        null;
      return {
        displayName,
        email: (data?.email as string | null) ?? u.user.email ?? null,
      };
    },
  });

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

  const { market, setMarket } = useMarketMode();

  const stats = useQuery({
    queryKey: ["dashboard_stats", currentMode],
    queryFn: () => statsFn({ data: undefined }),
    refetchInterval: 15_000,
  });

  const coinPortfolioFn = useServerFn(getCoinPortfolio);
  const coinHoldingsFn = useServerFn(getCoinHoldings);

  const coinPortfolio = useQuery({
    queryKey: ["coin_portfolio"],
    queryFn: () => coinPortfolioFn(),
    enabled: market === "all",
    refetchInterval: 20_000,
  });

  const coinHoldings = useQuery({
    queryKey: ["coin_holdings"],
    queryFn: () => coinHoldingsFn(),
    enabled: market === "all",
    refetchInterval: 20_000,
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

  if (market === "all") {
    const coinSummary = (coinHoldings.data as {
      summary?: {
        current_value_usdt?: number;
        unrealized_pnl_usdt?: number;
        active_holdings?: number;
      };
    } | undefined)?.summary;
    const futuresValue = Number(s?.portfolioValue ?? c?.paper_equity ?? 0);
    const coinEquity =
      Number(coinPortfolio.data?.available_cash_usdt ?? 0) +
      Number(coinSummary?.current_value_usdt ?? 0);
    const totalValue = futuresValue + coinEquity;
    const futuresTodayPnl = Number(s?.todayPnl ?? 0);
    const coinTodayPnl =
      Number(coinPortfolio.data?.realized_today_usdt ?? 0) +
      Number(coinSummary?.unrealized_pnl_usdt ?? 0);
    const totalTodayPnl = futuresTodayPnl + coinTodayPnl;
    const coinHoldingCount = Number(coinSummary?.active_holdings ?? coinPortfolio.data?.active_holdings ?? 0);

    // Invested (cost basis) and profit-till-date, kept consistent with totalValue:
    // totalReturns = current value − what was put in, so Invested + Returns = Current.
    const futuresInvested = Number(s?.baselineEquity ?? c?.paper_equity ?? 0);
    const coinInvested = Number(coinPortfolio.data?.allocated_capital_usdt ?? 0);
    const totalInvested = futuresInvested + coinInvested;
    const totalReturns = totalValue - totalInvested;

    if (viewMode === "simple") {
      return (
        <>
          {simpleTab === "home" && (
            <SimpleView
              fmt={fmt}
              hideBalance={hideBalance}
              currentMode={currentMode}
              displayName={profile.data?.displayName}
              email={profile.data?.email}
              totalValue={totalValue}
              totalInvested={totalInvested}
              totalReturns={totalReturns}
              totalTodayPnl={totalTodayPnl}
              futuresValue={futuresValue}
              futuresTodayPnl={futuresTodayPnl}
              coinEquity={coinEquity}
              coinTodayPnl={coinTodayPnl}
              openCount={openCount}
              coinHoldingCount={coinHoldingCount}
            />
          )}
          {simpleTab === "earnings" && (
            <SimpleEarnings
              fmt={fmt}
              hideBalance={hideBalance}
              totalTodayPnl={totalTodayPnl}
              totalValue={totalValue}
              totalInvested={totalInvested}
              totalReturns={totalReturns}
              futuresValue={futuresValue}
              futuresInvested={futuresInvested}
              coinEquity={coinEquity}
              coinInvested={coinInvested}
            />
          )}
          {simpleTab === "trades" && (
            <SimpleTrades fmt={fmt} hideBalance={hideBalance} />
          )}
          {simpleTab === "more" && (
            <SimpleMore
              onSwitchToPro={() => setViewMode("detail")}
              hideBalance={hideBalance}
              onToggleHideBalance={() => setHideBalance((v) => !v)}
              currentMode={currentMode}
            />
          )}
          <SimpleTabBar active={simpleTab} onNavigate={setSimpleTab} />
        </>
      );
    }




    return (
      <div className="min-h-svh bg-background pb-28">
        <header className="px-5 pt-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate({ to: "/about" })}
              aria-label="About earn'O"
              className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img src={earnoStacked.url} alt="earn'O" className="h-11 w-auto select-none" draggable={false} />
            </button>
            <div className="ml-auto flex items-center gap-2">
              <MarketTogglePill />
              {isAdmin && (
                <IconBtn ariaLabel="Admin" onClick={() => navigate({ to: "/admin" })}>
                  <Crown className="size-4 text-primary" />
                </IconBtn>
              )}
              <IconBtn ariaLabel="Settings" onClick={() => navigate({ to: "/settings" })}>
                <Cog className="size-4" />
              </IconBtn>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setViewMode("simple")}
            className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground transition"
          >
            ‹ Simple view
          </button>
        </header>


        {/* Mode banner */}
        <div className="px-5 mt-4">
          <button
            type="button"
            onClick={() => { if (isLive) toggleMode.mutate(false); else setConfirmLive(true); }}
            className={`w-full text-left flex items-center gap-3 rounded-2xl border px-4 py-3 transition ${isLive ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10" : "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15"}`}
            aria-label="Toggle paper or live trading"
          >
            <span className={`inline-flex items-center justify-center size-9 rounded-full shrink-0 ${isLive ? "bg-destructive/15 text-destructive" : "bg-amber-500/20 text-amber-600 dark:text-amber-400"}`}>
              {isLive ? <BadgeCheck className="size-4" /> : <FlaskConical className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] font-semibold leading-tight ${isLive ? "text-destructive" : "text-amber-700 dark:text-amber-300"}`}>
                {isLive ? "LIVE trading active" : "PAPER — practice mode"}
              </p>
              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                {isLive ? "Real funds are at risk. Tap to switch back to Paper." : "All numbers reflect simulated trading. Tap to go Live."}
              </p>
            </div>
            <span className={`text-[10px] font-semibold tracking-wider px-2 h-6 inline-flex items-center rounded-full ${isLive ? "bg-destructive text-destructive-foreground" : "bg-amber-500 text-white"}`}>
              {isLive ? "LIVE" : "PAPER"}
            </span>
          </button>
        </div>

        {/* Aggregate hero — signature earn'O brand-hero surface */}
        <div className="px-5 mt-3">
          <section className="brand-hero rounded-2xl px-5 py-4 shadow-md">
            <div className="text-[11px] uppercase tracking-wider text-white/60">Your money · all</div>
            <div className="mt-1 flex items-baseline gap-2 flex-wrap">
              <div className="text-3xl font-semibold tabular-nums text-white">{fmt(totalValue)}</div>
              <div className={`text-[13px] font-medium tabular-nums ${totalTodayPnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {fmt(totalTodayPnl, { signed: true })} today
              </div>
            </div>
          </section>
        </div>

        {/* Breakdown */}
        <div className="px-5 mt-3">
          <section className="rounded-2xl border bg-card overflow-hidden">
            <div className="divide-y divide-border">
              <button
                type="button"
                onClick={() => { setMarket("futures"); }}
                className="w-full flex items-center justify-between px-4 py-3 bg-background/60 hover:bg-muted/40 transition text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-sm bg-primary inline-block" />
                  <span className="text-[12.5px] font-medium">Futures</span>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-semibold tabular-nums">{fmt(futuresValue)}</div>
                  <div className={`text-[11px] tabular-nums ${futuresTodayPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                    {fmt(futuresTodayPnl, { signed: true })} today
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => { setMarket("spot"); }}
                className="w-full flex items-center justify-between px-4 py-3 bg-background/60 hover:bg-muted/40 transition text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-sm bg-accent inline-block" />
                  <span className="text-[12.5px] font-medium">Coins</span>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-semibold tabular-nums">{fmt(coinEquity)}</div>
                  <div className={`text-[11px] tabular-nums ${coinTodayPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                    {fmt(coinTodayPnl, { signed: true })} today
                  </div>
                </div>
              </button>
            </div>
            <p className="px-4 py-2.5 text-[10.5px] text-muted-foreground">Tap a row to see that view in detail.</p>
          </section>
        </div>

        {/* Safety status */}
        <div className="px-5 mt-3">
          <div className="rounded-2xl border bg-card p-4 flex items-center gap-3">
            <span className={`size-8 grid place-items-center rounded-full shrink-0 ${statusTone}`}>
              <Activity className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">Wealth Engine · {statusLabel}</p>
              <p className="text-[11px] text-muted-foreground">{reason}</p>
            </div>
            <span className={`text-[9.5px] font-semibold tracking-wider px-2 h-5 inline-flex items-center rounded-full ${statusLabel === "Running" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
              {statusLabel}
            </span>
          </div>
        </div>


        {/* Recent activity */}
        <div className="mt-6">
          <RecentActivityFeed />
        </div>

        <TabBar />

        <AlertDialog open={confirmLive} onOpenChange={setConfirmLive}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-destructive" /> Switch to Live trading?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Real orders will be placed on CoinDCX using your funds. Your daily-loss cap is {Number(c?.daily_loss_cap_pct ?? 6)}%. You can switch back to Paper anytime.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay on Paper</AlertDialogCancel>
              <AlertDialogAction onClick={() => toggleMode.mutate(true)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Go Live</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-destructive" /> Emergency Stop
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will immediately halt the bot and force-close every open position at market price. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => kill.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Stop &amp; close all</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (market === "spot") {
    return (
      <div className="min-h-svh bg-background pb-28">
        <header className="px-5 pt-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate({ to: "/about" })}
              aria-label="About earn'O"
              className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img
                src={earnoStacked.url}
                alt="earn'O"
                className="h-11 w-auto select-none"
                draggable={false}
              />
            </button>
            <div className="ml-auto flex items-center gap-1">
              <MarketTogglePill />
              <IconBtn ariaLabel="Settings" onClick={() => navigate({ to: "/settings" })}>
                <Cog className="size-4" />
              </IconBtn>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Coin paper bot · live CoinDCX market data · no real orders
          </p>
        </header>
        <div className="px-5 mt-4 space-y-4">
          <CoinHero />
          <CoinKpiStrip />
          <CoinBotHealth />
          <section>
            <div className="px-1 pb-2 flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Top signals
              </div>
              <Link to="/scanner" className="text-[11px] font-medium text-primary">
                See all →
              </Link>
            </div>
            <CoinSignalsList hideHeader limit={5} />
          </section>
          <section>
            <div className="px-1 pb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Holdings
            </div>
            <CoinHoldingsCard />
          </section>
          <CoinRecentActivity />
        </div>
        <TabBar />
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-background pb-28">
      {/* ===== TOP BAR — brand + ops controls ===== */}
      <header className="px-5 pt-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: "/about" })}
            aria-label="About earn'O"
            className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img
              src={earnoStacked.url}
              alt="earn'O"
              className="h-11 w-auto select-none"
              draggable={false}
            />
          </button>
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
              isLive ? "bg-destructive text-destructive-foreground" : "bg-amber-500 text-white"
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
                {fmt(s?.openPnl ?? 0, { signed: true })}
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

      {/* ===== Portfolio summary card ===== */}
      <div className="px-5 mt-3">
        <DailyChart
          portfolioValue={Number(s?.portfolioValue ?? c?.paper_equity ?? 0)}
          todayPnl={Number(s?.todayPnl ?? 0)}
          totalPnl={Number(s?.realizedPnlAllTime ?? 0)}
          totalPnlPct={s?.baselineEquity ? (Number(s.realizedPnlAllTime ?? 0) / s.baselineEquity) * 100 : 0}
          weekChangeAbs={Number(s?.weekChangeAbs ?? 0)}
          dailyPnl={s?.dailyPnl ?? []}
          hideBalance={hideBalance}
          onToggleHide={() => setHideBalance((v) => !v)}
          fmt={fmt}
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

      {/* ===== Weekly performance strip ===== */}
      <PerformanceStrip s={s} fmt={fmt} />

      {/* ===== Personalized recommendations (RAG) ===== */}
      <RecommendationsPanel />


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
    </div>
  );
}

function PerformanceStrip({
  s,
  fmt,
}: {
  s: StatsExtras | undefined;
  fmt: (n: number | null | undefined, opts?: { signed?: boolean }) => string;
}) {
  const netValue =
    s?.weeklyNetPnl ?? s?.totalNetPnl ?? s?.weekChangeAbs;
  const netLabel =
    s?.weeklyNetPnl != null ? "Net PnL" : s?.totalNetPnl != null ? "All time net" : "Net PnL";

  const computedWinRate =
    s?.totalWins != null && s?.totalClosed != null && s.totalClosed > 0
      ? s.totalWins / s.totalClosed
      : undefined;
  const winRate = s?.winRate ?? computedWinRate;

  const pf = s?.profitFactor;
  const fees = s?.totalFees ?? s?.realizedFeesAllTime;

  return (
    <section className="px-5 mt-3">
      <div className="grid grid-cols-4 gap-2 rounded-2xl border bg-card px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{netLabel}</p>
          <p className="mt-0.5 text-[13px] font-semibold tabular-nums truncate">
            {netValue == null ? "—" : fmt(netValue, { signed: true })}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">Win rate</p>
          <p className="mt-0.5 text-[13px] font-semibold tabular-nums truncate">
            {winRate == null ? (
              <span className="text-[11px] text-muted-foreground font-normal">Not yet</span>
            ) : `${(winRate * 100).toFixed(0)}%`}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">Profit factor</p>
          <p
            className={`mt-0.5 text-[13px] font-semibold tabular-nums truncate ${
              pf == null
                ? ""
                : pf > 1
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {pf == null ? (
              <span className="text-[11px] text-muted-foreground font-normal">Not yet</span>
            ) : pf.toFixed(2)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">Trading fees</p>
          <p className="mt-0.5 text-[13px] font-semibold tabular-nums truncate text-foreground">
            {fees == null ? "—" : fmt(Math.abs(fees))}
          </p>
          <p className="text-[10px] text-muted-foreground truncate">paid to exchange</p>
        </div>
      </div>
      {winRate == null && pf == null && (
        <p className="mt-2 text-[10.5px] text-muted-foreground px-1">
          Win rate and profit factor appear after ~30 closed positions.
        </p>
      )}
    </section>
  );
}

function CompactRiskRow({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-background/40 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-medium truncate">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <span
        className={`text-[12px] font-semibold tabular-nums shrink-0 ml-2 ${
          warn ? "text-amber-600 dark:text-amber-400" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function RiskRow({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
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
    { v: "all", label: "All" },
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
              active
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}


function DailyChart({
  portfolioValue,
  todayPnl,
  totalPnl,
  totalPnlPct,
  weekChangeAbs,
  dailyPnl,
  hideBalance,
  onToggleHide,
  fmt,
}: {
  portfolioValue: number;
  todayPnl: number;
  totalPnl: number;
  totalPnlPct: number;
  weekChangeAbs: number;
  dailyPnl: { date: string; pnl: number }[];
  hideBalance: boolean;
  onToggleHide: () => void;
  fmt: (usd: number | null | undefined, opts?: { signed?: boolean; digits?: number }) => string;
}) {
  const series = dailyPnl.slice(-14);
  const maxAbs = series.reduce((a, d) => Math.max(a, Math.abs(d.pnl)), 0);
  const todayPos = todayPnl >= 0;

  let context = "Flat week";
  if (todayPnl > 0 && weekChangeAbs > 0) {
    let streak = 0;
    for (let i = dailyPnl.length - 1; i >= 0; i--) {
      if (dailyPnl[i].pnl > 0) streak++;
      else break;
    }
    context = `${Math.max(streak, 1)}-day win streak`;
  } else if (weekChangeAbs < 0) {
    context = "Down this week — bot is adjusting";
  }

  return (
    <section className="rounded-2xl border bg-card px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Portfolio value
          </div>
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <div className="text-3xl font-semibold tabular-nums">
              {hideBalance ? "••••••" : fmt(portfolioValue)}
            </div>
            <div
              className={`text-[13px] font-medium tabular-nums ${
                todayPos
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {fmt(todayPnl, { signed: true })} today
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleHide}
          aria-label={hideBalance ? "Show balance" : "Hide balance"}
          className="size-8 grid place-items-center rounded-full hover:bg-muted text-muted-foreground"
        >
          {hideBalance ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border bg-background/60 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total P&L</p>
          <p
            className={`mt-0.5 text-[14px] font-semibold tabular-nums ${
              totalPnl >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {fmt(totalPnl, { signed: true })}
          </p>
        </div>
        <div className="rounded-xl border bg-background/60 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Return</p>
          <p
            className={`mt-0.5 text-[14px] font-semibold tabular-nums ${
              totalPnlPct >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {totalPnlPct >= 0 ? "+" : "−"}
            {Math.abs(totalPnlPct).toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="mt-4">
        {series.length < 3 ? (
          <div className="h-[64px] grid place-items-center text-[12px] text-muted-foreground">
            Chart builds as trades close
          </div>
        ) : (
          <div className="flex items-end gap-1.5 h-[64px]">
            {series.map((d) => {
              const ratio = maxAbs > 0 ? Math.abs(d.pnl) / maxAbs : 0;
              const h = Math.max(3, Math.round(ratio * 48));
              const pos = d.pnl >= 0;
              const day = d.date.slice(-2);
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className={`w-full rounded-sm ${
                      pos ? "bg-emerald-500/80" : "bg-rose-500/80"
                    }`}
                    style={{ height: `${h}px` }}
                  />
                  <div className="text-[9px] text-muted-foreground tabular-nums leading-none">
                    {day}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 text-[11px] text-muted-foreground">{context}</div>
    </section>
  );
}

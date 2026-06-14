import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { updateConfig, killAll, triggerMyAutoBookNow } from "@/lib/bot.functions";
import { getDashboardStats } from "@/lib/stats.functions";
import { getMyEntitlements } from "@/lib/plans.functions";
import { PLAN_NAME, type PlanTier } from "@/lib/plans";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TabBar } from "@/components/tab-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { PositionsStrip } from "@/components/positions-strip";
import { CopilotBeta } from "@/components/copilot-beta";
import { WealthHero } from "@/components/wealth-hero";
import { useCurrency } from "@/hooks/use-currency";
import { toast } from "sonner";
import earnoStacked from "@/assets/earno-stacked.jpg.asset.json";
import {
  Settings,
  HelpCircle,
  Power,
  AlertTriangle,
  Crown,
  ShieldCheck,
  Sparkles,
  Eye,
  EyeOff,
  Radar,
  Briefcase,
  Flame,
  ChevronRight,
  Zap,
  Rocket,
  CheckCircle2,
  KeyRound,
  SlidersHorizontal,
  Bot,
  LineChart,
  Crown as CrownIcon,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Earn'O" },
      { name: "description", content: "Live status of your Earn'O automated CoinDCX futures scalping bot." },
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

function pct(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}
function tone(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "text-muted-foreground";
  return n >= 0 ? "text-emerald-500" : "text-destructive";
}

const TABS = ["Overview", "Bot", "Activity", "Beta ✨"] as const;
type Tab = (typeof TABS)[number];

function Home() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const updateFn = useServerFn(updateConfig);
  const killFn = useServerFn(killAll);
  const statsFn = useServerFn(getDashboardStats);
  const entFn = useServerFn(getMyEntitlements);
  const triggerFn = useServerFn(triggerMyAutoBookNow);

  const [tab, setTab] = useState<Tab>("Overview");
  const [hideBalance, setHideBalance] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => entFn() });

  const profile = useQuery({
    queryKey: ["my_profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("display_name,email")
        .eq("id", u.user.id)
        .maybeSingle();
      return {
        display_name: (data?.display_name as string | null) ?? (u.user.user_metadata?.full_name as string | undefined) ?? null,
        email: (data?.email as string | null) ?? u.user.email ?? null,
        avatar_url: (u.user.user_metadata?.avatar_url as string | undefined) ?? null,
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

  const positions = useQuery({
    queryKey: ["positions_open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("id,symbol,side,leverage,entry_price,mark_price,pnl_pct,opened_at")
        .eq("status", "open")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
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

  const tier: PlanTier = ent.data?.tier ?? "free";
  const paywall = ent.data?.paywallEnabled ?? true;
  const canRunBot = !paywall || tier === "auto5" || tier === "unlimited";
  const isAdmin = !!ent.data?.isAdmin;

  const toggleRun = useMutation({
    mutationFn: async (run: boolean) => {
      if (run && !canRunBot) {
        navigate({ to: "/upgrade" });
        throw new Error("Upgrade required to start the bot");
      }
      return updateFn({ data: { is_running: run, auto_book: run } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bot_config"] }),
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Update failed";
      if (msg.startsWith("PAYMENT_REQUIRED")) {
        toast.error("Upgrade required to start the bot");
        navigate({ to: "/upgrade" });
      } else if (!msg.includes("Upgrade required")) toast.error(msg);
    },
  });

  const kill = useMutation({
    mutationFn: async () => killFn({ data: undefined }),
    onSuccess: () => {
      toast.success("Emergency stop: bot halted, positions closed.");
      qc.invalidateQueries();
    },
  });

  const { fmt } = useCurrency();
  const c = cfg.data;
  const isLive = c?.mode === "live";
  const isRunning = c?.is_running ?? false;
  const equity = Number(c?.paper_equity ?? 0);
  const portfolio = stats.data?.portfolioValue ?? equity;
  const s = stats.data;
  const dailyCap = Number(c?.daily_loss_cap_pct ?? 6);

  const masked = "••••••";

  return (
    <div className="min-h-svh bg-background pb-44">
      <PositionsStrip />

      {/* Profile bar */}
      <div className="px-5 pt-4 flex items-center gap-3">
        <Link
          to="/settings"
          className="size-10 rounded-full bg-primary/10 text-primary grid place-items-center font-semibold overflow-hidden shrink-0"
          aria-label="Profile"
        >
          {profile.data?.avatar_url ? (
            <img src={profile.data.avatar_url} alt="" className="size-full object-cover" />
          ) : (
            (profile.data?.display_name?.[0] ?? profile.data?.email?.[0] ?? "U").toUpperCase()
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">
            {profile.data?.display_name ?? "Welcome"}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {profile.data?.email ?? ""}
            {isAdmin ? <span className="ml-1.5 inline-flex items-center px-1.5 h-4 rounded-full bg-primary/10 text-primary text-[10px] font-medium align-middle">Admin</span> : null}
          </p>
        </div>
        <span className={`text-[10px] px-2 h-5 inline-flex items-center rounded-full font-medium shrink-0 ${
          tier === "unlimited" ? "bg-primary text-primary-foreground" :
          tier === "auto5" ? "bg-primary/10 text-primary" :
          "bg-muted text-muted-foreground"
        }`}>
          {PLAN_NAME[tier]}
        </span>
      </div>


      {/* Header */}
      <header className="px-5 pt-5 pb-3 flex items-center justify-between gap-3">
        <img
          src={earnoStacked.url}
          alt="Earn'O"
          className="h-9 w-auto select-none"
          draggable={false}
        />
        <div className="flex items-center gap-0.5 shrink-0">
          <ThemeToggle />
          {isAdmin && (
            <Link to="/admin" title="Admin" className="size-9 grid place-items-center rounded-full hover:bg-muted">
              <ShieldCheck className="size-5 text-primary" />
            </Link>
          )}
          <Link
            to="/upgrade"
            title={`Plan: ${PLAN_NAME[tier]}`}
            className="size-9 grid place-items-center rounded-full hover:bg-muted"
          >
            {tier === "unlimited" ? <Crown className="size-5 text-primary" /> :
              tier === "free" ? <Sparkles className="size-5 text-muted-foreground" /> :
              <Sparkles className="size-5 text-primary" />}
          </Link>
          <Link to="/help" className="size-9 grid place-items-center rounded-full hover:bg-muted">
            <HelpCircle className="size-5 text-muted-foreground" />
          </Link>
          <Link to="/settings" className="size-9 grid place-items-center rounded-full hover:bg-muted">
            <Settings className="size-5 text-muted-foreground" />
          </Link>
          <button
            type="button"
            onClick={() => setShowGuide(true)}
            className="size-9 grid place-items-center rounded-full hover:bg-muted"
            aria-label="Get started guide"
            title="Get started"
          >
            <Rocket className="size-5 text-primary" />
          </button>
        </div>
      </header>

      {/* Top segmented tabs (CoinDCX-style) */}
      <div className="px-5">
        <div className="flex items-center gap-5 border-b">
          {TABS.map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`relative -mb-px py-2.5 text-sm font-medium transition-colors ${
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
                {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary rounded-full" />}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "Overview" && (
        <>
          {/* Wealth command center */}
          <WealthHero
            stats={s}
            equityFallback={equity}
            isLive={isLive}
            hideBalance={hideBalance}
            onToggleHide={() => setHideBalance((v) => !v)}
          />

          {/* Action row */}
          <section className="px-5 mt-5">
            <div className="grid grid-cols-3 gap-2">
              <ActionTile
                icon={<Power className="size-4" />}
                label={isRunning ? "Stop bot" : "Start bot"}
                tone={isRunning ? "danger" : "primary"}
                onClick={() => toggleRun.mutate(!isRunning)}
              />
              <ActionTile
                icon={<Radar className="size-4" />}
                label="Scanner"
                onClick={() => navigate({ to: "/scanner" })}
              />
              <ActionTile
                icon={<Briefcase className="size-4" />}
                label="Positions"
                onClick={() => navigate({ to: "/positions" })}
              />
            </div>
          </section>


          {/* Featured banner */}
          {!canRunBot && (
            <Link
              to="/upgrade"
              className="mx-5 mt-5 block rounded-2xl p-4 bg-gradient-to-br from-primary to-[#3B82F6] text-primary-foreground"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs opacity-80">{PLAN_NAME[tier]} plan</p>
                  <p className="font-semibold mt-0.5">Unlock auto-trading</p>
                  <p className="text-xs opacity-80 mt-0.5">Let the bot book trades for you 24/7.</p>
                </div>
                <span className="text-[11px] px-2.5 h-7 inline-flex items-center rounded-full bg-white text-primary font-medium shrink-0">
                  Upgrade
                </span>
              </div>
            </Link>
          )}

          {/* Daily-loss meter */}
          <section className="px-5 mt-5">
            <div className="rounded-2xl border bg-card p-4">
              <div className="flex justify-between text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                <span>Daily loss used</span>
                <span className="tabular-nums">{(s?.dailyLossUsedPct ?? 0).toFixed(0)}% of {dailyCap}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    (s?.dailyLossUsedPct ?? 0) > 80 ? "bg-destructive" :
                    (s?.dailyLossUsedPct ?? 0) > 50 ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, s?.dailyLossUsedPct ?? 0)}%` }}
                />
              </div>
            </div>
          </section>

          {/* Stat grid */}
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
              value={hideBalance ? masked : (s ? fmt(s.maxDrawdown) : "—")}
              sub={s && s.consecutiveLosses > 0 ? `${s.consecutiveLosses} loss streak` : undefined}
            />
          </section>

          {/* Products list */}
          <section className="px-5 mt-6">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Products</h2>
            <div className="rounded-2xl border bg-card divide-y">
              <ProductRow to="/scanner" icon={<Radar className="size-5 text-primary" />} title="Scanner" desc="Auto-book setups ranked by confidence" />
              <ProductRow to="/positions" icon={<Briefcase className="size-5 text-primary" />} title="Positions" desc="Manage open trades & override TP/SL" />
              <ProductRow to="/movers" icon={<Flame className="size-5 text-destructive" />} title="Movers" desc="Biggest gainers and losers right now" />
              <ProductRow to="/settings" icon={<Settings className="size-5 text-muted-foreground" />} title="Settings" desc="Risk, leverage, exchange keys" />
            </div>
          </section>
        </>
      )}

      {tab === "Bot" && (
        <section className="px-5 pt-5 space-y-3">
          <div className="rounded-2xl border bg-card p-4 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`size-2.5 rounded-full shrink-0 ${isRunning ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
              <div className="min-w-0">
                <p className="font-medium text-sm">Bot {isRunning ? "running" : "stopped"}</p>
                <p className="text-xs text-muted-foreground">Auto-book cron {isRunning ? "active" : "paused"}</p>
              </div>
            </div>
            <Switch checked={isRunning} onCheckedChange={(v) => toggleRun.mutate(v)} />
          </div>

          <NextRunCard
            disabled={!isRunning}
            onRun={async () => {
              try {
                const res = await triggerFn({ data: undefined });
                toast.success(
                  `Manual run done — opened ${res.opened}, skipped ${res.skipped}, marked ${res.marked}, closed ${res.closed}`,
                );
                qc.invalidateQueries({ queryKey: ["positions_open"] });
                qc.invalidateQueries({ queryKey: ["dashboard_stats"] });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Manual run failed");
              }
            }}
          />



          <div className="rounded-2xl border bg-card p-4 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`size-2.5 rounded-full shrink-0 ${isLive ? "bg-destructive" : "bg-emerald-500"}`} />
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

          {isLive && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              Live mode active. Real funds at risk.
            </div>
          )}

          <Link to="/settings" className="rounded-2xl border bg-card p-4 flex items-center justify-between hover:bg-muted/40 transition">
            <div>
              <p className="text-sm font-medium">Risk & strategy</p>
              <p className="text-xs text-muted-foreground mt-0.5">Leverage, TP/SL, daily-loss cap</p>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        </section>
      )}

      {tab === "Activity" && (
        <section className="px-5 pt-5">
          <div className="rounded-2xl border bg-card divide-y">
            {(positions.data ?? []).slice(0, 8).map((p) => (
              <div key={p.id} className="p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm">
                    {p.symbol} <span className={p.side === "long" ? "text-emerald-500" : "text-destructive"}>{p.side.toUpperCase()}</span>
                    <span className="text-muted-foreground"> ×{p.leverage}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Entry {Number(p.entry_price).toFixed(4)} · {new Date(p.opened_at).toLocaleTimeString()}
                  </p>
                </div>
                <span className={`text-sm tabular-nums font-medium ${tone(p.pnl_pct as number | null)}`}>
                  {pct(p.pnl_pct as number | null)}
                </span>
              </div>
            ))}
            {(positions.data ?? []).length === 0 && (
              <p className="p-6 text-center text-xs text-muted-foreground">No open positions.</p>
            )}
          </div>
          <Link to="/positions" className="mt-3 block text-center text-xs text-primary py-2">
            View all positions →
          </Link>
        </section>
      )}

      {tab === "Beta ✨" && <CopilotBeta />}

      {/* Bottom action bar */}
      <div className="fixed bottom-14 inset-x-0 bg-background/90 backdrop-blur border-t px-5 py-3 flex items-center gap-3 z-20">
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

      {/* Get Started Guide */}
      <Sheet open={showGuide} onOpenChange={setShowGuide}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-8 max-h-[85svh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Getting Started</SheetTitle>
            <SheetDescription>Your quick-start guide to Earn'O</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <GuideStep
              n={1}
              icon={<KeyRound className="size-5 text-primary" />}
              title="Connect API Keys"
              desc="Go to Settings and add your CoinDCX API key & secret so the bot can place orders."
            />
            <GuideStep
              n={2}
              icon={<SlidersHorizontal className="size-5 text-primary" />}
              title="Set Your Risk"
              desc="Choose leverage, take-profit, stop-loss, and a daily loss cap that fits your comfort."
            />
            <GuideStep
              n={3}
              icon={<Bot className="size-5 text-primary" />}
              title="Start the Bot"
              desc="Tap Start Bot. It begins in Paper mode by default so you can practice without real money."
            />
            <GuideStep
              n={4}
              icon={<Radar className="size-5 text-primary" />}
              title="Watch the Scanner"
              desc="Open Scanner to see live opportunities ranked by confidence and expected return."
            />
            <GuideStep
              n={5}
              icon={<LineChart className="size-5 text-primary" />}
              title="Track Positions"
              desc="Monitor open trades, PnL, and history in the Positions tab. You can override TP/SL anytime."
            />
            <GuideStep
              n={6}
              icon={<CrownIcon className="size-5 text-primary" />}
              title="Upgrade When Ready"
              desc="Free plans get limited auto-runs. Upgrade to Auto or Unlimited for 24/7 automated trading."
            />
          </div>
          <div className="mt-6 flex gap-3">
            <Button className="flex-1 rounded-xl h-12" onClick={() => setShowGuide(false)}>
              <CheckCircle2 className="size-4 mr-2" />
              Got it
            </Button>
            <Button variant="outline" className="flex-1 rounded-xl h-12" onClick={() => { setShowGuide(false); navigate({ to: "/settings" }); }}>
              <KeyRound className="size-4 mr-2" />
              Open Settings
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ActionTile({
  icon, label, onClick, tone = "default",
}: { icon: React.ReactNode; label: string; onClick: () => void; tone?: "default" | "primary" | "danger" }) {
  const cls =
    tone === "primary" ? "bg-primary text-primary-foreground hover:opacity-90" :
    tone === "danger" ? "bg-destructive/10 text-destructive hover:bg-destructive/15" :
    "bg-secondary text-foreground hover:bg-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl py-3.5 text-xs font-medium transition ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}

function ProductRow({ to, icon, title, desc }: { to: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 p-4 hover:bg-muted/40 transition">
      <div className="size-10 grid place-items-center rounded-xl bg-muted shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{desc}</p>
      </div>
      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
    </Link>
  );
}

function NextRunCard({ disabled, onRun }: { disabled: boolean; onRun: () => void | Promise<void> }) {
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Cron schedule: every 2 minutes (*/2 * * * *).
  const next = new Date(now);
  next.setSeconds(0, 0);
  const minutesToAdd = next.getMinutes() % 2 === 0 ? 2 : 1;
  next.setMinutes(next.getMinutes() + minutesToAdd);
  const secs = Math.max(0, Math.round((next.getTime() - now) / 1000));
  const mm = Math.floor(secs / 60);
  const ss = (secs % 60).toString().padStart(2, "0");
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  const handleRun = async () => {
    if (pending || cooldownLeft > 0 || disabled) return;
    setPending(true);
    try {
      await onRun();
    } finally {
      setPending(false);
      setCooldownUntil(Date.now() + 60_000);
    }
  };

  return (
    <div className="rounded-2xl border bg-card p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Next auto run</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {disabled ? "Bot stopped — start it to enable the scheduler" : `in ${mm}m ${ss}s`}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="rounded-xl shrink-0"
        onClick={handleRun}
        disabled={disabled || pending || cooldownLeft > 0}
        aria-label="Run auto-book now"
      >
        <Zap className="size-4 mr-1.5" />
        {pending ? "Running…" : cooldownLeft > 0 ? `Wait ${cooldownLeft}s` : "Run now"}
      </Button>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border bg-card p-3.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums mt-1 leading-tight">{value}</p>
      {sub ? <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p> : null}
    </div>
  );
}

function GuideStep({
  icon,
  title,
  desc,
  n,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  n: number;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="size-8 rounded-full bg-primary/10 grid place-items-center shrink-0 text-[11px] font-semibold text-primary">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-sm font-medium">{title}</p>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

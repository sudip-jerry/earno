import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { killAll, triggerMyAutoBookNow, updateConfig } from "@/lib/bot.functions";
import { getDashboardStats } from "@/lib/stats.functions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TabBar } from "@/components/tab-bar";
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
import { AlertTriangle, ChevronLeft, ChevronRight, Power, Zap } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/bot")({
  head: () => ({
    meta: [
      { title: "Bot — Earn'O" },
      { name: "description", content: "Manage your Earn'O Wealth Engine: pause, resume, or emergency-stop the bot." },
    ],
  }),
  component: BotPage,
});

type ConfigRow = {
  mode: "paper" | "live";
  is_running: boolean;
  daily_loss_cap_pct: number;
};

function BotPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const updateFn = useServerFn(updateConfig);
  const killFn = useServerFn(killAll);
  const triggerFn = useServerFn(triggerMyAutoBookNow);
  const statsFn = useServerFn(getDashboardStats);

  const [confirmLive, setConfirmLive] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const cfg = useQuery({
    queryKey: ["bot_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_config")
        .select("mode,is_running,daily_loss_cap_pct")
        .maybeSingle();
      if (error) throw error;
      return data as ConfigRow | null;
    },
  });

  const stats = useQuery({
    queryKey: ["dashboard_stats", cfg.data?.mode ?? "paper"],
    queryFn: () => statsFn({ data: undefined }),
    refetchInterval: 15_000,
  });

  const isLive = cfg.data?.mode === "live";
  const isRunning = cfg.data?.is_running ?? false;
  const dailyCap = Number(cfg.data?.daily_loss_cap_pct ?? 6);

  const toggleMode = useMutation({
    mutationFn: async (live: boolean) => updateFn({ data: { mode: live ? "live" : "paper" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bot_config"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const toggleRun = useMutation({
    mutationFn: async (run: boolean) => updateFn({ data: { is_running: run, auto_book: run } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bot_config"] }),
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Update failed";
      if (msg.startsWith("PAYMENT_REQUIRED")) {
        toast.error("Upgrade required to start the bot");
        navigate({ to: "/upgrade" });
      } else toast.error(msg);
    },
  });

  const kill = useMutation({
    mutationFn: async () => killFn({ data: undefined }),
    onSuccess: () => {
      toast.success("Emergency stop: bot halted and positions closed.");
      qc.invalidateQueries();
    },
  });

  return (
    <div className="min-h-svh bg-background pb-28">
      <header className="px-5 pt-5 pb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/" })}
          className="size-9 grid place-items-center rounded-full hover:bg-muted -ml-2"
          aria-label="Back"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="text-lg font-semibold tracking-tight">Bot</h1>
        <span
          className={`ml-auto text-[10px] font-semibold tracking-wider px-2 h-5 inline-flex items-center rounded-full ${
            isLive
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
          }`}
        >
          {isLive ? "LIVE" : "PAPER"}
        </span>
      </header>

      <section className="px-5 mt-2 space-y-3">
        <div className="rounded-2xl border bg-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`size-2.5 rounded-full shrink-0 ${isRunning ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/40"}`} />
            <div className="min-w-0">
              <p className="font-medium text-sm">Wealth Engine {isRunning ? "running" : "paused"}</p>
              <p className="text-xs text-muted-foreground">
                {isRunning ? "Auto-booking is active" : "Tap to resume auto-booking"}
              </p>
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
                `Run done — opened ${res.opened}, skipped ${res.skipped}, closed ${res.closed}`,
              );
              qc.invalidateQueries({ queryKey: ["dashboard_stats"] });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Manual run failed");
            }
          }}
        />

        {stats.data?.noTradeReason && stats.data.noTradeReason !== "Waiting for better entry." && (
          <div className="rounded-2xl border bg-muted/40 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Why no trade</p>
            <p className="text-sm">{stats.data.noTradeReason}</p>
          </div>
        )}



        <div className="rounded-2xl border bg-card p-4 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Trading mode</p>
            <p className="text-xs text-muted-foreground truncate">
              {isLive ? "Real orders on CoinDCX" : "Simulated, no real money"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[11px] font-semibold tracking-wider ${!isLive ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>PAPER</span>
            <Switch
              checked={isLive}
              disabled={toggleMode.isPending}
              onCheckedChange={(v) => {
                if (v) setConfirmLive(true);
                else toggleMode.mutate(false);
              }}
              aria-label="Toggle paper or live trading"
            />
            <span className={`text-[11px] font-semibold tracking-wider ${isLive ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>LIVE</span>
          </div>
        </div>

        <Link to="/settings" className="rounded-2xl border bg-card p-4 flex items-center justify-between hover:bg-muted/40 transition">
          <div className="min-w-0">
            <p className="text-sm font-medium">Risk &amp; strategy</p>
            <p className="text-xs text-muted-foreground mt-0.5">Leverage, TP/SL, daily-loss cap ({dailyCap}%)</p>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>

        <div className="grid grid-cols-3 gap-2 pt-2">
          <Stat label="Open" value={`${stats.data?.openCount ?? 0}`} />
          <Stat label="Today" value={`${stats.data?.tradesToday ?? 0}`} />
          <Stat label="Scanned" value={`${stats.data?.marketsScannedToday ?? 0}`} />
        </div>

        <div className="pt-4 space-y-2">
          <Button
            variant="outline"
            className="w-full h-12 rounded-xl"
            onClick={() => toggleRun.mutate(!isRunning)}
            disabled={toggleRun.isPending}
          >
            <Power className="size-4 mr-2" />
            {isRunning ? "Pause Bot" : "Start Bot"}
          </Button>
          <Button
            variant="ghost"
            className="w-full h-12 rounded-xl text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setConfirmStop(true)}
            disabled={kill.isPending}
          >
            <AlertTriangle className="size-4 mr-2" />
            Emergency Stop
          </Button>
          <p className="text-[11px] text-muted-foreground text-center px-6 pt-1 leading-relaxed">
            Emergency Stop halts the bot and force-closes all open positions at market.
          </p>
        </div>
      </section>

      <TabBar />

      <AlertDialog open={confirmLive} onOpenChange={setConfirmLive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" />
              Switch to Live trading?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Real orders will be placed on CoinDCX using your funds. Your daily-loss cap is {dailyCap}%.
              You can switch back to Paper anytime.
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3 text-center">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
    </div>
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
          {disabled ? "Bot paused — resume to enable the scheduler" : `in ${mm}m ${ss}s`}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="rounded-xl shrink-0"
        onClick={handleRun}
        disabled={disabled || pending || cooldownLeft > 0}
      >
        <Zap className="size-4 mr-1.5" />
        {pending ? "Running…" : cooldownLeft > 0 ? `Wait ${cooldownLeft}s` : "Run now"}
      </Button>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { updateConfig, killAll } from "@/lib/bot.functions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TabBar } from "@/components/tab-bar";
import { toast } from "sonner";
import { Settings, HelpCircle, Power, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard — EarnO" },
      { name: "description", content: "Live status of your EarnO automated CoinDCX futures trading bot." },
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

function Home() {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateConfig);
  const killFn = useServerFn(killAll);

  const cfg = useQuery({
    queryKey: ["bot_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_config")
        .select("mode,is_running,leverage,take_profit_pct,stop_loss_pct,paper_equity")
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
      return (data ?? []) as PositionRow[];
    },
    refetchInterval: 5000,
  });

  // Realtime: refresh on changes
  useEffect(() => {
    const ch = supabase
      .channel("home")
      .on("postgres_changes", { event: "*", schema: "public", table: "positions" }, () => {
        qc.invalidateQueries({ queryKey: ["positions_open"] });
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
      toast.success("Bot stopped. All positions closed.");
      qc.invalidateQueries();
    },
  });

  const c = cfg.data;
  const isLive = c?.mode === "live";
  const isRunning = c?.is_running ?? false;

  const totalPnlPct =
    (positions.data ?? []).reduce((acc, p) => acc + Number(p.pnl_pct ?? 0), 0) /
    Math.max(positions.data?.length ?? 1, 1);

  return (
    <div className="min-h-svh bg-background pb-40">
      {/* Header */}
      <header className="px-5 pt-6 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">EarnO</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isLive ? "Trading with real funds" : "Paper trading"}
          </p>
        </div>
        <Link to="/settings" className="size-10 grid place-items-center rounded-full hover:bg-muted">
          <Settings className="size-5 text-muted-foreground" />
        </Link>
      </header>

      {/* Mode toggle */}
      <section className="px-5">
        <div className="rounded-2xl border bg-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`size-2 rounded-full shrink-0 ${
                isLive ? "bg-destructive" : "bg-emerald-500"
              }`}
            />
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

      {/* Equity summary */}
      <section className="px-5 mt-4">
        <div className="rounded-2xl border bg-card p-5">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            {isLive ? "Account" : "Paper equity"}
          </p>
          <p className="text-3xl font-semibold tracking-tight mt-1 tabular-nums">
            ${Number(c?.paper_equity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
          {positions.data && positions.data.length > 0 ? (
            <p
              className={`text-sm mt-1 tabular-nums ${
                totalPnlPct >= 0 ? "text-emerald-600" : "text-destructive"
              }`}
            >
              {totalPnlPct >= 0 ? "+" : ""}
              {totalPnlPct.toFixed(2)}% avg open
            </p>
          ) : (
            <p className="text-sm mt-1 text-muted-foreground">No open positions</p>
          )}

          <div className="grid grid-cols-3 gap-3 mt-5 pt-5 border-t">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Leverage</p>
              <p className="text-sm font-medium mt-0.5">{c?.leverage ?? 3}x</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">TP</p>
              <p className="text-sm font-medium mt-0.5 text-emerald-600">
                +{c?.take_profit_pct ?? 3}%
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">SL</p>
              <p className="text-sm font-medium mt-0.5 text-destructive">−{c?.stop_loss_pct ?? 2}%</p>
            </div>
          </div>
        </div>
      </section>

      {/* Positions */}
      <section className="px-5 mt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium">
            Positions{" "}
            <span className="text-muted-foreground">({positions.data?.length ?? 0})</span>
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
                          p.side === "long"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : "bg-destructive/10 text-destructive"
                        }`}
                      >
                        {p.side.toUpperCase()} {p.leverage}x
                      </span>
                    </div>
                    <div
                      className={`flex items-center gap-1 font-medium tabular-nums text-sm ${
                        up ? "text-emerald-600" : "text-destructive"
                      }`}
                    >
                      {up ? (
                        <TrendingUp className="size-3.5" />
                      ) : (
                        <TrendingDown className="size-3.5" />
                      )}
                      {up ? "+" : ""}
                      {pnl.toFixed(2)}%
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Entry </span>
                      <span className="tabular-nums">{Number(p.entry_price).toFixed(4)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-muted-foreground">Mark </span>
                      <span className="tabular-nums">
                        {p.mark_price != null ? Number(p.mark_price).toFixed(4) : "—"}
                      </span>
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
              {isRunning
                ? "Scanning the market for setups."
                : "Start the bot to begin scanning."}
            </p>
          </div>
        )}
      </section>

      {/* Bottom action bar */}
      <div className="fixed bottom-14 inset-x-0 bg-background/80 backdrop-blur border-t px-5 py-3 flex items-center gap-3 z-20">
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
            if (confirm("Kill switch: stop bot AND close all open positions at market. Continue?"))
              kill.mutate();
          }}
          disabled={kill.isPending}
          aria-label="Kill switch"
        >
          <AlertTriangle className="size-4" />
        </Button>
      </div>

      <TabBar />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getTopMovers, bookManualTrade, type Mover } from "@/lib/movers.functions";
import { getDashboardStats } from "@/lib/stats.functions";
import { useCurrency } from "@/hooks/use-currency";
import { RecommendationModal } from "@/components/recommendation-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { BetaLanding } from "@/components/beta-landing";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Target,
  HelpCircle,
  MessageSquare,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";

type ConfidenceLevel = "High" | "Medium" | "Low";

function confLevel(c: number): ConfidenceLevel {
  if (c >= 70) return "High";
  if (c >= 50) return "Medium";
  return "Low";
}

function actionWord(m: Mover): "Long" | "Short" | "Wait" {
  if (m.action === "long") return "Long";
  if (m.action === "short") return "Short";
  return "Wait";
}

function actionTone(a: "Long" | "Short" | "Wait") {
  if (a === "Long") return "bg-emerald-500/10 text-emerald-500 border-emerald-500/30";
  if (a === "Short") return "bg-destructive/10 text-destructive border-destructive/30";
  return "bg-muted text-muted-foreground border-border";
}

function expectedDurationMin(m: Mover): number {
  // Heuristic: higher confidence = faster fill. 5–20m.
  return Math.max(5, Math.round(20 - (m.confidence / 100) * 15));
}

export function CopilotBeta() {
  const moversFn = useServerFn(getTopMovers);
  const statsFn = useServerFn(getDashboardStats);
  const bookFn = useServerFn(bookManualTrade);
  const { fmt } = useCurrency();

  const [whyOpen, setWhyOpen] = useState(false);
  const [whyMover, setWhyMover] = useState<Mover | null>(null);

  const moversQ = useQuery({
    queryKey: ["copilot_movers"],
    queryFn: () => moversFn({ data: { market: "futures" } }),
    refetchInterval: 30_000,
  });
  const statsQ = useQuery({
    queryKey: ["dashboard_stats"],
    queryFn: () => statsFn({ data: undefined }),
    refetchInterval: 15_000,
  });
  const closedQ = useQuery({
    queryKey: ["copilot_closed"],
    queryFn: async () => {
      const { data } = await supabase
        .from("positions")
        .select("pnl,pnl_pct,opened_at,closed_at,status,symbol")
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(500);
      return data ?? [];
    },
    refetchInterval: 60_000,
  });

  const movers: Mover[] = useMemo(() => {
    if (!moversQ.data || moversQ.data.ok !== true) return [];
    return moversQ.data.movers;
  }, [moversQ.data]);

  const top = movers.slice(0, 3);
  const best = top[0] ?? null;
  const autoEligible = movers.filter((m) => m.eligible && m.action !== "avoid" && m.action !== "wait");
  const requiredConf = 80;
  const highestConfMover = movers[0] ?? null;
  const noTradeReason = !autoEligible.length;

  // Market mood from movers
  const mood = useMemo(() => {
    if (!movers.length) return null;
    const sample = movers.slice(0, 20);
    const longs = sample.filter((m) => m.bias === "long").length;
    const shorts = sample.filter((m) => m.bias === "short").length;
    const strength = Math.round((Math.abs(longs - shorts) / sample.length) * 100);
    const tone: "Bullish" | "Bearish" | "Neutral" =
      longs > shorts + 2 ? "Bullish" : shorts > longs + 2 ? "Bearish" : "Neutral";
    const volHigh = sample.filter((m) => m.volumeTier === "high").length;
    const volume = volHigh >= sample.length / 3 ? "Above Average" : "Average";
    const risk: "Low" | "Moderate" | "High" =
      tone === "Neutral" ? "Moderate" : strength > 60 ? "Low" : "Moderate";
    return { tone, strength, volume, risk };
  }, [movers]);

  // Bot health derivation
  const lastAnalysis = moversQ.dataUpdatedAt
    ? Math.max(0, Math.floor((Date.now() - moversQ.dataUpdatedAt) / 1000))
    : null;
  const futuresScanned = movers.length;
  const signalsToday = movers.filter((m) => m.action !== "avoid").length;
  const eligibleCount = autoEligible.length;
  const apiOk = moversQ.data?.ok === true;

  // Performance summary
  const perf = useMemo(() => {
    const rows = closedQ.data ?? [];
    const total = rows.length;
    if (!total) {
      return {
        total: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        best: 0,
        longestWinStreak: 0,
      };
    }
    const wins = rows.filter((r) => Number(r.pnl ?? 0) > 0);
    const losses = rows.filter((r) => Number(r.pnl ?? 0) < 0);
    const avgWin = wins.length ? wins.reduce((a, r) => a + Number(r.pnl), 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((a, r) => a + Number(r.pnl), 0) / losses.length : 0;
    const grossWin = wins.reduce((a, r) => a + Number(r.pnl), 0);
    const grossLoss = Math.abs(losses.reduce((a, r) => a + Number(r.pnl), 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    const best = rows.reduce((m, r) => Math.max(m, Number(r.pnl ?? 0)), 0);
    // Longest win streak (walk chronologically, oldest first)
    const chrono = [...rows].reverse();
    let cur = 0;
    let longest = 0;
    for (const r of chrono) {
      if (Number(r.pnl ?? 0) > 0) {
        cur += 1;
        longest = Math.max(longest, cur);
      } else cur = 0;
    }
    return {
      total,
      winRate: wins.length / total,
      avgWin,
      avgLoss,
      profitFactor,
      best,
      longestWinStreak: longest,
    };
  }, [closedQ.data]);

  // Goal (local-only placeholder)
  const [goal, setGoal] = useState<number>(() => {
    if (typeof window === "undefined") return 200000;
    const v = window.localStorage.getItem("copilot_goal");
    return v ? Number(v) || 200000 : 200000;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("copilot_goal", String(goal));
  }, [goal]);

  const handlePaperTrade = async (m: Mover) => {
    if (m.action !== "long" && m.action !== "short") {
      toast.error("No actionable side for this opportunity.");
      return;
    }
    try {
      await bookFn({
        data: { symbol: m.symbol, side: m.action, price: m.price, market: "futures", confidence: m.confidence },
      });
      toast.success(`Paper ${m.action.toUpperCase()} ${m.display} booked.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Paper trade failed");
    }
  };

  return (
    <>
      <BetaLanding />
    <section className="px-5 pt-5 space-y-4">

      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="size-8 rounded-xl bg-primary/10 text-primary grid place-items-center">
          <Sparkles className="size-4" />
        </div>
        <div>
          <p className="text-sm font-semibold">Wealth Copilot</p>
          <p className="text-[11px] text-muted-foreground">AI-curated opportunities, in plain English.</p>
        </div>
        <span className="ml-auto text-[10px] font-semibold px-2 h-5 inline-flex items-center rounded-full bg-primary text-primary-foreground">
          BETA
        </span>
      </div>

      {/* 1. AI Recommendation Card */}
      {best && best.action !== "avoid" ? (
        <div className="rounded-2xl border bg-gradient-to-br from-primary/5 to-transparent p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Best opportunity</p>
              <p className="text-lg font-semibold mt-0.5">{best.display}</p>
            </div>
            <span className={`text-xs font-semibold px-2 h-6 inline-flex items-center rounded-md border ${actionTone(actionWord(best))}`}>
              {actionWord(best)}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <Stat label="Confidence" value={`${best.confidence}%`} sub={confLevel(best.confidence)} />
            <Stat label="Expected return" value={`${best.tpPct.toFixed(1)}%`} />
            <Stat label="Expected duration" value={`${expectedDurationMin(best)} min`} />
          </div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">{best.decisionSentence}</p>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 rounded-xl"
              onClick={() => {
                setWhyMover(best);
                setWhyOpen(true);
              }}
            >
              <HelpCircle className="size-4 mr-1.5" />
              Why?
            </Button>
            <Button
              size="sm"
              className="flex-1 rounded-xl"
              onClick={() => handlePaperTrade(best)}
              disabled={best.action !== "long" && best.action !== "short"}
            >
              Paper trade
            </Button>
          </div>
        </div>
      ) : (
        /* 3. Why No Trade Card */
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-sm font-semibold">No trade currently active</p>
          <p className="text-xs text-muted-foreground mt-1">
            No setup exceeds the confidence threshold right now.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Stat
              label="Highest confidence"
              value={highestConfMover ? `${highestConfMover.confidence}%` : "—"}
              sub={highestConfMover?.display ?? ""}
            />
            <Stat label="Required" value={`${requiredConf}%`} />
          </div>
        </div>
      )}

      {/* 2. Top Opportunities Preview */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top opportunities</h3>
          <span className="text-[11px] text-muted-foreground">{moversQ.isFetching ? "Refreshing…" : "Live"}</span>
        </div>
        <div className="rounded-2xl border bg-card divide-y">
          {top.length === 0 && (
            <p className="p-6 text-center text-xs text-muted-foreground">Scanning markets…</p>
          )}
          {top.map((m) => {
            const a = actionWord(m);
            return (
              <button
                key={m.symbol}
                type="button"
                onClick={() => {
                  setWhyMover(m);
                  setWhyOpen(true);
                }}
                className="w-full flex items-center gap-3 p-3 hover:bg-muted/40 transition text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{m.display}</p>
                  <p className="text-[11px] text-muted-foreground">{confLevel(m.confidence)} confidence</p>
                </div>
                <span className={`text-[10px] font-semibold px-1.5 h-5 inline-flex items-center rounded border ${actionTone(a)}`}>
                  {a}
                </span>
                <span className="text-sm font-semibold tabular-nums w-12 text-right">{m.confidence}%</span>
                {m.bias === "long" ? (
                  <TrendingUp className="size-4 text-emerald-500" />
                ) : m.bias === "short" ? (
                  <TrendingDown className="size-4 text-destructive" />
                ) : (
                  <Minus className="size-4 text-muted-foreground" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Bot Health */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="size-4 text-primary" />
          <p className="text-sm font-semibold">Bot health</p>
          <span className={`ml-auto text-[10px] font-semibold px-2 h-5 inline-flex items-center rounded-full ${
            apiOk ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"
          }`}>
            {apiOk ? "Healthy" : "Degraded"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Last analysis" value={lastAnalysis != null ? `${lastAnalysis}s ago` : "—"} />
          <Stat label="Futures scanned" value={`${futuresScanned}`} />
          <Stat label="Signals today" value={`${signalsToday}`} />
          <Stat label="Eligible trades" value={`${eligibleCount}`} />
          <Stat label="API status" value={apiOk ? "Connected" : "Disconnected"} />
        </div>
      </div>

      {/* 10. Market Mood */}
      {mood && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="size-4 text-primary" />
            <p className="text-sm font-semibold">Market mood</p>
            <span className={`ml-auto text-[10px] font-semibold px-2 h-5 inline-flex items-center rounded-full ${
              mood.tone === "Bullish" ? "bg-emerald-500/10 text-emerald-500" :
              mood.tone === "Bearish" ? "bg-destructive/10 text-destructive" :
              "bg-muted text-muted-foreground"
            }`}>
              {mood.tone}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Strength" value={`${mood.strength}/100`} />
            <Stat label="Volume" value={mood.volume} />
            <Stat label="Risk" value={mood.risk} />
          </div>
        </div>
      )}

      {/* 9. Wealth Goal */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="size-4 text-primary" />
          <p className="text-sm font-semibold">My wealth goal</p>
        </div>
        <GoalEditor goal={goal} setGoal={setGoal} fmt={fmt} statsTodayPnl={statsQ.data?.todayPnl ?? 0} />
      </div>

      {/* 7. Performance Summary */}
      <div className="rounded-2xl border bg-card p-4">
        <p className="text-sm font-semibold mb-3">Performance summary</p>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Total trades" value={`${perf.total}`} />
          <Stat label="Win rate" value={perf.total ? `${Math.round(perf.winRate * 100)}%` : "—"} />
          <Stat label="Avg winner" value={perf.total ? fmt(perf.avgWin, { signed: true }) : "—"} />
          <Stat label="Avg loser" value={perf.total ? fmt(perf.avgLoss, { signed: true }) : "—"} />
          <Stat label="Profit factor" value={perf.profitFactor === Infinity ? "∞" : perf.profitFactor ? perf.profitFactor.toFixed(2) : "—"} />
          <Stat label="Best trade" value={perf.total ? fmt(perf.best, { signed: true }) : "—"} />
          <Stat label="Longest win streak" value={`${perf.longestWinStreak}`} />
        </div>
      </div>

      {/* 11. Ask earnO placeholder */}
      <div className="rounded-2xl border border-dashed bg-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare className="size-4 text-primary" />
          <p className="text-sm font-semibold">Ask earnO</p>
          <span className="ml-auto text-[10px] font-semibold px-2 h-5 inline-flex items-center rounded-full bg-muted text-muted-foreground">
            Coming soon
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Chat with your copilot in plain English. Examples:</p>
        <div className="flex flex-wrap gap-2">
          {[
            "Why are we not trading?",
            "Explain my last loss",
            "Should I increase risk?",
            "What is today's best opportunity?",
          ].map((q) => (
            <span
              key={q}
              className="text-[11px] px-2.5 h-7 inline-flex items-center rounded-full bg-muted text-muted-foreground"
            >
              {q}
            </span>
          ))}
        </div>
        <Button size="sm" variant="outline" className="rounded-xl mt-3 w-full" disabled>
          Ask a question
          <ChevronRight className="size-4 ml-1" />
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground text-center pt-2 pb-1">
        This is a beta preview. Existing dashboard is unchanged on other tabs.
      </p>

      <RecommendationModal
        open={whyOpen}
        onOpenChange={setWhyOpen}
        mover={whyMover}
        dailyRiskAvailable={(statsQ.data?.dailyLossUsedPct ?? 0) < 100}
      />
    </section>
    </>
  );

}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums mt-0.5">{value}</p>
      {sub ? <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p> : null}
    </div>
  );
}

function GoalEditor({
  goal,
  setGoal,
  fmt,
  statsTodayPnl,
}: {
  goal: number;
  setGoal: (n: number) => void;
  fmt: (n: number, opts?: { signed?: boolean }) => string;
  statsTodayPnl: number;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(goal));
  // Use today's PnL as a proxy "current progress" delta; goal current is a local placeholder.
  const current = Math.max(0, goal * 0.47 + statsTodayPnl); // demo math
  const progress = Math.min(100, (current / Math.max(1, goal)) * 100);
  const monthsLeft = progress > 0 ? Math.max(0.1, ((100 - progress) / Math.max(1, progress)) * 6).toFixed(1) : "—";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-muted-foreground">Target</p>
        {editing ? (
          <div className="flex items-center gap-1">
            <Input
              value={val}
              onChange={(e) => setVal(e.target.value)}
              className="h-7 w-28 text-right"
              inputMode="numeric"
            />
            <Button
              size="sm"
              className="h-7 rounded-lg"
              onClick={() => {
                const n = Number(val);
                if (Number.isFinite(n) && n > 0) {
                  setGoal(n);
                  setEditing(false);
                }
              }}
            >
              Save
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-semibold tabular-nums hover:text-primary"
          >
            {fmt(goal)}
          </button>
        )}
      </div>
      <div className="flex items-baseline justify-between mt-2">
        <p className="text-xs text-muted-foreground">Current</p>
        <p className="text-sm font-semibold tabular-nums">{fmt(current)}</p>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden mt-2">
        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="flex justify-between mt-2 text-[11px] text-muted-foreground">
        <span>{progress.toFixed(0)}% complete</span>
        <span>Projected: {monthsLeft} months</span>
      </div>
    </div>
  );
}

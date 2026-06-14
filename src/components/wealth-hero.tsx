import { Eye, EyeOff, ArrowUpRight, Target, TrendingUp, CalendarRange, Sparkles, FlaskConical, BadgeCheck } from "lucide-react";
import type { DashboardStats, EquityPoint } from "@/lib/stats.functions";
import { useCurrency } from "@/hooks/use-currency";
import { Switch } from "@/components/ui/switch";

type Props = {
  stats?: DashboardStats;
  equityFallback: number;
  isLive: boolean;
  hideBalance: boolean;
  onToggleHide: () => void;
  onToggleMode?: (live: boolean) => void;
  modePending?: boolean;
};

// Nice round milestone ladder in the user's display currency.
function nextNiceMilestone(value: number): { next: number; prev: number } {
  if (!Number.isFinite(value) || value <= 0) return { next: 1000, prev: 0 };
  const bases = [1, 2.5, 5];
  const ladder: number[] = [];
  for (let exp = 2; exp <= 12; exp++) {
    for (const b of bases) ladder.push(b * Math.pow(10, exp));
  }
  const next = ladder.find((m) => m > value) ?? value * 2;
  const prev = [...ladder].reverse().find((m) => m <= value) ?? 0;
  return { next, prev };
}

const masked = "••••••";

function pctStr(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function toneClass(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "text-muted-foreground";
  return n >= 0 ? "text-emerald-500" : "text-destructive";
}

export function WealthHero({ stats, equityFallback, isLive, hideBalance, onToggleHide, onToggleMode, modePending }: Props) {
  const { fmt } = useCurrency();
  const portfolio = stats?.portfolioValue ?? equityFallback;
  const hasHistory = !!stats && stats.closedAllTime > 0;

  return (
    <section className="px-5 pt-5">
      {/* Mode toggle — single source of truth for paper vs live */}
      <div
        className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
          isLive
            ? "border-emerald-500/30 bg-emerald-500/10"
            : "border-amber-500/30 bg-amber-500/10"
        }`}
      >
        <span
          className={`inline-flex items-center justify-center size-6 rounded-full shrink-0 ${
            isLive ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
          }`}
        >
          {isLive ? <BadgeCheck className="size-3.5" /> : <FlaskConical className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-[11px] font-semibold leading-tight ${isLive ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
            {isLive ? "Live — real money" : "Paper — practice mode"}
          </p>
          <p className="text-[10px] text-muted-foreground leading-tight">
            All numbers below reflect this mode.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-semibold tracking-wider ${!isLive ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>PAPER</span>
          <Switch
            checked={isLive}
            disabled={!onToggleMode || modePending}
            onCheckedChange={(v) => {
              if (!onToggleMode) return;
              if (v && !confirm("Switch to LIVE? Real money will be at risk.")) return;
              onToggleMode(v);
            }}
            aria-label="Toggle paper or live trading"
          />
          <span className={`text-[10px] font-semibold tracking-wider ${isLive ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>LIVE</span>
        </div>
      </div>


      {/* Label row */}
      <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="uppercase tracking-wider text-[10px] font-medium">
          Portfolio Value
        </span>
        <button
          type="button"
          onClick={onToggleHide}
          aria-label={hideBalance ? "Show balance" : "Hide balance"}
          className="size-5 grid place-items-center rounded hover:bg-muted text-muted-foreground"
        >
          {hideBalance ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </div>

      {/* Portfolio value */}
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-[40px] leading-none font-semibold tracking-tight tabular-nums">
          {hideBalance ? masked : fmt(portfolio)}
        </p>
      </div>

      {/* Today / 7-day / 30-day */}
      {!hasHistory ? (
        <div className="mt-3 rounded-2xl border bg-card p-4 text-center">
          <p className="text-xs text-muted-foreground">Not enough history yet</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Period changes appear once trades close.
          </p>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <WealthStat
            label="Today's Change"
            value={hideBalance ? masked : (stats ? fmt(stats.todayPnl, { signed: true }) : "—")}
            pct={stats?.todayPnlPct}
            icon={<ArrowUpRight className="size-3" />}
          />
          <WealthStat
            label="7-Day Change"
            value={hideBalance ? masked : (stats ? fmt(stats.weekChangeAbs, { signed: true }) : "—")}
            pct={stats?.weekChangePct}
            icon={<TrendingUp className="size-3" />}
          />
          <WealthStat
            label="30-Day Change"
            value={hideBalance ? masked : (stats ? fmt(stats.monthlyGrowthAbs, { signed: true }) : "—")}
            pct={stats?.monthlyGrowthPct}
            icon={<CalendarRange className="size-3" />}
          />
        </div>
      )}
    </section>
  );
}

export function MilestoneCard({
  stats, equityFallback, hideBalance,
}: { stats?: DashboardStats; equityFallback: number; hideBalance: boolean }) {
  const { rate, symbol } = useCurrency();
  const portfolio = stats?.portfolioValue ?? equityFallback;
  const displayValue = portfolio * rate;
  const { next: nextDisplay, prev: prevDisplay } = nextNiceMilestone(displayValue);
  const milestoneProgress =
    nextDisplay > prevDisplay
      ? Math.min(100, Math.max(0, ((displayValue - prevDisplay) / (nextDisplay - prevDisplay)) * 100))
      : 0;
  const toGo = Math.max(0, nextDisplay - displayValue);
  const fmtDisplay = (v: number) => {
    const digits = symbol === "₹" || symbol === "¥" ? 0 : v >= 1000 ? 0 : 2;
    return `${symbol}${v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 })}`;
  };
  return (
    <section className="px-5 mt-5">
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <Target className="size-4 text-primary" />
          <p className="text-xs font-semibold">Next milestone</p>
          <span className="ml-auto text-xs tabular-nums font-semibold">
            {hideBalance ? masked : fmtDisplay(nextDisplay)}
          </span>
        </div>
        <div className="mt-3 h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-[#3B82F6] transition-all"
            style={{ width: `${milestoneProgress}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">
          <span>{milestoneProgress.toFixed(0)}% there</span>
          <span>{hideBalance ? masked : `${fmtDisplay(toGo)} to go`}</span>
        </div>
      </div>
    </section>
  );
}

export function PerformanceHistoryCard({ stats }: { stats?: DashboardStats }) {
  return (
    <section className="px-5 mt-5">
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <p className="text-xs font-semibold">Performance history</p>
        </div>
        {stats && stats.equityCurve && stats.equityCurve.length > 1 ? (
          <div className="mt-3 rounded-xl bg-muted/30 p-2">
            <Sparkline points={stats.equityCurve} />
          </div>
        ) : (
          <div className="mt-3 rounded-xl bg-muted/30 px-4 py-6 text-center">
            <p className="text-xs font-medium text-foreground">Not enough history yet</p>
            <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
              Your equity curve will appear once trades close.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function WealthStat({
  label, value, pct, icon, plain, tone,
}: {
  label: string;
  value: string;
  pct?: number;
  icon?: React.ReactNode;
  plain?: boolean;
  tone?: "positive" | "negative";
}) {
  const t = plain
    ? (tone === "positive" ? "text-emerald-500" : tone === "negative" ? "text-destructive" : "text-foreground")
    : toneClass(pct);
  return (
    <div className="rounded-2xl border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-semibold tabular-nums ${t}`}>{value}</p>
      {!plain && pct != null && Number.isFinite(pct) && (
        <span
          className={`mt-1 inline-flex items-center gap-0.5 text-[10px] px-1.5 h-4 rounded ${
            pct >= 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive"
          }`}
        >
          {icon}
          {pctStr(pct)}
        </span>
      )}
    </div>
  );
}



function Sparkline({ points }: { points: EquityPoint[] }) {
  const w = 320;
  const h = 64;
  if (!points.length) {
    return <div className="h-16 rounded-md bg-muted/40" />;
  }
  const ys = points.map((p) => p.equity);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const range = maxY - minY || 1;
  const stepX = points.length > 1 ? w / (points.length - 1) : 0;
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = h - ((p.equity - minY) / range) * (h - 6) - 3;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const lastY = h - ((ys[ys.length - 1] - minY) / range) * (h - 6) - 3;
  const lastX = (points.length - 1) * stepX;
  const up = ys[ys.length - 1] >= ys[0];
  const stroke = up ? "hsl(var(--primary))" : "hsl(var(--destructive))";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill="url(#sparkfill)" />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={stroke} />
    </svg>
  );
}

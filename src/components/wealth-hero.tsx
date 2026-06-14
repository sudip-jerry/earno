import { Eye, EyeOff, ArrowUpRight, Target, TrendingUp, CalendarRange, Sparkles } from "lucide-react";
import type { DashboardStats, EquityPoint } from "@/lib/stats.functions";
import { useCurrency } from "@/hooks/use-currency";

type Props = {
  stats?: DashboardStats;
  equityFallback: number;
  isLive: boolean;
  hideBalance: boolean;
  onToggleHide: () => void;
};

// Nice round milestone ladder in the user's display currency.
// Scales 1, 2.5, 5, 10 x 10^n.
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

export function WealthHero({ stats, equityFallback, isLive, hideBalance, onToggleHide }: Props) {
  const { fmt, rate, symbol } = useCurrency();
  const portfolio = stats?.portfolioValue ?? equityFallback;

  // Milestones in display currency (nice round numbers).
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
    <section className="px-5 pt-5">
      {/* Label row */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="uppercase tracking-wider text-[10px] font-medium">
          {isLive ? "Account balance" : "Virtual portfolio"}
        </span>
        <button
          type="button"
          onClick={onToggleHide}
          aria-label={hideBalance ? "Show balance" : "Hide balance"}
          className="size-5 grid place-items-center rounded hover:bg-muted text-muted-foreground"
        >
          {hideBalance ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
        <span
          className={`ml-auto inline-flex items-center gap-1 text-[10px] px-2 h-5 rounded-full font-medium ${
            isLive ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
          }`}
        >
          {isLive ? "LIVE" : "PAPER"}
        </span>
      </div>

      {/* Portfolio value */}
      <p className="text-[40px] leading-none font-semibold tracking-tight mt-2 tabular-nums">
        {hideBalance ? masked : fmt(portfolio)}
      </p>

      {/* Today / Monthly / CAGR */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <WealthStat
          label="Today"
          value={hideBalance ? masked : (stats ? fmt(stats.todayPnl, { signed: true }) : "—")}
          pct={stats?.todayPnlPct}
          icon={<ArrowUpRight className="size-3" />}
        />
        <WealthStat
          label="30-day"
          value={hideBalance ? masked : (stats ? fmt(stats.monthlyGrowthAbs, { signed: true }) : "—")}
          pct={stats?.monthlyGrowthPct}
          icon={<CalendarRange className="size-3" />}
        />
        <WealthStat
          label="CAGR"
          value={pctStr(stats?.cagrPct)}
          plain
          tone={(stats?.cagrPct ?? 0) >= 0 ? "positive" : "negative"}
          icon={<TrendingUp className="size-3" />}
        />
      </div>

      {/* Milestone progress */}
      <div className="mt-4 rounded-2xl border bg-card p-4">
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

      {/* Wealth path: projection horizon */}
      <div className="mt-3 rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <p className="text-xs font-semibold">Wealth path</p>
          {stats && stats.cagrPct > 0 && (
            <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
              At {pctStr(stats.cagrPct, 1)} CAGR
            </span>
          )}
        </div>

        {stats && stats.cagrPct > 0 ? (
          <>
            <div className="mt-3 rounded-xl bg-muted/30 p-2">
              <Sparkline points={stats?.equityCurve ?? []} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <ProjTile label="In 6 mo" value={hideBalance ? masked : (stats.projected6m != null ? fmt(stats.projected6m) : "—")} highlight={false} />
              <ProjTile label="In 1 yr" value={hideBalance ? masked : (stats.projected12m != null ? fmt(stats.projected12m) : "—")} highlight />
              <ProjTile label="In 2 yr" value={hideBalance ? masked : (stats.projected24m != null ? fmt(stats.projected24m) : "—")} highlight={false} />
            </div>
          </>
        ) : (
          <div className="mt-3 rounded-xl bg-muted/30 px-4 py-6 text-center">
            <p className="text-xs font-medium text-foreground">Your wealth path appears here</p>
            <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
              Keep trading consistently — projections unlock once your portfolio is compounding.
            </p>
          </div>
        )}
      </div>

      {/* Success-question chip row */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <FactTile
          label="Consistency"
          value={stats && stats.tradingDays30d > 0 ? `${stats.consistencyPct.toFixed(0)}%` : "—"}
          sub={stats?.tradingDays30d ? `${stats.tradingDays30d}d active` : "Last 30 days"}
        />
        <FactTile
          label="On track?"
          value={(stats?.cagrPct ?? 0) >= 20 ? "Yes" : (stats?.cagrPct ?? 0) > 0 ? "Building" : "Not yet"}
          sub={`${pctStr(stats?.cagrPct, 1)} CAGR`}
          tone={(stats?.cagrPct ?? 0) >= 20 ? "positive" : (stats?.cagrPct ?? 0) > 0 ? "neutral" : "negative"}
        />
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

function ProjTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-2.5 ${highlight ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted/40"}`}>
      <p className={`text-[10px] uppercase tracking-wider ${highlight ? "text-primary" : "text-muted-foreground"}`}>{label}</p>
      <p className={`mt-0.5 text-sm font-semibold tabular-nums ${highlight ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}

function FactTile({
  label, value, sub, tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const t =
    tone === "positive" ? "text-emerald-500" :
    tone === "negative" ? "text-destructive" :
    "text-foreground";
  return (
    <div className="rounded-2xl border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${t}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">{sub}</p>}
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

import { Link } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { type DashboardStats } from "@/lib/stats.functions";

export type StatsExtras = DashboardStats & {
  weeklyNetPnl?: number;
  totalNetPnl?: number;
  winRate?: number;
  totalWins?: number;
  totalClosed?: number;
  profitFactor?: number;
  totalFees?: number;
};

export function timeAgo(iso: string | null): string {
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

export function PerformanceStrip({
  s,
  fmt,
}: {
  s: StatsExtras | undefined;
  fmt: (n: number | null | undefined, opts?: { signed?: boolean }) => string;
}) {
  const netValue = s?.weeklyNetPnl ?? s?.totalNetPnl ?? s?.weekChangeAbs;
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
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
            {netLabel}
          </p>
          <p className="mt-0.5 text-[13px] font-semibold tabular-nums truncate">
            {netValue == null ? "—" : fmt(netValue, { signed: true })}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
            Win rate
          </p>
          <p className="mt-0.5 text-[13px] font-semibold tabular-nums truncate">
            {winRate == null ? (
              <span className="text-[11px] text-muted-foreground font-normal">Not yet</span>
            ) : (
              `${(winRate * 100).toFixed(0)}%`
            )}
          </p>
        </div>
        <div className="min-w-0">
          <p
            className="text-[10px] uppercase tracking-wider text-muted-foreground truncate"
            title="Profit factor — money won ÷ money lost. Above 1.0 means you're ahead."
          >
            Profit factor
          </p>
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
            ) : (
              pf.toFixed(2)
            )}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
            Trading fees
          </p>
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

export function CompactRiskRow({
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

export function RiskRow({
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

export function QuickAction({
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

export function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
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

export function DailyChart({
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
    <section className="brand-hero rounded-2xl px-5 py-4 shadow-md">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wider text-white/60">Portfolio value</div>
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <div className="text-3xl font-semibold tabular-nums text-white">
              {hideBalance ? "••••••" : fmt(portfolioValue)}
            </div>
            <div
              className={`text-[13px] font-medium tabular-nums ${
                todayPos ? "text-emerald-300" : "text-rose-300"
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
          className="size-8 grid place-items-center rounded-full hover:bg-white/10 text-white/80"
        >
          {hideBalance ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white/10 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-white/55">Total P&L</p>
          <p
            className={`mt-0.5 text-[14px] font-semibold tabular-nums ${
              totalPnl >= 0 ? "text-emerald-300" : "text-rose-300"
            }`}
          >
            {fmt(totalPnl, { signed: true })}
          </p>
        </div>
        <div className="rounded-xl bg-white/10 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-white/55">Return</p>
          <p
            className={`mt-0.5 text-[14px] font-semibold tabular-nums ${
              totalPnlPct >= 0 ? "text-emerald-300" : "text-rose-300"
            }`}
          >
            {totalPnlPct >= 0 ? "+" : "−"}
            {Math.abs(totalPnlPct).toFixed(1)}%
          </p>
        </div>
      </div>

      <div className="mt-4">
        {series.length < 3 ? (
          <div className="h-[64px] grid place-items-center text-[12px] text-white/60">
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
                    className={`w-full rounded-sm ${pos ? "bg-emerald-400" : "bg-rose-400"}`}
                    style={{ height: `${h}px` }}
                  />
                  <div className="text-[9px] text-white/50 tabular-nums leading-none">{day}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-3 text-[11px] text-white/60">{context}</div>
    </section>
  );
}

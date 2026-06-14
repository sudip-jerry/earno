import type { DashboardStats } from "@/lib/stats.functions";
import { Activity, Radar, Target, CheckCircle2, ShieldAlert, ShieldCheck, Briefcase, Clock } from "lucide-react";

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

export function WealthEngineStatus({ stats }: { stats?: DashboardStats }) {
  const status = stats?.engineStatus ?? "paused";
  const badge =
    status === "active"
      ? { label: "Active", cls: "bg-emerald-500 text-white" }
      : status === "cooldown"
        ? { label: "Cooldown", cls: "bg-amber-500 text-white" }
        : { label: "Paused", cls: "bg-muted text-muted-foreground" };

  return (
    <section className="px-5 mt-5">
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          <p className="text-xs font-semibold uppercase tracking-wider">Wealth Engine Status</p>
          <span
            className={`ml-auto inline-flex items-center text-[10px] px-2 h-5 rounded-full font-bold tracking-wider ${badge.cls}`}
          >
            {status === "active" && (
              <span className="size-1.5 rounded-full bg-white mr-1.5 animate-pulse" />
            )}
            {badge.label.toUpperCase()}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Cell
            icon={<Radar className="size-3.5 text-primary" />}
            label="Markets scanned"
            value={(stats?.marketsScannedToday ?? 0).toLocaleString()}
          />
          <Cell
            icon={<Target className="size-3.5 text-primary" />}
            label="Opportunities found"
            value={(stats?.opportunitiesFoundToday ?? 0).toLocaleString()}
          />
          <Cell
            icon={<CheckCircle2 className="size-3.5 text-primary" />}
            label="Trades executed"
            value={(stats?.tradesExecutedToday ?? 0).toLocaleString()}
          />
          <Cell
            icon={<Briefcase className="size-3.5 text-primary" />}
            label="Open positions"
            value={(stats?.openCount ?? 0).toLocaleString()}
          />
          <Cell
            icon={<Clock className="size-3.5 text-primary" />}
            label="Last analysis"
            value={timeAgo(stats?.lastAnalysisAt ?? null)}
          />
          <Cell
            icon={
              stats?.riskHealthy ? (
                <ShieldCheck className="size-3.5 text-emerald-500" />
              ) : (
                <ShieldAlert className="size-3.5 text-amber-500" />
              )
            }
            label="Risk status"
            value={stats?.riskHealthy ? "Healthy" : "Attention"}
            tone={stats?.riskHealthy ? "positive" : "warn"}
          />
        </div>
      </div>
    </section>
  );
}

function Cell({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "positive" | "warn";
}) {
  const valueCls =
    tone === "positive" ? "text-emerald-600 dark:text-emerald-400" :
    tone === "warn" ? "text-amber-600 dark:text-amber-400" :
    "text-foreground";
  return (
    <div className="rounded-xl border bg-background/40 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className={`mt-1 text-sm font-semibold tabular-nums ${valueCls}`}>{value}</p>
    </div>
  );
}

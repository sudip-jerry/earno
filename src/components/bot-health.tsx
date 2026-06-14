import type { DashboardStats, HealthState } from "@/lib/stats.functions";
import { HeartPulse } from "lucide-react";

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

const pillStyle: Record<HealthState, string> = {
  healthy: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  monitoring: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  paused: "bg-muted text-muted-foreground",
  cooldown: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

const pillLabel: Record<HealthState, string> = {
  healthy: "Healthy",
  monitoring: "Monitoring",
  paused: "Paused",
  cooldown: "Cooldown Active",
};

export function BotHealth({ stats }: { stats?: DashboardStats }) {
  const rows: Array<{ label: string; state: HealthState }> = [
    { label: "Market Scanner", state: stats?.scannerHealth ?? "paused" },
    { label: "Data Feed", state: stats?.dataFeedHealth ?? "paused" },
    { label: "Risk Engine", state: stats?.riskEngineHealth ?? "paused" },
    { label: "Automation Engine", state: stats?.automationHealth ?? "paused" },
  ];

  return (
    <section className="px-5 mt-5">
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <HeartPulse className="size-4 text-primary" />
          <p className="text-xs font-semibold uppercase tracking-wider">Bot Health</p>
        </div>
        <div className="mt-3 divide-y">
          {rows.map((r) => (
            <div key={r.label} className="py-2 flex items-center justify-between gap-3">
              <span className="text-xs text-foreground">{r.label}</span>
              <span
                className={`text-[10px] px-2 h-5 inline-flex items-center rounded-full font-semibold ${pillStyle[r.state]}`}
              >
                {pillLabel[r.state]}
              </span>
            </div>
          ))}
          <div className="py-2 flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">Last successful scan</span>
            <span className="text-xs tabular-nums text-foreground">
              {timeAgo(stats?.lastSuccessfulScanAt ?? null)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

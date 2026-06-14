import type { DashboardStats } from "@/lib/stats.functions";
import { Info } from "lucide-react";

export function WhyNoTrade({ stats }: { stats?: DashboardStats }) {
  if (!stats) return null;
  if ((stats.openCount ?? 0) > 0) return null;

  const top = Math.round(stats.topConfidenceToday);
  const min = Math.round(stats.minConfidenceRequired);

  return (
    <section className="px-5 mt-5">
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <Info className="size-4 text-primary" />
          <p className="text-xs font-semibold uppercase tracking-wider">No Trade Opened</p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border bg-background/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Top opportunity
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {top > 0 ? `${top}%` : "—"}
            </p>
          </div>
          <div className="rounded-xl border bg-background/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Minimum required
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{min}%</p>
          </div>
        </div>

        <div className="mt-3 rounded-xl bg-muted/40 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Reason</p>
          <p className="mt-0.5 text-xs text-foreground leading-relaxed">{stats.noTradeReason}</p>
        </div>
      </div>
    </section>
  );
}

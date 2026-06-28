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
          <p className="text-xs font-semibold uppercase tracking-wider">Why no trade right now?</p>
        </div>

        <p className="mt-3 text-xs text-foreground leading-relaxed">{stats.noTradeReason}</p>

        {top > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border bg-background/40 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Top opportunity
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{top}%</p>
            </div>
            <div className="rounded-xl border bg-background/40 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Minimum confidence
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{min}%</p>
            </div>
          </div>
        )}

        <p className="mt-3 text-[10px] text-muted-foreground leading-relaxed">
          The bot is running and being selective. It only opens trades when conditions meet your
          settings.
        </p>
      </div>
    </section>
  );
}

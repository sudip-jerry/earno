export type KpiItem = { label: string; value: string; sub?: string; tone?: "pos" | "neg" };

/**
 * Shared 4-up KPI strip. Matches the Coins screen's strip styling so the
 * Futures screen reads the same; the Coins screen keeps its own copy
 * unchanged.
 */
export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <section className="grid grid-cols-4 gap-2">
      {items.map((k, i) => (
        <div key={i} className="rounded-xl border bg-card p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {k.label}
          </div>
          <div
            className={`mt-0.5 text-sm font-semibold tabular-nums ${
              k.tone === "pos"
                ? "text-emerald-600 dark:text-emerald-400"
                : k.tone === "neg"
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-foreground"
            }`}
          >
            {k.value}
          </div>
          {k.sub && <div className="text-[10px] text-muted-foreground truncate">{k.sub}</div>}
        </div>
      ))}
    </section>
  );
}

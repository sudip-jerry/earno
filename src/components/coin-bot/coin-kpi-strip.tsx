import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getCoinHoldings } from "@/lib/coin-bot/coin-bot.functions";


export function CoinKpiStrip() {
  const holdingsFn = useServerFn(getCoinHoldings);
  const q = useQuery({ queryKey: ["coin_holdings"], queryFn: () => holdingsFn(), refetchInterval: 20_000 });

  const closed = q.data?.closed ?? [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const closedToday = closed.filter((c: any) => c.closed_at && new Date(c.closed_at) >= today);
  const wins = closedToday.filter((c: any) => Number(c.realized_pnl_usdt ?? 0) > 0).length;
  const winRate = closedToday.length ? (wins / closedToday.length) * 100 : null;
  const sum = q.data?.summary;

  return (
    <section className="grid grid-cols-4 gap-2">
      <Kpi label="Win rate" value={winRate == null ? "—" : `${fmt(winRate, 0)}%`} />
      <Kpi label="Closed today" value={String(closedToday.length)} />
      <Kpi label="Best" value={sum?.best_pnl_pct != null ? `${fmt(sum.best_pnl_pct, 1)}%` : "—"} sub={sum?.best_symbol ?? undefined} tone="pos" />
      <Kpi label="Worst" value={sum?.worst_pnl_pct != null ? `${fmt(sum.worst_pnl_pct, 1)}%` : "—"} sub={sum?.worst_symbol ?? undefined} tone="neg" />
    </section>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? "text-emerald-600 dark:text-emerald-400" : tone === "neg" ? "text-rose-600 dark:text-rose-400" : "text-foreground";
  return (
    <div className="rounded-xl border bg-card p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

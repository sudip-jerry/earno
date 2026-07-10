import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getCoinHoldings } from "@/lib/coin-bot/coin-bot.functions";
import { useCurrency } from "@/hooks/use-currency";

function fmtPrice(n: number | null | undefined, d = 6) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}

function ago(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

type ClosedCoinTrade = {
  id: string;
  display?: string;
  exit_reason?: string | null;
  exit_price?: number | null;
  closed_at?: string | null;
  realized_pnl_usdt?: number | null;
};

export function CoinRecentActivity({
  pageSize = 6,
  title = "Recent coin activity",
}: {
  pageSize?: number;
  title?: string;
}) {
  const { fmt } = useCurrency();
  const fn = useServerFn(getCoinHoldings);
  const q = useQuery({ queryKey: ["coin_holdings"], queryFn: () => fn(), refetchInterval: 20_000 });
  const [visible, setVisible] = useState(pageSize);
  const all = (q.data?.closed ?? []) as ClosedCoinTrade[];
  const closed = all.slice(0, visible);

  return (
    <section>
      <div className="px-1 pb-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{title}</span>
        {all.length > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">{all.length} total</span>
        )}
      </div>
      {closed.length === 0 ? (
        <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          No closed coin trades yet.
        </div>
      ) : (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <ul className="divide-y">
            {closed.map((c) => {
              const pnl = Number(c.realized_pnl_usdt ?? 0);
              const pos = pnl >= 0;
              return (
                <li key={c.id} className="px-3 py-2 flex items-center gap-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm">{c.display}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {c.exit_reason ?? "closed"} · {ago(c.closed_at ?? null)} ago
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div
                      className={`text-sm font-semibold ${pos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                    >
                      {fmt(pnl, { signed: true })}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      @ {fmtPrice(c.exit_price)} USDT
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {visible < all.length && (
            <div className="px-3 py-2.5 border-t">
              <button
                type="button"
                onClick={() => setVisible((v) => v + pageSize)}
                className="w-full h-9 rounded-lg text-[12.5px] font-medium text-primary hover:bg-primary/5 transition"
              >
                Show more
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";

import { getCoinHoldings } from "@/lib/coin-bot/coin-bot.functions";
import { useCurrency } from "@/hooks/use-currency";
import { CoinHoldingsCard } from "@/components/coin-bot/coin-panels";
import { CoinRecentActivity } from "@/components/coin-bot/coin-recent-activity";

/**
 * Coin positions — same shape as the futures Positions page (Active-PNL hero →
 * Open / History tabs → list) but kept in its own file so positions.tsx (the
 * futures screen) isn't overloaded with coin logic.
 */
export function CoinPositionsView() {
  const { fmt } = useCurrency();
  const fn = useServerFn(getCoinHoldings);
  const q = useQuery({ queryKey: ["coin_holdings"], queryFn: () => fn(), refetchInterval: 20_000 });
  const [tab, setTab] = useState<"open" | "closed">("open");

  const summary = q.data?.summary;
  const unrealized = Number(summary?.unrealized_pnl_usdt ?? 0);
  const realized = Number(summary?.realized_pnl_usdt ?? 0);
  const openCount = Number(summary?.active_holdings ?? 0);
  const closedCount = (q.data?.closed ?? []).length;

  return (
    <div className="px-5 pt-3 space-y-3">
      <div className="inline-flex rounded-full border bg-muted p-1">
        {(["open", "closed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 h-8 text-xs font-medium rounded-full transition-colors ${
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            {t === "open" ? "Holdings" : "History"}
          </button>
        ))}
      </div>

      {tab === "open" ? (
        <>
          <div className="brand-hero rounded-2xl p-4 flex items-center justify-between shadow-md">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/60">Active PNL</p>
              <p
                className={`text-2xl font-semibold tabular-nums mt-0.5 ${
                  unrealized >= 0 ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {fmt(unrealized, { signed: true })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-white/60">Holdings</p>
              <p className="text-2xl font-semibold tabular-nums mt-0.5 text-white">{openCount}</p>
            </div>
          </div>
          <CoinHoldingsCard />
        </>
      ) : (
        <>
          <div className="brand-hero rounded-2xl p-4 flex items-center justify-between shadow-md">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/60">Realized PNL</p>
              <p
                className={`text-2xl font-semibold tabular-nums mt-0.5 ${
                  realized >= 0 ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {fmt(realized, { signed: true })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-white/60">Closed</p>
              <p className="text-2xl font-semibold tabular-nums mt-0.5 text-white">{closedCount}</p>
            </div>
          </div>
          <CoinRecentActivity pageSize={12} title="All coin trades" />
        </>
      )}
    </div>
  );
}

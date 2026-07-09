import type { useCurrency } from "@/hooks/use-currency";
import { TrendingUp } from "lucide-react";

type Fmt = ReturnType<typeof useCurrency>["fmt"];

export type SimpleEarningsProps = {
  fmt: Fmt;
  hideBalance: boolean;
  totalTodayPnl: number;
  totalValue: number;
  totalInvested: number;
  totalReturns: number;
  futuresValue: number;
  futuresInvested: number;
  coinEquity: number;
  coinInvested: number;
};

function Amount({
  value,
  fmt,
  hidden,
  className = "",
}: {
  value: number;
  fmt: Fmt;
  hidden: boolean;
  className?: string;
}) {
  return (
    <span className={`tabular-nums ${className}`}>
      {hidden ? "••••••" : fmt(value, { signed: true })}
    </span>
  );
}

export function SimpleEarnings(props: SimpleEarningsProps) {
  const {
    fmt,
    hideBalance,
    totalTodayPnl,
    totalValue,
    totalInvested,
    totalReturns,
    futuresValue,
    futuresInvested,
    coinEquity,
    coinInvested,
  } = props;

  const todayPct = totalValue > 0 ? (totalTodayPnl / totalValue) * 100 : 0;
  const returnsPct = totalInvested > 0 ? (totalReturns / totalInvested) * 100 : 0;
  const returnsPos = totalReturns >= 0;
  const todayPos = totalTodayPnl >= 0;
  const futuresProfit = futuresValue - futuresInvested;
  const coinProfit = coinEquity - coinInvested;

  const upCls = "text-emerald-600 dark:text-emerald-400";
  const downCls = "text-rose-600 dark:text-rose-400";

  return (
    <div className="min-h-svh bg-background pb-28">
      <div className="mx-auto max-w-md">
        <header className="px-5 pt-5">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-5 text-primary" />
            <h1 className="text-[19px] font-semibold">Your earnings</h1>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            How much you've made — today and in total.
          </p>
        </header>

        {/* Profit till date — the headline */}
        <div className="px-5 mt-4">
          <section className="rounded-2xl border border-t-2 border-t-primary bg-card px-5 py-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Profit till date
                </div>
                <div
                  className={`mt-1 text-3xl font-semibold tabular-nums ${returnsPos ? upCls : downCls}`}
                >
                  {hideBalance ? "••••••" : fmt(totalReturns, { signed: true })}
                </div>
              </div>
              <span
                className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 h-6 text-[11px] font-semibold tabular-nums ${returnsPos ? "bg-emerald-500/10 " + upCls : "bg-rose-500/10 " + downCls}`}
              >
                <span aria-hidden="true">{returnsPos ? "▲" : "▼"}</span>
                {returnsPct >= 0 ? "+" : ""}
                {returnsPct.toFixed(2)}%
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4">
              <div>
                <div className="text-[11px] text-muted-foreground">Invested</div>
                <div className="text-[14px] font-semibold tabular-nums">
                  {hideBalance ? "••••" : fmt(totalInvested)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-muted-foreground">Current value</div>
                <div className="text-[14px] font-semibold tabular-nums">
                  {hideBalance ? "••••" : fmt(totalValue)}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Today */}
        <div className="px-5 mt-4">
          <section className="rounded-2xl border bg-card px-5 py-4 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Earned today
              </div>
              <Amount
                value={totalTodayPnl}
                fmt={fmt}
                hidden={hideBalance}
                className={`mt-1 block text-xl font-semibold ${todayPos ? upCls : downCls}`}
              />
            </div>
            <span
              className={`text-[12px] font-semibold tabular-nums ${todayPos ? upCls : downCls}`}
            >
              {todayPct >= 0 ? "+" : ""}
              {todayPct.toFixed(2)}%
            </span>
          </section>
        </div>

        {/* Where the profit came from */}
        <div className="px-5 mt-4">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 px-1">
            Where your profit came from
          </div>
          <section className="rounded-2xl border bg-card shadow-sm divide-y">
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-[12.5px] font-medium">Futures</div>
                <div className="text-[11px] text-muted-foreground">
                  {hideBalance ? "••••" : fmt(futuresValue)} now
                </div>
              </div>
              <Amount
                value={futuresProfit}
                fmt={fmt}
                hidden={hideBalance}
                className={`text-[14px] font-semibold ${futuresProfit >= 0 ? upCls : downCls}`}
              />
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-[12.5px] font-medium">Coins</div>
                <div className="text-[11px] text-muted-foreground">
                  {hideBalance ? "••••" : fmt(coinEquity)} now
                </div>
              </div>
              <Amount
                value={coinProfit}
                fmt={fmt}
                hidden={hideBalance}
                className={`text-[14px] font-semibold ${coinProfit >= 0 ? upCls : downCls}`}
              />
            </div>
          </section>
        </div>

        <div className="px-5 mt-4">
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
            <p className="text-[12px] leading-relaxed text-foreground/90">
              Earnings are shown after exchange fees &amp; GST — the real amount that lands in your
              account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

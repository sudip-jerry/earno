import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getCoinHoldings } from "@/lib/coin-bot/coin-bot.functions";
import { RecentActivityFeed } from "@/components/recent-activity";
import type { useCurrency } from "@/hooks/use-currency";

type Fmt = ReturnType<typeof useCurrency>["fmt"];

export type SimpleTradesProps = {
  fmt: Fmt;
  hideBalance: boolean;
};

type OpenPosition = {
  id: string;
  symbol: string;
  side: "long" | "short";
  pnl: number | null;
  pnl_pct: number | null;
};

type CoinHolding = {
  symbol: string;
  qty: number;
  current_value_usdt?: number | null;
  unrealized_pnl_usdt?: number | null;
};

const upCls = "text-emerald-600 dark:text-emerald-400";
const downCls = "text-rose-600 dark:text-rose-400";

function PnlRow({
  title,
  subtitle,
  pnl,
  fmt,
  hidden,
}: {
  title: string;
  subtitle: string;
  pnl: number;
  fmt: Fmt;
  hidden: boolean;
}) {
  const pos = pnl >= 0;
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium truncate">{title}</div>
        <div className="text-[11px] text-muted-foreground">{subtitle}</div>
      </div>
      <div className={`text-[13px] font-semibold tabular-nums ${pos ? upCls : downCls}`}>
        {hidden ? "••••" : fmt(pnl, { signed: true })}
      </div>
    </div>
  );
}

export function SimpleTrades({ fmt, hideBalance }: SimpleTradesProps) {
  const coinHoldingsFn = useServerFn(getCoinHoldings);

  const futures = useQuery({
    queryKey: ["positions_open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("id,symbol,side,pnl,pnl_pct")
        .eq("status", "open")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OpenPosition[];
    },
    refetchInterval: 20_000,
  });

  const coins = useQuery({
    queryKey: ["coin_holdings"],
    queryFn: () => coinHoldingsFn(),
    refetchInterval: 20_000,
  });

  const futuresRows = futures.data ?? [];
  const coinRows = ((coins.data as { open?: CoinHolding[] } | undefined)?.open ??
    []) as CoinHolding[];
  const loading = futures.isLoading || coins.isLoading;
  const errored = futures.isError || coins.isError;
  const nothingOpen = !loading && !errored && futuresRows.length === 0 && coinRows.length === 0;

  return (
    <div className="min-h-svh bg-background pb-28">
      <div className="mx-auto max-w-md">
        <header className="px-5 pt-5">
          <div className="flex items-center gap-2">
            <Receipt className="size-5 text-primary" />
            <h1 className="text-[19px] font-semibold">Your trades</h1>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Everything open right now, and what just happened.
          </p>
        </header>

        {loading && (
          <div className="px-5 mt-4 space-y-2">
            <div className="h-16 rounded-2xl border bg-card animate-pulse" />
            <div className="h-16 rounded-2xl border bg-card animate-pulse" />
          </div>
        )}

        {errored && !loading && (
          <div className="px-5 mt-4">
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-5 py-6 text-center">
              <p className="text-[13px] font-medium">Couldn't load your trades</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Check your connection — this will refresh on its own.
              </p>
            </div>
          </div>
        )}

        {nothingOpen && (
          <div className="px-5 mt-4">
            <div className="rounded-2xl border bg-card px-5 py-8 text-center shadow-sm">
              <p className="text-[13px] font-medium">No open trades right now</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                earn'O opens trades automatically when it finds a good setup. Check back soon.
              </p>
            </div>
          </div>
        )}

        {futuresRows.length > 0 && (
          <div className="px-5 mt-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 px-1">
              Futures positions
            </div>
            <section className="rounded-2xl border bg-card shadow-sm divide-y">
              {futuresRows.map((p) => (
                <PnlRow
                  key={p.id}
                  title={p.symbol}
                  subtitle={`${p.side === "short" ? "Sell (short)" : "Buy (long)"}${p.pnl_pct != null ? ` · ${p.pnl_pct >= 0 ? "+" : ""}${p.pnl_pct.toFixed(2)}%` : ""}`}
                  pnl={Number(p.pnl ?? 0)}
                  fmt={fmt}
                  hidden={hideBalance}
                />
              ))}
            </section>
          </div>
        )}

        {coinRows.length > 0 && (
          <div className="px-5 mt-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2 px-1">
              Coin holdings
            </div>
            <section className="rounded-2xl border bg-card shadow-sm divide-y">
              {coinRows.map((h) => (
                <PnlRow
                  key={h.symbol}
                  title={h.symbol}
                  subtitle={`Worth ${hideBalance ? "••••" : fmt(Number(h.current_value_usdt ?? 0))}`}
                  pnl={Number(h.unrealized_pnl_usdt ?? 0)}
                  fmt={fmt}
                  hidden={hideBalance}
                />
              ))}
            </section>
          </div>
        )}

        <div className="mt-4">
          <RecentActivityFeed />
        </div>
      </div>
    </div>
  );
}

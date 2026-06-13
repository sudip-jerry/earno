import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getTopMovers, bookManualTrade, type Mover } from "@/lib/movers.functions";
import { TabBar } from "@/components/tab-bar";
import { PositionsStrip } from "@/components/positions-strip";
import { OpportunityCard } from "@/components/opportunity-card";
import { useMarketMode } from "@/hooks/use-market-mode";
import { toast } from "sonner";
import { Flame, RefreshCw, HelpCircle } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/movers")({
  head: () => ({
    meta: [
      { title: "Top Movers — EarnO" },
      { name: "description", content: "Top movers with simple Long/Short/Wait/Avoid recommendations and confidence." },
    ],
  }),
  component: MoversPage,
});

type Cfg = {
  take_profit_pct: number;
  stop_loss_pct: number;
  risk_per_trade_pct: number;
  paper_equity: number;
};

function MoversPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getTopMovers);
  const bookFn = useServerFn(bookManualTrade);
  const [pending, setPending] = useState<string | null>(null);
  const { market } = useMarketMode();

  const q = useQuery({
    queryKey: ["top_movers", market],
    queryFn: () => getFn({ data: { market } }),
    refetchInterval: 30_000,
  });

  const cfg = useQuery({
    queryKey: ["bot_config_movers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_config")
        .select("take_profit_pct,stop_loss_pct,risk_per_trade_pct,paper_equity")
        .maybeSingle();
      if (error) throw error;
      return data as Cfg | null;
    },
  });

  const book = useMutation({
    mutationFn: async (input: { m: Mover; side: "long" | "short" }) =>
      bookFn({ data: { symbol: input.m.symbol, side: input.side, price: input.m.price, market } }),
    onMutate: (v) => setPending(v.m.symbol),
    onSettled: () => setPending(null),
    onSuccess: (_d, v) => {
      toast.success(`${v.side === "long" ? "Long" : "Short"} ${v.m.display} booked`);
      qc.invalidateQueries({ queryKey: ["positions_open"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Booking failed"),
  });

  const movers: Mover[] = q.data?.ok ? q.data.movers : [];
  const errorMsg = q.data && !q.data.ok ? q.data.error : null;
  const c = cfg.data;
  const tpPct = Number(c?.take_profit_pct ?? 0.6);
  const slPct = Number(c?.stop_loss_pct ?? 0.4);
  const equity = Number(c?.paper_equity ?? 0);
  const riskAmount = (equity * Number(c?.risk_per_trade_pct ?? 1)) / 100;

  return (
    <div className="min-h-svh bg-background pb-28">
      <header className="px-5 pt-6 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="size-5 text-orange-500" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Top Movers</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Long / Short / Wait / Avoid with confidence
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link to="/help" className="size-10 grid place-items-center rounded-full hover:bg-muted">
            <HelpCircle className="size-5 text-muted-foreground" />
          </Link>
          <button
            onClick={() => q.refetch()}
            className="size-10 grid place-items-center rounded-full hover:bg-muted"
            aria-label="Refresh"
          >
            <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>


      {errorMsg ? (
        <div className="mx-5 mt-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {errorMsg}
        </div>
      ) : null}

      <ul className="px-5 mt-3 space-y-2">
        {q.isLoading && !q.data
          ? Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="h-32 rounded-2xl border bg-card animate-pulse" />
            ))
          : null}

        {movers.map((m) => {
          const booking = pending === m.symbol;
          return (
            <li key={m.symbol}>
              <OpportunityCard
                mover={m}
                tpPct={tpPct}
                slPct={slPct}
                riskAmountUsd={riskAmount}
                booking={booking}
                onBook={(s) => book.mutate({ m, side: s })}
              />
            </li>
          );
        })}

        {!q.isLoading && movers.length === 0 && !errorMsg ? (
          <li className="rounded-2xl border border-dashed bg-card/50 p-8 text-center text-sm text-muted-foreground">
            No movers available right now.
          </li>
        ) : null}
      </ul>

      <TabBar />
    </div>
  );
}

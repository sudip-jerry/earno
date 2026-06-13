import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getTopMovers, bookManualTrade, type Mover } from "@/lib/movers.functions";
import { TabBar } from "@/components/tab-bar";
import { PositionsStrip } from "@/components/positions-strip";
import { OpportunityCard } from "@/components/opportunity-card";
import { useStrictness } from "@/hooks/use-strictness";
import { useMarketMode } from "@/hooks/use-market-mode";
import { toast } from "sonner";
import { Radar, RefreshCw, HelpCircle, Filter } from "lucide-react";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/scanner")({
  head: () => ({
    meta: [
      { title: "Market Scanner — EarnO" },
      { name: "description", content: "Futures pairs ranked by confidence with simple Long/Short/Wait/Avoid recommendations." },
    ],
  }),
  component: ScannerPage,
});

type Cfg = {
  take_profit_pct: number;
  stop_loss_pct: number;
  risk_per_trade_pct: number;
  paper_equity: number;
  daily_loss_cap_pct: number;
};

function ScannerPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getTopMovers);
  const bookFn = useServerFn(bookManualTrade);
  const [pending, setPending] = useState<string | null>(null);

  const [action, setAction] = useState<"all" | "long" | "short" | "avoid" | "wait">("all");
  const [minConfidence, setMinConfidence] = useState(55);
  const [tradableOnly, setTradableOnly] = useState(false);

  const { strictness } = useStrictness();
  const q = useQuery({
    queryKey: ["scanner_movers", strictness],
    queryFn: () => getFn({ data: { market: "futures", strictness } }),
    refetchInterval: 30_000,
  });

  const cfg = useQuery({
    queryKey: ["bot_config_scanner"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_config")
        .select("take_profit_pct,stop_loss_pct,risk_per_trade_pct,paper_equity,daily_loss_cap_pct")
        .maybeSingle();
      if (error) throw error;
      return data as Cfg | null;
    },
  });

  const book = useMutation({
    mutationFn: async (input: { m: Mover; side: "long" | "short" }) =>
      bookFn({ data: { symbol: input.m.symbol, side: input.side, price: input.m.price, market: "futures" } }),
    onMutate: (v) => setPending(v.m.symbol),
    onSettled: () => setPending(null),
    onSuccess: (_d, v) => {
      toast.success(`${v.side === "long" ? "Long" : "Short"} ${v.m.display} booked`);
      qc.invalidateQueries({ queryKey: ["positions_open"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Booking failed"),
  });

  const all = q.data?.ok ? q.data.movers : [];
  const filtered = useMemo(() => {
    return all.filter((m) => {
      if (tradableOnly && m.action !== "long" && m.action !== "short") return false;
      if (action !== "all" && m.action !== action) return false;
      if (m.confidence < minConfidence) return false;
      return true;
    });
  }, [all, tradableOnly, action, minConfidence]);

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
          <Radar className="size-5 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Scanner</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {filtered.length} match · ranked by confidence
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

      {/* Filters */}
      <div className="px-5 space-y-2">
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <Filter className="size-3.5 text-muted-foreground" />
          <button
            onClick={() => setTradableOnly((v) => !v)}
            className={`h-7 px-3 rounded-full border ${tradableOnly ? "bg-primary/10 border-primary/30 text-primary" : "text-muted-foreground"}`}
          >
            Tradable only
          </button>
          {(["all", "long", "short", "avoid", "wait"] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAction(a)}
              className={`h-7 px-3 rounded-full border capitalize ${action === a ? "bg-foreground text-background" : "text-muted-foreground"}`}
            >
              {a}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Min confidence</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={minConfidence}
            onChange={(e) => setMinConfidence(Number(e.target.value))}
            className="w-32"
          />
          <span className="tabular-nums w-8">{minConfidence}%</span>
        </label>
      </div>

      {errorMsg ? (
        <div className="mx-5 mt-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {errorMsg}
        </div>
      ) : null}

      <ul className="px-5 mt-3 space-y-2">
        {q.isLoading && !q.data
          ? Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="h-32 rounded-2xl border bg-card animate-pulse" />
            ))
          : null}

        {filtered.map((m) => {
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

        {!q.isLoading && filtered.length === 0 && !errorMsg ? (
          <li className="rounded-2xl border border-dashed bg-card/50 p-8 text-center text-sm text-muted-foreground">
            No pairs match your filters. Try lowering confidence or showing all actions.
          </li>
        ) : null}
      </ul>

      <TabBar />
    </div>
  );
}

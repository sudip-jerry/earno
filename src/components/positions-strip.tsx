import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLivePrices } from "@/hooks/use-live-prices";
import { useMarketMode, type MarketMode } from "@/hooks/use-market-mode";
import { useCurrency } from "@/hooks/use-currency";
import { ChevronRight, RefreshCw, Briefcase } from "lucide-react";

type Row = {
  id: string;
  symbol: string;
  side: "long" | "short";
  leverage: number;
  qty: number;
  entry_price: number;
  mark_price: number | null;
  instrument: "futures" | "spot" | null;
};

export function PositionsStrip({ showMarketToggle = true }: { showMarketToggle?: boolean }) {
  const qc = useQueryClient();
  const { market, setMarket } = useMarketMode();
  const { fmt } = useCurrency();

  const q = useQuery({
    queryKey: ["positions_open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("id,symbol,side,leverage,qty,entry_price,mark_price,instrument")
        .eq("status", "open");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 5_000,
  });

  useEffect(() => {
    const ch = supabase
      .channel("positions_strip")
      .on("postgres_changes", { event: "*", schema: "public", table: "positions" }, () => {
        qc.invalidateQueries({ queryKey: ["positions_open"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const rows = q.data ?? [];
  const symbols = useMemo(() => rows.map((r) => r.symbol), [rows]);
  const { prices, isFetching: pricesFetching } = useLivePrices(symbols, rows.length > 0);

  const totalPnl = rows.reduce((acc, r) => {
    const entry = Number(r.entry_price);
    const live = prices[r.symbol] ?? Number(r.mark_price ?? r.entry_price);
    const qty = Number(r.qty);
    const sideMul = r.side === "long" ? 1 : -1;
    return acc + (live - entry) * qty * sideMul;
  }, 0);

  const up = totalPnl >= 0;

  return (
    <div className="sticky top-0 z-30 bg-background/85 backdrop-blur border-b">
      <div className="px-5 py-2.5 flex items-center gap-2">
        <Link
          to="/positions"
          className="flex-1 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Briefcase className="size-4 text-primary shrink-0" />
            <span className="text-xs font-medium">Open {rows.length}</span>
            <span
              className={`text-sm font-semibold tabular-nums ${
                rows.length === 0 ? "text-muted-foreground" : up ? "text-emerald-500" : "text-destructive"
              }`}
            >
              {rows.length === 0 ? "—" : fmtUsd(totalPnl)}
            </span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        </Link>

        <button
          onClick={() => { q.refetch(); }}
          className="size-8 grid place-items-center rounded-full border hover:bg-muted shrink-0"
          aria-label="Refresh positions"
        >
          <RefreshCw className={`size-3.5 ${q.isFetching || pricesFetching ? "animate-spin" : ""}`} />
        </button>

        {showMarketToggle ? (
          <div className="inline-flex rounded-full border bg-muted/40 p-0.5 text-[11px] font-medium shrink-0">
            {(["futures", "spot"] as MarketMode[]).map((opt) => (
              <button
                key={opt}
                onClick={() => setMarket(opt)}
                className={`px-2.5 h-6 rounded-full capitalize transition ${
                  market === opt
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt === "futures" ? "Futures" : "Coins"}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

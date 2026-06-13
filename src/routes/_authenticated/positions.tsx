import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { closeManualTrade } from "@/lib/movers.functions";
import { Button } from "@/components/ui/button";
import { TabBar } from "@/components/tab-bar";
import { PositionsStrip } from "@/components/positions-strip";
import { useLivePrices } from "@/hooks/use-live-prices";
import { useCurrency } from "@/hooks/use-currency";
import { toast } from "sonner";
import { Briefcase, RefreshCw, HelpCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/positions")({
  head: () => ({
    meta: [
      { title: "Open Positions — EarnO" },
      { name: "description", content: "Your open paper and live positions with live PNL and ROE." },
    ],
  }),
  component: PositionsPage,
});

type PositionRow = {
  id: string;
  symbol: string;
  side: "long" | "short";
  leverage: number;
  qty: number;
  entry_price: number;
  mark_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  opened_at: string;
  mode: string;
  instrument: "futures" | "spot" | null;
};

function fmtNum(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function PositionsPage() {
  const qc = useQueryClient();
  const closeFn = useServerFn(closeManualTrade);
  const [pending, setPending] = useState<string | null>(null);
  const { fmt } = useCurrency();

  const q = useQuery({
    queryKey: ["positions_open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("id,symbol,side,leverage,qty,entry_price,mark_price,stop_loss,take_profit,pnl,pnl_pct,opened_at,mode,instrument")
        .eq("status", "open")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PositionRow[];
    },
    refetchInterval: 5_000,
  });

  const rows = q.data ?? [];
  const symbols = useMemo(() => rows.map((r) => r.symbol), [rows]);
  const { prices, isFetching: pricesFetching, refetch: refetchPrices } = useLivePrices(symbols, rows.length > 0);

  useEffect(() => {
    const ch = supabase
      .channel("positions_page")
      .on("postgres_changes", { event: "*", schema: "public", table: "positions" }, () => {
        qc.invalidateQueries({ queryKey: ["positions_open"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const close = useMutation({
    mutationFn: async (v: { positionId: string; limitPrice: number }) =>
      closeFn({ data: { positionId: v.positionId, limitPrice: v.limitPrice } }),
    onMutate: (v) => setPending(v.positionId),
    onSettled: () => setPending(null),
    onSuccess: () => {
      toast.success("Limit close submitted");
      qc.invalidateQueries({ queryKey: ["positions_open"] });
      qc.invalidateQueries({ queryKey: ["dashboard_stats"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Close failed"),
  });

  const totalPnl = rows.reduce((acc, r) => {
    const entry = Number(r.entry_price);
    const live = prices[r.symbol] ?? Number(r.mark_price ?? r.entry_price);
    const qty = Number(r.qty);
    const sideMul = r.side === "long" ? 1 : -1;
    return acc + (live - entry) * qty * sideMul;
  }, 0);

  return (
    <div className="min-h-svh bg-background pb-28">
      <PositionsStrip showMarketToggle={false} />
      <header className="px-5 pt-6 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Briefcase className="size-5 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Positions</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Open trades with live PNL and ROE</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link to="/help" className="size-10 grid place-items-center rounded-full hover:bg-muted">
            <HelpCircle className="size-5 text-muted-foreground" />
          </Link>
          <button
            onClick={() => { q.refetch(); refetchPrices(); }}
            className="size-10 grid place-items-center rounded-full hover:bg-muted"
            aria-label="Refresh positions"
          >
            <RefreshCw className={`size-4 ${q.isFetching || pricesFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>


      <section className="px-5">
        <div className="rounded-2xl border bg-card p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Active PNL</p>
            <p
              className={`text-2xl font-semibold tabular-nums mt-0.5 ${
                totalPnl >= 0 ? "text-emerald-500" : "text-destructive"
              }`}
            >
              {fmt(totalPnl, { signed: true })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Open</p>
            <p className="text-2xl font-semibold tabular-nums mt-0.5">{rows.length}</p>
          </div>
        </div>
      </section>

      <ul className="px-5 mt-3 space-y-2">
        {q.isLoading && !q.data
          ? Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="h-44 rounded-2xl border bg-card animate-pulse" />
            ))
          : null}

        {rows.map((p) => {
          const entry = Number(p.entry_price);
          const live = prices[p.symbol];
          const mark = live ?? (p.mark_price != null ? Number(p.mark_price) : entry);
          const qty = Number(p.qty);
          const lev = Number(p.leverage);
          const size = qty * mark;
          const margin = (qty * entry) / Math.max(1, lev);
          const sideMul = p.side === "long" ? 1 : -1;
          const pnl = (mark - entry) * qty * sideMul;
          const roe = entry > 0 ? ((mark - entry) / entry) * 100 * sideMul * lev : 0;
          const up = pnl >= 0;
          const sideCls =
            p.side === "long"
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-destructive/10 text-destructive";
          const instr = p.instrument ?? (p.symbol.startsWith("B-") ? "futures" : "spot");
          const closing = pending === p.id;

          return (
            <li key={p.id} className="rounded-2xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="font-medium text-sm">{p.symbol}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${sideCls}`}>
                    {p.side === "long" ? "Long" : "Short"} {lev}x
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded border text-foreground capitalize">
                    {instr}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                    {p.mode}
                  </span>
                </div>
              </div>


              <div className="mt-3 flex items-start justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Active PNL</p>
                  <p
                    className={`text-xl font-semibold tabular-nums ${
                      up ? "text-emerald-500" : "text-destructive"
                    }`}
                  >
                    {fmt(pnl, { signed: true })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">ROE</p>
                  <p
                    className={`text-xl font-semibold tabular-nums ${
                      up ? "text-emerald-500" : "text-destructive"
                    }`}
                  >
                    {up ? "+" : ""}
                    {roe.toFixed(2)}%
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-y-2 gap-x-3 text-[11px]">
                <div>
                  <p className="text-muted-foreground">Qty</p>
                  <p className="tabular-nums font-medium mt-0.5">{fmtNum(qty, 4)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Size</p>
                  <p className="tabular-nums font-medium mt-0.5">{fmt(size)}</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">Margin</p>
                  <p className="tabular-nums font-medium mt-0.5">{fmt(margin)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Avg. Entry</p>
                  <p className="tabular-nums font-medium mt-0.5">{fmtNum(entry, 6)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">LTP</p>
                  <p className="tabular-nums font-medium mt-0.5">{fmtNum(mark, 6)}</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">Leverage</p>
                  <p className="tabular-nums font-medium mt-0.5">{lev}x</p>
                </div>
              </div>

              <div className="mt-3 rounded-lg border bg-muted/40 px-3 py-2 text-[11px] flex items-center justify-between">
                <span className="text-muted-foreground">
                  TP <span className="tabular-nums text-foreground">{fmtNum(p.take_profit, 6)}</span>
                </span>
                <span className="text-muted-foreground">
                  SL <span className="tabular-nums text-foreground">{fmtNum(p.stop_loss, 6)}</span>
                </span>
              </div>

              <div className="mt-3">
                <Button
                  variant="outline"
                  className="w-full h-9 rounded-lg"
                  disabled={closing || !live}
                  onClick={() => {
                    if (!live) return;
                    if (
                      confirm(
                        `Place LIMIT close for ${p.side.toUpperCase()} ${p.symbol} at ${fmtNum(live, 6)}? (Lower fee than market.)`,
                      )
                    ) {
                      close.mutate({ positionId: p.id, limitPrice: live });
                    }
                  }}
                >
                  {closing
                    ? "Submitting…"
                    : live
                    ? `Close · Limit @ ${fmtNum(live, 6)}`
                    : "Waiting for live price…"}
                </Button>
                <p className="text-[10px] text-muted-foreground mt-1 text-center">
                  Limit orders pay lower CoinDCX fees than market orders.
                </p>
              </div>
            </li>
          );
        })}

        {!q.isLoading && rows.length === 0 ? (
          <li className="rounded-2xl border border-dashed bg-card/50 p-8 text-center">
            <p className="text-sm text-muted-foreground">No open positions.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Book a trade from the Dashboard or Scanner.
            </p>
          </li>
        ) : null}
      </ul>

      <TabBar />
    </div>
  );
}

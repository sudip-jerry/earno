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

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function PositionsPage() {
  const qc = useQueryClient();
  const closeFn = useServerFn(closeManualTrade);
  const [pending, setPending] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["positions_open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("id,symbol,side,leverage,qty,entry_price,mark_price,stop_loss,take_profit,pnl,pnl_pct,opened_at,mode")
        .eq("status", "open")
        .order("opened_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PositionRow[];
    },
    refetchInterval: 5_000,
  });

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
    mutationFn: async (positionId: string) => closeFn({ data: { positionId } }),
    onMutate: (id) => setPending(id),
    onSettled: () => setPending(null),
    onSuccess: () => {
      toast.success("Position closed");
      qc.invalidateQueries({ queryKey: ["positions_open"] });
      qc.invalidateQueries({ queryKey: ["dashboard_stats"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Close failed"),
  });

  const rows = q.data ?? [];
  const totalPnl = rows.reduce((acc, r) => acc + Number(r.pnl ?? 0), 0);

  return (
    <div className="min-h-svh bg-background pb-28">
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
            onClick={() => q.refetch()}
            className="size-10 grid place-items-center rounded-full hover:bg-muted"
            aria-label="Refresh positions"
          >
            <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin" : ""}`} />
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
              {fmtUsd(totalPnl)}
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
          const mark = p.mark_price != null ? Number(p.mark_price) : entry;
          const qty = Number(p.qty);
          const lev = Number(p.leverage);
          const size = qty * mark;
          const margin = (qty * entry) / Math.max(1, lev);
          const pnl = Number(p.pnl ?? 0);
          const roe = Number(p.pnl_pct ?? 0);
          const up = pnl >= 0;
          const sideCls =
            p.side === "long"
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-destructive/10 text-destructive";
          const closing = pending === p.id;

          return (
            <li key={p.id} className="rounded-2xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-sm">{p.symbol}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${sideCls}`}>
                    {p.side === "long" ? "Long" : "Short"} {lev}x
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
                    {fmtUsd(pnl)}
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
                  <p className="tabular-nums font-medium mt-0.5">${fmtNum(size, 2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground">Margin</p>
                  <p className="tabular-nums font-medium mt-0.5">${fmtNum(margin, 2)}</p>
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
                  disabled={closing}
                  onClick={() => {
                    if (confirm(`Close ${p.side.toUpperCase()} ${p.symbol} at market?`)) {
                      close.mutate(p.id);
                    }
                  }}
                >
                  {closing ? "Closing…" : "Close"}
                </Button>
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

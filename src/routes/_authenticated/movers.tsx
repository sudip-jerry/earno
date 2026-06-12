import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTopMovers, bookManualTrade, type Mover } from "@/lib/movers.functions";
import { Button } from "@/components/ui/button";
import { TabBar } from "@/components/tab-bar";
import { toast } from "sonner";
import { Flame, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/movers")({
  head: () => ({
    meta: [
      { title: "Top Movers — EarnO" },
      { name: "description", content: "Top gaining futures pairs with 1m, 5m, and 24h momentum." },
    ],
  }),
  component: MoversPage,
});

function pct(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n.toFixed(digits);
  return `${n >= 0 ? "+" : ""}${s}%`;
}

function colorClass(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "text-muted-foreground";
  return n >= 0 ? "text-emerald-600" : "text-destructive";
}

function MoversPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getTopMovers);
  const bookFn = useServerFn(bookManualTrade);
  const [pending, setPending] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["top_movers"],
    queryFn: () => getFn({ data: undefined }),
    refetchInterval: 30_000,
  });

  const book = useMutation({
    mutationFn: async (input: { m: Mover; side: "long" | "short" }) =>
      bookFn({ data: { symbol: input.m.symbol, side: input.side, price: input.m.price } }),
    onMutate: (v) => setPending(`${v.m.symbol}:${v.side}`),
    onSettled: () => setPending(null),
    onSuccess: (_d, v) => {
      toast.success(`${v.side === "long" ? "Long" : "Short"} ${v.m.display} booked`);
      qc.invalidateQueries({ queryKey: ["positions_open"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Booking failed"),
  });

  const movers: Mover[] = q.data?.ok ? q.data.movers : [];
  const errorMsg = q.data && !q.data.ok ? q.data.error : null;

  return (
    <div className="min-h-svh bg-background pb-28">
      <header className="px-5 pt-6 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="size-5 text-orange-500" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Top Movers</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ranked by 24h % change · Tap Long / Short to book manually
            </p>
          </div>
        </div>
        <button
          onClick={() => q.refetch()}
          className="size-10 grid place-items-center rounded-full hover:bg-muted"
          aria-label="Refresh"
        >
          <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin" : ""}`} />
        </button>
      </header>

      {errorMsg ? (
        <div className="mx-5 mt-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {errorMsg}
        </div>
      ) : null}

      {/* Column header */}
      <div className="px-5 mt-3 grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Symbol</span>
        <span className="w-14 text-right">1m</span>
        <span className="w-14 text-right">5m</span>
        <span className="w-16 text-right">24h</span>
        <span className="w-10 text-right">Rank</span>
      </div>

      <ul className="px-5 mt-2 space-y-2">
        {q.isLoading && !q.data
          ? Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="h-24 rounded-2xl border bg-card animate-pulse" />
            ))
          : null}

        {movers.map((m) => {
          const bookingLong = pending === `${m.symbol}:long`;
          const bookingShort = pending === `${m.symbol}:short`;
          return (
            <li key={m.symbol} className="rounded-2xl border bg-card p-4">
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{m.display}</p>
                  <p className="text-[11px] text-muted-foreground tabular-nums truncate">
                    {m.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </p>
                </div>
                <span className={`w-14 text-right text-xs tabular-nums ${colorClass(m.change1m)}`}>
                  {pct(m.change1m)}
                </span>
                <span className={`w-14 text-right text-xs tabular-nums ${colorClass(m.change5m)}`}>
                  {pct(m.change5m)}
                </span>
                <span className={`w-16 text-right text-sm font-medium tabular-nums ${colorClass(m.change24h)}`}>
                  {pct(m.change24h, 1)}
                </span>
                <span className="w-10 text-right text-xs text-muted-foreground">#{m.rank24h}</span>
              </div>

              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  className="flex-1 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={bookingLong || bookingShort}
                  onClick={() => book.mutate({ m, side: "long" })}
                >
                  <TrendingUp className="size-3.5 mr-1" />
                  {bookingLong ? "Booking…" : "Long"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-9 rounded-lg border-destructive/40 text-destructive hover:bg-destructive/5"
                  disabled={bookingLong || bookingShort}
                  onClick={() => book.mutate({ m, side: "short" })}
                >
                  <TrendingDown className="size-3.5 mr-1" />
                  {bookingShort ? "Booking…" : "Short"}
                </Button>
              </div>
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

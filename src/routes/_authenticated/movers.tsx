import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTopMovers, bookManualTrade, type Mover } from "@/lib/movers.functions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TabBar } from "@/components/tab-bar";
import { toast } from "sonner";
import { Flame, RefreshCw, HelpCircle, TrendingUp, TrendingDown, Info, Minus } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/movers")({
  head: () => ({
    meta: [
      { title: "Top Movers — EarnO" },
      { name: "description", content: "Top movers with Long/Short recommendations, confidence score and rationale." },
    ],
  }),
  component: MoversPage,
});

function pct(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function colorClass(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "text-muted-foreground";
  return n >= 0 ? "text-emerald-600" : "text-destructive";
}

function recBadge(rec: Mover["recommendation"], confidence: number, market: "futures" | "spot") {
  if (rec === "long") {
    return {
      label: market === "spot" ? "BUY" : "LONG",
      cls: "bg-emerald-600/10 text-emerald-700 border-emerald-600/30",
      Icon: TrendingUp,
    };
  }
  if (rec === "short") {
    return {
      label: "SHORT",
      cls: "bg-destructive/10 text-destructive border-destructive/30",
      Icon: TrendingDown,
    };
  }
  return {
    label: confidence > 0 ? "WAIT" : "NEUTRAL",
    cls: "bg-muted text-muted-foreground border-border",
    Icon: Minus,
  };
}

function MoversPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getTopMovers);
  const bookFn = useServerFn(bookManualTrade);
  const [pending, setPending] = useState<string | null>(null);
  const [market, setMarket] = useState<"futures" | "spot">("futures");

  const q = useQuery({
    queryKey: ["top_movers", market],
    queryFn: () => getFn({ data: { market } }),
    refetchInterval: 30_000,
  });

  const book = useMutation({
    mutationFn: async (input: { m: Mover; side: "long" | "short" }) =>
      bookFn({ data: { symbol: input.m.symbol, side: input.side, price: input.m.price, market } }),
    onMutate: (v) => setPending(`${v.m.symbol}:${v.side}`),
    onSettled: () => setPending(null),
    onSuccess: (_d, v) => {
      toast.success(`${v.side === "long" ? (market === "spot" ? "Buy" : "Long") : "Short"} ${v.m.display} booked`);
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
              AI-suggested Long/Short with confidence · 1m · 5m · 30m signals
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

      <div className="px-5">
        <div className="inline-flex rounded-full border bg-muted/40 p-0.5 text-xs font-medium">
          {(["futures", "spot"] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setMarket(opt)}
              className={`px-4 h-8 rounded-full capitalize transition ${
                market === opt
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

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
          const badge = recBadge(m.recommendation, m.confidence, market);
          const BadgeIcon = badge.Icon;
          const side: "long" | "short" = m.recommendation === "short" ? "short" : "long";
          const booking = pending === `${m.symbol}:${side}`;
          const canTrade = m.recommendation !== "neutral";

          return (
            <li key={m.symbol} className="rounded-2xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm truncate">{m.display}</p>
                    <span className="text-[10px] text-muted-foreground">#{m.rank24h}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground tabular-nums truncate">
                    {m.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center gap-1 px-2 h-6 rounded-full border text-[10px] font-semibold ${badge.cls}`}>
                    <BadgeIcon className="size-3" />
                    {badge.label}
                  </span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className="size-7 grid place-items-center rounded-full hover:bg-muted text-muted-foreground"
                        aria-label="Why this recommendation"
                      >
                        <Info className="size-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 text-xs">
                      <p className="font-semibold mb-1">
                        {badge.label} · confidence {m.confidence}%
                      </p>
                      <p className="text-muted-foreground mb-2">
                        30m trend: <span className="capitalize">{m.trend30}</span>
                        {m.change30mLast != null ? ` · last 30m ${pct(m.change30mLast)}` : ""}
                      </p>
                      {m.reasons.length ? (
                        <ul className="space-y-1 list-disc pl-4">
                          {m.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-muted-foreground">No strong signal yet.</p>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Confidence bar */}
              <div className="mt-3">
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full ${
                      m.recommendation === "long"
                        ? "bg-emerald-500"
                        : m.recommendation === "short"
                          ? "bg-destructive"
                          : "bg-muted-foreground/40"
                    }`}
                    style={{ width: `${Math.max(4, m.confidence)}%` }}
                  />
                </div>
              </div>

              {/* Signals row */}
              <div className="mt-3 grid grid-cols-4 gap-2 text-[10px]">
                <div>
                  <p className="uppercase text-muted-foreground tracking-wider">1m</p>
                  <p className={`tabular-nums ${colorClass(m.change1m)}`}>{pct(m.change1m)}</p>
                </div>
                <div>
                  <p className="uppercase text-muted-foreground tracking-wider">5m</p>
                  <p className={`tabular-nums ${colorClass(m.change5m)}`}>{pct(m.change5m)}</p>
                </div>
                <div>
                  <p className="uppercase text-muted-foreground tracking-wider">30m</p>
                  <p className={`tabular-nums ${colorClass(m.change30mLast)}`}>{pct(m.change30mLast)}</p>
                </div>
                <div>
                  <p className="uppercase text-muted-foreground tracking-wider">24h</p>
                  <p className={`tabular-nums ${colorClass(m.change24h)}`}>{pct(m.change24h, 1)}</p>
                </div>
              </div>

              <div className="mt-3">
                <Button
                  size="sm"
                  className={`w-full h-9 rounded-lg text-white ${
                    m.recommendation === "short"
                      ? "bg-destructive hover:bg-destructive/90"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  } disabled:opacity-60`}
                  disabled={!canTrade || booking}
                  onClick={() => canTrade && book.mutate({ m, side })}
                >
                  {m.recommendation === "short" ? (
                    <TrendingDown className="size-3.5 mr-1" />
                  ) : (
                    <TrendingUp className="size-3.5 mr-1" />
                  )}
                  {booking
                    ? "Booking…"
                    : !canTrade
                      ? "No clear signal"
                      : `Book ${badge.label} (${m.confidence}%)`}
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTopMovers, bookManualTrade, type Mover, type Bias } from "@/lib/movers.functions";
import { Button } from "@/components/ui/button";
import { TabBar } from "@/components/tab-bar";
import { toast } from "sonner";
import { Radar, RefreshCw, HelpCircle, Filter, Check, X, Clock, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/scanner")({
  head: () => ({
    meta: [
      { title: "Market Scanner — EarnO" },
      { name: "description", content: "Futures pairs ranked by Scalp Score with bias, spread, RSI, EMA and VWAP signals." },
    ],
  }),
  component: ScannerPage,
});

function pct(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}
function clr(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "text-muted-foreground";
  return n >= 0 ? "text-emerald-500" : "text-destructive";
}
function biasMeta(b: Bias) {
  if (b === "long") return { cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30", Icon: TrendingUp, label: "LONG" };
  if (b === "short") return { cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: TrendingDown, label: "SHORT" };
  return { cls: "bg-muted text-muted-foreground border-border", Icon: Minus, label: "WAIT" };
}

function ScannerPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getTopMovers);
  const bookFn = useServerFn(bookManualTrade);
  const [pending, setPending] = useState<string | null>(null);

  // Filters
  const [onlyEligible, setOnlyEligible] = useState(true);
  const [bias, setBias] = useState<"all" | "long" | "short">("all");
  const [minScore, setMinScore] = useState(40);
  const [minVol, setMinVol] = useState<"any" | "ok" | "high">("ok");
  const [maxSpread, setMaxSpread] = useState<"any" | "normal" | "tight">("normal");

  const q = useQuery({
    queryKey: ["scanner_movers"],
    queryFn: () => getFn({ data: { market: "futures" } }),
    refetchInterval: 30_000,
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
      if (onlyEligible && !m.eligible) return false;
      if (bias === "long" && m.bias !== "long") return false;
      if (bias === "short" && m.bias !== "short") return false;
      if (m.scalpScore < minScore) return false;
      if (minVol === "ok" && m.volumeTier === "low") return false;
      if (minVol === "high" && m.volumeTier !== "high") return false;
      if (maxSpread === "normal" && m.spread === "wide") return false;
      if (maxSpread === "tight" && m.spread !== "tight") return false;
      return true;
    });
  }, [all, onlyEligible, bias, minScore, minVol, maxSpread]);

  const errorMsg = q.data && !q.data.ok ? q.data.error : null;

  return (
    <div className="min-h-svh bg-background pb-28">
      <header className="px-5 pt-6 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radar className="size-5 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Scanner</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {filtered.length} eligible · scored on 1m · 5m · 30m
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

      {/* Filter bar */}
      <div className="px-5 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <Filter className="size-3.5 text-muted-foreground" />
          <button
            onClick={() => setOnlyEligible((v) => !v)}
            className={`h-7 px-3 rounded-full border ${onlyEligible ? "bg-primary/10 border-primary/30 text-primary" : "text-muted-foreground"}`}
          >
            Eligible only
          </button>
          {(["all", "long", "short"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBias(b)}
              className={`h-7 px-3 rounded-full border capitalize ${bias === b ? "bg-foreground text-background" : "text-muted-foreground"}`}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Min score</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-24"
            />
            <span className="tabular-nums w-6">{minScore}</span>
          </label>
          <select
            value={minVol}
            onChange={(e) => setMinVol(e.target.value as typeof minVol)}
            className="h-7 px-2 rounded border bg-background text-xs"
          >
            <option value="any">Any vol</option>
            <option value="ok">Vol ≥ OK</option>
            <option value="high">Vol high</option>
          </select>
          <select
            value={maxSpread}
            onChange={(e) => setMaxSpread(e.target.value as typeof maxSpread)}
            className="h-7 px-2 rounded border bg-background text-xs"
          >
            <option value="any">Any spread</option>
            <option value="normal">≤ Normal</option>
            <option value="tight">Tight only</option>
          </select>
        </div>
      </div>

      {errorMsg ? (
        <div className="mx-5 mt-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {errorMsg}
        </div>
      ) : null}

      {/* Table-style list */}
      <ul className="px-3 mt-3 space-y-1.5">
        {q.isLoading && !q.data
          ? Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="h-16 rounded-xl border bg-card animate-pulse" />
            ))
          : null}

        {filtered.map((m) => {
          const b = biasMeta(m.bias);
          const Icon = b.Icon;
          const booking = pending === m.symbol;
          const side: "long" | "short" = m.bias === "short" ? "short" : "long";
          return (
            <li key={m.symbol} className="rounded-xl border bg-card px-3 py-2.5">
              <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{m.display}</span>
                    <span className={`inline-flex items-center gap-0.5 px-1.5 h-5 rounded text-[10px] font-semibold border ${b.cls}`}>
                      <Icon className="size-2.5" />
                      {b.label}
                    </span>
                    {m.eligible ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-500">
                        <Check className="size-3" /> Eligible
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title={m.rejectReason ?? ""}>
                        <X className="size-3" /> {m.rejectReason ?? "Rejected"}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                    <span>${m.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                    <span className={clr(m.change24h)}>{pct(m.change24h, 1)}</span>
                    <span>RSI {m.rsi != null ? m.rsi.toFixed(0) : "—"}</span>
                    <span>EMA <span className="capitalize">{m.emaTrend}</span></span>
                    <span>VWAP <span className="capitalize">{m.vwapStatus}</span></span>
                    <span className="capitalize">Spread {m.spread}</span>
                    <span className="capitalize">Vol {m.volumeTier}{m.volumeSpike ? " ⚡" : ""}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <div className="flex items-center gap-1">
                    <span className="text-lg font-semibold tabular-nums leading-none">
                      {m.scalpScore}
                    </span>
                    <span className="text-[10px] text-muted-foreground">/100</span>
                  </div>
                  <Button
                    size="sm"
                    disabled={!m.eligible || booking}
                    onClick={() => book.mutate({ m, side })}
                    className={`h-7 px-2.5 text-[11px] rounded-md ${
                      m.bias === "short" ? "bg-destructive hover:bg-destructive/90" : "bg-emerald-600 hover:bg-emerald-700"
                    } text-white disabled:opacity-50`}
                  >
                    {booking ? <Clock className="size-3" /> : <>Book {b.label}</>}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}

        {!q.isLoading && filtered.length === 0 && !errorMsg ? (
          <li className="rounded-xl border border-dashed bg-card/50 p-8 text-center text-sm text-muted-foreground">
            No pairs match your filters. Try lowering the score or showing all biases.
          </li>
        ) : null}
      </ul>

      <TabBar />
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { closeManualTrade, updatePositionTpSl } from "@/lib/movers.functions";
import { Button } from "@/components/ui/button";
import { TabBar } from "@/components/tab-bar";
import { PositionsStrip } from "@/components/positions-strip";
import { useLivePrices } from "@/hooks/use-live-prices";
import { useCurrency } from "@/hooks/use-currency";
import { toast } from "sonner";
import { Briefcase, RefreshCw, HelpCircle, Pencil, Target, Shield, LineChart } from "lucide-react";
import { PositionChartSheet } from "@/components/position-chart-sheet";

export const Route = createFileRoute("/_authenticated/positions")({
  head: () => ({
    meta: [
      { title: "Open Positions — Earn'O" },
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

type ClosedRow = PositionRow & {
  exit_price: number | null;
  exit_reason: string | null;
  closed_at: string | null;
};

function fmtNum(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtDuration(fromIso: string, toIso: string | null): string {
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  const sec = Math.max(0, Math.floor((to - from) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${hr}h ${rem}m` : `${hr}h`;
}

function PositionsPage() {
  const qc = useQueryClient();
  const closeFn = useServerFn(closeManualTrade);
  const [pending, setPending] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "closed">("open");
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

  const closedQ = useQuery({
    queryKey: ["positions_closed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("id,symbol,side,leverage,qty,entry_price,mark_price,stop_loss,take_profit,pnl,pnl_pct,opened_at,closed_at,exit_price,exit_reason,mode,instrument")
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as ClosedRow[];
    },
    enabled: tab === "closed",
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
        <div className="inline-flex rounded-full border bg-muted p-1 mb-3">
          {(["open", "closed"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 h-8 text-xs font-medium rounded-full transition-colors ${
                tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {t === "open" ? "Open" : "History"}
            </button>
          ))}
        </div>

        {tab === "open" ? (
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
        ) : (
          <ClosedSummary rows={closedQ.data ?? []} />
        )}
      </section>

      {tab === "open" ? (
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

                <TpSlEditor
                  positionId={p.id}
                  side={p.side}
                  entry={entry}
                  takeProfit={p.take_profit}
                  stopLoss={p.stop_loss}
                />


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
      ) : (
        <ClosedList rows={closedQ.data ?? []} isLoading={closedQ.isLoading} />
      )}


      <TabBar />
    </div>
  );
}

function TpSlEditor({
  positionId,
  side,
  entry,
  takeProfit,
  stopLoss,
}: {
  positionId: string;
  side: "long" | "short";
  entry: number;
  takeProfit: number | null;
  stopLoss: number | null;
}) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updatePositionTpSl);
  const [editing, setEditing] = useState(false);
  const [tp, setTp] = useState<string>(takeProfit != null ? String(takeProfit) : "");
  const [sl, setSl] = useState<string>(stopLoss != null ? String(stopLoss) : "");
  const [tpUnit, setTpUnit] = useState<"price" | "pct">("price");
  const [slUnit, setSlUnit] = useState<"price" | "pct">("pct");

  useEffect(() => {
    if (!editing) {
      setTp(takeProfit != null ? String(takeProfit) : "");
      setSl(stopLoss != null ? String(stopLoss) : "");
      setTpUnit("price");
      setSlUnit("pct");
    }
  }, [editing, takeProfit, stopLoss]);

  const save = useMutation({
    mutationFn: async (v: { takeProfit: number | null; stopLoss: number | null }) =>
      updateFn({ data: { positionId, takeProfit: v.takeProfit, stopLoss: v.stopLoss } }),
    onSuccess: () => {
      toast.success("TP/SL updated");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["positions_open"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const tpPct = takeProfit != null && entry > 0
    ? ((takeProfit - entry) / entry) * 100 * (side === "long" ? 1 : -1)
    : null;
  const slPct = stopLoss != null && entry > 0
    ? ((entry - stopLoss) / entry) * 100 * (side === "long" ? 1 : -1)
    : null;

  if (!editing) {
    const hasTp = takeProfit != null;
    const hasSl = stopLoss != null;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-3 w-full rounded-lg border bg-muted/40 px-3 py-2 text-[11px] flex items-center justify-between gap-2 hover:bg-muted hover:border-primary/40 transition-colors text-left"
        aria-label="Edit take profit and stop loss"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Target className="size-3.5 text-emerald-500 shrink-0" />
          <span className="text-muted-foreground">TP</span>
          <span className={`tabular-nums ${hasTp ? "text-emerald-500 font-medium" : "text-muted-foreground italic"}`}>
            {hasTp ? fmtNum(takeProfit, 6) : "not set"}
          </span>
          {tpPct != null ? <span className="text-muted-foreground">({tpPct >= 0 ? "+" : ""}{tpPct.toFixed(2)}%)</span> : null}
        </span>
        <span className="flex items-center gap-1.5 min-w-0">
          <Shield className="size-3.5 text-destructive shrink-0" />
          <span className="text-muted-foreground">SL</span>
          <span className={`tabular-nums ${hasSl ? "text-destructive font-medium" : "text-muted-foreground italic"}`}>
            {hasSl ? fmtNum(stopLoss, 6) : "not set"}
          </span>
          {slPct != null ? <span className="text-muted-foreground">(-{Math.abs(slPct).toFixed(2)}%)</span> : null}
        </span>
        <span className="flex items-center gap-1 text-primary text-[10px] font-medium shrink-0">
          <Pencil className="size-3" /> Edit
        </span>
      </button>
    );
  }

  // Convert the typed value (in selected unit) to an absolute price.
  // For TP: long → entry*(1+pct/100); short → entry*(1-pct/100)
  // For SL: long → entry*(1-pct/100); short → entry*(1+pct/100)
  const pctToPrice = (pctVal: number, kind: "tp" | "sl"): number => {
    const dir = side === "long" ? 1 : -1;
    const sign = kind === "tp" ? 1 : -1;
    return entry * (1 + (dir * sign * pctVal) / 100);
  };

  const parseToPrice = (raw: string, unit: "price" | "pct", kind: "tp" | "sl"): number | null => {
    const s = raw.trim();
    if (s === "") return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return NaN;
    if (unit === "price") return n;
    if (n <= 0) return NaN;
    return pctToPrice(n, kind);
  };

  const tpPrice = parseToPrice(tp, tpUnit, "tp");
  const slPrice = parseToPrice(sl, slUnit, "sl");
  const tpInvalid =
    tpPrice != null && (Number.isNaN(tpPrice) || tpPrice <= 0 || (side === "long" ? tpPrice <= entry : tpPrice >= entry));
  const slInvalid =
    slPrice != null && (Number.isNaN(slPrice) || slPrice <= 0 || (side === "long" ? slPrice >= entry : slPrice <= entry));

  // Live preview for the *other* unit (helps the user understand what they typed).
  const tpPreviewPct = tpPrice != null && !Number.isNaN(tpPrice) && entry > 0
    ? ((tpPrice - entry) / entry) * 100 * (side === "long" ? 1 : -1)
    : null;
  const slPreviewPct = slPrice != null && !Number.isNaN(slPrice) && entry > 0
    ? ((entry - slPrice) / entry) * 100 * (side === "long" ? 1 : -1)
    : null;

  return (
    <div className="mt-3 rounded-lg border bg-muted/40 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Take Profit ({side === "long" ? ">" : "<"} {fmtNum(entry, 6)})</span>
            <UnitToggle value={tpUnit} onChange={setTpUnit} />
          </div>
          <div className="relative">
            <input
              type="number"
              step="any"
              inputMode="decimal"
              value={tp}
              onChange={(e) => setTp(e.target.value)}
              placeholder={tpUnit === "pct" ? "e.g. 3" : "—"}
              className={`w-full rounded-md border bg-background pl-2 pr-7 h-8 text-xs tabular-nums ${tpInvalid ? "border-destructive" : ""}`}
            />
            {tpUnit === "pct" && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {tpUnit === "pct"
              ? tpPrice != null && !Number.isNaN(tpPrice) ? `≈ ${fmtNum(tpPrice, 6)}` : "Enter % above entry"
              : tpPreviewPct != null ? `≈ +${tpPreviewPct.toFixed(2)}%` : "Enter price"}
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Stop Loss ({side === "long" ? "<" : ">"} {fmtNum(entry, 6)})</span>
            <UnitToggle value={slUnit} onChange={setSlUnit} />
          </div>
          <div className="relative">
            <input
              type="number"
              step="any"
              inputMode="decimal"
              value={sl}
              onChange={(e) => setSl(e.target.value)}
              placeholder={slUnit === "pct" ? "e.g. 1.5" : "—"}
              className={`w-full rounded-md border bg-background pl-2 pr-7 h-8 text-xs tabular-nums ${slInvalid ? "border-destructive" : ""}`}
            />
            {slUnit === "pct" && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {slUnit === "pct"
              ? slPrice != null && !Number.isNaN(slPrice) ? `≈ ${fmtNum(slPrice, 6)}` : "Enter % below entry"
              : slPreviewPct != null ? `≈ −${Math.abs(slPreviewPct).toFixed(2)}%` : "Enter price"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 flex-1"
          onClick={() => setEditing(false)}
          disabled={save.isPending}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-8 flex-1"
          disabled={save.isPending || tpInvalid || slInvalid}
          onClick={() =>
            save.mutate({
              takeProfit: tpPrice != null && !Number.isNaN(tpPrice) ? tpPrice : null,
              stopLoss: slPrice != null && !Number.isNaN(slPrice) ? slPrice : null,
            })
          }
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Switch between price and % per field. Leave blank to clear. The bot auto-closes when LTP crosses these levels.
      </p>
    </div>
  );
}

function UnitToggle({
  value, onChange,
}: { value: "price" | "pct"; onChange: (v: "price" | "pct") => void }) {
  return (
    <div className="inline-flex items-center rounded-md border bg-background p-0.5">
      {(["price", "pct"] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          className={`h-5 px-2 text-[10px] font-medium rounded ${
            value === u ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {u === "price" ? "Price" : "%"}
        </button>
      ))}
    </div>
  );
}




function ClosedSummary({ rows }: { rows: ClosedRow[] }) {
  const { fmt } = useCurrency();
  const total = rows.reduce((a, r) => a + Number(r.pnl ?? 0), 0);
  const wins = rows.filter((r) => Number(r.pnl ?? 0) > 0).length;
  const winRate = rows.length ? (wins / rows.length) * 100 : 0;
  return (
    <div className="rounded-2xl border bg-card p-4 grid grid-cols-3 gap-3">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total PNL</p>
        <p className={`text-xl font-semibold tabular-nums mt-0.5 ${total >= 0 ? "text-emerald-500" : "text-destructive"}`}>
          {fmt(total, { signed: true })}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Trades</p>
        <p className="text-xl font-semibold tabular-nums mt-0.5">{rows.length}</p>
      </div>
      <div className="text-right">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Win rate</p>
        <p className="text-xl font-semibold tabular-nums mt-0.5">{winRate.toFixed(0)}%</p>
      </div>
    </div>
  );
}

function ClosedList({
  rows,
  isLoading,
}: {
  rows: ClosedRow[];
  isLoading: boolean;
}) {
  const { fmt } = useCurrency();

  if (isLoading && !rows.length) {
    return (
      <ul className="px-5 mt-3 space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="h-28 rounded-2xl border bg-card animate-pulse" />
        ))}
      </ul>
    );
  }
  if (!rows.length) {
    return (
      <div className="px-5 mt-3">
        <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">No closed trades yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Closed positions will show up here.</p>
        </div>
      </div>
    );
  }
  return (
    <ul className="px-5 mt-3 space-y-2">
      {rows.map((p) => {
        const pnl = Number(p.pnl ?? 0);
        const up = pnl >= 0;
        const sideCls =
          p.side === "long" ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive";
        const reason = p.exit_reason ?? "—";
        const reasonLabel =
          reason === "take_profit" ? "Take Profit"
          : reason === "stop_loss" ? "Stop Loss"
          : reason === "time_exit" ? "Time Exit"
          : reason === "trend_invalidated" ? "Trend Invalidated"
          : reason === "manual_limit" ? "Manual Close"
          : reason === "kill_switch" ? "Emergency Stop"
          : reason === "risk_protection" ? "Risk Protection"
          : reason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        return (
          <li key={p.id} className="rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span className="font-medium text-sm">{p.symbol}</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${sideCls}`}>
                  {p.side === "long" ? "Long" : "Short"} {p.leverage}x
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                  {p.mode}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded border text-foreground capitalize">
                  {reasonLabel}
                </span>
              </div>
              <p className={`text-lg font-semibold tabular-nums ${up ? "text-emerald-500" : "text-destructive"}`}>
                {fmt(pnl, { signed: true })}
              </p>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2 text-[11px]">
              <div>
                <p className="text-muted-foreground">Entry</p>
                <p className="tabular-nums font-medium mt-0.5">{fmtNum(p.entry_price, 6)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Exit</p>
                <p className="tabular-nums font-medium mt-0.5">{fmtNum(p.exit_price ?? p.mark_price, 6)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ROE</p>
                <p className={`tabular-nums font-medium mt-0.5 ${up ? "text-emerald-500" : "text-destructive"}`}>
                  {up ? "+" : ""}
                  {Number(p.pnl_pct ?? 0).toFixed(2)}%
                </p>
              </div>
              <div className="text-right">
                <p className="text-muted-foreground">Held</p>
                <p className="tabular-nums font-medium mt-0.5">{fmtDuration(p.opened_at, p.closed_at)}</p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              {new Date(p.opened_at).toLocaleString()} → {p.closed_at ? new Date(p.closed_at).toLocaleString() : "—"}
            </p>
          </li>
        );
      })}
    </ul>
  );
}


/**
 * Shared Coin Paper Bot panels. Used by /coin-bot, and by /scanner & /positions
 * when the top market toggle is set to "Coins".
 */

import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { HelpCircle, RefreshCw } from "lucide-react";

import {
  getCoinPortfolio, getCoinSignals, getCoinHoldings,
  paperBuyCoin, paperSellCoin, runCoinScan,
} from "@/lib/coin-bot/coin-bot.functions";
import { Button } from "@/components/ui/button";
import { useCurrency } from "@/hooks/use-currency";

type Action = "buy" | "sell" | "hold" | "wait" | "avoid";

const ACTION_PILL: Record<Action, string> = {
  buy: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  sell: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200",
  hold: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200",
  wait: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  avoid: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};
const ACTION_LABEL: Record<Action, string> = { buy: "Buy", sell: "Sell", hold: "Hold", wait: "Wait", avoid: "Avoid" };

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}

function useCoinQueries() {
  const portfolioFn = useServerFn(getCoinPortfolio);
  const signalsFn = useServerFn(getCoinSignals);
  const holdingsFn = useServerFn(getCoinHoldings);
  return {
    portfolio: useQuery({ queryKey: ["coin_portfolio"], queryFn: () => portfolioFn(), refetchInterval: 20_000 }),
    signals: useQuery({ queryKey: ["coin_signals"], queryFn: () => signalsFn(), refetchInterval: 30_000 }),
    holdings: useQuery({ queryKey: ["coin_holdings"], queryFn: () => holdingsFn(), refetchInterval: 20_000 }),
  };
}

export function CoinPortfolioCard() {
  const { fmt: fmtCur } = useCurrency();
  const { portfolio, holdings } = useCoinQueries();
  const p = portfolio.data;
  const h = holdings.data;
  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Coin paper portfolio</div>
      <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
        <Stat label="Allocated" value={fmtCur(p?.allocated_capital_usdt ?? 0)} />
        <Stat label="Available cash" value={fmtCur(p?.available_cash_usdt ?? 0)} />
        <Stat label="Invested" value={fmtCur(p?.invested_usdt ?? 0)} />
        <Stat label="Active holdings" value={String(p?.active_holdings ?? 0)} />
        <Stat label="Realized today" value={fmtCur(Number(p?.realized_today_usdt ?? 0), { signed: true })} />
        <Stat label="Bot" value={p?.enabled ? "On" : "Off"} />
      </div>
      {h?.summary && (
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div>Best: <span className="text-foreground">{h.summary.best_symbol ?? "—"} {h.summary.best_pnl_pct != null ? `(${fmt(h.summary.best_pnl_pct)}%)` : ""}</span></div>
          <div>Worst: <span className="text-foreground">{h.summary.worst_symbol ?? "—"} {h.summary.worst_pnl_pct != null ? `(${fmt(h.summary.worst_pnl_pct)}%)` : ""}</span></div>
        </div>
      )}
    </section>
  );
}

export function CoinHoldingsCard() {
  const qc = useQueryClient();
  const { holdings } = useCoinQueries();
  const sellFn = useServerFn(paperSellCoin);
  const sell = useMutation({
    mutationFn: (v: { positionId: string; price: number }) =>
      sellFn({ data: { positionId: v.positionId, price: v.price, reason: "manual_paper_sell" } }),
    onSuccess: (r) => {
      if ((r as any).ok) {
        toast.success("Paper sell booked");
        qc.invalidateQueries({ queryKey: ["coin_portfolio"] });
        qc.invalidateQueries({ queryKey: ["coin_holdings"] });
      } else toast.error((r as any).error ?? "Sell failed");
    },
  });

  const open = holdings.data?.open ?? [];
  if (open.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
        No active coin holdings yet.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">Coin</th>
            <th className="text-right px-2 py-2">Qty</th>
            <th className="text-right px-2 py-2">Avg (USDT)</th>
            <th className="text-right px-2 py-2">Now (USDT)</th>
            <th className="text-right px-2 py-2">PnL</th>
            <th className="px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {open.map((row) => {
            const pnlPct = ((Number(row.last_price) - Number(row.avg_buy_price)) / Number(row.avg_buy_price)) * 100;
            return (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2 font-medium">{row.display}</td>
                <td className="text-right px-2 py-2">{fmt(row.qty, 6)}</td>
                <td className="text-right px-2 py-2">{fmt(row.avg_buy_price, 6)}</td>
                <td className="text-right px-2 py-2">{fmt(row.last_price, 6)}</td>
                <td className={`text-right px-2 py-2 ${pnlPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {fmt(pnlPct)}%
                </td>
                <td className="px-2 py-2 text-right">
                  <Button size="sm" variant="outline" onClick={() => sell.mutate({ positionId: row.id, price: row.last_price ?? row.avg_buy_price })}>
                    Sell
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CoinSignalsList({
  headerRight, filterAction, query, limit, hideHeader, hideScan,
}: {
  headerRight?: React.ReactNode;
  filterAction?: "all" | "buy" | "hold" | "wait" | "avoid" | "sell";
  query?: string;
  limit?: number;
  hideHeader?: boolean;
  hideScan?: boolean;
} = {}) {
  const qc = useQueryClient();
  const { signals } = useCoinQueries();
  const buyFn = useServerFn(paperBuyCoin);
  const scanFn = useServerFn(runCoinScan);
  const [whyOpen, setWhyOpen] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["coin_portfolio"] });
    qc.invalidateQueries({ queryKey: ["coin_signals"] });
    qc.invalidateQueries({ queryKey: ["coin_holdings"] });
  };

  const scan = useMutation({
    mutationFn: () => scanFn(),
    onSuccess: (r) => {
      if ((r as any)?.ok) {
        toast.success(`Scan complete · ${(r as any).scanned} coins · ${(r as any).signals} signals`);
        refresh();
      } else toast.error((r as any)?.error ?? "Scan failed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Scan failed"),
  });

  const buy = useMutation({
    mutationFn: (v: { symbol: string; display: string; price: number; reason: string; target: number; stop: number }) =>
      buyFn({ data: { symbol: v.symbol, display: v.display, price: v.price, usdt: 250, reason: v.reason, target: v.target, stop: v.stop, source: "manual" } }),
    onSuccess: (r) => {
      if ((r as any).ok) { toast.success("Paper buy booked"); refresh(); }
      else toast.error((r as any).error ?? "Buy failed");
    },
  });

  let sigs = (signals.data ?? []) as any[];
  if (filterAction && filterAction !== "all") sigs = sigs.filter((s) => s.action === filterAction);
  if (query && query.trim()) {
    const q = query.trim().toLowerCase();
    sigs = sigs.filter((s) => String(s.display ?? "").toLowerCase().includes(q) || String(s.symbol ?? "").toLowerCase().includes(q));
  }
  if (limit) sigs = sigs.slice(0, limit);

  return (
    <div className="space-y-2">
      {!hideHeader && (
        <div className="flex items-center justify-between px-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Live coin signals</div>
          <div className="flex items-center gap-2">
            {headerRight}
            {!hideScan && (
              <Button size="sm" variant="outline" onClick={() => scan.mutate()} disabled={scan.isPending}>
                <RefreshCw className={`size-3 mr-1 ${scan.isPending ? "animate-spin" : ""}`} />
                Scan
              </Button>
            )}
          </div>
        </div>
      )}

      {sigs.length === 0 ? (
        <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          No coin signals match. Tap Scan to run on live CoinDCX data.
        </div>
      ) : (
        <ul className="space-y-2">
          {sigs.map((s) => (
            <li key={s.id} className="rounded-2xl border bg-card p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{s.display}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${ACTION_PILL[s.action as Action]}`}>
                    {ACTION_LABEL[s.action as Action]}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{s.confidence}%</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setWhyOpen(whyOpen === s.id ? null : s.id)}>
                  <HelpCircle className="size-4" />
                </Button>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                <div>Price <span className="text-foreground">{fmt(s.price, 6)}</span> <span className="text-[9px]">USDT</span></div>
                <div>Target <span className="text-foreground">{fmt(s.target, 6)}</span> <span className="text-[9px]">USDT</span></div>
                <div>Stop <span className="text-foreground">{fmt(s.stop, 6)}</span> <span className="text-[9px]">USDT</span></div>
              </div>
              <div className="mt-1 text-xs">{s.reason_short}</div>
              {whyOpen === s.id && s.reason_detail?.pills && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {(s.reason_detail.pills as string[]).map((p, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{p}</span>
                  ))}
                </div>
              )}
              <div className="mt-2 flex gap-2">
                {(s.action === "buy" || s.action === "wait" || s.action === "hold") && (
                  <Button size="sm" onClick={() => buy.mutate({ symbol: s.symbol, display: s.display, price: s.price, reason: s.reason_short, target: s.target, stop: s.stop })}>
                    Paper Buy
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

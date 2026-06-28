import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Coins, RefreshCw, HelpCircle, Settings as Cog } from "lucide-react";

import {
  getCoinPortfolio,
  getCoinSignals,
  getCoinHoldings,
  paperBuyCoin,
  paperSellCoin,
  runCoinScan,
  getCoinConfig,
  updateCoinConfig,
} from "@/lib/coin-bot/coin-bot.functions";
import { Button } from "@/components/ui/button";
import { TabBar } from "@/components/tab-bar";
import { useCurrency } from "@/hooks/use-currency";

export const Route = createFileRoute("/_authenticated/coin-bot")({
  head: () => ({
    meta: [
      { title: "Coin Paper Bot — Earn'O" },
      {
        name: "description",
        content: "Coin buy/sell paper trading using real CoinDCX public market data.",
      },
    ],
  }),
  component: CoinBotPage,
});

type Action = "buy" | "sell" | "hold" | "wait" | "avoid";

const ACTION_PILL: Record<Action, string> = {
  buy: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  sell: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200",
  hold: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200",
  wait: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  avoid: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const ACTION_LABEL: Record<Action, string> = {
  buy: "Buy",
  sell: "Sell",
  hold: "Hold",
  wait: "Wait",
  avoid: "Avoid",
};

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}

function CoinBotPage() {
  const qc = useQueryClient();
  const portfolioFn = useServerFn(getCoinPortfolio);
  const signalsFn = useServerFn(getCoinSignals);
  const holdingsFn = useServerFn(getCoinHoldings);
  const buyFn = useServerFn(paperBuyCoin);
  const sellFn = useServerFn(paperSellCoin);
  const scanFn = useServerFn(runCoinScan);
  const cfgFn = useServerFn(getCoinConfig);
  const updCfgFn = useServerFn(updateCoinConfig);

  const portfolio = useQuery({
    queryKey: ["coin_portfolio"],
    queryFn: () => portfolioFn(),
    refetchInterval: 20_000,
  });
  const signals = useQuery({
    queryKey: ["coin_signals"],
    queryFn: () => signalsFn(),
    refetchInterval: 30_000,
  });
  const holdings = useQuery({
    queryKey: ["coin_holdings"],
    queryFn: () => holdingsFn(),
    refetchInterval: 20_000,
  });
  const cfg = useQuery({ queryKey: ["coin_cfg"], queryFn: () => cfgFn() });

  const [whyOpen, setWhyOpen] = useState<string | null>(null);
  const [showCfg, setShowCfg] = useState(false);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["coin_portfolio"] });
    qc.invalidateQueries({ queryKey: ["coin_signals"] });
    qc.invalidateQueries({ queryKey: ["coin_holdings"] });
  };

  const scan = useMutation({
    mutationFn: () => scanFn(),
    onSuccess: (r) => {
      if (r && (r as any).ok) {
        toast.success(
          `Scan complete · ${(r as any).scanned} coins · ${(r as any).signals} signals`,
        );
        refreshAll();
      } else {
        toast.error((r as any)?.error ?? "Scan failed");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Scan failed"),
  });

  const buy = useMutation({
    mutationFn: (v: {
      symbol: string;
      display: string;
      price: number;
      reason: string;
      target: number;
      stop: number;
    }) =>
      buyFn({
        data: {
          symbol: v.symbol,
          display: v.display,
          price: v.price,
          usdt: 250,
          reason: v.reason,
          target: v.target,
          stop: v.stop,
          source: "manual",
        },
      }),
    onSuccess: (r) => {
      if ((r as any).ok) {
        toast.success("Paper buy booked");
        refreshAll();
      } else toast.error((r as any).error ?? "Buy failed");
    },
  });

  const sell = useMutation({
    mutationFn: (v: { positionId: string; price: number }) =>
      sellFn({ data: { positionId: v.positionId, price: v.price, reason: "manual_paper_sell" } }),
    onSuccess: (r) => {
      if ((r as any).ok) {
        toast.success("Paper sell booked");
        refreshAll();
      } else toast.error((r as any).error ?? "Sell failed");
    },
  });

  const updCfg = useMutation({
    mutationFn: (v: any) => updCfgFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coin_cfg"] });
      qc.invalidateQueries({ queryKey: ["coin_portfolio"] });
      toast.success("Settings saved");
    },
  });

  const p = portfolio.data;
  const h = holdings.data;
  const c = cfg.data;
  const sigs = (signals.data ?? []) as any[];
  const heldSymbols = new Set((h?.open ?? []).map((row: any) => row.symbol));

  return (
    <div className="min-h-dvh pb-24 bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="size-5" />
            <h1 className="font-semibold">Coin Paper Bot</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowCfg((v) => !v)}>
              <Cog className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => scan.mutate()}
              disabled={scan.isPending}
            >
              <RefreshCw className={`size-4 ${scan.isPending ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-4 space-y-4">
        {/* Portfolio summary */}
        <section className="rounded-2xl border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Coin portfolio
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Allocated" value={`$${fmt(p?.allocated_capital_usdt)}`} />
            <Stat label="Available cash" value={`$${fmt(p?.available_cash_usdt)}`} />
            <Stat label="Invested" value={`$${fmt(p?.invested_usdt)}`} />
            <Stat label="Active holdings" value={String(p?.active_holdings ?? 0)} />
            <Stat label="Realized today" value={`$${fmt(p?.realized_today_usdt)}`} />
            <Stat label="Bot" value={p?.enabled ? "On" : "Off"} />
          </div>
          {h?.summary && (
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div>
                Best:{" "}
                <span className="text-foreground">
                  {h.summary.best_symbol ?? "—"}{" "}
                  {h.summary.best_pnl_pct != null ? `(${fmt(h.summary.best_pnl_pct)}%)` : ""}
                </span>
              </div>
              <div>
                Worst:{" "}
                <span className="text-foreground">
                  {h.summary.worst_symbol ?? "—"}{" "}
                  {h.summary.worst_pnl_pct != null ? `(${fmt(h.summary.worst_pnl_pct)}%)` : ""}
                </span>
              </div>
            </div>
          )}
        </section>

        {showCfg && c && (
          <section className="rounded-2xl border bg-card p-4 space-y-3">
            <div className="text-sm font-medium">Coin Bot settings</div>
            <div className="flex items-center justify-between text-sm">
              <span>Bot enabled</span>
              <Button
                size="sm"
                variant={c.enabled ? "default" : "outline"}
                onClick={() => updCfg.mutate({ enabled: !c.enabled })}
              >
                {c.enabled ? "On" : "Off"}
              </Button>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Mode</span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={c.mode === "intraday" ? "default" : "outline"}
                  onClick={() => updCfg.mutate({ mode: "intraday" })}
                >
                  Intraday
                </Button>
                <Button
                  size="sm"
                  variant={c.mode === "swing" ? "default" : "outline"}
                  onClick={() => updCfg.mutate({ mode: "swing" })}
                >
                  Swing
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Intraday: scans every {c.scan_interval_min}m, prefers short-term momentum, can carry
              overnight if trend valid. Swing: holds across days, max {c.max_holding_days} days. No
              forced time-based exits.
            </div>
          </section>
        )}

        {/* Holdings */}
        <section>
          <div className="px-1 pb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Holdings
          </div>
          {h?.open?.length ? (
            <div className="overflow-hidden rounded-2xl border bg-card">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Coin</th>
                    <th className="text-right px-2 py-2">Qty</th>
                    <th className="text-right px-2 py-2">Avg</th>
                    <th className="text-right px-2 py-2">Now</th>
                    <th className="text-right px-2 py-2">PnL</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {h.open.map((row) => {
                    const pnlPct =
                      ((row.last_price! - row.avg_buy_price) / row.avg_buy_price) * 100;
                    return (
                      <tr key={row.id} className="border-t">
                        <td className="px-3 py-2 font-medium">{row.display}</td>
                        <td className="text-right px-2 py-2">{fmt(row.qty, 6)}</td>
                        <td className="text-right px-2 py-2">{fmt(row.avg_buy_price, 6)}</td>
                        <td className="text-right px-2 py-2">{fmt(row.last_price, 6)}</td>
                        <td
                          className={`text-right px-2 py-2 ${pnlPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                        >
                          {fmt(pnlPct)}%
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              sell.mutate({
                                positionId: row.id,
                                price: row.last_price ?? row.avg_buy_price,
                              })
                            }
                          >
                            Sell
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
              No active coin holdings yet.
            </div>
          )}
        </section>

        {/* Signals */}
        <section>
          <div className="px-1 pb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Live coin signals
          </div>
          {sigs.length === 0 ? (
            <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
              No signals yet. Tap refresh to run a scan.
            </div>
          ) : (
            <ul className="space-y-2">
              {sigs.map((s) => (
                <li key={s.id} className="rounded-2xl border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{s.display}</span>
                      {heldSymbols.has(s.symbol) && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">
                          Held
                        </span>
                      )}
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full ${ACTION_PILL[s.action as Action]}`}
                      >
                        {ACTION_LABEL[s.action as Action]}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{s.confidence}%</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setWhyOpen(whyOpen === s.id ? null : s.id)}
                    >
                      <HelpCircle className="size-4" />
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                    <div>
                      Price <span className="text-foreground">{fmt(s.price, 6)}</span>
                    </div>
                    <div>
                      Target <span className="text-foreground">{fmt(s.target, 6)}</span>
                    </div>
                    <div>
                      Stop <span className="text-foreground">{fmt(s.stop, 6)}</span>
                    </div>
                  </div>
                  <div className="mt-1 text-xs">{s.reason_short}</div>
                  {whyOpen === s.id && s.reason_detail?.pills && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(s.reason_detail.pills as string[]).map((p, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    {(s.action === "buy" || s.action === "wait" || s.action === "hold") && (
                      <Button
                        size="sm"
                        onClick={() =>
                          buy.mutate({
                            symbol: s.symbol,
                            display: s.display,
                            price: s.price,
                            reason: s.reason_short,
                            target: s.target,
                            stop: s.stop,
                          })
                        }
                      >
                        Paper Buy
                      </Button>
                    )}
                    {s.action === "sell" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sell.mutate({ positionId: "", price: s.price })}
                        disabled
                      >
                        Paper Sell (from Holdings)
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <TabBar />
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

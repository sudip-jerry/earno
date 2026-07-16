import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

import { getDashboardStats } from "@/lib/stats.functions";
import { getCoinHoldings, getCoinPortfolio } from "@/lib/coin-bot/coin-bot.functions";
import { PageHeader } from "@/components/brand/brand-ui";
import { useCurrency } from "@/hooks/use-currency";
import { useMarketMode } from "@/hooks/use-market-mode";

export const Route = createFileRoute("/_authenticated/capital")({
  head: () => ({
    meta: [
      { title: "Capital — Earn'O" },
      { name: "description", content: "Your capital over time, day by day or week by week." },
    ],
  }),
  component: CapitalPage,
});

type Delta = { date: string; pnl: number };

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** ISO-ish week key (year + week number) for weekly aggregation. */
function weekKey(iso: string): string {
  const d = new Date(iso);
  const day = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - day);
  return dayKey(d);
}

function CapitalPage() {
  const navigate = useNavigate();
  const { fmt } = useCurrency();
  const { market } = useMarketMode();
  const [gran, setGran] = useState<"day" | "week">("day");

  const statsFn = useServerFn(getDashboardStats);
  const holdingsFn = useServerFn(getCoinHoldings);
  const portfolioFn = useServerFn(getCoinPortfolio);

  const stats = useQuery({
    queryKey: ["dashboard_stats"],
    queryFn: () => statsFn({ data: undefined }),
    enabled: market !== "spot",
  });
  const holdings = useQuery({
    queryKey: ["coin_holdings"],
    queryFn: () => holdingsFn(),
    enabled: market !== "futures",
  });
  const portfolio = useQuery({
    queryKey: ["coin_portfolio"],
    queryFn: () => portfolioFn(),
    enabled: market !== "futures",
  });

  const label = market === "spot" ? "Coins" : market === "futures" ? "Futures" : "Total";

  const { points, current, change } = useMemo(() => {
    // Daily deltas + current capital, per market.
    const futDeltas: Delta[] = (stats.data?.dailyPnl ?? []).map((d) => ({
      date: d.date,
      pnl: Number(d.pnl),
    }));
    const futCurrent = Number(stats.data?.portfolioValue ?? 0) + Number(stats.data?.openPnl ?? 0);

    const coinBucket = new Map<string, number>();
    for (const c of holdings.data?.closed ?? []) {
      if (!c.closed_at) continue;
      coinBucket.set(
        dayKey(new Date(c.closed_at)),
        (coinBucket.get(dayKey(new Date(c.closed_at))) ?? 0) + Number(c.realized_pnl_usdt ?? 0),
      );
    }
    const coinDeltas: Delta[] = [...coinBucket.entries()].map(([date, pnl]) => ({ date, pnl }));
    const coinCurrent =
      Number(portfolio.data?.available_cash_usdt ?? 0) +
      Number(holdings.data?.summary?.current_value_usdt ?? 0);

    let deltas: Delta[];
    let current: number;
    if (market === "futures") {
      deltas = futDeltas;
      current = futCurrent;
    } else if (market === "spot") {
      deltas = coinDeltas;
      current = coinCurrent;
    } else {
      const merged = new Map<string, number>();
      for (const d of [...futDeltas, ...coinDeltas])
        merged.set(d.date, (merged.get(d.date) ?? 0) + d.pnl);
      deltas = [...merged.entries()].map(([date, pnl]) => ({ date, pnl }));
      current = futCurrent + coinCurrent;
    }

    deltas.sort((a, b) => (a.date < b.date ? -1 : 1));

    // Weekly aggregation: sum deltas within each week.
    if (gran === "week") {
      const wk = new Map<string, number>();
      for (const d of deltas) wk.set(weekKey(d.date), (wk.get(weekKey(d.date)) ?? 0) + d.pnl);
      deltas = [...wk.entries()]
        .map(([date, pnl]) => ({ date, pnl }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    }

    // Build a capital curve that ends at the true current capital.
    const total = deltas.reduce((a, d) => a + d.pnl, 0);
    let cap = current - total;
    const start = cap;
    const pts = deltas.map((d) => {
      cap += d.pnl;
      return { date: d.date, capital: cap };
    });
    // Prepend the starting capital so the line has a baseline.
    const points = pts.length ? [{ date: deltas[0].date, capital: start }, ...pts] : [];

    return { points, current, change: current - start };
  }, [stats.data, holdings.data, portfolio.data, market, gran]);

  const up = change >= 0;

  return (
    <div className="min-h-svh bg-background pb-28">
      <PageHeader onBack={() => navigate({ to: "/" })} title={`${label} capital`} />

      <div className="px-5 mt-2">
        <div className="inline-flex rounded-full border bg-muted p-1">
          {(["day", "week"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGran(g)}
              className={`px-4 h-8 text-xs font-medium rounded-full transition-colors capitalize ${
                gran === g ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {g === "day" ? "Day by day" : "Week by week"}
            </button>
          ))}
        </div>
      </div>

      <section className="px-5 mt-4">
        <div className="brand-hero rounded-2xl p-5 shadow-md">
          <div className="text-[11px] uppercase tracking-wider text-white/60">Current capital</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-white">{fmt(current)}</div>
          <div
            className={`mt-1 text-[13px] font-medium tabular-nums ${up ? "text-emerald-300" : "text-rose-300"}`}
          >
            {fmt(change, { signed: true })} over this period
          </div>

          <div className="mt-4 h-[220px]">
            {points.length < 2 ? (
              <div className="h-full grid place-items-center text-[12px] text-white/60">
                Chart builds as trades close
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="capFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={up ? "#34d399" : "#fb7185"} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={up ? "#34d399" : "#fb7185"} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 9 }}
                    tickFormatter={(v: string) => v.slice(5)}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 9 }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                    tickFormatter={(v: number) => fmt(v)}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0d1b3d",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 12,
                      color: "#fff",
                      fontSize: 12,
                    }}
                    labelFormatter={(v: string) => v}
                    formatter={(v: number) => [fmt(v), "Capital"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="capital"
                    stroke={up ? "#34d399" : "#fb7185"}
                    strokeWidth={2}
                    fill="url(#capFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <p className="mt-3 text-[11.5px] text-muted-foreground leading-relaxed">
          Capital is your money on this side over time — {gran === "day" ? "each day" : "each week"}
          &apos;s closing value. The line ends at your current {label.toLowerCase()} value.
        </p>
      </section>
    </div>
  );
}

import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Coins, TrendingUp, TrendingDown } from "lucide-react";
import { getCoinPortfolio, getCoinHoldings } from "@/lib/coin-bot/coin-bot.functions";
import { useCurrency } from "@/hooks/use-currency";
import { DailyBars } from "@/components/market/daily-bars";

export function CoinHero() {
  const { fmt } = useCurrency();
  const portfolioFn = useServerFn(getCoinPortfolio);
  const holdingsFn = useServerFn(getCoinHoldings);
  const portfolio = useQuery({
    queryKey: ["coin_portfolio"],
    queryFn: () => portfolioFn(),
    refetchInterval: 20_000,
  });
  const holdings = useQuery({
    queryKey: ["coin_holdings"],
    queryFn: () => holdingsFn(),
    refetchInterval: 20_000,
  });

  const p = portfolio.data;
  const sum = holdings.data?.summary;
  const unrealized = Number(sum?.unrealized_pnl_usdt ?? 0);
  const equity = Number(p?.available_cash_usdt ?? 0) + Number(sum?.current_value_usdt ?? 0);
  const totalPnl = unrealized + Number(p?.realized_today_usdt ?? 0);
  const pnlPos = totalPnl >= 0;

  // Daily realized-PnL series from closed trades, for the bar chart.
  const dailyPnl = (() => {
    const bucket = new Map<string, number>();
    for (const c of holdings.data?.closed ?? []) {
      if (!c.closed_at) continue;
      const d = new Date(c.closed_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      bucket.set(key, (bucket.get(key) ?? 0) + Number(c.realized_pnl_usdt ?? 0));
    }
    return [...bucket.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, pnl]) => ({ date, pnl }));
  })();

  return (
    <section className="brand-hero rounded-2xl p-5 shadow-md">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/60">
        <Coins className="size-3.5" />
        Coin paper equity
        <span
          className={`ml-auto text-[10px] font-semibold px-2 h-5 inline-flex items-center rounded-full ${p?.enabled ? "bg-emerald-400/20 text-emerald-200" : "bg-white/10 text-white/60"}`}
        >
          Bot {p?.enabled ? "On" : "Off"}
        </span>
      </div>
      <div className="mt-2 flex items-end gap-3">
        <div className="text-3xl font-semibold tabular-nums text-white">{fmt(equity)}</div>
        <div
          className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums mb-1 ${pnlPos ? "text-emerald-300" : "text-rose-300"}`}
        >
          {pnlPos ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
          {fmt(totalPnl, { signed: true })}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 text-[11px]">
        <Tile label="Cash" value={fmt(p?.available_cash_usdt ?? 0)} />
        <Tile label="Deployed" value={fmt(p?.invested_usdt ?? 0)} />
        <Tile
          label="Unrealized"
          value={fmt(unrealized, { signed: true })}
          tone={unrealized >= 0 ? "pos" : "neg"}
        />
        <Tile
          label="Today"
          value={fmt(Number(p?.realized_today_usdt ?? 0), { signed: true })}
          tone={Number(p?.realized_today_usdt ?? 0) >= 0 ? "pos" : "neg"}
        />
      </div>
      <DailyBars series={dailyPnl} />
    </section>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const color =
    tone === "pos" ? "text-emerald-300" : tone === "neg" ? "text-rose-300" : "text-white";
  return (
    <div className="rounded-xl bg-white/10 p-2">
      <div className="text-[10px] uppercase tracking-wider text-white/55">{label}</div>
      <div className={`mt-0.5 text-[12px] font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

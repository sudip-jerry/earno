import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/help")({
  head: () => ({
    meta: [
      { title: "How it works — EarnO" },
      { name: "description", content: "How EarnO selects and books futures trades." },
    ],
  }),
  component: HelpPage,
});

function HelpPage() {
  return (
    <div className="min-h-svh bg-background pb-12">
      <header className="px-5 pt-6 pb-4 flex items-center gap-2">
        <Link to="/dashboard" className="size-9 grid place-items-center rounded-full hover:bg-muted -ml-2">
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-xl font-semibold">How it works</h1>
      </header>

      <div className="px-5 space-y-6">
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="text-sm font-semibold">1. Market scan</h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            EarnO monitors CoinDCX futures tickers in real time and ranks the top moving pairs by 24-hour percentage change. It also reads the last 1-minute and 5-minute candles to confirm short-term momentum before considering a pair.
          </p>
        </section>

        <section className="rounded-2xl border bg-card p-4">
          <h2 className="text-sm font-semibold">2. Entry signal (EMA cross)</h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            A trade is only booked when the fast EMA crosses the slow EMA on the chosen timeframe (default 15m). Fast above slow triggers a long; fast below slow triggers a short (if shorts are enabled).
          </p>
          <div className="mt-3 flex gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Fast EMA</span>
              <p className="font-medium mt-0.5">9 periods</p>
            </div>
            <div>
              <span className="text-muted-foreground">Slow EMA</span>
              <p className="font-medium mt-0.5">21 periods</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-card p-4">
          <h2 className="text-sm font-semibold">3. Position sizing</h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Size is calculated so that if the stop-loss hits you only lose the configured risk per trade. The formula is:
          </p>
          <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs font-mono text-foreground">
            Notional = Equity × Risk% ÷ SL% × Leverage
          </p>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Example: with $1,000 equity, 2% risk, 20% stop loss and 3x leverage, the notional position would be about $300.
          </p>
        </section>

        <section className="rounded-2xl border bg-card p-4">
          <h2 className="text-sm font-semibold">4. Risk guards</h2>
          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span className="text-foreground font-medium">Max positions</span>
              <span>— no new trades once the cap is hit.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-foreground font-medium">Daily loss cap</span>
              <span>— bot stops automatically if the day&apos;s drawdown reaches the limit.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-foreground font-medium">Trailing stop</span>
              <span>— when enabled, the stop follows the price in profit to lock gains.</span>
            </li>
          </ul>
        </section>

        <section className="rounded-2xl border bg-card p-4">
          <h2 className="text-sm font-semibold">5. Manual booking</h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            You can also open trades manually from the Top Movers tab. The same leverage, TP and SL settings are applied automatically.
          </p>
        </section>
      </div>
    </div>
  );
}

import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { ChevronRight, Settings as Cog, FlaskConical, Info } from "lucide-react";
import earnoStacked from "@/assets/earno-stacked.jpg.asset.json";
import { RecentActivity } from "@/components/recent-activity";
import { useMarketMode } from "@/hooks/use-market-mode";
import type { useCurrency } from "@/hooks/use-currency";
import { SimpleMarketTabs } from "./simple-market-tabs";
import { SimpleTabBar } from "./simple-tab-bar";

type Fmt = ReturnType<typeof useCurrency>["fmt"];
type ActivityItems = React.ComponentProps<typeof RecentActivity>["items"];

export type SimpleViewProps = {
  fmt: Fmt;
  hideBalance: boolean;
  currentMode: "paper" | "live";
  displayName: string | null | undefined;
  email: string | null | undefined;
  totalValue: number;
  totalTodayPnl: number;
  futuresValue: number;
  futuresTodayPnl: number;
  coinEquity: number;
  coinTodayPnl: number;
  openCount: number;
  coinHoldingCount: number;
  recentActivity: ActivityItems;
  onDetails: () => void;
};

function IconBtn({
  children,
  ariaLabel,
  onClick,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="size-8 grid place-items-center rounded-full hover:bg-muted text-foreground"
    >
      {children}
    </button>
  );
}

export function SimpleView(props: SimpleViewProps) {
  const {
    fmt,
    hideBalance,
    currentMode,
    displayName,
    email,
    totalValue,
    totalTodayPnl,
    futuresValue,
    futuresTodayPnl,
    coinEquity,
    coinTodayPnl,
    openCount,
    coinHoldingCount,
    recentActivity,
    onDetails,
  } = props;
  const navigate = useNavigate();
  const { setMarket } = useMarketMode();

  const derived = useMemo(() => {
    const totalPos = totalTodayPnl >= 0;
    const dayPct = totalValue > 0 ? (totalTodayPnl / totalValue) * 100 : 0;
    const todayGained = [futuresTodayPnl, coinTodayPnl]
      .filter((n) => n > 0)
      .reduce((a, n) => a + n, 0);
    const todayLost = Math.abs(
      [futuresTodayPnl, coinTodayPnl].filter((n) => n < 0).reduce((a, n) => a + n, 0),
    );
    const activityTotal = todayGained + todayLost;
    const gainedShare =
      activityTotal > 0 ? Math.min(92, Math.max(8, (todayGained / activityTotal) * 100)) : 50;
    const movementLine =
      totalValue <= 0
        ? "Your balance is being set up."
        : dayPct > 2
          ? "Strong growth today."
          : dayPct > 0.3
            ? "Steady growth today — a normal good day."
            : dayPct >= -0.3
              ? "Fairly flat today — that's normal."
              : dayPct >= -2
                ? "A small dip today — this is normal."
                : "Down more than usual today — the engine adapts.";
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const firstName = (displayName ?? email?.split("@")[0] ?? "there").trim().split(/\s+/)[0];
    return {
      totalPos,
      dayPct,
      todayGained,
      todayLost,
      gainedShare,
      movementLine,
      greeting,
      firstName,
    };
  }, [totalValue, totalTodayPnl, futuresTodayPnl, coinTodayPnl, displayName, email]);

  const futuresPositionsLabel = `${openCount} position${openCount === 1 ? "" : "s"}`;
  const coinHoldingsLabel = `${coinHoldingCount} holding${coinHoldingCount === 1 ? "" : "s"}`;

  return (
    <div className="min-h-svh bg-background pb-28">
      <div className="mx-auto max-w-md">
        <header className="px-5 pt-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate({ to: "/about" })}
              aria-label="About earn'O"
              className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img src={earnoStacked.url} alt="earn'O" className="h-10 w-auto select-none" draggable={false} />
            </button>
            <div className="ml-auto">
              <IconBtn ariaLabel="Settings" onClick={() => navigate({ to: "/settings" })}>
                <Cog className="size-5" />
              </IconBtn>
            </div>
          </div>
          <p className="mt-5 text-[11px] uppercase tracking-wider text-muted-foreground">
            {derived.greeting}
          </p>
          <p className="mt-0.5 text-[19px] font-semibold text-foreground">
            {derived.firstName}
          </p>
          {currentMode === "paper" && (
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2.5 h-6 text-[11px] font-medium">
              <FlaskConical className="size-3" />
              Practice mode — using simulated trades
            </span>
          )}
        </header>


        <div className="px-5 mt-4">
          <section className="rounded-2xl border border-t-2 border-t-primary bg-card px-5 py-4 shadow-sm">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Your total balance</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">
              {hideBalance ? "••••••" : fmt(totalValue)}
            </div>
            <div
              className={`mt-1 inline-flex items-center gap-1 text-[13px] font-semibold tabular-nums ${derived.totalPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
            >
              <span aria-hidden="true">{derived.totalPos ? "↗" : "↘"}</span>
              <span>
                {fmt(totalTodayPnl, { signed: true })} ({derived.dayPct >= 0 ? "+" : ""}
                {derived.dayPct.toFixed(2)}%) today
              </span>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {derived.movementLine}
            </p>

            <div className="mt-4 border-t pt-4">
              <div
                className="flex h-2.5 overflow-hidden rounded-full bg-muted"
                aria-label="Today's gained and lost split"
              >
                <div className="bg-emerald-500" style={{ width: `${derived.gainedShare}%` }} />
                <div className="flex-1 bg-rose-500" />
              </div>
              <div className="mt-3 flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
                <span>Gained {fmt(derived.todayGained)} today</span>
                <span>Lost {fmt(derived.todayLost)} today</span>
              </div>
            </div>
          </section>
        </div>


        <div className="px-5 mt-4">
          <SimpleMarketTabs />
        </div>

        <div className="px-5 mt-4">
          <section className="rounded-2xl border bg-card shadow-sm divide-y">
            <button
              type="button"
              onClick={() => setMarket("futures")}
              className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-muted/40 transition first:rounded-t-2xl"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] leading-tight font-medium">Futures</div>
                <div className="text-[11px] text-muted-foreground">{futuresPositionsLabel}</div>
              </div>
              <div className="text-right">
                <div className="text-[13px] font-semibold tabular-nums">
                  {fmt(futuresValue)}
                </div>
                <div
                  className={`mt-1 text-[11px] tabular-nums ${futuresTodayPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                >
                  {futuresTodayPnl >= 0 ? "↗" : "↘"} {fmt(futuresTodayPnl, { signed: true })} today
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => setMarket("spot")}
              className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-muted/40 transition last:rounded-b-2xl"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] leading-tight font-medium">Coins</div>
                <div className="text-[11px] text-muted-foreground">{coinHoldingsLabel}</div>
              </div>
              <div className="text-right">
                <div className="text-[13px] font-semibold tabular-nums">
                  {fmt(coinEquity)}
                </div>
                <div
                  className={`mt-1 text-[11px] tabular-nums ${coinTodayPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                >
                  {coinTodayPnl >= 0 ? "↗" : "↘"} {fmt(coinTodayPnl, { signed: true })} today
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </section>
        </div>


        <div className="px-5 mt-4">
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 flex items-start gap-3">
            <span className="size-7 grid place-items-center rounded-full text-amber-700 dark:text-amber-300 shrink-0">
              <Info className="size-4" />
            </span>
            <p className="text-[12.5px] leading-relaxed text-foreground/90">
              EarnO spreads your money across automated strategies on your own exchange account. It
              never holds your funds directly.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <RecentActivity items={recentActivity} />
        </div>
      </div>

      <SimpleTabBar onDetails={onDetails} />
    </div>
  );
}

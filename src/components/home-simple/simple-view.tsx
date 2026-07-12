import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { ChevronRight, Settings as Cog, FlaskConical, Info, BadgeCheck } from "lucide-react";
import earnoStacked from "@/assets/earno-stacked.jpg.asset.json";
import earneyWave from "@/assets/earney-wave.png.asset.json";
import { RecentActivityFeed } from "@/components/recent-activity";
import { ModeBanner } from "@/components/market/mode-banner";
import { OpenPositionsBanner } from "@/components/market/open-positions-banner";
import { useMarketMode } from "@/hooks/use-market-mode";
import type { useCurrency } from "@/hooks/use-currency";
import { SimpleMarketTabs } from "./simple-market-tabs";

type Fmt = ReturnType<typeof useCurrency>["fmt"];

export type SimpleViewProps = {
  fmt: Fmt;
  hideBalance: boolean;
  currentMode: "paper" | "live";
  displayName: string | null | undefined;
  email: string | null | undefined;
  totalValue: number;
  totalInvested: number;
  totalReturns: number;
  totalTodayPnl: number;
  futuresValue: number;
  futuresTodayPnl: number;
  coinEquity: number;
  coinTodayPnl: number;
  openCount: number;
  coinHoldingCount: number;
  openPnl?: number;
  onManageMode: () => void;
  embedded?: boolean;
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
    totalInvested,
    totalReturns,
    totalTodayPnl,
    futuresValue,
    futuresTodayPnl,
    coinEquity,
    coinTodayPnl,
    openCount,
    coinHoldingCount,
    openPnl = 0,
    onManageMode,
    embedded,
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

  const returnsPos = totalReturns >= 0;
  const returnsPct = totalInvested > 0 ? (totalReturns / totalInvested) * 100 : 0;

  const content = (
    <>
      {!embedded && (
        <header className="px-5 pt-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate({ to: "/about" })}
              aria-label="About earn'O"
              className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img
                src={earnoStacked.url}
                alt="earn'O"
                className="h-10 w-auto select-none"
                draggable={false}
              />
            </button>
            <div className="ml-auto">
              <IconBtn ariaLabel="Settings" onClick={() => navigate({ to: "/settings" })}>
                <Cog className="size-5" />
              </IconBtn>
            </div>
          </div>
          <div className="mt-5 flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {derived.greeting}
              </p>
              <p className="mt-0.5 text-[19px] font-semibold text-foreground">
                {derived.firstName}
              </p>
              <button
                type="button"
                onClick={onManageMode}
                className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 h-6 text-[11px] font-medium transition ${currentMode === "live" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15" : "bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"}`}
              >
                {currentMode === "live" ? (
                  <BadgeCheck className="size-3" />
                ) : (
                  <FlaskConical className="size-3" />
                )}
                {currentMode === "live"
                  ? "Live — real money · manage"
                  : "Practice mode · tap to go live"}
              </button>
            </div>
            <img
              src={earneyWave.url}
              alt="Earney, your earn'O assistant, waving"
              className="h-16 w-16 shrink-0 select-none -mb-1 drop-shadow-sm"
              draggable={false}
            />
          </div>
        </header>
      )}

      {embedded && (
        <div className="px-5 mt-4">
          <p
            suppressHydrationWarning
            className="text-[11px] uppercase tracking-wider text-muted-foreground"
          >
            {derived.greeting}
          </p>
          <p className="mt-0.5 text-[19px] font-semibold text-foreground">{derived.firstName}</p>
        </div>
      )}

      {/* Mode banner + open positions — shared across All / Futures / Coins */}
      <ModeBanner isLive={currentMode === "live"} onToggle={onManageMode} />
      <OpenPositionsBanner
        count={openCount + coinHoldingCount}
        pnl={openPnl}
        noun="position"
        fmt={fmt}
      />

      <div className="px-5 mt-4">
        <section className="brand-hero rounded-2xl px-5 py-4 shadow-md">
          <div className="text-[11px] uppercase tracking-wider text-white/60">
            Your total balance
          </div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-white">
            {hideBalance ? "••••••" : fmt(totalValue)}
          </div>
          <div
            className={`mt-1 inline-flex items-center gap-1 text-[13px] font-semibold tabular-nums ${derived.totalPos ? "text-emerald-300" : "text-rose-300"}`}
          >
            <span aria-hidden="true">{derived.totalPos ? "↗" : "↘"}</span>
            <span>
              {hideBalance
                ? "••••"
                : `${fmt(totalTodayPnl, { signed: true })} (${derived.dayPct >= 0 ? "+" : ""}${derived.dayPct.toFixed(2)}%)`}{" "}
              today
            </span>
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed text-white/70">{derived.movementLine}</p>

          <div className="mt-4 border-t border-white/15 pt-4">
            <div
              className="flex h-2.5 overflow-hidden rounded-full bg-white/15"
              aria-label="Today's gained and lost split"
            >
              {derived.todayLost === 0 ? (
                derived.todayGained > 0 && <div className="flex-1 bg-emerald-400" />
              ) : (
                <>
                  <div className="bg-emerald-400" style={{ width: `${derived.gainedShare}%` }} />
                  <div className="flex-1 bg-rose-400" />
                </>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-4 text-[11px] text-white/60">
              <span>Gained {hideBalance ? "••••" : fmt(derived.todayGained)} today</span>
              <span>Lost {hideBalance ? "••••" : fmt(derived.todayLost)} today</span>
            </div>
          </div>
        </section>
      </div>

      <div className="px-5 mt-3">
        <section className="rounded-2xl border bg-card px-5 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Profit till date
              </div>
              <div
                className={`mt-1 text-2xl font-semibold tabular-nums ${returnsPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
              >
                {hideBalance ? "••••••" : fmt(totalReturns, { signed: true })}
              </div>
            </div>
            <span
              className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 h-6 text-[11px] font-semibold tabular-nums ${returnsPos ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/10 text-rose-600 dark:text-rose-400"}`}
            >
              <span aria-hidden="true">{returnsPos ? "▲" : "▼"}</span>
              {returnsPct >= 0 ? "+" : ""}
              {returnsPct.toFixed(2)}%
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t pt-3">
            <div className="text-[11px] text-muted-foreground">Invested since you started</div>
            <div className="text-[13px] font-semibold tabular-nums">
              {hideBalance ? "••••" : fmt(totalInvested)}
            </div>
          </div>
          <p className="mt-2 text-[10.5px] leading-snug text-muted-foreground">
            The {returnsPct >= 0 ? "+" : ""}
            {returnsPct.toFixed(2)}% above is your total gain on money invested. The “today” figure
            up top is measured against your whole balance — they use different bases.
          </p>
        </section>
      </div>

      {!embedded && (
        <div className="px-5 mt-4">
          <SimpleMarketTabs />
        </div>
      )}

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
                {hideBalance ? "••••" : fmt(futuresValue)}
              </div>
              <div
                className={`mt-1 text-[11px] tabular-nums ${futuresTodayPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
              >
                {futuresTodayPnl >= 0 ? "↗" : "↘"}{" "}
                {hideBalance ? "••••" : fmt(futuresTodayPnl, { signed: true })} today
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
                {hideBalance ? "••••" : fmt(coinEquity)}
              </div>
              <div
                className={`mt-1 text-[11px] tabular-nums ${coinTodayPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
              >
                {coinTodayPnl >= 0 ? "↗" : "↘"}{" "}
                {hideBalance ? "••••" : fmt(coinTodayPnl, { signed: true })} today
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
        <RecentActivityFeed />
      </div>
    </>
  );

  if (embedded) {
    return content;
  }

  return <div className="min-h-svh bg-background pb-28">{content}</div>;
}

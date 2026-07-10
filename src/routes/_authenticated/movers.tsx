import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTopMovers, bookManualTrade, type Mover } from "@/lib/movers.functions";
import { TabBar } from "@/components/tab-bar";
import { PositionsStrip } from "@/components/positions-strip";
import { OpportunityCard } from "@/components/opportunity-card";
import { PageHeader, BrandEmptyState, ModePill } from "@/components/brand/brand-ui";
import { CoinSignalsList } from "@/components/coin-bot/coin-panels";
import { CoinHero } from "@/components/coin-bot/coin-hero";
import { useMarketMode } from "@/hooks/use-market-mode";
import { getSignalAges } from "@/lib/signal-age.functions";
import { timeAgo } from "@/lib/time-ago";
import { toast } from "sonner";
import { Flame, RefreshCw, HelpCircle } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/movers")({
  head: () => ({
    meta: [
      { title: "Top Movers — Earn'O" },
      {
        name: "description",
        content: "Top movers with simple Long/Short/Wait/Avoid recommendations and confidence.",
      },
    ],
  }),
  component: MoversPage,
});

const DEFAULT_RISK_META = {
  capital: 1000,
  style: "balanced",
  minSL: 1.2,
  atrMult: 1.5,
  maxAutoSL: 4,
  targetMult: 1.7,
  minRR: 1.5,
  riskPct: 1,
} as const;

function MoversPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getTopMovers);
  const bookFn = useServerFn(bookManualTrade);
  const [pending, setPending] = useState<string | null>(null);
  const { market } = useMarketMode();

  const q = useQuery({
    queryKey: ["top_movers", market],
    queryFn: () => getFn({ data: { market } }),
    refetchInterval: 30_000,
  });

  const book = useMutation({
    mutationFn: async (input: { m: Mover; side: "long" | "short"; tpPct: number; slPct: number }) =>
      bookFn({
        data: {
          symbol: input.m.symbol,
          side: input.side,
          price: input.m.price,
          market,
          confidence: input.m.confidence,
          tpPct: input.tpPct,
          slPct: input.slPct,
        },
      }),
    onMutate: (v) => setPending(v.m.symbol),
    onSettled: () => setPending(null),
    onSuccess: (_d, v) => {
      toast.success(
        `${v.side === "long" ? "Long" : "Short"} ${v.m.display} booked · Target +${v.tpPct.toFixed(2)}% · Stop −${v.slPct.toFixed(2)}%`,
      );
      qc.invalidateQueries({ queryKey: ["positions_open"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Booking failed"),
  });

  const movers: Mover[] = q.data?.ok ? q.data.movers : [];
  const riskMeta = (q.data?.ok ? q.data.risk : null) ?? DEFAULT_RISK_META;
  const errorMsg = q.data && !q.data.ok ? q.data.error : null;
  const agesFn = useServerFn(getSignalAges);
  const agesQ = useQuery({
    queryKey: ["signal_ages"],
    queryFn: () => agesFn(),
    refetchInterval: 60_000,
  });
  const ages = agesQ.data?.ages ?? {};
  const lastScanAt = agesQ.data?.lastScanAt ?? null;

  // Coins are spot-only — never show Long/Short here. Show the top actionable
  // coin opportunities instead, matching the Coin Scanner.
  if (market === "spot") {
    return (
      <div className="min-h-svh bg-background pb-28">
        <PositionsStrip />
        <PageHeader
          icon={<Flame className="size-5 text-orange-500" />}
          title="Top Coins"
          subtitle="Best coin opportunities by confidence"
          actions={<ModePill market="coin" />}
        />
        <div className="px-5 mt-3 space-y-4">
          <CoinHero />
          <CoinSignalsList hideHeader actionableOnly />
        </div>
        <TabBar />
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-background pb-28">
      <PositionsStrip />
      <PageHeader
        icon={<Flame className="size-5 text-orange-500" />}
        title="Top Movers"
        subtitle={`${market === "all" ? "Futures · " : ""}Long / Short / Wait / Avoid with confidence`}
        actions={
          <>
            <Link
              to="/help"
              className="size-10 grid place-items-center rounded-full hover:bg-muted"
            >
              <HelpCircle className="size-5 text-muted-foreground" />
            </Link>
            <button
              onClick={() => q.refetch()}
              className="size-10 grid place-items-center rounded-full hover:bg-muted"
              aria-label="Refresh"
            >
              <RefreshCw className={`size-4 ${q.isFetching ? "animate-spin" : ""}`} />
            </button>
          </>
        }
      />

      <div className="px-5 mt-1 text-[11px] text-muted-foreground">
        {lastScanAt
          ? `Last bot scan: ${timeAgo(lastScanAt)} · showing the 10 latest bot signals`
          : "No recent bot scan — manual view (times shown as “manual”)"}
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
          const booking = pending === m.symbol;
          return (
            <li key={m.symbol}>
              <OpportunityCard
                mover={m}
                riskMeta={riskMeta}
                booking={booking}
                asOf={ages[m.symbol] ?? "manual"}
                onBook={(s, ov) => book.mutate({ m, side: s, tpPct: ov.tpPct, slPct: ov.slPct })}
              />
            </li>
          );
        })}

        {!q.isLoading && movers.length === 0 && !errorMsg ? (
          <li>
            <BrandEmptyState
              mood="thinking"
              title="No movers right now"
              message="The market's quiet. Earney will surface fresh setups here as they appear."
            />
          </li>
        ) : null}
      </ul>

      <TabBar />
    </div>
  );
}

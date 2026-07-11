import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { updateCoinConfig, getCoinHoldings } from "@/lib/coin-bot/coin-bot.functions";
import { CoinHoldingsCard, CoinSignalsList } from "@/components/coin-bot/coin-panels";
import { CoinHero } from "@/components/coin-bot/coin-hero";
import { CoinKpiStrip } from "@/components/coin-bot/coin-kpi-strip";
import { CoinBotHealth } from "@/components/coin-bot/coin-bot-health";
import { CoinRecentActivity } from "@/components/coin-bot/coin-recent-activity";
import { GoLiveDialog } from "@/components/go-live-dialog";
import { ModeBanner } from "@/components/market/mode-banner";
import { OpenPositionsBanner } from "@/components/market/open-positions-banner";
import { useCurrency } from "@/hooks/use-currency";
import { toast } from "sonner";

export function CoinHome() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const updateCoinFn = useServerFn(updateCoinConfig);
  const holdingsFn = useServerFn(getCoinHoldings);
  const { fmt } = useCurrency();
  const [confirmCoinLive, setConfirmCoinLive] = useState(false);

  const coinCfg = useQuery({
    queryKey: ["coin_config_mode"],
    queryFn: async () => {
      const { data } = await supabase.from("coin_bot_config").select("live_mode").maybeSingle();
      return data as { live_mode?: boolean } | null;
    },
  });
  const coinLive = coinCfg.data?.live_mode === true;

  const holdings = useQuery({
    queryKey: ["coin_holdings"],
    queryFn: () => holdingsFn(),
    refetchInterval: 20_000,
  });
  const holdingsSum = holdings.data?.summary;
  const openHoldings = Number(holdingsSum?.active_holdings ?? 0);
  const openUnrealized = Number(holdingsSum?.unrealized_pnl_usdt ?? 0);
  const openInvested = Number(holdingsSum?.invested_usdt ?? 0);
  const openUnrealizedPct = openInvested > 0 ? (openUnrealized / openInvested) * 100 : null;

  const toggleCoinMode = useMutation({
    mutationFn: async (live: boolean) => updateCoinFn({ data: { live_mode: live } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coin_config_mode"] });
      qc.invalidateQueries({ queryKey: ["coin_cfg"] });
      qc.invalidateQueries({ queryKey: ["coin_portfolio"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Update failed";
      if (msg.startsWith("PAYMENT_REQUIRED")) {
        toast.error("Upgrade required to go live");
        navigate({ to: "/upgrade" });
      } else toast.error(msg);
    },
  });

  return (
    <>
      {/* ===== Mode banner — shared across All / Futures / Coins ===== */}
      <ModeBanner
        isLive={coinLive}
        onToggle={() => (coinLive ? toggleCoinMode.mutate(false) : setConfirmCoinLive(true))}
      />

      {/* ===== Open holdings banner — unrealized PnL + count ===== */}
      <OpenPositionsBanner
        count={openHoldings}
        pnl={openUnrealized}
        pnlPct={openUnrealizedPct}
        noun="holding"
        fmt={fmt}
      />

      <div className="px-5 mt-4 space-y-4">
        <CoinHero />
        <CoinKpiStrip />
        <CoinBotHealth />
        <section>
          <div className="px-1 pb-2 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Top signals</div>
            <Link to="/scanner" className="text-[11px] font-medium text-primary">
              See all →
            </Link>
          </div>
          <CoinSignalsList hideHeader limit={5} actionableOnly />
        </section>
        <section>
          <div className="px-1 pb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Holdings
          </div>
          <CoinHoldingsCard />
        </section>
        <CoinRecentActivity />
      </div>

      <GoLiveDialog
        open={confirmCoinLive}
        onOpenChange={setConfirmCoinLive}
        onConfirm={() => {
          toggleCoinMode.mutate(true);
          setConfirmCoinLive(false);
        }}
        what="Real orders on CoinDCX"
      />
    </>
  );
}

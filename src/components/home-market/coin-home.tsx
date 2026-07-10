import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { updateCoinConfig } from "@/lib/coin-bot/coin-bot.functions";
import { CoinHoldingsCard, CoinSignalsList } from "@/components/coin-bot/coin-panels";
import { CoinHero } from "@/components/coin-bot/coin-hero";
import { CoinKpiStrip } from "@/components/coin-bot/coin-kpi-strip";
import { CoinBotHealth } from "@/components/coin-bot/coin-bot-health";
import { CoinRecentActivity } from "@/components/coin-bot/coin-recent-activity";
import { GoLiveDialog } from "@/components/go-live-dialog";
import { FlaskConical, BadgeCheck } from "lucide-react";
import { toast } from "sonner";

export function CoinHome() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const updateCoinFn = useServerFn(updateCoinConfig);
  const [confirmCoinLive, setConfirmCoinLive] = useState(false);

  const coinCfg = useQuery({
    queryKey: ["coin_config_mode"],
    queryFn: async () => {
      const { data } = await supabase.from("coin_bot_config").select("live_mode").maybeSingle();
      return data as { live_mode?: boolean } | null;
    },
  });
  const coinLive = coinCfg.data?.live_mode === true;

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
      {/* ===== Mode banner — parity with the futures dashboard ===== */}
      <div className="px-5 mt-4">
        <button
          type="button"
          onClick={() => {
            if (coinLive) toggleCoinMode.mutate(false);
            else setConfirmCoinLive(true);
          }}
          className={`w-full text-left flex items-center gap-3 rounded-2xl border px-4 py-3 transition ${
            coinLive
              ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
              : "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15"
          }`}
          aria-label="Toggle paper or live trading"
        >
          <span
            className={`inline-flex items-center justify-center size-9 rounded-full shrink-0 ${
              coinLive
                ? "bg-destructive/15 text-destructive"
                : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
            }`}
          >
            {coinLive ? <BadgeCheck className="size-4" /> : <FlaskConical className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={`text-[13px] font-semibold leading-tight ${
                coinLive ? "text-destructive" : "text-amber-700 dark:text-amber-300"
              }`}
            >
              {coinLive ? "LIVE trading active" : "PAPER — practice mode"}
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
              {coinLive
                ? "Real funds are at risk. Tap to switch back to Paper."
                : "All numbers reflect simulated trading. Tap to go Live."}
            </p>
          </div>
          <span
            className={`text-[10px] font-semibold tracking-wider px-2 h-6 inline-flex items-center rounded-full ${
              coinLive ? "bg-destructive text-destructive-foreground" : "bg-amber-500 text-white"
            }`}
          >
            {coinLive ? "LIVE" : "PAPER"}
          </span>
        </button>
      </div>

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

import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getMyEntitlements } from "@/lib/plans.functions";
import {
  getBetaReport,
  adminApplyTune,
  adminApplyTuningAction,
  exportAllTradesCsv,
  exportSignalsCsv,
  exportAlgoConfigsCsv,
  exportAlgoAuditCsv,
  type TesterReport,
  type TuneSuggestion,
  type TuningAction,
  type BucketComparison,
  type BucketStats,
} from "@/lib/beta-report.functions";


function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export const Route = createFileRoute("/_authenticated/beta-report")({
  head: () => ({ meta: [{ title: "Beta Report — Earn'O" }] }),
  component: BetaReportPage,
});

function fmt(n: number, d = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(d);
}
function pct(n: number) {
  return `${n >= 0 ? "" : ""}${fmt(n, 1)}%`;
}
function money(n: number) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${fmt(Math.abs(n), 2).replace("-", "")}`.replace("$-", "-$");
}
function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const [local] = email.split("@");
  return local ?? "—";
}


function BetaReportPage() {
  const qc = useQueryClient();
  const entFn = useServerFn(getMyEntitlements);
  const reportFn = useServerFn(getBetaReport);
  const applyFn = useServerFn(adminApplyTune);

  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => entFn() });
  const rep = useQuery({
    queryKey: ["beta_report"],
    queryFn: () => reportFn(),
    enabled: !!ent.data?.isAdmin,
    refetchInterval: 60_000,
  });

  const apply = useMutation({
    mutationFn: (v: { userId: string; patch: TuneSuggestion["patch"] }) =>
      applyFn({ data: v as never }),
    onSuccess: () => {
      toast.success("Applied to paper mode");
      qc.invalidateQueries({ queryKey: ["beta_report"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (ent.isLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!ent.data?.isAdmin)
    return (
      <div className="p-6 text-sm">
        Admin only.{" "}
        <Link to="/" className="text-primary underline">
          Go back
        </Link>
      </div>
    );

  const s = rep.data?.summary;
  const testers = rep.data?.testers ?? [];
  const tuningActions = rep.data?.tuningActions ?? [];

  return (
    <div className="min-h-svh bg-background pb-16">
      <header className="px-5 pt-6 pb-4 flex items-center gap-2">
        <Link
          to="/admin"
          className="size-9 grid place-items-center rounded-full hover:bg-muted -ml-2"
        >
          <ChevronLeft className="size-5" />
        </Link>
      <h1 className="text-xl font-semibold">Beta Report</h1>
      </header>

      <p className="px-5 text-[11px] text-muted-foreground -mt-2 mb-3">
        Based on current paper-trading sample. May improve testing quality. Not a
        guarantee of future performance.
      </p>

      <ExportBar />

      <TuningActionsSection actions={tuningActions} />



      {!s ? (
        <div className="px-5 text-sm text-muted-foreground">Loading report…</div>
      ) : (
        <>
          <section className="px-5 grid grid-cols-3 gap-2">
            <Tile label="Active" value={`${s.activeTesters}/${s.totalTesters}`} />
            <Tile label="Trades" value={`${s.totalTrades}`} />
            <Tile label="Closed" value={`${s.totalClosed}`} />
            <Tile
              label="Realized PnL"
              value={money(s.totalRealized)}
              tone={s.totalRealized >= 0 ? "pos" : "neg"}
            />
            <Tile label="Avg win %" value={`${fmt(s.avgWinRate, 1)}%`} />
            <Tile label="Avg PF" value={fmt(s.avgProfitFactor, 2)} />
            <Tile label="Avg DD" value={money(-Math.abs(s.avgMaxDrawdown))} tone="neg" />
            <Tile
              label="Best dir"
              value={s.bestDirection ? s.bestDirection.toUpperCase() : "—"}
            />
            <Tile
              label="Worst dir"
              value={s.worstDirection ? s.worstDirection.toUpperCase() : "—"}
            />
          </section>

          <section className="px-5 mt-5">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Today (since 00:30 IST / 19:00 UTC prev day)
              </h2>

              <span className="text-[10px] text-muted-foreground">
                {s.todayActiveTesters} active
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Tile
                label="PnL"
                value={money(s.today.pnl)}
                tone={s.today.pnl >= 0 ? "pos" : "neg"}
              />
              <Tile label="Closed" value={`${s.today.closed}`} />
              <Tile label="Open" value={`${s.today.open}`} />
              <Tile
                label="Win %"
                value={`${fmt(s.today.winRate, 1)}%`}
                tone={s.today.winRate >= 50 ? "pos" : s.today.winRate > 0 ? "neg" : undefined}
              />
              <Tile label="Wins" value={`${s.today.wins}`} tone="pos" />
              <Tile label="Losses" value={`${s.today.losses}`} tone="neg" />
              <Tile
                label="Longs"
                value={`${s.today.longTrades} · ${fmt(s.today.longWinRate, 0)}%`}
              />
              <Tile
                label="L PnL"
                value={money(s.today.longPnl)}
                tone={s.today.longPnl >= 0 ? "pos" : "neg"}
              />
              <Tile
                label="Best"
                value={money(s.today.bestTrade)}
                tone="pos"
              />
              <Tile
                label="Shorts"
                value={`${s.today.shortTrades} · ${fmt(s.today.shortWinRate, 0)}%`}
              />
              <Tile
                label="S PnL"
                value={money(s.today.shortPnl)}
                tone={s.today.shortPnl >= 0 ? "pos" : "neg"}
              />
              <Tile
                label="Worst"
                value={money(s.today.worstTrade)}
                tone="neg"
              />
              <Tile label="Avg %" value={pct(s.today.avgPnlPct)} />
              <Tile label="Top exit" value={s.today.topCloseReason ?? "—"} />
              <Tile
                label="Best/Worst pair"
                value={`${s.todayBestPair ?? "—"} / ${s.todayWorstPair ?? "—"}`}
              />
            </div>
          </section>


          <section className="px-5 mt-4 grid grid-cols-2 gap-2 text-xs">
            <Card label="Best tester">
              {s.bestTester ? (
                <>
                  <p className="truncate">{maskEmail(s.bestTester.email)}</p>
                  <p className="text-emerald-500">{money(s.bestTester.pnl)}</p>
                </>
              ) : (
                <p className="text-muted-foreground">—</p>
              )}
            </Card>
            <Card label="Weakest tester">
              {s.weakestTester ? (
                <>
                  <p className="truncate">{s.weakestTester.email ?? "—"}</p>
                  <p
                    className={
                      s.weakestTester.pnl >= 0 ? "text-emerald-500" : "text-destructive"
                    }
                  >
                    {money(s.weakestTester.pnl)}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">—</p>
              )}
            </Card>
            <Card label="Best pair">
              <p className="font-medium">{s.bestPair ?? "—"}</p>
            </Card>
            <Card label="Worst pair">
              <p className="font-medium">{s.worstPair ?? "—"}</p>
            </Card>
            <Card label="Top close reason">
              <p className="truncate">{s.topCloseReason ?? "—"}</p>
            </Card>
            <Card label="Top skip reason">
              <p className="truncate">{s.topSkipReason ?? "—"}</p>
            </Card>
          </section>

          {s.exitAttribution && (
            <section className="px-5 mt-6">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Exit attribution
              </h2>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <Card label="Total PnL"><p className="tabular-nums font-medium">{money(s.exitAttribution.total_pnl)}</p></Card>
                <Card label="Bot exits"><p className="tabular-nums">{money(s.exitAttribution.bot_exit_pnl)} <span className="text-muted-foreground">· {s.exitAttribution.bot_exit_count}</span></p></Card>
                <Card label="Manual exits"><p className="tabular-nums">{money(s.exitAttribution.manual_exit_pnl)} <span className="text-muted-foreground">· {s.exitAttribution.manual_exit_count}</span></p></Card>
                <Card label="Manual saved / missed"><p className="tabular-nums text-emerald-500">{money(s.exitAttribution.manual_saved_pnl)}</p><p className="tabular-nums text-destructive">{money(s.exitAttribution.manual_missed_pnl)}</p></Card>
                <Card label="Final TP"><p className="tabular-nums">{money(s.exitAttribution.take_profit_pnl)}</p></Card>
                <Card label="TP1"><p className="tabular-nums">{money(s.exitAttribution.tp1_pnl)}</p></Card>
                <Card label="Stop loss"><p className="tabular-nums">{money(s.exitAttribution.stop_loss_pnl)}</p></Card>
                <Card label="Trailing"><p className="tabular-nums">{money(s.exitAttribution.trailing_exit_pnl)}</p></Card>
                <Card label="Profit fade"><p className="tabular-nums">{money(s.exitAttribution.profit_fade_exit_pnl)}</p></Card>
                <Card label="Breakeven"><p className="tabular-nums">{money(s.exitAttribution.breakeven_exit_pnl)}</p></Card>
                <Card label="Time exit"><p className="tabular-nums">{money(s.exitAttribution.time_exit_pnl)}</p></Card>
                <Card label="TP1 hit-rate"><p className="tabular-nums">{s.exitAttribution.tp1_hit_rate.toFixed(1)}%</p></Card>
                <Card label="Final TP hit-rate"><p className="tabular-nums">{s.exitAttribution.final_tp_hit_rate.toFixed(1)}%</p></Card>
                <Card label="SL after positive"><p className="tabular-nums">{s.exitAttribution.sl_after_positive_count}</p></Card>
              </div>
            </section>
          )}

          <section className="px-5 mt-6">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Testers ({testers.length})
            </h2>
            <div className="space-y-3">
              {testers.map((t) => (
                <TesterCard
                  key={t.userId}
                  t={t}
                  onApply={(patch) => apply.mutate({ userId: t.userId, patch })}
                  isApplying={apply.isPending}
                />
              ))}
              {testers.length === 0 && (
                <p className="text-xs text-muted-foreground">No testers yet.</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  const color =
    tone === "pos"
      ? "text-emerald-500"
      : tone === "neg"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`text-base font-semibold tabular-nums mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}

function TesterCard({
  t,
  onApply,
  isApplying,
}: {
  t: TesterReport;
  onApply: (patch: TuneSuggestion["patch"]) => void;
  isApplying: boolean;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">{t.email ?? t.userId.slice(0, 8)}</p>
          <p className="text-[11px] text-muted-foreground">
            {t.settings?.mode ?? "—"} · {t.settings?.is_running ? "running" : "stopped"}{" "}
            · style {t.settings?.trading_style ?? "—"}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p
            className={`text-sm font-semibold tabular-nums ${t.realizedPnl >= 0 ? "text-emerald-500" : "text-destructive"}`}
          >
            {money(t.realizedPnl)}
          </p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            PF {fmt(t.profitFactor, 2)} · DD {money(-Math.abs(t.maxDrawdown))}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <Stat k="Closed" v={`${t.closed}`} />
        <Stat k="Wins" v={`${t.wins}`} />
        <Stat k="Losses" v={`${t.losses}`} />
        <Stat k="Win %" v={`${fmt(t.winRate, 1)}%`} />
        <Stat k="Avg %" v={pct(t.avgPnlPct)} />
        <Stat k="Hold" v={`${t.avgHoldMinutes}m`} />
        <Stat
          k="Long PnL"
          v={money(t.longPnl)}
          tone={t.longPnl >= 0 ? "pos" : "neg"}
        />
        <Stat
          k="Short PnL"
          v={money(t.shortPnl)}
          tone={t.shortPnl >= 0 ? "pos" : "neg"}
        />
        <Stat
          k="L/S win"
          v={`${fmt(t.longWinRate, 0)}/${fmt(t.shortWinRate, 0)}%`}
        />
      </div>

      <div className="mt-3 rounded-lg border bg-muted/40 p-2">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Today
          </p>
          <p
            className={`text-xs font-semibold tabular-nums ${t.today.pnl >= 0 ? "text-emerald-500" : "text-destructive"}`}
          >
            {money(t.today.pnl)}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-[11px]">
          <Stat k="Closed" v={`${t.today.closed}`} />
          <Stat k="Open" v={`${t.today.open}`} />
          <Stat
            k="Win %"
            v={`${fmt(t.today.winRate, 0)}%`}
            tone={t.today.winRate >= 50 ? "pos" : t.today.winRate > 0 ? "neg" : undefined}
          />
          <Stat
            k={`Longs ${t.today.longTrades}`}
            v={`${fmt(t.today.longWinRate, 0)}% · ${money(t.today.longPnl)}`}
            tone={t.today.longPnl >= 0 ? "pos" : "neg"}
          />
          <Stat
            k={`Shorts ${t.today.shortTrades}`}
            v={`${fmt(t.today.shortWinRate, 0)}% · ${money(t.today.shortPnl)}`}
            tone={t.today.shortPnl >= 0 ? "pos" : "neg"}
          />
          <Stat k="Avg %" v={pct(t.today.avgPnlPct)} />
          <Stat k="Best" v={money(t.today.bestTrade)} tone="pos" />
          <Stat k="Worst" v={money(t.today.worstTrade)} tone="neg" />
          <Stat k="Top exit" v={t.today.topCloseReason ?? "—"} />
        </div>
      </div>

      <BucketComparisonBlock buckets={t.buckets} />




      {t.settings && (
        <div className="mt-3 rounded-lg border bg-muted/40 p-2 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground mb-0.5">Current settings</p>
          ATR {Number(t.settings.atr_multiplier).toFixed(2)} · Tgt{" "}
          {Number(t.settings.target_multiplier).toFixed(2)} · MaxOpen{" "}
          {t.settings.max_open_positions} · AutoClose {t.settings.auto_close_minutes}m
          · Risk {Number(t.settings.risk_per_trade_pct).toFixed(2)}% · MinScore{" "}
          {t.settings.min_scalp_score} · Shorts {t.settings.allow_short ? "on" : "off"}
        </div>
      )}

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          Performance diagnosis
        </p>
        {t.diagnosisStage === "none" && (
          <p className="text-xs text-muted-foreground">
            Not enough data yet. ({t.closed}/30 closed trades)
          </p>
        )}
        {t.diagnosisStage === "early" && (
          <p className="text-xs text-amber-500">
            Early signal — continue testing. ({t.closed} closed)
          </p>
        )}
        {t.diagnosisStage === "ready" && (
          <div className="space-y-2">
            {t.diagnosis.map((d, i) => {
              const tone =
                d.status === "Healthy"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                  : d.status === "Watch"
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                  : d.status === "Needs Tuning"
                  ? "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30"
                  : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30";
              return (
                <div key={i} className="rounded-lg border bg-card p-2.5">
                  <span className={`inline-flex items-center text-[10px] font-semibold px-2 h-5 rounded-full border ${tone}`}>
                    {d.status}
                  </span>
                  <p className="mt-1.5 text-xs font-medium">{d.issue}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{d.evidence}</p>
                  <p className="text-[11px] mt-1"><span className="text-muted-foreground">Action: </span>{d.action}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {t.suggestions.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Suggested tune
          </p>
          {t.suggestions.map((sg) => (
            <div key={sg.key} className="rounded-lg border bg-card p-2.5">
              <p className="text-xs font-medium">{sg.label}</p>
              <p className="text-[11px] text-muted-foreground">{sg.rationale}</p>
              <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                {Object.entries(sg.patch)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" · ")}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={isApplying}
                  onClick={() => onApply(sg.patch)}
                >
                  Apply to Paper Mode
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  asChild
                >
                  <Link to="/settings">Review Settings</Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => toast.message("Ignored")}
                >
                  Ignore
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: "pos" | "neg" }) {
  const color =
    tone === "pos"
      ? "text-emerald-500"
      : tone === "neg"
        ? "text-destructive"
        : "";
  return (
    <div className="rounded-md border bg-background p-1.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</p>
      <p className={`tabular-nums font-medium ${color}`}>{v}</p>
    </div>
  );
}

function pf(n: number) {
  return Number.isFinite(n) ? n.toFixed(2) : "∞";
}

function BucketRow({ label, b }: { label: string; b: BucketStats }) {
  return (
    <tr className="border-t">
      <td className="px-2 py-1 font-medium">{label}</td>
      <td className="px-2 py-1 tabular-nums text-right">{b.trades}</td>
      <td className={`px-2 py-1 tabular-nums text-right ${b.grossPnl >= 0 ? "text-emerald-500" : "text-destructive"}`}>{money(b.grossPnl)}</td>
      <td className="px-2 py-1 tabular-nums text-right text-muted-foreground">{money(b.estimatedFees)}</td>
      <td className={`px-2 py-1 tabular-nums text-right font-semibold ${b.netPnl >= 0 ? "text-emerald-500" : "text-destructive"}`}>{money(b.netPnl)}</td>
      <td className="px-2 py-1 tabular-nums text-right">{fmt(b.winRate, 0)}%</td>
      <td className="px-2 py-1 tabular-nums text-right">{pf(b.profitFactor)}</td>
      <td className="px-2 py-1 tabular-nums text-right">{b.tpCount}/{b.slCount}</td>
      <td className="px-2 py-1 tabular-nums text-right">{b.avgHoldMinutes}m</td>
      <td className="px-2 py-1 tabular-nums text-right">{fmt(b.avgConfidence, 0)}</td>
    </tr>
  );
}

function BucketComparisonBlock({ buckets }: { buckets: BucketComparison }) {
  if (buckets.totalAutoBooked === 0) {
    return (
      <div className="mt-3 rounded-lg border bg-muted/40 p-2 text-[11px] text-muted-foreground">
        <p className="font-medium text-foreground mb-0.5">Quality buckets (today, auto-booked, max 50)</p>
        No auto-booked trades today{buckets.strategy ? ` for strategy ${buckets.strategy}` : ""}.
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-lg border bg-card p-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Quality buckets — today, auto-booked (max 50)
        </p>
        <p className="text-[10px] text-muted-foreground">
          Strategy: {buckets.strategy ?? "—"} · Pool: {buckets.totalAutoBooked}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left font-normal">Bucket</th>
              <th className="px-2 py-1 text-right font-normal">Trades</th>
              <th className="px-2 py-1 text-right font-normal">Gross</th>
              <th className="px-2 py-1 text-right font-normal">Fees</th>
              <th className="px-2 py-1 text-right font-normal">Net</th>
              <th className="px-2 py-1 text-right font-normal">Win</th>
              <th className="px-2 py-1 text-right font-normal">PF</th>
              <th className="px-2 py-1 text-right font-normal">TP/SL</th>
              <th className="px-2 py-1 text-right font-normal">Hold</th>
              <th className="px-2 py-1 text-right font-normal">Conf</th>
            </tr>
          </thead>
          <tbody>
            <BucketRow label="Top 10" b={buckets.top10} />
            <BucketRow label="Top 30" b={buckets.top30} />
            <BucketRow label="All 50" b={buckets.all50} />
          </tbody>
        </table>
      </div>
    </div>
  );
}



function ExportBar() {
  const tradesFn = useServerFn(exportAllTradesCsv);
  const signalsFn = useServerFn(exportSignalsCsv);
  const cfgFn = useServerFn(exportAlgoConfigsCsv);
  const auditFn = useServerFn(exportAlgoAuditCsv);

  const trades = useMutation({
    mutationFn: () => tradesFn(),
    onSuccess: (r) => {
      downloadCsv(`trades-${ts()}.csv`, r.csv);
      toast.success(`Exported ${r.count} trades`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const signals = useMutation({
    mutationFn: () => signalsFn(),
    onSuccess: (r) => {
      downloadCsv(`signals-${ts()}.csv`, r.csv);
      toast.success(`Exported ${r.count} signals`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const cfg = useMutation({
    mutationFn: () => cfgFn(),
    onSuccess: (r) => {
      downloadCsv(`algo-configs-${ts()}.csv`, r.csv);
      toast.success(`Exported ${r.count} configs`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const audit = useMutation({
    mutationFn: () => auditFn(),
    onSuccess: (r) => {
      downloadCsv(`algo-config-history-${ts()}.csv`, r.csv);
      toast.success(`Exported ${r.count} config changes`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <section className="px-5 mb-4">
      <div className="rounded-2xl border bg-card p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Algo data exports
          </p>
          <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
            <Link to="/algo-config">Algo config screen →</Link>
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={trades.isPending}
            onClick={() => trades.mutate()}
          >
            {trades.isPending ? "Exporting…" : "Download trades CSV"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={signals.isPending}
            onClick={() => signals.mutate()}
          >
            {signals.isPending ? "Exporting…" : "Download signals CSV"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={cfg.isPending}
            onClick={() => cfg.mutate()}
          >
            {cfg.isPending ? "Exporting…" : "Download current configs CSV"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={audit.isPending}
            onClick={() => audit.mutate()}
          >
            {audit.isPending ? "Exporting…" : "Download config history CSV"}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Trades = all positions (paper + live, open + closed) with PnL, SL/TP,
          exit reason. Signals = one row per scanned symbol per user per scan
          cycle, with action (LONG/SHORT/WAIT/AVOID), weighted confidence and
          band, full indicator snapshot (trend, VWAP, EMA, RSI, volume spike,
          spread, ATR, distances, R:R, regime), risk gates (cooldown, daily
          loss, max positions), booked/skip/avoid decision, rejection reason,
          plus each tester's config snapshot. Current configs = latest per-user
          bot settings snapshot. Config history = full audit log of every
          per-field change with old/new values, who changed it (user/admin/system)
          and when.
        </p>
      </div>
    </section>
  );
}

function TuningActionsSection({ actions }: { actions: TuningAction[] }) {
  const qc = useQueryClient();
  const applyFn = useServerFn(adminApplyTuningAction);
  const applyMut = useMutation({
    mutationFn: (v: { kind: TuningAction["kind"]; userIds: string[] }) =>
      applyFn({ data: v as never }),
    onSuccess: (r: { updated: number; skipped: number; errors: string[] }) => {
      toast.success(
        `Applied to ${r.updated} tester${r.updated === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} skipped` : ""}`,
      );
      if (r.errors?.length) toast.error(r.errors.slice(0, 2).join(" · "));
      qc.invalidateQueries({ queryKey: ["beta_report"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (actions.length === 0) return null;
  const pill = (p: TuningAction["priority"]) => {
    if (p === "High") return "bg-[#0F52BA] text-white border-[#0F52BA]";
    if (p === "Medium") return "bg-[#E8F0FB] text-[#0F52BA] border-[#0F52BA]/40";
    return "bg-white text-[#0F52BA] border-[#0F52BA]/30";
  };
  return (
    <section className="mx-5 mt-2 mb-4 rounded-2xl bg-white text-black border border-[#0F52BA]/20 shadow-sm">
      <div className="px-4 pt-4 pb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-black">Tuning Actions</h2>
        <span className="text-[10px] uppercase tracking-wider text-[#0F52BA] font-semibold">
          {actions.length} recommendation{actions.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="px-4 pb-4 space-y-2.5">
        {actions.map((a) => {
          const isPending =
            applyMut.isPending && applyMut.variables?.kind === a.kind;
          return (
            <div
              key={a.id}
              className="rounded-xl border border-[#0F52BA]/15 bg-white p-3"
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span
                  className={`text-[10px] font-semibold px-2 h-5 inline-flex items-center rounded-full border ${pill(a.priority)}`}
                >
                  {a.priority} priority
                </span>
                <span className="text-[10px] text-black/50 truncate max-w-[55%] text-right">
                  {a.affected}
                </span>
              </div>
              <p className="text-xs font-semibold text-black">{a.issue}</p>
              <p className="text-[11px] text-black/70 mt-1">{a.evidence}</p>
              <p className="text-[11px] mt-1.5">
                <span className="text-[#0F52BA] font-semibold">Action: </span>
                <span className="text-black">{a.action}</span>
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[10px] text-black/55 italic">
                  {a.applyHint}
                </p>
                {a.applyable && a.affectedUserIds.length > 0 ? (
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-[#0F52BA] hover:bg-[#0F52BA]/90 text-white shrink-0"
                    disabled={applyMut.isPending}
                    onClick={() =>
                      applyMut.mutate({
                        kind: a.kind,
                        userIds: a.affectedUserIds,
                      })
                    }
                  >
                    {isPending
                      ? "Applying…"
                      : `Apply to ${a.affectedUserIds.length}`}
                  </Button>
                ) : (
                  <span className="text-[10px] text-black/40 shrink-0">
                    Manual only
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="px-4 pb-3 text-[10px] text-black/50">
        Applies to paper-mode config only. Changes persist and take effect on the
        next scanner cycle (and all subsequent days).
      </p>
    </section>
  );
}


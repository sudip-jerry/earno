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
  exportAllTradesCsv,
  exportSignalsCsv,
  exportAlgoConfigsCsv,
  type TesterReport,
  type TuneSuggestion,
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
                Today (since 00:00 UTC)
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
                  <p className="truncate">{s.bestTester.email ?? "—"}</p>
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
          <ul className="text-xs space-y-0.5 list-disc list-inside">
            {t.diagnosis.length === 0 ? (
              <li className="text-muted-foreground list-none">
                No outliers — settings look balanced.
              </li>
            ) : (
              t.diagnosis.map((d, i) => <li key={i}>{d}</li>)
            )}
          </ul>
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

function ExportBar() {
  const tradesFn = useServerFn(exportAllTradesCsv);
  const signalsFn = useServerFn(exportSignalsCsv);
  const cfgFn = useServerFn(exportAlgoConfigsCsv);

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
            {cfg.isPending ? "Exporting…" : "Download algo configs CSV"}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Trades = all positions (paper + live, open + closed) with PnL, SL/TP,
          exit reason. Signals = scanner & auto-book events across users
          (scan results, auto-booked signals with confidence/target/stop/RR,
          skipped, paused) + each tester's config snapshot. Configs = current
          per-user bot settings.
        </p>
      </div>
    </section>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ChevronLeft, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getMyEntitlements } from "@/lib/plans.functions";
import {
  exportAlgoConfigsCsv,
  exportAlgoAuditCsv,
  getAlgoConfigsOverview,
  getAlgoAuditLog,
} from "@/lib/beta-report.functions";

export const Route = createFileRoute("/_authenticated/algo-config")({
  head: () => ({ meta: [{ title: "Algo Configs — Earn'O" }] }),
  component: AlgoConfigPage,
});

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

function AlgoConfigPage() {
  const entFn = useServerFn(getMyEntitlements);
  const overviewFn = useServerFn(getAlgoConfigsOverview);
  const exportFn = useServerFn(exportAlgoConfigsCsv);
  const auditFn = useServerFn(getAlgoAuditLog);
  const auditCsvFn = useServerFn(exportAlgoAuditCsv);

  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => entFn() });
  const data = useQuery({
    queryKey: ["algo_configs_overview"],
    queryFn: () => overviewFn(),
    enabled: !!ent.data?.isAdmin,
    refetchInterval: 60_000,
  });
  const audit = useQuery({
    queryKey: ["algo_audit"],
    queryFn: () => auditFn(),
    enabled: !!ent.data?.isAdmin,
    refetchInterval: 60_000,
  });

  const exportMut = useMutation({
    mutationFn: () => exportFn(),
    onSuccess: (r) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadCsv(`algo-configs-${stamp}.csv`, r.csv);
      toast.success(`Exported ${r.count} configs`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const auditExportMut = useMutation({
    mutationFn: () => auditCsvFn(),
    onSuccess: (r) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadCsv(`algo-audit-${stamp}.csv`, r.csv);
      toast.success(`Exported ${r.count} audit rows`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const list = data.data?.configs ?? [];
    if (!q.trim()) return list;
    const needle = q.toLowerCase();
    return list.filter(
      (c) =>
        (c.user_email ?? "").toLowerCase().includes(needle) ||
        (c.user_name ?? "").toLowerCase().includes(needle) ||
        c.user_id.includes(needle) ||
        c.trading_style.includes(needle) ||
        c.mode.includes(needle),
    );
  }, [data.data, q]);

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

  return (
    <div className="min-h-svh bg-background pb-16">
      <header className="px-5 pt-6 pb-4 flex items-center gap-2">
        <Link
          to="/beta-report"
          className="size-9 grid place-items-center rounded-full hover:bg-muted -ml-2"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-xl font-semibold flex-1">Algo Configs</h1>
        <Button
          size="sm"
          className="h-8 text-xs gap-1"
          disabled={exportMut.isPending}
          onClick={() => exportMut.mutate()}
        >
          <Download className="size-3.5" />
          {exportMut.isPending ? "Exporting…" : "CSV"}
        </Button>
      </header>

      <p className="px-5 text-[11px] text-muted-foreground -mt-2 mb-3">
        Current bot settings per user across modes. No change-history is
        recorded yet — CSV captures the live snapshot.
      </p>

      <section className="px-5 mb-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by email, style, mode…"
          className="h-9 text-xs"
        />
      </section>

      {data.isLoading && (
        <p className="px-5 text-xs text-muted-foreground">Loading…</p>
      )}

      <section className="px-5 space-y-2">
        {filtered.map((c) => (
          <div key={c.user_id} className="rounded-2xl border bg-card p-3">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <p className="font-medium truncate text-sm">
                  {c.user_email ?? c.user_id.slice(0, 8)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {c.mode} · {c.is_running ? "running" : "stopped"} · style{" "}
                  {c.trading_style}
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {new Date(c.updated_at).toLocaleString()}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              <Kv k="ATR" v={c.atr_multiplier.toFixed(2)} />
              <Kv k="Tgt" v={c.target_multiplier.toFixed(2)} />
              <Kv k="Min RR" v={c.min_rr.toFixed(2)} />
              <Kv k="Risk %" v={c.risk_per_trade_pct.toFixed(2)} />
              <Kv k="MinScore" v={`${c.min_scalp_score}`} />
              <Kv k="Lev" v={`${c.leverage}x`} />
              <Kv k="MaxOpen" v={`${c.max_open_positions}`} />
              <Kv k="Max/day" v={`${c.max_trades_per_day}`} />
              <Kv k="AutoClose" v={`${c.auto_close_minutes}m`} />
              <Kv k="DailyCap" v={`${c.daily_loss_cap_pct.toFixed(2)}%`} />
              <Kv k="Cooldown" v={`${c.cooldown_minutes}m`} />
              <Kv k="ScanEvery" v={`${c.scan_interval_minutes}m`} />
              <Kv k="Long" v={c.allow_long ? "on" : "off"} />
              <Kv k="Short" v={c.allow_short ? "on" : "off"} />
            </div>
          </div>
        ))}
        {!data.isLoading && filtered.length === 0 && (
          <p className="text-xs text-muted-foreground">No configs match.</p>
        )}
      </section>

      <section className="px-5 mt-6">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Recent admin tunes
        </h2>
        <div className="space-y-1.5">
          {(data.data?.recentTunes ?? []).map((t, i) => (
            <div
              key={i}
              className="rounded-lg border bg-card p-2 text-[11px]"
            >
              <div className="flex justify-between gap-2">
                <span className="truncate font-medium">
                  {t.user_email ?? t.user_id.slice(0, 8)}
                </span>
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {new Date(t.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-muted-foreground truncate">{t.message}</p>
              {t.meta != null && (
                <p className="font-mono text-[10px] text-muted-foreground truncate">
                  {JSON.stringify(t.meta)}
                </p>
              )}
            </div>
          ))}
          {(data.data?.recentTunes ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">No admin tunes yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border bg-background p-1.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {k}
      </p>
      <p className="tabular-nums font-medium">{v}</p>
    </div>
  );
}

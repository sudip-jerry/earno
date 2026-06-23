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
  adminApplyTune,
} from "@/lib/beta-report.functions";
import { useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Pencil, X } from "lucide-react";

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
        Current bot settings per user across modes. Every edit is logged in
        the audit history below — used for tuning pattern analysis.
      </p>

      <PatternsPanel rows={audit.data ?? []} />


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
          <UserConfigCard key={c.user_id} c={c} />
        ))}
        {!data.isLoading && filtered.length === 0 && (
          <p className="text-xs text-muted-foreground">No configs match.</p>
        )}
      </section>

      <section className="px-5 mt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Audit log
          </h2>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            disabled={auditExportMut.isPending}
            onClick={() => auditExportMut.mutate()}
          >
            <Download className="size-3" />
            {auditExportMut.isPending ? "Exporting…" : "CSV"}
          </Button>
        </div>
        <div className="space-y-1.5">
          {(audit.data ?? []).map((a) => {
            const tone =
              a.source === "admin"
                ? "border-amber-500/40 bg-amber-500/5"
                : a.source === "system"
                  ? "border-blue-500/30 bg-blue-500/5"
                  : "";
            return (
              <div
                key={a.id}
                className={`rounded-lg border bg-card p-2 text-[11px] ${tone}`}
              >
                <div className="flex justify-between gap-2">
                  <span className="truncate font-medium">
                    {a.user_email ?? a.user_id.slice(0, 8)}
                  </span>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {new Date(a.changed_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  <span className="font-mono text-foreground">{a.field}</span>
                  {": "}
                  <span className="line-through opacity-60">
                    {a.old_value ?? "—"}
                  </span>
                  {" → "}
                  <span className="text-foreground">{a.new_value ?? "—"}</span>
                </p>
                <p className="text-[10px] text-muted-foreground">
                  by {a.changed_by_email ?? a.source}
                  {a.source !== "user" && ` · ${a.source}`}
                </p>
              </div>
            );
          })}
          {!audit.isLoading && (audit.data ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">
              No changes recorded yet. New edits will appear here.
            </p>
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

type CfgRow = {
  user_id: string;
  user_email: string | null;
  user_name: string | null;
  mode: string;
  is_running: boolean;
  trading_style: string;
  atr_multiplier: number;
  target_multiplier: number;
  min_rr: number;
  risk_per_trade_pct: number;
  max_open_positions: number;
  max_trades_per_day: number;
  auto_close_minutes: number;
  min_scalp_score: number;
  allow_long: boolean;
  allow_short: boolean;
  leverage: number;
  cooldown_minutes: number;
  daily_loss_cap_pct: number;
  scan_interval_minutes: number;
  auto_book: boolean;
  move_to_breakeven: boolean;
  trailing_enabled: boolean;
  regime_filter_enabled: boolean;
  updated_at: string;
};

type NumField =
  | "leverage"
  | "risk_per_trade_pct"
  | "max_open_positions"
  | "max_trades_per_day"
  | "cooldown_minutes"
  | "auto_close_minutes"
  | "scan_interval_minutes"
  | "daily_loss_cap_pct"
  | "min_scalp_score"
  | "atr_multiplier"
  | "target_multiplier";

type BoolField =
  | "is_running"
  | "auto_book"
  | "allow_long"
  | "allow_short"
  | "move_to_breakeven"
  | "trailing_enabled"
  | "regime_filter_enabled";

function UserConfigCard({ c }: { c: CfgRow }) {
  const qc = useQueryClient();
  const tuneFn = useServerFn(adminApplyTune);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});

  const startEdit = () => {
    setDraft({
      leverage: String(c.leverage),
      risk_per_trade_pct: String(c.risk_per_trade_pct),
      max_open_positions: String(c.max_open_positions),
      max_trades_per_day: String(c.max_trades_per_day),
      cooldown_minutes: String(c.cooldown_minutes),
      auto_close_minutes: String(c.auto_close_minutes),
      scan_interval_minutes: String(c.scan_interval_minutes),
      daily_loss_cap_pct: String(c.daily_loss_cap_pct),
      min_scalp_score: String(c.min_scalp_score),
      atr_multiplier: String(c.atr_multiplier),
      target_multiplier: String(c.target_multiplier),
      trading_style: c.trading_style,
      is_running: c.is_running,
      auto_book: c.auto_book,
      allow_long: c.allow_long,
      allow_short: c.allow_short,
      move_to_breakeven: c.move_to_breakeven,
      trailing_enabled: c.trailing_enabled,
      regime_filter_enabled: c.regime_filter_enabled,
    });
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      tuneFn({ data: { userId: c.user_id, patch } as never }),
    onSuccess: () => {
      toast.success("Config updated");
      qc.invalidateQueries({ queryKey: ["algo_configs_overview"] });
      qc.invalidateQueries({ queryKey: ["algo_audit"] });
      setEditing(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const buildPatch = (): Record<string, unknown> => {
    const numFields: NumField[] = [
      "leverage", "risk_per_trade_pct", "max_open_positions", "max_trades_per_day",
      "cooldown_minutes", "auto_close_minutes", "scan_interval_minutes",
      "daily_loss_cap_pct", "min_scalp_score", "atr_multiplier", "target_multiplier",
    ];
    const boolFields: BoolField[] = [
      "is_running", "auto_book", "allow_long", "allow_short",
      "move_to_breakeven", "trailing_enabled", "regime_filter_enabled",
    ];
    const intFields = new Set<NumField>([
      "leverage", "max_open_positions", "max_trades_per_day",
      "cooldown_minutes", "auto_close_minutes", "scan_interval_minutes", "min_scalp_score",
    ]);
    const out: Record<string, unknown> = {};
    for (const f of numFields) {
      const raw = String(draft[f] ?? "").trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      const v = intFields.has(f) ? Math.round(n) : n;
      if (v !== Number(c[f])) out[f] = v;
    }
    for (const f of boolFields) {
      const v = Boolean(draft[f]);
      if (v !== c[f]) out[f] = v;
    }
    const style = String(draft.trading_style ?? "");
    if (style && style !== c.trading_style) out.trading_style = style;
    return out;
  };

  return (
    <div className="rounded-2xl border bg-card p-3">
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
        <div className="flex items-center gap-2 shrink-0">
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {new Date(c.updated_at).toLocaleString()}
          </p>
          <Button
            size="sm"
            variant={editing ? "ghost" : "outline"}
            className="h-7 px-2 text-[11px]"
            onClick={() => (editing ? setEditing(false) : startEdit())}
          >
            {editing ? <X className="size-3" /> : <Pencil className="size-3" />}
          </Button>
        </div>
      </div>

      {!editing ? (
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
          <Kv k="AutoBook" v={c.auto_book ? "on" : "off"} />
          <Kv k="MoveBE" v={c.move_to_breakeven ? "on" : "off"} />
          <Kv k="Trail" v={c.trailing_enabled ? "on" : "off"} />
          <Kv k="Regime" v={c.regime_filter_enabled ? "on" : "off"} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <SelField
              label="Style"
              value={String(draft.trading_style ?? "")}
              onChange={(v) => setDraft((d) => ({ ...d, trading_style: v }))}
              options={["conservative", "balanced", "aggressive"]}
            />
            <NumField label="Leverage" value={draft.leverage} onChange={(v) => setDraft((d) => ({ ...d, leverage: v }))} />
            <NumField label="Risk/trade %" value={draft.risk_per_trade_pct} onChange={(v) => setDraft((d) => ({ ...d, risk_per_trade_pct: v }))} />
            <NumField label="Max open" value={draft.max_open_positions} onChange={(v) => setDraft((d) => ({ ...d, max_open_positions: v }))} />
            <NumField label="Max/day" value={draft.max_trades_per_day} onChange={(v) => setDraft((d) => ({ ...d, max_trades_per_day: v }))} />
            <NumField label="Cooldown (min)" value={draft.cooldown_minutes} onChange={(v) => setDraft((d) => ({ ...d, cooldown_minutes: v }))} />
            <NumField label="Auto-close (min)" value={draft.auto_close_minutes} onChange={(v) => setDraft((d) => ({ ...d, auto_close_minutes: v }))} />
            <NumField label="Scan every (min)" value={draft.scan_interval_minutes} onChange={(v) => setDraft((d) => ({ ...d, scan_interval_minutes: v }))} />
            <NumField label="Daily cap %" value={draft.daily_loss_cap_pct} onChange={(v) => setDraft((d) => ({ ...d, daily_loss_cap_pct: v }))} />
            <NumField label="Min score" value={draft.min_scalp_score} onChange={(v) => setDraft((d) => ({ ...d, min_scalp_score: v }))} />
            <NumField label="ATR mult" value={draft.atr_multiplier} onChange={(v) => setDraft((d) => ({ ...d, atr_multiplier: v }))} />
            <NumField label="Target mult" value={draft.target_multiplier} onChange={(v) => setDraft((d) => ({ ...d, target_multiplier: v }))} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <BoolRow label="Bot running" value={!!draft.is_running} onChange={(v) => setDraft((d) => ({ ...d, is_running: v }))} />
            <BoolRow label="Auto-book" value={!!draft.auto_book} onChange={(v) => setDraft((d) => ({ ...d, auto_book: v }))} />
            <BoolRow label="Allow longs" value={!!draft.allow_long} onChange={(v) => setDraft((d) => ({ ...d, allow_long: v }))} />
            <BoolRow label="Allow shorts" value={!!draft.allow_short} onChange={(v) => setDraft((d) => ({ ...d, allow_short: v }))} />
            <BoolRow label="Move to BE" value={!!draft.move_to_breakeven} onChange={(v) => setDraft((d) => ({ ...d, move_to_breakeven: v }))} />
            <BoolRow label="Trailing SL" value={!!draft.trailing_enabled} onChange={(v) => setDraft((d) => ({ ...d, trailing_enabled: v }))} />
            <BoolRow label="Regime filter" value={!!draft.regime_filter_enabled} onChange={(v) => setDraft((d) => ({ ...d, regime_filter_enabled: v }))} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={save.isPending}
              onClick={() => {
                const patch = buildPatch();
                if (Object.keys(patch).length === 0) {
                  toast.info("No changes");
                  return;
                }
                save.mutate(patch);
              }}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NumField({
  label, value, onChange,
}: { label: string; value: string | boolean | undefined; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      <Input
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        className="h-8 text-xs"
      />
    </label>
  );
}

function SelField({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded-md border bg-background px-2 text-xs capitalize"
      >
        {options.map((o) => (
          <option key={o} value={o} className="capitalize">{o}</option>
        ))}
      </select>
    </label>
  );
}

function BoolRow({
  label, value, onChange,
}: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-1.5">
      <span className="text-[11px]">{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

type AuditRow = {
  id: string;
  changed_at: string;
  user_id: string;
  user_email: string | null;
  source: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
};

function PatternsPanel({ rows }: { rows: AuditRow[] }) {
  const stats = useMemo(() => {
    const byField = new Map<string, number>();
    const byUser = new Map<string, number>();
    const bySource = new Map<string, number>();
    const byDay = new Map<string, number>();
    const fieldDirections = new Map<string, { up: number; down: number }>();

    for (const r of rows) {
      byField.set(r.field, (byField.get(r.field) ?? 0) + 1);
      const u = r.user_email ?? r.user_id.slice(0, 8);
      byUser.set(u, (byUser.get(u) ?? 0) + 1);
      bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
      const day = r.changed_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);

      const ov = Number(r.old_value);
      const nv = Number(r.new_value);
      if (Number.isFinite(ov) && Number.isFinite(nv) && ov !== nv) {
        const d = fieldDirections.get(r.field) ?? { up: 0, down: 0 };
        if (nv > ov) d.up++;
        else d.down++;
        fieldDirections.set(r.field, d);
      }
    }
    const sortDesc = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]);
    return {
      topFields: sortDesc(byField).slice(0, 8),
      topUsers: sortDesc(byUser).slice(0, 6),
      bySource: sortDesc(bySource),
      byDay: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      directions: fieldDirections,
      total: rows.length,
    };
  }, [rows]);

  if (stats.total === 0) return null;

  return (
    <section className="px-5 mb-4">
      <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Tuning patterns ({stats.total} changes)
      </h2>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Most-tuned fields
          </p>
          <ul className="space-y-1 text-[11px]">
            {stats.topFields.map(([f, n]) => {
              const d = stats.directions.get(f);
              return (
                <li key={f} className="flex justify-between gap-2">
                  <span className="font-mono truncate">{f}</span>
                  <span className="tabular-nums text-muted-foreground shrink-0">
                    {n}
                    {d && (d.up || d.down) ? (
                      <span className="ml-1 text-[10px]">
                        <span className="text-emerald-500">↑{d.up}</span>
                        {" "}
                        <span className="text-rose-500">↓{d.down}</span>
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Most-active tuners
          </p>
          <ul className="space-y-1 text-[11px]">
            {stats.topUsers.map(([u, n]) => (
              <li key={u} className="flex justify-between gap-2">
                <span className="truncate">{u}</span>
                <span className="tabular-nums text-muted-foreground shrink-0">
                  {n}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            By source
          </p>
          <ul className="space-y-1 text-[11px]">
            {stats.bySource.map(([s, n]) => (
              <li key={s} className="flex justify-between gap-2">
                <span className="capitalize">{s}</span>
                <span className="tabular-nums text-muted-foreground">{n}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border bg-card p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Changes per day
          </p>
          <ul className="space-y-1 text-[11px]">
            {stats.byDay.slice(-6).map(([d, n]) => (
              <li key={d} className="flex justify-between gap-2">
                <span className="tabular-nums">{d.slice(5)}</span>
                <span className="tabular-nums text-muted-foreground">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">
        Up/down arrows show how often a numeric field is raised vs. lowered —
        useful for spotting where defaults should move.
      </p>
    </section>
  );
}


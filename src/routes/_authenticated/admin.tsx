import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getMyEntitlements,
  adminListUsers,
  adminSetUserPlan,
  adminTogglePaywall,
  adminCreateCoupon,
  adminListCoupons,
  adminListTrades,
  adminListEvents,
  adminGetUserConfig,
  adminUpdateUserConfig,
  adminCopyUserConfig,
} from "@/lib/plans.functions";

import { PLAN_NAME, type PlanTier } from "@/lib/plans";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — Earn'O" }] }),
  component: AdminPage,
});

function AdminPage() {
  const qc = useQueryClient();
  const entFn = useServerFn(getMyEntitlements);
  const usersFn = useServerFn(adminListUsers);
  const setPlanFn = useServerFn(adminSetUserPlan);
  const togglePaywallFn = useServerFn(adminTogglePaywall);
  const createCouponFn = useServerFn(adminCreateCoupon);
  const listCouponsFn = useServerFn(adminListCoupons);
  const listTradesFn = useServerFn(adminListTrades);
  const listEventsFn = useServerFn(adminListEvents);

  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => entFn() });
  const users = useQuery({
    queryKey: ["admin_users"],
    queryFn: () => usersFn(),
    enabled: !!ent.data?.isAdmin,
  });
  const coupons = useQuery({
    queryKey: ["admin_coupons"],
    queryFn: () => listCouponsFn(),
    enabled: !!ent.data?.isAdmin,
  });
  const [tradeStatus, setTradeStatus] = useState<"all" | "open" | "closed">("all");
  const trades = useQuery({
    queryKey: ["admin_trades", tradeStatus],
    queryFn: () => listTradesFn({ data: { status: tradeStatus, limit: 100 } }),
    enabled: !!ent.data?.isAdmin,
    refetchInterval: 15_000,
  });
  const [eventLevel, setEventLevel] = useState<
    "all" | "info" | "signal" | "trade" | "warn" | "error"
  >("all");
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const events = useQuery({
    queryKey: ["admin_events", eventLevel],
    queryFn: () => listEventsFn({ data: { level: eventLevel, limit: 150 } }),
    enabled: !!ent.data?.isAdmin,
    refetchInterval: 15_000,
  });


  const [couponCode, setCouponCode] = useState("");
  const [couponTier, setCouponTier] = useState<"reco" | "auto5" | "unlimited">("reco");
  const [couponDays, setCouponDays] = useState(30);

  const togglePaywall = useMutation({
    mutationFn: (enabled: boolean) => togglePaywallFn({ data: { enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entitlements"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const setPlan = useMutation({
    mutationFn: (v: { userId: string; tier: PlanTier; days: number }) =>
      setPlanFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin_users"] });
      toast.success("Plan updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
    onSettled: () => setSavingUserId(null),
  });

  const createCoupon = useMutation({
    mutationFn: () =>
      createCouponFn({
        data: { code: couponCode, tier: couponTier, durationDays: couponDays },
      }),
    onSuccess: () => {
      toast.success("Coupon created");
      setCouponCode("");
      qc.invalidateQueries({ queryKey: ["admin_coupons"] });
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

  const u = users.data ?? [];
  const totalTradesToday = u.reduce((s, x) => s + x.tradesToday, 0);
  const activeBots = u.filter((x) => x.isRunning).length;
  const paying = u.filter((x) => x.tier !== "free").length;

  return (
    <div className="min-h-svh bg-background pb-16">
      <header className="px-5 pt-6 pb-4 flex items-center gap-2">
        <Link
          to="/"
          className="size-9 grid place-items-center rounded-full hover:bg-muted -ml-2"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-xl font-semibold">Admin</h1>
        <Link
          to="/beta-report"
          className="ml-auto text-xs px-3 h-8 inline-flex items-center rounded-full border bg-card hover:bg-muted"
        >
          Beta Report →
        </Link>
      </header>

      <section className="px-5 grid grid-cols-4 gap-2">
        <Tile label="Users" value={`${u.length}`} />
        <Tile label="Paying" value={`${paying}`} />
        <Tile label="Bots on" value={`${activeBots}`} />
        <Tile label="Trades/24h" value={`${totalTradesToday}`} />
      </section>

      <section className="px-5 mt-6">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          App-wide paywall
        </h2>
        <div className="rounded-2xl border bg-card p-4 flex items-center justify-between">
          <div className="min-w-0">
            <p className="font-medium text-sm">Paywall enabled</p>
            <p className="text-xs text-muted-foreground">
              When off, all features are free for everyone.
            </p>
          </div>
          <Switch
            checked={ent.data.paywallEnabled}
            onCheckedChange={(v) => togglePaywall.mutate(v)}
          />
        </div>
      </section>

      <section className="px-5 mt-6">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Create coupon
        </h2>
        <div className="rounded-2xl border bg-card p-4 space-y-3">
          <Input
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            placeholder="CODE (A-Z, 0-9)"
          />
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={couponTier}
              onValueChange={(v) => setCouponTier(v as typeof couponTier)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reco">Insights</SelectItem>
                <SelectItem value="auto5">Auto-Trader</SelectItem>
                <SelectItem value="unlimited">Unlimited</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              value={couponDays}
              onChange={(e) => setCouponDays(parseInt(e.target.value) || 30)}
              placeholder="Days"
            />
          </div>
          <Button
            className="w-full"
            onClick={() => createCoupon.mutate()}
            disabled={!couponCode || createCoupon.isPending}
          >
            Create coupon
          </Button>
        </div>
        {coupons.data?.length ? (
          <div className="mt-3 space-y-2">
            {coupons.data.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border bg-card p-3 text-sm flex items-center justify-between"
              >
                <div className="min-w-0">
                  <button
                    type="button"
                    className="font-mono font-medium flex items-center gap-1 hover:text-primary"
                    onClick={() => {
                      navigator.clipboard.writeText(c.code);
                      toast.success("Copied");
                    }}
                  >
                    {c.code}
                    <Copy className="size-3 opacity-60" />
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {PLAN_NAME[c.tier as PlanTier]} · {c.duration_days}d · used{" "}
                    {c.used_count}
                    {c.max_uses ? `/${c.max_uses}` : ""}
                  </p>
                </div>
                <span
                  className={`text-[11px] px-2 h-6 inline-flex items-center rounded-full ${c.active ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"}`}
                >
                  {c.active ? "Active" : "Inactive"}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="px-5 mt-6">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          Users ({u.length})
        </h2>
        <div className="space-y-2">
          {u.map((x) => {
            const isSaving = savingUserId === x.id;
            return (
              <div key={x.id} className="rounded-xl border bg-card p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{x.email ?? x.id.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground">
                      {PLAN_NAME[x.tier]} · {x.planSource}
                      {x.planExpires
                        ? ` · until ${new Date(x.planExpires).toLocaleDateString()}`
                        : ""}
                      {x.roles.includes("admin") ? " · admin" : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Bot {x.isRunning ? "🟢 running" : "⚪ stopped"} · {x.mode ?? "—"} ·{" "}
                      {x.tradesToday} trades today
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Select
                      value={x.tier}
                      onValueChange={(t) => {
                        setSavingUserId(x.id);
                        setPlan.mutate({
                          userId: x.id,
                          tier: t as PlanTier,
                          days: t === "free" ? 0 : 36500,
                        });
                      }}
                    >
                      <SelectTrigger className="w-32 h-8 text-xs" disabled={isSaving}>
                        <SelectValue placeholder="Set plan" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="free">Free</SelectItem>
                        <SelectItem value="reco">Insights</SelectItem>
                        <SelectItem value="auto5">Auto-Trader</SelectItem>
                        <SelectItem value="unlimited">Unlimited (∞)</SelectItem>
                      </SelectContent>
                    </Select>
                    {isSaving && (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </div>
                <UserConfigEditor
                  userId={x.id}
                  label={x.email ?? x.id.slice(0, 8)}
                  allUsers={u}
                />
              </div>
            );
          })}
        </div>
      </section>

      <section className="px-5 mt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            All trades ({trades.data?.length ?? 0})
          </h2>
          <Select value={tradeStatus} onValueChange={(v) => setTradeStatus(v as typeof tradeStatus)}>
            <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          {(trades.data ?? []).map((t) => {
            const pnl = t.pnl == null ? null : Number(t.pnl);
            const pnlPct = t.pnl_pct == null ? null : Number(t.pnl_pct);
            return (
              <div key={t.id} className="rounded-lg border bg-card p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {t.symbol} <span className={t.side === "long" ? "text-emerald-500" : "text-destructive"}>{t.side.toUpperCase()}</span> ×{t.leverage}
                      <span className="text-muted-foreground"> · {t.mode}</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {t.email ?? t.user_id.slice(0, 8)} · {new Date(t.opened_at).toLocaleString()}
                      {t.closed_at ? ` → ${new Date(t.closed_at).toLocaleTimeString()}` : ""}
                      {t.exit_reason ? ` · ${t.exit_reason}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-medium tabular-nums ${pnl == null ? "text-muted-foreground" : pnl >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                      {pnl == null ? (t.status === "open" ? "open" : "—") : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`}
                    </p>
                    {pnlPct != null && (
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {trades.data?.length === 0 && (
            <p className="text-xs text-muted-foreground">No trades yet.</p>
          )}
        </div>
      </section>

      <section className="px-5 mt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Event logs ({events.data?.length ?? 0})
          </h2>
          <Select value={eventLevel} onValueChange={(v) => setEventLevel(v as typeof eventLevel)}>
            <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="signal">Signal</SelectItem>
              <SelectItem value="trade">Trade</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          {(events.data ?? []).map((e) => {
            const tone =
              e.level === "error" ? "text-destructive" :
              e.level === "warn" ? "text-amber-500" :
              e.level === "trade" ? "text-emerald-500" :
              e.level === "signal" ? "text-primary" :
              "text-muted-foreground";
            return (
              <div key={e.id} className="rounded-lg border bg-card p-2.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words">
                    <span className={`uppercase text-[10px] font-medium mr-1.5 ${tone}`}>{e.level}</span>
                    {e.message}
                  </p>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(e.created_at).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  {e.email ?? e.user_id.slice(0, 8)}
                </p>
              </div>
            );
          })}
          {events.data?.length === 0 && (
            <p className="text-xs text-muted-foreground">No events yet.</p>
          )}
        </div>
      </section>
    </div>

  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-xl font-semibold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}


type EditableCfg = {
  is_running: boolean;
  auto_book: boolean;
  mode: "paper" | "live";
  trading_style: "conservative" | "balanced" | "aggressive";
  allow_long: boolean;
  allow_short: boolean;
  leverage: number;
  risk_per_trade_pct: number;
  max_open_positions: number;
  max_trades_per_day: number;
  cooldown_minutes: number;
  auto_close_minutes: number;
  daily_loss_cap_pct: number;
  min_scalp_score: number;
  auto_book_confidence_threshold: number;
  display_confidence_threshold: number;
  atr_multiplier: number;
  target_multiplier: number;
  min_rr: number;
  min_sl_pct: number;
  max_auto_sl_pct: number;
  move_to_breakeven: boolean;
  trailing_enabled: boolean;
  regime_filter_enabled: boolean;
  symbol_blacklist_threshold: number;
  symbol_sl_cooldown_minutes: number;
  max_sl_atr_pct: number;
  min_ev_ratio: number;
  minimum_net_profit_to_enter_pct: number;
  major_coin_confidence_floor: number;
  blocked_session_hours_ist: number[];
};


const NUM_FIELDS: { key: keyof EditableCfg; label: string; step?: number }[] = [
  { key: "leverage", label: "Leverage" },
  { key: "risk_per_trade_pct", label: "Risk/trade %", step: 0.1 },
  { key: "max_open_positions", label: "Max open" },
  { key: "max_trades_per_day", label: "Max trades/day" },
  { key: "cooldown_minutes", label: "Cooldown (min)" },
  { key: "auto_close_minutes", label: "Auto-close (min)" },
  { key: "daily_loss_cap_pct", label: "Daily loss cap %", step: 0.1 },
  { key: "min_scalp_score", label: "Min scalp score" },
  { key: "auto_book_confidence_threshold", label: "Auto-book conf %" },
  { key: "display_confidence_threshold", label: "Display conf %" },
  { key: "atr_multiplier", label: "ATR mult", step: 0.1 },
  { key: "target_multiplier", label: "Target mult", step: 0.1 },
  { key: "min_rr", label: "Min RR", step: 0.1 },
  { key: "min_sl_pct", label: "Min SL %", step: 0.1 },
  { key: "max_auto_sl_pct", label: "Max auto SL %", step: 0.1 },
  { key: "symbol_blacklist_threshold", label: "Symbol blacklist N" },
  { key: "symbol_sl_cooldown_minutes", label: "Symbol SL cooldown (min)" },
  { key: "max_sl_atr_pct", label: "Max SL ATR %", step: 0.1 },
  { key: "min_ev_ratio", label: "Min EV ratio", step: 0.05 },
  { key: "minimum_net_profit_to_enter_pct", label: "Min net profit to enter %", step: 0.01 },
];


const BOOL_FIELDS: { key: keyof EditableCfg; label: string }[] = [
  { key: "is_running", label: "Bot running" },
  { key: "auto_book", label: "Auto-book" },
  { key: "allow_long", label: "Allow longs" },
  { key: "allow_short", label: "Allow shorts" },
  { key: "move_to_breakeven", label: "Move to BE" },
  { key: "trailing_enabled", label: "Trailing SL" },
  { key: "regime_filter_enabled", label: "Regime filter" },
];

function UserConfigEditor({
  userId,
  label,
  allUsers,
}: {
  userId: string;
  label: string;
  allUsers: { id: string; email: string | null }[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [patch, setPatch] = useState<Partial<EditableCfg>>({});
  const [copyFrom, setCopyFrom] = useState<string>("");
  const getFn = useServerFn(adminGetUserConfig);
  const updFn = useServerFn(adminUpdateUserConfig);
  const copyFn = useServerFn(adminCopyUserConfig);

  const cfg = useQuery({
    queryKey: ["admin_user_cfg", userId],
    queryFn: () => getFn({ data: { userId } }),
    enabled: open,
  });

  const upd = useMutation({
    mutationFn: (p: Partial<EditableCfg>) =>
      updFn({ data: { userId, patch: p } }),
    onSuccess: () => {
      toast.success("Config saved");
      setPatch({});
      qc.invalidateQueries({ queryKey: ["admin_user_cfg", userId] });
      qc.invalidateQueries({ queryKey: ["admin_users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const copy = useMutation({
    mutationFn: (fromUserId: string) =>
      copyFn({ data: { fromUserId, toUserId: userId } }),
    onSuccess: () => {
      toast.success("Config copied");
      setCopyFrom("");
      qc.invalidateQueries({ queryKey: ["admin_user_cfg", userId] });
      qc.invalidateQueries({ queryKey: ["admin_users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const c = (cfg.data ?? {}) as Partial<EditableCfg>;
  const get = <K extends keyof EditableCfg>(k: K): EditableCfg[K] | undefined =>
    (patch[k] ?? c[k]) as EditableCfg[K] | undefined;
  const setK = <K extends keyof EditableCfg>(k: K, v: EditableCfg[K]) =>
    setPatch((p) => ({ ...p, [k]: v }));

  return (
    <div className="mt-2 border-t pt-2">
      <button
        type="button"
        className="text-[11px] text-primary hover:underline"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide config ▴" : "Edit config ▾"}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {cfg.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Select value={copyFrom} onValueChange={setCopyFrom}>
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue placeholder="Copy config from…" />
                  </SelectTrigger>
                  <SelectContent>
                    {allUsers
                      .filter((o) => o.id !== userId)
                      .map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.email ?? o.id.slice(0, 8)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  disabled={!copyFrom || copy.isPending}
                  onClick={() => copy.mutate(copyFrom)}
                >
                  Copy
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Mode</p>
                  <Select
                    value={(get("mode") ?? "paper") as string}
                    onValueChange={(v) => setK("mode", v as EditableCfg["mode"])}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paper">Paper</SelectItem>
                      <SelectItem value="live">Live</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Style</p>
                  <Select
                    value={(get("trading_style") ?? "balanced") as string}
                    onValueChange={(v) =>
                      setK("trading_style", v as EditableCfg["trading_style"])
                    }
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="conservative">Conservative</SelectItem>
                      <SelectItem value="balanced">Balanced</SelectItem>
                      <SelectItem value="aggressive">Aggressive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {BOOL_FIELDS.map((f) => (
                  <label
                    key={f.key}
                    className="flex items-center justify-between rounded-md border bg-background px-2 py-1.5 text-[11px]"
                  >
                    <span>{f.label}</span>
                    <Switch
                      checked={!!get(f.key)}
                      onCheckedChange={(v) => setK(f.key, v as never)}
                    />
                  </label>
                ))}
                <div className="rounded-md border bg-muted/30 px-2 py-2 text-[11px] col-span-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-muted-foreground">Blocked IST hours</span>
                    <span className="font-medium tabular-nums">
                      {(() => {
                        const cur = (get("blocked_session_hours_ist") ?? []) as number[];
                        return cur.length > 0 ? [...cur].sort((a, b) => a - b).join(", ") : "none";
                      })()}
                    </span>
                  </div>
                  <div className="grid grid-cols-12 gap-1">
                    {Array.from({ length: 24 }, (_, h) => {
                      const cur = (get("blocked_session_hours_ist") ?? []) as number[];
                      const on = cur.includes(h);
                      return (
                        <button
                          key={h}
                          type="button"
                          onClick={() => {
                            const next = on ? cur.filter((x) => x !== h) : [...cur, h].sort((a, b) => a - b);
                            setK("blocked_session_hours_ist", next);
                          }}
                          className={`h-6 rounded text-[10px] tabular-nums border ${
                            on
                              ? "bg-destructive text-destructive-foreground border-destructive"
                              : "bg-background hover:bg-muted border-border"
                          }`}
                          aria-pressed={on}
                          aria-label={`Hour ${h} IST ${on ? "blocked" : "allowed"}`}
                        >
                          {h}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">Tap an hour to block/allow entries during that IST hour.</p>
                </div>
              </div>



              <div className="grid grid-cols-2 gap-2">
                {NUM_FIELDS.map((f) => {
                  const v = get(f.key);
                  return (
                    <label key={f.key} className="text-[11px]">
                      <span className="text-muted-foreground">{f.label}</span>
                      <Input
                        type="number"
                        step={f.step ?? 1}
                        className="h-7 text-xs mt-0.5"
                        value={v == null ? "" : String(v)}
                        onChange={(e) => {
                          const n = e.target.value === "" ? undefined : Number(e.target.value);
                          if (n === undefined || Number.isNaN(n)) return;
                          setK(f.key, n as never);
                        }}
                      />
                    </label>
                  );
                })}
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={Object.keys(patch).length === 0}
                  onClick={() => setPatch({})}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs flex-1"
                  disabled={Object.keys(patch).length === 0 || upd.isPending}
                  onClick={() => upd.mutate(patch)}
                >
                  Save {Object.keys(patch).length > 0 ? `(${Object.keys(patch).length})` : ""} for {label.split("@")[0]}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

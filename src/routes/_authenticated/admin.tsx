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
    onError: (e) => toast.error(e instanceof Error ? e.message,message : "Failed"),
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
          {u.map((x) => (
            <UserPlanRow
              key={x.id}
              user={x}
              onSave={(tier) =>
                setPlan.mutate({
                  userId: x.id,
                  tier,
                  days: tier === "free" ? 0 : 36500,
                })
              }
              saving={setPlan.isPending}
            />
          ))}
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

type AdminUser = {
  id: string;
  email: string | null;
  tier: PlanTier;
  planSource: string;
  planExpires: string | null;
  mode: string | null;
  isRunning: boolean;
  roles: string[];
  tradesToday: number;
};

function UserPlanRow({
  user,
  onSave,
  saving,
}: {
  user: AdminUser;
  onSave: (tier: PlanTier) => void;
  saving: boolean;
}) {
  const [pending, setPending] = useState<PlanTier>(user.tier);
  const dirty = pending !== user.tier;
  return (
    <div className="rounded-xl border bg-card p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium truncate">{user.email ?? user.id.slice(0, 8)}</p>
          <p className="text-xs text-muted-foreground">
            {PLAN_NAME[user.tier]} · {user.planSource}
            {user.planExpires
              ? ` · until ${new Date(user.planExpires).toLocaleDateString()}`
              : ""}
            {user.roles.includes("admin") ? " · admin" : ""}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Bot {user.isRunning ? "🟢 running" : "⚪ stopped"} · {user.mode ?? "—"} ·{" "}
            {user.tradesToday} trades today
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Select value={pending} onValueChange={(t) => setPending(t as PlanTier)}>
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue placeholder="Set plan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="reco">Insights</SelectItem>
              <SelectItem value="auto5">Auto-Trader</SelectItem>
              <SelectItem value="unlimited">Unlimited (∞)</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-8 px-3 text-xs"
            disabled={!dirty || saving}
            onClick={() => onSave(pending)}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

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
import { ChevronLeft, Copy } from "lucide-react";
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
  head: () => ({ meta: [{ title: "Admin — EarnO" }] }),
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
                <Select
                  onValueChange={(t) =>
                    setPlan.mutate({
                      userId: x.id,
                      tier: t as PlanTier,
                      days: t === "free" ? 0 : 36500,
                    })
                  }
                >
                  <SelectTrigger className="w-32 h-8 text-xs shrink-0">
                    <SelectValue placeholder="Set plan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="reco">Insights</SelectItem>
                    <SelectItem value="auto5">Auto-Trader</SelectItem>
                    <SelectItem value="unlimited">Unlimited (∞)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
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

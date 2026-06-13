import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, Check, Ticket, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getMyEntitlements, redeemCoupon } from "@/lib/plans.functions";
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
} from "@/lib/razorpay.functions";
import {
  PLAN_FEATURES,
  PLAN_NAME,
  PLAN_PRICE_INR,
  type PlanTier,
} from "@/lib/plans";

export const Route = createFileRoute("/_authenticated/upgrade")({
  head: () => ({ meta: [{ title: "Upgrade — EarnO" }] }),
  component: UpgradePage,
});

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (r: unknown) => void) => void;
    };
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

function UpgradePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const entFn = useServerFn(getMyEntitlements);
  const orderFn = useServerFn(createRazorpayOrder);
  const verifyFn = useServerFn(verifyRazorpayPayment);
  const couponFn = useServerFn(redeemCoupon);

  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => entFn() });
  const [busy, setBusy] = useState<PlanTier | null>(null);
  const [code, setCode] = useState("");

  const startCheckout = async (tier: Exclude<PlanTier, "free">) => {
    try {
      setBusy(tier);
      const ok = await loadRazorpayScript();
      if (!ok) throw new Error("Could not load Razorpay checkout");
      const order = await orderFn({ data: { tier } });
      if (!window.Razorpay) throw new Error("Razorpay unavailable");
      const rp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: "EarnO",
        description: `${PLAN_NAME[tier]} — 30 days`,
        theme: { color: "#3b82f6" },
        handler: async (res: unknown) => {
          const r = res as {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          };
          try {
            const v = await verifyFn({ data: { ...r, tier } });
            toast.success(
              `${PLAN_NAME[tier]} active until ${new Date(v.expires_at).toLocaleDateString()}`,
            );
            qc.invalidateQueries({ queryKey: ["entitlements"] });
            navigate({ to: "/" });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Verification failed");
          }
        },
        modal: { ondismiss: () => setBusy(null) },
      });
      rp.on("payment.failed", (r: unknown) => {
        const err = (r as { error?: { description?: string } })?.error?.description;
        toast.error(err ?? "Payment failed");
        setBusy(null);
      });
      rp.open();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start payment");
      setBusy(null);
    }
  };

  const redeem = useMutation({
    mutationFn: () => couponFn({ data: { code } }),
    onSuccess: (r) => {
      toast.success(
        `Activated ${PLAN_NAME[r.tier]} until ${new Date(r.expires_at).toLocaleDateString()}`,
      );
      setCode("");
      qc.invalidateQueries({ queryKey: ["entitlements"] });
      navigate({ to: "/" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not redeem"),
  });

  const currentTier = ent.data?.tier ?? "free";
  const expires = ent.data?.plan?.expires_at;
  const tiers: Exclude<PlanTier, "free">[] = ["reco", "auto5", "unlimited"];

  return (
    <div className="min-h-svh bg-background pb-16">
      <header className="px-5 pt-6 pb-4 flex items-center gap-2">
        <Link
          to="/"
          className="size-9 grid place-items-center rounded-full hover:bg-muted -ml-2"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Choose your plan</h1>
          <p className="text-xs text-muted-foreground">
            Current:{" "}
            <span className="text-foreground font-medium">{PLAN_NAME[currentTier]}</span>
            {expires ? ` · until ${new Date(expires).toLocaleDateString()}` : ""}
          </p>
        </div>
      </header>

      <div className="px-5 space-y-3">
        {tiers.map((t) => {
          const isCurrent = currentTier === t;
          return (
            <div
              key={t}
              className={`rounded-2xl border bg-card p-4 ${isCurrent ? "border-primary" : ""}`}
            >
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{PLAN_NAME[t]}</p>
                  <p className="text-2xl font-semibold tracking-tight">
                    ₹{PLAN_PRICE_INR[t]}
                    <span className="text-xs text-muted-foreground font-normal">
                      /month
                    </span>
                  </p>
                </div>
                {isCurrent ? (
                  <span className="text-[11px] px-2 h-6 inline-flex items-center rounded-full bg-primary/10 text-primary">
                    Current
                  </span>
                ) : null}
              </div>
              <ul className="mt-3 space-y-1.5">
                {PLAN_FEATURES[t].map((f) => (
                  <li key={f} className="text-sm flex gap-2">
                    <Check className="size-4 text-primary mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                className="w-full mt-4"
                disabled={busy !== null}
                onClick={() => startCheckout(t)}
              >
                {busy === t ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Opening Razorpay…
                  </>
                ) : isCurrent ? (
                  `Extend +30 days · ₹${PLAN_PRICE_INR[t]}`
                ) : (
                  `Subscribe · ₹${PLAN_PRICE_INR[t]}`
                )}
              </Button>
            </div>
          );
        })}

        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
            <Ticket className="size-3" /> Have a coupon?
          </p>
          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. EARNO99"
            />
            <Button
              onClick={() => redeem.mutate()}
              disabled={!code || redeem.isPending}
            >
              {redeem.isPending ? "…" : "Redeem"}
            </Button>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground px-1 pt-2">
          Payments processed by Razorpay (UPI / cards / netbanking). Plans last 30 days
          from activation. EarnO never custodies funds.
        </p>
      </div>
    </div>
  );
}

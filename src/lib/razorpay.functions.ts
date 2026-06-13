import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { PlanTier } from "./plans";

// Amount in paise (1 INR = 100 paise)
const PRICE_PAISE: Record<Exclude<PlanTier, "free">, number> = {
  reco: 9900,
  auto5: 49900,
  unlimited: 99900,
};

async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const createRazorpayOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ tier: z.enum(["reco", "auto5", "unlimited"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error(
        "Razorpay not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend secrets.",
      );
    }
    const amount = PRICE_PAISE[data.tier];
    const receipt = `earno_${data.tier}_${context.userId.slice(0, 8)}_${Date.now()}`.slice(
      0,
      40,
    );
    const auth = btoa(`${keyId}:${keySecret}`);
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt,
        notes: { user_id: context.userId, tier: data.tier },
      }),
    });
    const json = (await res.json()) as { id?: string; error?: { description?: string } };
    if (!res.ok || !json.id) {
      throw new Error(json?.error?.description ?? "Razorpay order creation failed");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("payment_orders").insert({
      order_id: json.id,
      user_id: context.userId,
      tier: data.tier,
      amount_paise: amount,
      status: "created",
    });
    return {
      orderId: json.id,
      amount,
      currency: "INR" as const,
      keyId,
      tier: data.tier,
    };
  });

export const verifyRazorpayPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        razorpay_order_id: z.string().min(8).max(64),
        razorpay_payment_id: z.string().min(8).max(64),
        razorpay_signature: z.string().min(16).max(256),
        // tier accepted for backwards compatibility but IGNORED — server derives tier from payment_orders
        tier: z.enum(["reco", "auto5", "unlimited"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) throw new Error("Razorpay not configured");
    const expected = await hmacSha256Hex(
      keySecret,
      `${data.razorpay_order_id}|${data.razorpay_payment_id}`,
    );
    if (!timingSafeEqual(expected, data.razorpay_signature)) {
      throw new Error("Signature mismatch — payment not verified");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Derive tier from the server-side order record — never trust the client.
    const { data: order, error: orderErr } = await supabaseAdmin
      .from("payment_orders")
      .select("tier,user_id,status")
      .eq("order_id", data.razorpay_order_id)
      .maybeSingle();
    if (orderErr || !order) throw new Error("Order not found");
    if (order.user_id !== context.userId) throw new Error("Order does not belong to caller");
    const tier = order.tier as "reco" | "auto5" | "unlimited" | "free";
    if (tier === "free") throw new Error("Invalid order tier");
    const paidTier = tier as "reco" | "auto5" | "unlimited";

    const { data: existing } = await supabaseAdmin
      .from("user_plans")
      .select("expires_at,tier")
      .eq("user_id", context.userId)
      .maybeSingle();
    const sameTierActive =
      existing?.tier === paidTier &&
      existing?.expires_at &&
      new Date(existing.expires_at) > new Date();
    const base = sameTierActive ? new Date(existing!.expires_at!) : new Date();
    const expires_at = new Date(base.getTime() + 30 * 86_400_000).toISOString();
    await supabaseAdmin.from("user_plans").upsert({
      user_id: context.userId,
      tier: paidTier,
      source: "razorpay",
      started_at: new Date().toISOString(),
      expires_at,
      status: "active",
    });
    await supabaseAdmin
      .from("payment_orders")
      .update({ status: "verified", verified_at: new Date().toISOString() })
      .eq("order_id", data.razorpay_order_id);
    return { ok: true, tier: paidTier, expires_at };
  });

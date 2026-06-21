import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { PlanTier } from "./plans";

type AnySupa = { rpc: (...a: unknown[]) => Promise<{ data: unknown }> };

async function assertAdmin(supabase: AnySupa, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Forbidden — admin only");
}

export const getMyEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [tierRes, adminRes, settingsRes, planRes] = await Promise.all([
      supabase.rpc("current_plan_tier", { _user_id: userId }),
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.from("app_settings").select("paywall_enabled").eq("id", 1).maybeSingle(),
      supabase
        .from("user_plans")
        .select("tier,status,source,expires_at,started_at")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    return {
      tier: ((tierRes.data as PlanTier | null) ?? "free") as PlanTier,
      isAdmin: !!adminRes.data,
      paywallEnabled: settingsRes.data?.paywall_enabled ?? true,
      plan: planRes.data ?? null,
    };
  });

export const redeemCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ code: z.string().trim().min(2).max(64) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = data.code.toUpperCase();
    const { data: c } = await supabaseAdmin
      .from("coupons")
      .select("*")
      .eq("code", code)
      .eq("active", true)
      .maybeSingle();
    if (!c) throw new Error("Invalid or inactive coupon");
    if (c.valid_until && new Date(c.valid_until) < new Date()) throw new Error("Coupon expired");
    if (c.max_uses != null && c.used_count >= c.max_uses)
      throw new Error("Coupon fully redeemed");
    const { data: prev } = await supabaseAdmin
      .from("coupon_redemptions")
      .select("id")
      .eq("coupon_id", c.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (prev) throw new Error("You've already used this coupon");
    const expires = new Date(Date.now() + c.duration_days * 86_400_000).toISOString();
    await supabaseAdmin
      .from("coupon_redemptions")
      .insert({ coupon_id: c.id, user_id: context.userId });
    await supabaseAdmin
      .from("coupons")
      .update({ used_count: c.used_count + 1 })
      .eq("id", c.id);
    await supabaseAdmin.from("user_plans").upsert({
      user_id: context.userId,
      tier: c.tier,
      source: "coupon",
      started_at: new Date().toISOString(),
      expires_at: expires,
      status: "active",
    });
    return { ok: true, tier: c.tier as PlanTier, expires_at: expires };
  });

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id,email,display_name,created_at,terms_accepted_at")
      .order("created_at", { ascending: false });
    const ids = (profiles ?? []).map((p) => p.id);
    const safeIds = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
    const [{ data: plans }, { data: cfgs }, { data: roles }, { data: tradesToday }] =
      await Promise.all([
        supabaseAdmin
          .from("user_plans")
          .select("user_id,tier,source,expires_at,status")
          .in("user_id", safeIds),
        supabaseAdmin
          .from("bot_config")
          .select("user_id,is_running,mode,auto_book")
          .in("user_id", safeIds),
        supabaseAdmin.from("user_roles").select("user_id,role").in("user_id", safeIds),
        supabaseAdmin
          .from("positions")
          .select("user_id")
          .in("user_id", safeIds)
          .gte("opened_at", new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString()),
      ]);
    const planMap = new Map((plans ?? []).map((p) => [p.user_id, p]));
    const cfgMap = new Map((cfgs ?? []).map((c) => [c.user_id, c]));
    const roleMap = new Map<string, string[]>();
    (roles ?? []).forEach((r) => {
      const a = roleMap.get(r.user_id) ?? [];
      a.push(r.role);
      roleMap.set(r.user_id, a);
    });
    const tradeMap = new Map<string, number>();
    (tradesToday ?? []).forEach((t) =>
      tradeMap.set(t.user_id, (tradeMap.get(t.user_id) ?? 0) + 1),
    );
    return (profiles ?? []).map((p) => ({
      id: p.id,
      email: p.email,
      name: p.display_name,
      createdAt: p.created_at,
      tier: (planMap.get(p.id)?.tier ?? "free") as PlanTier,
      planSource: planMap.get(p.id)?.source ?? "system",
      planExpires: planMap.get(p.id)?.expires_at ?? null,
      mode: cfgMap.get(p.id)?.mode ?? null,
      isRunning: cfgMap.get(p.id)?.is_running ?? false,
      autoBook: cfgMap.get(p.id)?.auto_book ?? false,
      roles: roleMap.get(p.id) ?? [],
      tradesToday: tradeMap.get(p.id) ?? 0,
    }));
  });

export const adminSetUserPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        userId: z.string().uuid(),
        tier: z.enum(["free", "reco", "auto5", "unlimited"]),
        days: z.number().int().min(0).max(36500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const expires =
      data.days && data.days > 0
        ? new Date(Date.now() + data.days * 86_400_000).toISOString()
        : null;
    await supabaseAdmin.from("user_plans").upsert({
      user_id: data.userId,
      tier: data.tier,
      source: "admin",
      started_at: new Date().toISOString(),
      expires_at: expires,
      status: "active",
    });
    return { ok: true };
  });

export const adminTogglePaywall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("app_settings")
      .update({
        paywall_enabled: data.enabled,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    return { ok: true };
  });

export const adminCreateCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        code: z
          .string()
          .trim()
          .min(3)
          .max(64)
          .regex(/^[A-Z0-9_-]+$/i),
        tier: z.enum(["reco", "auto5", "unlimited"]),
        durationDays: z.number().int().min(1).max(3650).default(30),
        maxUses: z.number().int().min(1).max(100_000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("coupons").insert({
      code: data.code.toUpperCase(),
      tier: data.tier,
      duration_days: data.durationDays,
      max_uses: data.maxUses ?? null,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListCoupons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("coupons")
      .select("*")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

export const adminListTrades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        status: z.enum(["all", "open", "closed"]).default("all"),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("positions")
      .select(
        "id,user_id,mode,symbol,side,leverage,entry_price,exit_price,mark_price,pnl,pnl_pct,status,exit_reason,opened_at,closed_at",
      )
      .order("opened_at", { ascending: false })
      .limit(data.limit);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows } = await q;
    const ids = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    const safeIds = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id,email")
      .in("id", safeIds);
    const emailMap = new Map((profs ?? []).map((p) => [p.id, p.email]));
    return (rows ?? []).map((r) => ({ ...r, email: emailMap.get(r.user_id) ?? null }));
  });

export const adminListEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        level: z.enum(["all", "info", "signal", "trade", "warn", "error"]).default("all"),
        limit: z.number().int().min(1).max(500).default(150),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("bot_events")
      .select("id,user_id,level,message,meta,created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.level !== "all") q = q.eq("level", data.level);
    const { data: rows } = await q;
    const ids = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    const safeIds = ids.length ? ids : ["00000000-0000-0000-0000-000000000000"];
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id,email")
      .in("id", safeIds);
    const emailMap = new Map((profs ?? []).map((p) => [p.id, p.email]));
    return (rows ?? []).map((r) => ({ ...r, email: emailMap.get(r.user_id) ?? null }));
  });


const editableCfgSchema = z.object({
  is_running: z.boolean().optional(),
  auto_book: z.boolean().optional(),
  mode: z.enum(["paper", "live"]).optional(),
  trading_style: z.enum(["conservative", "balanced", "aggressive"]).optional(),
  allow_long: z.boolean().optional(),
  allow_short: z.boolean().optional(),
  leverage: z.number().int().min(1).max(50).optional(),
  risk_per_trade_pct: z.number().min(0).max(100).optional(),
  max_open_positions: z.number().int().min(0).max(50).optional(),
  max_trades_per_day: z.number().int().min(0).max(1000).optional(),
  cooldown_minutes: z.number().int().min(0).max(1440).optional(),
  auto_close_minutes: z.number().int().min(0).max(1440).optional(),
  daily_loss_cap_pct: z.number().min(0).max(100).optional(),
  min_scalp_score: z.number().min(0).max(100).optional(),
  auto_book_confidence_threshold: z.number().min(0).max(100).optional(),
  display_confidence_threshold: z.number().min(0).max(100).optional(),
  atr_multiplier: z.number().min(0).max(10).optional(),
  target_multiplier: z.number().min(0).max(20).optional(),
  min_rr: z.number().min(0).max(20).optional(),
  min_sl_pct: z.number().min(0).max(50).optional(),
  max_auto_sl_pct: z.number().min(0).max(50).optional(),
  stop_loss_pct: z.number().min(0).max(50).optional(),
  take_profit_pct: z.number().min(0).max(100).optional(),
  move_to_breakeven: z.boolean().optional(),
  trailing_enabled: z.boolean().optional(),
  regime_filter_enabled: z.boolean().optional(),
  symbol_blacklist_threshold: z.number().int().min(0).max(20).optional(),
  symbol_sl_cooldown_minutes: z.number().int().min(0).max(10080).optional(),
});

export const adminGetUserConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("bot_config")
      .select("*")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminUpdateUserConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ userId: z.string().uuid(), patch: editableCfgSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    if (Object.keys(data.patch).length === 0) return { ok: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("bot_config")
      .update({ ...data.patch, updated_at: new Date().toISOString() })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminCopyUserConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ fromUserId: z.string().uuid(), toUserId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: src, error: e1 } = await supabaseAdmin
      .from("bot_config")
      .select("*")
      .eq("user_id", data.fromUserId)
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!src) throw new Error("Source user has no config");
    const { user_id: _u, created_at: _c, updated_at: _up, ...patch } = src as Record<string, unknown>;
    const { error: e2 } = await supabaseAdmin
      .from("bot_config")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("user_id", data.toUserId);
    if (e2) throw new Error(e2.message);
    return { ok: true };
  });

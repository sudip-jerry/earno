import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const credsSchema = z.object({
  apiKey: z.string().trim().min(8).max(256),
  apiSecret: z.string().trim().min(8).max(512),
});

export const saveCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => credsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("api_credentials").upsert({
      user_id: context.userId,
      api_key: data.apiKey,
      api_secret: data.apiSecret,
      is_valid: false,
      last_checked_at: null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getCredentialStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("api_credentials")
      .select("api_key,is_valid,last_checked_at,updated_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data) return { hasCredentials: false as const };
    return {
      hasCredentials: true as const,
      keyPreview: `${data.api_key.slice(0, 4)}…${data.api_key.slice(-4)}`,
      isValid: data.is_valid,
      lastCheckedAt: data.last_checked_at,
    };
  });

export const testConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { coindcxAuthedPost } = await import("@/lib/coindcx.server");

    const { data: creds } = await supabaseAdmin
      .from("api_credentials")
      .select("api_key,api_secret")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (!creds) return { ok: false, error: "No credentials saved." };

    // Read-only balance check
    const result = await coindcxAuthedPost<Array<{ currency: string; balance: string }>>(
      "/exchange/v1/users/balances",
      creds.api_key,
      creds.api_secret,
    );

    const isValid = result.ok;
    await supabaseAdmin
      .from("api_credentials")
      .update({ is_valid: isValid, last_checked_at: new Date().toISOString() })
      .eq("user_id", context.userId);

    if (!result.ok) return { ok: false, error: result.error };

    const usdt = result.data.find((b) => b.currency === "USDT");
    return { ok: true, usdtBalance: usdt?.balance ?? "0" };
  });

const configSchema = z.object({
  mode: z.enum(["paper", "live"]).optional(),
  is_running: z.boolean().optional(),
  ema_fast: z.number().int().min(2).max(200).optional(),
  ema_slow: z.number().int().min(3).max(400).optional(),
  timeframe: z.enum(["1m", "3m", "5m", "15m", "1h", "4h"]).optional(),
  leverage: z.number().int().min(1).max(5).optional(),
  take_profit_pct: z.number().min(0.1).max(50).optional(),
  stop_loss_pct: z.number().min(0.1).max(50).optional(),
  trailing_enabled: z.boolean().optional(),
  risk_per_trade_pct: z.number().min(0.1).max(20).optional(),
  max_open_positions: z.number().int().min(1).max(10).optional(),
  daily_loss_cap_pct: z.number().min(0.5).max(50).optional(),
  scanner_top_n: z.number().int().min(1).max(20).optional(),
  allow_short: z.boolean().optional(),
  // Auto Book
  auto_book: z.boolean().optional(),
  strategy: z.enum(["vwap_pullback", "momentum_breakout"]).optional(),
  cooldown_minutes: z.number().int().min(0).max(240).optional(),
  max_trades_per_day: z.number().int().min(1).max(200).optional(),
  auto_close_minutes: z.number().int().min(1).max(720).optional(),
  move_to_breakeven: z.boolean().optional(),
  min_scalp_score: z.number().int().min(0).max(100).optional(),
});

export const updateConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => configSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Gate auto-trading features behind the user's plan.
    if (data.is_running === true || data.auto_book === true) {
      const [{ data: tier }, { data: settings }] = await Promise.all([
        supabase.rpc("current_plan_tier", { _user_id: context.userId }),
        supabase.from("app_settings").select("paywall_enabled").eq("id", 1).maybeSingle(),
      ]);
      const paywall = settings?.paywall_enabled ?? true;
      const allowed = tier === "auto5" || tier === "unlimited";
      if (paywall && !allowed) {
        throw new Error(
          "PAYMENT_REQUIRED: Upgrade to Auto-Trader or Unlimited to start the bot.",
        );
      }
    }
    const { error } = await supabase.from("bot_config").update(data).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const killAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("bot_config")
      .update({ is_running: false })
      .eq("user_id", context.userId);
    await supabaseAdmin
      .from("positions")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        exit_reason: "kill_switch",
      })
      .eq("user_id", context.userId)
      .eq("status", "open");
    await supabaseAdmin.from("bot_events").insert({
      user_id: context.userId,
      level: "warn",
      message: "Kill switch activated. All positions force-closed and bot stopped.",
    });
    return { ok: true };
  });

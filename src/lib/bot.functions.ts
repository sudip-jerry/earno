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
    if (error) { console.error("DB error", error); throw new Error("Operation failed. Please try again."); }
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

/** Returns available USDT in spot and futures wallets. Used by Live-mode allocation UI. */
export const getWalletBalances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { coindcxAuthedPost } = await import("@/lib/coindcx.server");

    const { data: creds } = await supabaseAdmin
      .from("api_credentials")
      .select("api_key,api_secret")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!creds) return { ok: false as const, error: "No CoinDCX credentials saved." };

    const [spotRes, futRes] = await Promise.all([
      coindcxAuthedPost<Array<{ currency: string; balance: string; locked_balance?: string }>>(
        "/exchange/v1/users/balances",
        creds.api_key,
        creds.api_secret,
      ),
      coindcxAuthedPost<Array<{ asset?: string; currency?: string; balance?: string; available_balance?: string }>>(
        "/exchange/v1/derivatives/futures/wallets",
        creds.api_key,
        creds.api_secret,
      ),
    ]);

    const spot = spotRes.ok
      ? Number((spotRes.data.find((b) => b.currency === "USDT")?.balance ?? "0")) || 0
      : 0;
    const futures = futRes.ok
      ? (() => {
          const row = (futRes.data ?? []).find(
            (b) => (b.asset ?? b.currency) === "USDT",
          );
          const v = row?.available_balance ?? row?.balance ?? "0";
          return Number(v) || 0;
        })()
      : 0;

    return {
      ok: true as const,
      spot,
      futures,
      spotError: spotRes.ok ? null : spotRes.error,
      futuresError: futRes.ok ? null : futRes.error,
    };
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
  // Volatility-adjusted risk preset
  trading_style: z.enum(["conservative", "balanced", "aggressive"]).optional(),
  min_sl_pct: z.number().min(0.1).max(20).optional(),
  atr_multiplier: z.number().min(0.5).max(5).optional(),
  max_auto_sl_pct: z.number().min(0.5).max(20).optional(),
  target_multiplier: z.number().min(0.5).max(10).optional(),
  min_rr: z.number().min(0.5).max(10).optional(),
  // Live-mode wallet allocation
  live_wallet_source: z.enum(["futures", "spot"]).optional(),
  live_allocation_mode: z.enum(["full", "amount", "percent"]).optional(),
  live_allocation_amount: z.number().min(0).max(10_000_000).optional(),
  live_allocation_pct: z.number().min(1).max(100).optional(),
  // Per-user symbol blocklist (full CoinDCX symbols like B-PHB_USDT)
  symbol_blocklist: z.array(z.string().min(1).max(40)).max(200).optional(),
});

export const updateConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => configSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Gate auto-trading features behind the user's plan.
    if (data.is_running === true || data.auto_book === true || data.mode === "live") {
      const [{ data: tier }, { data: settings }] = await Promise.all([
        supabase.rpc("current_plan_tier", { _user_id: context.userId }),
        supabase.from("app_settings").select("paywall_enabled").eq("id", 1).maybeSingle(),
      ]);
      const paywall = settings?.paywall_enabled ?? true;
      const allowed = tier === "auto5" || tier === "unlimited";
      if (paywall && !allowed) {
        throw new Error(
          "PAYMENT_REQUIRED: Upgrade to Auto-Trader or Unlimited to enable live mode.",
        );
      }
    }
    const { error } = await supabase.from("bot_config").update(data).eq("user_id", context.userId);
    if (error) { console.error("DB error", error); throw new Error("Operation failed. Please try again."); }
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

    // LIVE positions must be flattened on the EXCHANGE, not just in the DB —
    // a kill switch that closes rows while real exposure stays open is worse
    // than no kill switch. Rows whose live flatten fails stay open (and the
    // user sees it) rather than silently hiding exchange exposure.
    const { data: openRows } = await supabaseAdmin
      .from("positions")
      .select("id,symbol,side,qty,remaining_qty,mode")
      .eq("user_id", context.userId)
      .eq("status", "open");
    let flattenFailures = 0;
    for (const r of openRows ?? []) {
      if (r.mode === "live") {
        const { loadLiveCreds, placeLiveExit } = await import("@/lib/futures/live-execution.server");
        const creds = await loadLiveCreds(supabaseAdmin, context.userId);
        const remainQ = Number(r.remaining_qty ?? r.qty);
        const exec =
          creds && remainQ > 0
            ? await placeLiveExit({
                creds,
                symbol: r.symbol as string,
                side: r.side as "long" | "short",
                qty: remainQ,
              })
            : ({ ok: false as const, error: creds ? "zero qty" : "no API credentials" });
        if (!exec.ok) {
          flattenFailures++;
          await supabaseAdmin.from("bot_events").insert({
            user_id: context.userId,
            level: "error",
            message: `Kill switch: live flatten FAILED for ${r.symbol}: ${exec.error} — position left open, close it manually on CoinDCX`,
            meta: { kind: "kill_switch_flatten_failed", symbol: r.symbol, position_id: r.id },
          });
          continue;
        }
      }
      await supabaseAdmin
        .from("positions")
        .update({
          status: "closed",
          closed_at: new Date().toISOString(),
          exit_reason: "kill_switch",
        })
        .eq("id", r.id as string)
        .eq("status", "open");
    }
    await supabaseAdmin.from("bot_events").insert({
      user_id: context.userId,
      level: "warn",
      message: flattenFailures
        ? `Kill switch activated. Bot stopped; ${flattenFailures} live position(s) could NOT be flattened — close them manually.`
        : "Kill switch activated. All positions force-closed and bot stopped.",
    });
    return { ok: true, flatten_failures: flattenFailures };
  });

const MANUAL_TRIGGER_PREFIX = "Manual trigger:";

/** Manually run an auto-book + mark pass for the calling user. Throttled to once per minute. */
export const triggerMyAutoBookNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Throttle: at most one manual trigger per minute per user.
    const sinceIso = new Date(Date.now() - 60_000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("bot_events")
      .select("created_at")
      .eq("user_id", context.userId)
      .like("message", `${MANUAL_TRIGGER_PREFIX}%`)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1);
    if (recent && recent.length > 0) {
      const last = new Date(recent[0].created_at as string).getTime();
      const waitMs = Math.max(0, 60_000 - (Date.now() - last));
      throw new Error(
        `Manual trigger is limited to once per minute. Try again in ${Math.ceil(waitMs / 1000)}s.`,
      );
    }

    // Ensure the user actually has the bot configured to auto-book + running.
    const { data: cfg } = await supabaseAdmin
      .from("bot_config")
      .select("auto_book,is_running")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!cfg?.is_running || !cfg?.auto_book) {
      throw new Error("Start the bot first (auto-book must be running).");
    }

    await supabaseAdmin.from("bot_events").insert({
      user_id: context.userId,
      level: "info",
      message: `${MANUAL_TRIGGER_PREFIX} auto-book pass requested by user`,
    });

    const { runAutoBookPass, runMarkPass } = await import("@/lib/auto-book.server");
    const [book, mark] = await Promise.all([
      runAutoBookPass(supabaseAdmin, { userId: context.userId }),
      runMarkPass(supabaseAdmin, { userId: context.userId }),
    ]);
    return {
      ok: true,
      opened: book.opened,
      skipped: book.skipped,
      marked: mark.updated,
      closed: mark.closed,
    };
  });

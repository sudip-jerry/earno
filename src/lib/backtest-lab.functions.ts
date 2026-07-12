import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const filterSchema = z.object({
  sinceHours: z.number().int().min(1).max(24 * 60).optional(),
  limit: z.number().int().min(10).max(1500).optional(),
  side: z.enum(["long", "short"]).optional(),
});

const generateSchema = z.object({
  sinceHours: z.number().int().min(1).max(168).optional(),
  maxSymbols: z.number().int().min(1).max(30).optional(),
  tpPct: z.number().min(0.1).max(20).optional(),
  slPct: z.number().min(0.1).max(20).optional(),
  symbols: z.array(z.string()).max(30).optional(),
});

const moversSchema = z.object({
  sinceHours: z.number().int().min(1).max(168).optional(),
  minVolume: z.number().min(0).optional(),
  maxSymbols: z.number().int().min(1).max(40).optional(),
  moverGatePct: z.number().min(0).max(50).optional(),
  tpPct: z.number().min(0.1).max(20).optional(),
  slPct: z.number().min(0.1).max(20).optional(),
  side: z.enum(["long", "short", "both"]).optional(),
  shortRule: z.enum(["continuation", "exhaustion", "meanrev"]).optional(),
  gainerPct: z.number().min(0).max(100).optional(),
  symbols: z.array(z.string()).max(40).optional(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("Forbidden — admin only");
}

export const runFilterBacktest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => filterSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runManualEntryBacktest } = await import("@/lib/futures/manual-entry-backtest.server");
    const started = Date.now();
    const res = await runManualEntryBacktest(supabaseAdmin, {
      sinceHours: data.sinceHours,
      limit: data.limit,
      side: data.side ?? "long",
    });
    return { ...res, elapsedMs: Date.now() - started };
  });

export const runGenerateBacktest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => generateSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runManualEntryGeneration } = await import("@/lib/futures/manual-entry-backtest.server");
    const started = Date.now();
    const res = await runManualEntryGeneration(supabaseAdmin, data);
    return { ...res, elapsedMs: Date.now() - started };
  });

export const runMoversBacktest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => moversSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runMoversMomentumBacktest } = await import("@/lib/futures/manual-entry-backtest.server");
    const started = Date.now();
    const res = await runMoversMomentumBacktest(supabaseAdmin, data);
    return { ...res, elapsedMs: Date.now() - started };
  });

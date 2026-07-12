import { createFileRoute } from "@tanstack/react-router";

async function isAuthorized(request: Request): Promise<boolean> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  const envSecret = process.env.CRON_SECRET;
  if (envSecret && token === envSecret) return true;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.rpc("verify_cron_secret", { _token: token });
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Coin ENTRY-rule benchmark replay (analysis only — no DB writes, no live
 * behavior). Compares candidate entry logics (current climax shape, v2-for-
 * spot pullback, EMA cross, Donchian breakout) against null benchmarks
 * (random entries with identical exits, buy&hold) on real CoinDCX candles.
 * Candle fetches need CoinDCX reachability, so run this in the deployed
 * environment (the sandbox blocks it; drive via pg_net).
 *
 * POST body: { symbols: string[], sinceDays?, tpPct?, slPct?, maxHoldHours?,
 *              feeRoundTripPct?, randomRatePct? }
 */
export const Route = createFileRoute("/api/public/hooks/coin-entry-backtest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await isAuthorized(request))) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const mod = await import("@/lib/coin-bot/coin-entry-backtest.server");
          const result = await mod.runCoinEntryBacktest({
            symbols: Array.isArray(body.symbols) ? (body.symbols as string[]) : undefined,
            sinceDays: typeof body.sinceDays === "number" ? body.sinceDays : undefined,
            tpPct: typeof body.tpPct === "number" ? body.tpPct : undefined,
            slPct: typeof body.slPct === "number" ? body.slPct : undefined,
            maxHoldHours: typeof body.maxHoldHours === "number" ? body.maxHoldHours : undefined,
            feeRoundTripPct: typeof body.feeRoundTripPct === "number" ? body.feeRoundTripPct : undefined,
            randomRatePct: typeof body.randomRatePct === "number" ? body.randomRatePct : undefined,
            regimeGate: body.regimeGate === true,
          });
          return Response.json(result);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[coin-entry-backtest] failed", msg);
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

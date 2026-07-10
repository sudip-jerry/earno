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
 * Manual-entry FILTER backtest trigger. For real closed futures LONG trades,
 * refetches 30m + 1m candles at entry and compares rule-pass vs rule-fail
 * outcomes (win rate / profit factor / expectancy). Candle fetch needs CoinDCX
 * reachability, so run this in the deployed environment (sandbox blocks it).
 *
 * POST body (all optional): { sinceHours, limit }
 */
export const Route = createFileRoute("/api/public/hooks/manual-entry-backtest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await isAuthorized(request))) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const body = (await request.json().catch(() => ({}))) as {
            sinceHours?: number;
            limit?: number;
          };
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { runManualEntryBacktest } = await import(
            "@/lib/futures/manual-entry-backtest.server"
          );
          const result = await runManualEntryBacktest(supabaseAdmin, {
            sinceHours: body.sinceHours,
            limit: body.limit,
          });
          return Response.json(result);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[manual-entry-backtest] failed", msg);
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

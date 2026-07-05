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
 * Backtest harness trigger. Replays real futures trades over their true 1m
 * candle path under config-variant overrides and writes one backtest_runs row
 * per variant. Candle fetch needs CoinDCX reachability, so run this in the
 * deployed environment (sandbox blocks the fetch).
 *
 * POST body (all optional): { userId, symbol, sinceHours, limit, label }
 */
export const Route = createFileRoute("/api/public/hooks/backtest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await isAuthorized(request))) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const body = (await request.json().catch(() => ({}))) as {
            userId?: string;
            symbol?: string;
            sinceHours?: number;
            limit?: number;
            label?: string;
          };
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { runBacktest } = await import("@/lib/futures/backtest.server");
          const { summaries, scope } = await runBacktest(supabaseAdmin, {
            userId: body.userId,
            symbol: body.symbol,
            sinceHours: body.sinceHours,
            limit: body.limit,
            label: body.label,
          });
          // Return compact summaries (drop per-trade details from the response).
          const compact = summaries.map((s) => {
            const { details: _details, ...rest } = s;
            void _details;
            return rest;
          });
          return Response.json({ ok: true, scope, summaries: compact });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[backtest] failed", msg);
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

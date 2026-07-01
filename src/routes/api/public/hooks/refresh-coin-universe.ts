/**
 * Webhook: refresh-coin-universe
 * Called by cron job daily at 18:30 UTC (midnight IST).
 * Upserts all CoinDCX USDT spot pairs with their active/inactive status
 * into the coin_universe table, which the coin scanner reads at runtime.
 *
 * To seed on first deploy: POST /api/public/hooks/refresh-coin-universe
 * with Authorization: Bearer <CRON_SECRET>
 */
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

export const Route = createFileRoute("/api/public/hooks/refresh-coin-universe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await isAuthorized(request))) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { fetchActiveSpotSymbols, fetchFuturesTickers } = await import("@/services/coindcxPublicApi");

          // Get active symbols from market_details (via existing helper that uses correct endpoint)
          const activeSymbols = await fetchActiveSpotSymbols();

          // Get all known USDT symbols from ticker feed
          const tickers = await fetchFuturesTickers();
          const allSymbols = tickers
            .filter((t) => t.symbol.endsWith("_USDT"))
            .map((t) => t.symbol);

          if (allSymbols.length === 0) {
            throw new Error("Ticker feed returned no symbols");
          }

          // Build rows: active if in activeSymbols set, inactive otherwise
          // If activeSymbols is empty (fetchActiveSpotSymbols failed), mark all as active (fail-open)
          const failOpen = activeSymbols.size === 0;
          const rows = allSymbols.map((symbol) => ({
            symbol,
            status: failOpen || activeSymbols.has(symbol) ? "active" : "inactive",
            min_quantity: null,
            max_quantity: null,
            updated_at: new Date().toISOString(),
          }));

          const BATCH = 200;
          for (let i = 0; i < rows.length; i += BATCH) {
            const { error } = await supabaseAdmin
              .from("coin_universe")
              .upsert(rows.slice(i, i + BATCH), { onConflict: "symbol" });
            if (error) throw error;
          }

          console.log(`[refresh-coin-universe] upserted ${rows.length} symbols (${activeSymbols.size} active from market_details, failOpen=${failOpen})`);
          return Response.json({ ok: true, upserted: rows.length, active: activeSymbols.size, fail_open: failOpen });

        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[refresh-coin-universe] failed", msg);
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

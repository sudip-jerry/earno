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

          // Fetch all market statuses from CoinDCX market_details
          type MarketDetail = { pair?: string; status?: string; min_quantity?: number; max_quantity?: number };
          const raw = await fetch("https://api.coindcx.com/exchange/v1/market_details", {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(10000),
          });
          if (!raw.ok) throw new Error(`market_details HTTP ${raw.status}`);
          const markets = (await raw.json()) as MarketDetail[];

          if (!Array.isArray(markets) || markets.length === 0) {
            throw new Error("market_details returned empty or invalid response");
          }

          const rows = markets
            .filter((m) => m.pair && m.pair.endsWith("_USDT"))
            .map((m) => ({
              symbol: m.pair!,
              status: (m.status ?? "active").toLowerCase(),
              min_quantity: m.min_quantity ?? null,
              max_quantity: m.max_quantity ?? null,
              updated_at: new Date().toISOString(),
            }));

          const BATCH = 200;
          for (let i = 0; i < rows.length; i += BATCH) {
            const { error } = await supabaseAdmin
              .from("coin_universe")
              .upsert(rows.slice(i, i + BATCH), { onConflict: "symbol" });
            if (error) throw error;
          }

          console.log(`[refresh-coin-universe] upserted ${rows.length} symbols`);
          return Response.json({ ok: true, upserted: rows.length });
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

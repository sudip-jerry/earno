import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/auto-book")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (!secret) {
          return new Response(
            JSON.stringify({ ok: false, error: "CRON_SECRET not configured" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
        const auth = request.headers.get("authorization") ?? "";
        if (auth !== `Bearer ${secret}`) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { runAutoBookPass } = await import("@/lib/auto-book.server");
          const result = await runAutoBookPass(supabaseAdmin);
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[auto-book] failed", msg);
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

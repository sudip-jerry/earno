import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/auto-book")({
  server: {
    handlers: {
      POST: async () => {
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

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/mark-positions")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { runMarkPass } = await import("@/lib/auto-book.server");
          const result = await runMarkPass(supabaseAdmin);
          return Response.json({ ok: true, ...result });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[mark-positions] failed", msg);
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

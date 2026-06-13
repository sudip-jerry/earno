import { createFileRoute } from "@tanstack/react-router";

async function isAuthorized(request: Request): Promise<boolean> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  const envSecret = process.env.CRON_SECRET;
  if (envSecret && token === envSecret) return true;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .schema("vault" as never)
      .from("decrypted_secrets" as never)
      .select("decrypted_secret")
      .eq("name", "cron_secret")
      .maybeSingle();
    const vaultSecret = (data as { decrypted_secret?: string } | null)?.decrypted_secret;
    return !!vaultSecret && token === vaultSecret;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/hooks/auto-book")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await isAuthorized(request))) {
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

import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sb(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_dashboard_stats",
  title: "Get dashboard stats",
  description:
    "Return summary trading statistics for the signed-in user: open positions count, realized PnL totals, and recent activity from the futures bot.",
  inputSchema: {
    mode: z
      .enum(["paper", "live"])
      .optional()
      .describe("Which trading mode to summarize. Defaults to paper."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ mode }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = sb(ctx);
    const m = mode ?? "paper";
    const userId = ctx.getUserId();

    const [openRes, closedRes] = await Promise.all([
      supabase
        .from("positions")
        .select("id,symbol,side,entry_price,qty,pnl,opened_at")
        .eq("user_id", userId)
        .eq("mode", m)
        .eq("status", "open"),
      supabase
        .from("positions")
        .select("pnl,closed_at,exit_reason")
        .eq("user_id", userId)
        .eq("mode", m)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(200),
    ]);

    if (openRes.error) {
      return { content: [{ type: "text", text: openRes.error.message }], isError: true };
    }
    if (closedRes.error) {
      return { content: [{ type: "text", text: closedRes.error.message }], isError: true };
    }

    const closed = closedRes.data ?? [];
    const realized = closed.reduce((s, r) => s + (Number(r.pnl) || 0), 0);
    const wins = closed.filter((r) => Number(r.pnl) > 0).length;
    const summary = {
      mode: m,
      openPositions: openRes.data?.length ?? 0,
      closedTradesConsidered: closed.length,
      realizedPnlUsdt: Number(realized.toFixed(4)),
      winRatePct: closed.length ? Number(((wins / closed.length) * 100).toFixed(2)) : 0,
      open: openRes.data ?? [],
    };
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      structuredContent: summary,
    };
  },
});

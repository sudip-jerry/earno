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
  name: "list_recent_trades",
  title: "List recent trades",
  description:
    "List the signed-in user's most recent closed futures trades with symbol, side, PnL, and exit reason.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum number of trades to return. Defaults to 20."),
    mode: z.enum(["paper", "live"]).optional().describe("Trading mode. Defaults to paper."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, mode }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = sb(ctx);
    const { data, error } = await supabase
      .from("positions")
      .select("id,symbol,side,entry_price,exit_price,qty,pnl,opened_at,closed_at,exit_reason")
      .eq("user_id", ctx.getUserId())
      .eq("mode", mode ?? "paper")
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(limit ?? 20);

    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { trades: data ?? [] },
    };
  },
});

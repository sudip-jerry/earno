import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Lightweight signal times for the interactive futures Scanner, sourced from
 * the persisted `bot_signals` log. Reads only the 10 most recent bot signals
 * for the user and returns, per symbol, when it was last logged by a bot scan.
 * Symbols not in that set are labelled "manual" by the UI (an ad-hoc/live
 * refresh); manual scans are never persisted.
 */
const TOP_N = 10;

export type SignalAges = {
  /** symbol → most recent bot-scan time for it (ms epoch). */
  ages: Record<string, number>;
  /** Most recent bot scan time across all signals (ms epoch), or null if none. */
  lastScanAt: number | null;
};

export const getSignalAges = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SignalAges> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("bot_signals")
      .select("symbol, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(TOP_N);

    const rows = data ?? [];
    const lastScanAt = rows.length ? new Date(rows[0].created_at as string).getTime() : null;

    const ages: Record<string, number> = {};
    for (const r of rows) {
      const symbol = r.symbol as string;
      const ts = new Date(r.created_at as string).getTime();
      // rows are newest-first, so the first time we see a symbol is its latest.
      if (!(symbol in ages)) ages[symbol] = ts;
    }
    return { ages, lastScanAt };
  });

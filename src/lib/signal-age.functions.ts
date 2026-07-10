import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Real signal age for the interactive futures Scanner, sourced from the
 * persisted `bot_signals` log (the bot's own scans). For each symbol we
 * return the start of its CURRENT continuous streak — the same definition
 * the auto-book pass uses — so the age grows sensibly instead of resetting
 * to "just now" on every re-scan. Symbols with no recent bot signal simply
 * aren't in the map; the UI labels those "manual" (an ad-hoc/live refresh),
 * and manual scans are never persisted.
 */
const STREAK_GAP_MS = 5 * 60_000; // ~2 scan intervals

export type SignalAges = {
  /** symbol → start-of-current-streak ms epoch (current signal age = now − this). */
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
      .select("symbol, side_bias, created_at")
      .eq("user_id", context.userId)
      .gte("created_at", new Date(Date.now() - 4 * 3600_000).toISOString())
      .order("created_at", { ascending: false })
      // Cap the read: current streaks live in the newest rows, so this bounds
      // cost without affecting the ages we surface.
      .limit(6000);

    const rows = data ?? [];
    const lastScanAt = rows.length ? new Date(rows[0].created_at as string).getTime() : null;

    const bySymbol = new Map<string, Array<{ ts: number; side: string | null }>>();
    for (const r of rows) {
      const arr = bySymbol.get(r.symbol as string) ?? [];
      arr.push({
        ts: new Date(r.created_at as string).getTime(),
        side: (r.side_bias as string | null) ?? null,
      });
      bySymbol.set(r.symbol as string, arr);
    }

    const ages: Record<string, number> = {};
    for (const [symbol, streakRows] of bySymbol) {
      const head = streakRows[0]; // newest-first
      if (!head) continue;
      let streakStart = head.ts;
      let prevTs = head.ts;
      for (let i = 1; i < streakRows.length; i++) {
        const r = streakRows[i];
        if (r.side !== head.side) break;
        if (prevTs - r.ts > STREAK_GAP_MS) break;
        streakStart = r.ts;
        prevTs = r.ts;
      }
      ages[symbol] = streakStart;
    }
    return { ages, lastScanAt };
  });

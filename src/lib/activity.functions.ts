import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ActivityItem, ActivityMeta } from "@/lib/stats.functions";

/**
 * Lightweight, paginated feed of the user's bot activity.
 *
 * Kept separate from getDashboardStats so the activity list can load a small
 * first page and fetch more only when the user asks — instead of every screen
 * pulling a big slice inside the heavy 15s stats refetch.
 */
export const getRecentActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).max(2000).optional(),
      })
      .strict()
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const limit = data.limit ?? 8;
    const offset = data.offset ?? 0;
    const { data: rows, error } = await context.supabase
      .from("bot_events")
      .select("id,created_at,level,message,meta")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    const items: ActivityItem[] = (rows ?? []).map((e) => ({
      id: e.id as string,
      at: e.created_at as string,
      level: (e.level as ActivityItem["level"]) ?? "info",
      message: (e.message as string) ?? "",
      meta: (e.meta as ActivityMeta | null) ?? null,
    }));
    return { items, hasMore: items.length === limit };
  });

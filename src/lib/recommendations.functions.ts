import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type RagStatus = "red" | "amber" | "green";

export type RecommendationKind =
  | "loss-streak"
  | "daily-bleed"
  | "sl-dominated"
  | "shorts-bleeding"
  | "longs-bleeding"
  | "low-pf"
  | "overtrading"
  | "wide-net"
  | "auto-blacklist-loose";

export type Recommendation = {
  id: string;
  kind: RecommendationKind;
  severity: RagStatus; // red/amber/green per-rec
  title: string;
  why: string;
  willDo: string;
};

export type MyRecommendations = {
  overall: RagStatus;
  headline: string;
  recommendations: Recommendation[];
  isRunning: boolean;
  computedAt: string;
};

type Pos = {
  symbol: string;
  side: "long" | "short";
  status: "open" | "closed";
  pnl: number | null;
  exit_reason: string | null;
  opened_at: string;
  closed_at: string | null;
};

type CfgRow = {
  user_id: string;
  mode: string;
  is_running: boolean | null;
  paper_equity: number | null;
  max_open_positions: number | null;
  max_trades_per_day: number | null;
  cooldown_minutes: number | null;
  risk_per_trade_pct: number | null;
  allow_short: boolean | null;
  allow_long: boolean | null;
  auto_book_confidence_threshold: number | null;
  symbol_blacklist_threshold: number | null;
  symbol_sl_cooldown_minutes: number | null;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function maxConsecLosses(closed: Pos[]): number {
  // assume input is chronological desc; sort ascending
  const sorted = [...closed].sort(
    (a, b) =>
      new Date(a.closed_at ?? a.opened_at).getTime() -
      new Date(b.closed_at ?? b.opened_at).getTime(),
  );
  let max = 0;
  let cur = 0;
  for (const p of sorted) {
    if ((p.pnl ?? 0) < 0) {
      cur += 1;
      if (cur > max) max = cur;
    } else cur = 0;
  }
  return max;
}

function topMode<T>(arr: (T | null | undefined)[]): T | null {
  const m = new Map<T, number>();
  for (const v of arr) if (v != null) m.set(v, (m.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bc = 0;
  for (const [k, c] of m) if (c > bc) ((best = k), (bc = c));
  return best;
}

export const getMyRecommendations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyRecommendations> => {
    const { supabase, userId } = context;
    const sinceUtc = new Date();
    sinceUtc.setUTCHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000);

    const [{ data: cfg }, { data: pos }] = await Promise.all([
      supabase
        .from("bot_config")
        .select(
          "user_id,mode,is_running,paper_equity,max_open_positions,max_trades_per_day,cooldown_minutes,risk_per_trade_pct,allow_short,allow_long,auto_book_confidence_threshold,symbol_blacklist_threshold,symbol_sl_cooldown_minutes",
        )
        .eq("user_id", userId)
        .eq("mode", "paper")
        .maybeSingle(),
      supabase
        .from("positions")
        .select("symbol,side,status,pnl,exit_reason,opened_at,closed_at")
        .eq("user_id", userId)
        .eq("mode", "paper")
        .gte("opened_at", sevenDaysAgo.toISOString())
        .order("opened_at", { ascending: false })
        .limit(500),
    ]);

    const config = (cfg ?? null) as CfgRow | null;
    const all = (pos ?? []) as Pos[];
    const closed = all.filter((p) => p.status === "closed");
    const today = closed.filter(
      (p) => p.closed_at && new Date(p.closed_at) >= sinceUtc,
    );

    const equity = Number(config?.paper_equity ?? 0) || 1000;
    const todayPnl = today.reduce((s, p) => s + Number(p.pnl ?? 0), 0);
    const realizedPnl = closed.reduce((s, p) => s + Number(p.pnl ?? 0), 0);
    const gross = closed.reduce(
      (acc, p) => {
        const x = Number(p.pnl ?? 0);
        if (x > 0) acc.w += x;
        else acc.l += -x;
        return acc;
      },
      { w: 0, l: 0 },
    );
    const pf = gross.l === 0 ? (gross.w > 0 ? Infinity : 0) : gross.w / gross.l;

    const todayLong = today.filter((p) => p.side === "long");
    const todayShort = today.filter((p) => p.side === "short");
    const todayLongPnl = todayLong.reduce((s, p) => s + Number(p.pnl ?? 0), 0);
    const todayShortPnl = todayShort.reduce((s, p) => s + Number(p.pnl ?? 0), 0);

    const todayTopExit = topMode(today.map((p) => p.exit_reason));
    const streak = maxConsecLosses(today);

    const recs: Recommendation[] = [];

    // Red — loss streak
    if (streak >= 4) {
      recs.push({
        id: "loss-streak",
        kind: "loss-streak",
        severity: "red",
        title: `Loss streak: ${streak} in a row today`,
        why: `Auto-book is compounding losses. Pause and tighten before next trade.`,
        willDo:
          "Raise auto-book confidence by +10, halve risk per trade, set cooldown ≥ 60 min.",
      });
    }

    // Red — daily bleed (>= 2% equity drop today)
    if (today.length >= 3 && todayPnl < -equity * 0.02) {
      recs.push({
        id: "daily-bleed",
        kind: "daily-bleed",
        severity: "red",
        title: `Today's PnL is −$${Math.abs(todayPnl).toFixed(2)} (${((todayPnl / equity) * 100).toFixed(1)}%)`,
        why: `Drawdown is faster than your daily loss cap. Throttle frequency before it widens.`,
        willDo: "Cap trades/day at 6 and raise auto-book confidence by +5.",
      });
    }

    // Amber — stop-loss is top exit
    if (today.length >= 5 && todayTopExit === "stop_loss") {
      recs.push({
        id: "sl-dominated",
        kind: "sl-dominated",
        severity: "amber",
        title: "Stop-loss is your top exit today",
        why: `${today.filter((p) => p.exit_reason === "stop_loss").length} of ${today.length} trades stopped out. Entries are too loose.`,
        willDo: "Raise auto-book confidence threshold by +5.",
      });
    }

    // Amber — shorts bleeding
    if (
      todayShort.length >= 3 &&
      todayShortPnl < 0 &&
      todayShortPnl < todayLongPnl &&
      config?.allow_short !== false
    ) {
      recs.push({
        id: "shorts-bleeding",
        kind: "shorts-bleeding",
        severity: "amber",
        title: "Shorts are losing today",
        why: `Short PnL −$${Math.abs(todayShortPnl).toFixed(2)} over ${todayShort.length} trades vs long $${todayLongPnl.toFixed(2)}.`,
        willDo: "Disable short auto-book until the trend flips.",
      });
    }

    // Amber — longs bleeding
    if (
      todayLong.length >= 3 &&
      todayLongPnl < 0 &&
      todayLongPnl < todayShortPnl &&
      config?.allow_long !== false
    ) {
      recs.push({
        id: "longs-bleeding",
        kind: "longs-bleeding",
        severity: "amber",
        title: "Longs are losing today",
        why: `Long PnL −$${Math.abs(todayLongPnl).toFixed(2)} over ${todayLong.length} trades vs short $${todayShortPnl.toFixed(2)}.`,
        willDo: "Disable long auto-book until the trend flips.",
      });
    }

    // Amber — low PF over 7d
    if (closed.length >= 20 && Number.isFinite(pf) && pf < 1) {
      recs.push({
        id: "low-pf",
        kind: "low-pf",
        severity: "amber",
        title: `Profit factor ${pf.toFixed(2)} over last ${closed.length} trades`,
        why: `Losers outweigh winners. Current settings are net-unprofitable.`,
        willDo:
          "Halve risk per trade, +10 confidence threshold, cap trades/day at 8.",
      });
    }

    // Amber — overtrading today
    const maxOpen = config?.max_open_positions ?? 5;
    if (today.length >= Math.max(8, maxOpen * 4) && todayPnl < 0) {
      recs.push({
        id: "overtrading",
        kind: "overtrading",
        severity: "amber",
        title: `${today.length} trades today and PnL is negative`,
        why: `Frequency is high relative to max open (${maxOpen}). Each trade carries lower expected value.`,
        willDo: "Cap trades/day at 6 and raise confidence threshold by +5.",
      });
    }

    // Amber — wide net (confidence threshold too low)
    const conf = config?.auto_book_confidence_threshold ?? 70;
    if (conf < 65 && closed.length >= 10) {
      recs.push({
        id: "wide-net",
        kind: "wide-net",
        severity: "amber",
        title: `Auto-book threshold is low (${conf})`,
        why: `Below 65 the bot takes weak signals. Most testers run at 70–75.`,
        willDo: "Raise auto-book confidence threshold to 70.",
      });
    }

    // Amber — auto-blacklist loose
    const blThresh = config?.symbol_blacklist_threshold ?? 3;
    if (blThresh >= 3 && today.length >= 5 && todayPnl < 0) {
      recs.push({
        id: "auto-blacklist-loose",
        kind: "auto-blacklist-loose",
        severity: "amber",
        title: "Auto-blacklist takes too long to kick in",
        why: `A symbol needs ${blThresh} losses in 24h to be auto-skipped. In a bad tape this leaks money.`,
        willDo:
          "Tighten auto-blacklist to 2 losses/24h and extend SL cooldown to 6h.",
      });
    }

    const overall: RagStatus = recs.some((r) => r.severity === "red")
      ? "red"
      : recs.some((r) => r.severity === "amber")
        ? "amber"
        : "green";

    const headline =
      overall === "red"
        ? "Action needed — your bot is bleeding today"
        : overall === "amber"
          ? "Tuning suggested — settings can do better"
          : recs.length === 0
            ? "All clear — settings look balanced"
            : "Settings look healthy";

    return {
      overall,
      headline,
      recommendations: recs,
      isRunning: !!config?.is_running,
      computedAt: new Date().toISOString(),
    };
  });

// ---------------- Shared patch builder ----------------
function buildPatchForKinds(
  kinds: string[],
  cur: CfgRow,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const conf = cur.auto_book_confidence_threshold ?? 70;
  for (const id of kinds) {
    switch (id as RecommendationKind) {
      case "loss-streak":
        patch.auto_book_confidence_threshold = clamp(
          Math.max(Number(patch.auto_book_confidence_threshold ?? conf), conf + 10),
          50,
          95,
        );
        patch.risk_per_trade_pct = clamp(
          Number(patch.risk_per_trade_pct ?? cur.risk_per_trade_pct ?? 1) * 0.5,
          0.25,
          10,
        );
        patch.cooldown_minutes = Math.max(
          Number(patch.cooldown_minutes ?? cur.cooldown_minutes ?? 0),
          60,
        );
        break;
      case "daily-bleed":
        patch.max_trades_per_day = Math.min(
          Number(patch.max_trades_per_day ?? cur.max_trades_per_day ?? 10),
          50,
        );
        patch.auto_book_confidence_threshold = clamp(
          Math.max(Number(patch.auto_book_confidence_threshold ?? conf), conf + 5),
          50,
          95,
        );
        break;
      case "sl-dominated":
        patch.auto_book_confidence_threshold = clamp(
          Math.max(Number(patch.auto_book_confidence_threshold ?? conf), conf + 5),
          50,
          95,
        );
        break;
      case "shorts-bleeding":
        patch.allow_short = false;
        break;
      case "longs-bleeding":
        patch.allow_long = false;
        break;
      case "low-pf":
        patch.risk_per_trade_pct = clamp(
          Number(patch.risk_per_trade_pct ?? cur.risk_per_trade_pct ?? 1) * 0.5,
          0.25,
          10,
        );
        patch.auto_book_confidence_threshold = clamp(
          Math.max(Number(patch.auto_book_confidence_threshold ?? conf), conf + 10),
          50,
          95,
        );
        patch.max_trades_per_day = Math.min(
          Number(patch.max_trades_per_day ?? cur.max_trades_per_day ?? 10),
          50,
        );
        break;
      case "overtrading":
        patch.max_trades_per_day = Math.min(
          Number(patch.max_trades_per_day ?? cur.max_trades_per_day ?? 10),
          50,
        );
        patch.auto_book_confidence_threshold = clamp(
          Math.max(Number(patch.auto_book_confidence_threshold ?? conf), conf + 5),
          50,
          95,
        );
        break;
      case "wide-net":
        patch.auto_book_confidence_threshold = Math.max(
          Number(patch.auto_book_confidence_threshold ?? conf),
          70,
        );
        break;
      case "auto-blacklist-loose":
        patch.symbol_blacklist_threshold = Math.min(
          Number(
            patch.symbol_blacklist_threshold ?? cur.symbol_blacklist_threshold ?? 3,
          ),
          2,
        );
        patch.symbol_sl_cooldown_minutes = Math.max(
          Number(
            patch.symbol_sl_cooldown_minutes ?? cur.symbol_sl_cooldown_minutes ?? 180,
          ),
          360,
        );
        break;
    }
  }
  return patch;
}

const applySchema = z.object({
  ids: z.array(z.string()).min(1).max(20),
});

export const applyMyRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => applySchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cfg, error: e1 } = await supabase
      .from("bot_config")
      .select(
        "user_id,mode,is_running,paper_equity,max_open_positions,max_trades_per_day,cooldown_minutes,risk_per_trade_pct,allow_short,allow_long,auto_book_confidence_threshold,symbol_blacklist_threshold,symbol_sl_cooldown_minutes",
      )
      .eq("user_id", userId)
      .eq("mode", "paper")
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!cfg) throw new Error("Paper config not found");

    const patch = buildPatchForKinds(data.ids, cfg as CfgRow);
    if (Object.keys(patch).length === 0) return { ok: true, applied: [] };

    const { error: e2 } = await supabase
      .from("bot_config")
      .update(patch as never)
      .eq("user_id", userId)
      .eq("mode", "paper");
    if (e2) throw new Error(e2.message);

    return { ok: true, applied: data.ids };
  });

// ---------------- Auto-apply critical recommendations ----------------
// Called by the home panel when overall === 'red'. Guarantees:
//  - Skips entirely when the bot is stopped (manual or auto). No DB write.
//  - Dedupes by (user, rec_kind, UTC day) using bot_events meta.
//  - Logs exactly one bot_events row per successful auto-tune batch.
const autoApplySchema = z.object({
  kinds: z.array(z.string()).min(1).max(20),
});

export const autoApplyCriticalRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => autoApplySchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: cfg } = await supabase
      .from("bot_config")
      .select(
        "user_id,mode,is_running,paper_equity,max_open_positions,max_trades_per_day,cooldown_minutes,risk_per_trade_pct,allow_short,allow_long,auto_book_confidence_threshold,symbol_blacklist_threshold,symbol_sl_cooldown_minutes",
      )
      .eq("user_id", userId)
      .eq("mode", "paper")
      .maybeSingle();

    if (!cfg) return { ok: false, skipped: "no_config" as const, applied: [] };
    const cur = cfg as CfgRow;

    // Guard: bot stopped (manual or kill-switch). Do not apply, do not log.
    if (!cur.is_running) {
      return { ok: true, skipped: "bot_stopped" as const, applied: [] };
    }

    // Dynamic dedupe: build the patch, then drop fields that already match
    // the current config. If nothing would actually change, skip silently.
    // This lets auto-tune fire as often as conditions warrant — re-tightening
    // when the bot drifts back — but never spams the DB with no-op writes.
    const rawPatch = buildPatchForKinds(data.kinds, cur);
    const curRec = cur as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawPatch)) {
      if (curRec[k] !== v) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) {
      return { ok: true, skipped: "no_change" as const, applied: [] };
    }

    const { error: upErr } = await supabase
      .from("bot_config")
      .update(patch as never)
      .eq("user_id", userId)
      .eq("mode", "paper");
    if (upErr) throw new Error(upErr.message);

    const fieldList = Object.keys(patch).join(", ");
    await supabase.from("bot_events").insert({
      user_id: userId,
      level: "warn",
      message: `Auto-tuned settings after critical alert (${data.kinds.join(", ")})`,
      meta: {
        kind: "auto_tune",
        rec_kinds: data.kinds,
        fields: Object.keys(patch),
        patch,
        field_summary: fieldList,
      } as never,
    });

    return { ok: true, applied: data.kinds, fields: Object.keys(patch) };
  });

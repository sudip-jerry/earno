import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type AnySupa = { rpc: (...a: unknown[]) => Promise<{ data: unknown }> };

async function assertAdmin(supabase: AnySupa, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Forbidden — admin only");
}

type Pos = {
  user_id: string;
  symbol: string;
  side: "long" | "short";
  status: "open" | "closed";
  pnl: number | null;
  pnl_pct: number | null;
  exit_reason: string | null;
  opened_at: string;
  closed_at: string | null;
};

type Cfg = {
  user_id: string;
  mode: string;
  is_running: boolean;
  auto_book: boolean;
  atr_multiplier: number;
  target_multiplier: number;
  max_open_positions: number;
  auto_close_minutes: number;
  risk_per_trade_pct: number;
  min_scalp_score: number;
  allow_short: boolean;
  leverage: number;
  trading_style: string;
};

export type TuneSuggestion = {
  key: string;
  label: string;
  rationale: string;
  patch: Partial<Cfg>;
};

export type DayStats = {
  closed: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  avgPnlPct: number;
  bestTrade: number;
  worstTrade: number;
  longTrades: number;
  longWins: number;
  longPnl: number;
  longWinRate: number;
  shortTrades: number;
  shortWins: number;
  shortPnl: number;
  shortWinRate: number;
  topCloseReason: string | null;
};

export type TesterReport = {
  userId: string;
  email: string | null;
  name: string | null;
  closed: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnl: number;
  avgPnlPct: number;
  longPnl: number;
  shortPnl: number;
  longTrades: number;
  shortTrades: number;
  longWinRate: number;
  shortWinRate: number;
  avgHoldMinutes: number;
  maxDrawdown: number;
  profitFactor: number;
  settings: Cfg | null;
  today: DayStats;
  diagnosis: string[];
  diagnosisStage: "none" | "early" | "ready";
  suggestions: TuneSuggestion[];
};

function emptyDay(): DayStats {
  return {
    closed: 0, open: 0, wins: 0, losses: 0, winRate: 0, pnl: 0, avgPnlPct: 0,
    bestTrade: 0, worstTrade: 0,
    longTrades: 0, longWins: 0, longPnl: 0, longWinRate: 0,
    shortTrades: 0, shortWins: 0, shortPnl: 0, shortWinRate: 0,
    topCloseReason: null,
  };
}

function computeDayStats(positions: Pos[], sinceIso: string): DayStats {
  const since = new Date(sinceIso).getTime();
  const closedToday = positions.filter(
    (t) => t.status === "closed" && t.closed_at && new Date(t.closed_at).getTime() >= since,
  );
  const openedToday = positions.filter((t) => new Date(t.opened_at).getTime() >= since);
  if (closedToday.length === 0 && openedToday.length === 0) return emptyDay();
  const wins = closedToday.filter((t) => Number(t.pnl ?? 0) > 0).length;
  const losses = closedToday.filter((t) => Number(t.pnl ?? 0) < 0).length;
  const pnl = closedToday.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
  const avgPnlPct = closedToday.length
    ? closedToday.reduce((s, t) => s + Number(t.pnl_pct ?? 0), 0) / closedToday.length
    : 0;
  const longs = closedToday.filter((t) => t.side === "long");
  const shorts = closedToday.filter((t) => t.side === "short");
  const longWins = longs.filter((t) => Number(t.pnl ?? 0) > 0).length;
  const shortWins = shorts.filter((t) => Number(t.pnl ?? 0) > 0).length;
  const pnls = closedToday.map((t) => Number(t.pnl ?? 0));
  return {
    closed: closedToday.length,
    open: openedToday.filter((t) => t.status === "open").length,
    wins, losses,
    winRate: closedToday.length ? (wins / closedToday.length) * 100 : 0,
    pnl, avgPnlPct,
    bestTrade: pnls.length ? Math.max(...pnls) : 0,
    worstTrade: pnls.length ? Math.min(...pnls) : 0,
    longTrades: longs.length, longWins,
    longPnl: longs.reduce((s, t) => s + Number(t.pnl ?? 0), 0),
    longWinRate: longs.length ? (longWins / longs.length) * 100 : 0,
    shortTrades: shorts.length, shortWins,
    shortPnl: shorts.reduce((s, t) => s + Number(t.pnl ?? 0), 0),
    shortWinRate: shorts.length ? (shortWins / shorts.length) * 100 : 0,
    topCloseReason: topMode(closedToday.map((t) => t.exit_reason)),
  };
}

function profitFactor(closed: Pos[]): number {
  let gain = 0,
    loss = 0;
  for (const t of closed) {
    const p = Number(t.pnl ?? 0);
    if (p >= 0) gain += p;
    else loss += -p;
  }
  if (loss === 0) return gain > 0 ? Infinity : 0;
  return gain / loss;
}

function maxDrawdown(closed: Pos[]): number {
  // chronological order
  const sorted = [...closed].sort((a, b) =>
    (a.closed_at ?? "").localeCompare(b.closed_at ?? ""),
  );
  let peak = 0,
    cum = 0,
    dd = 0;
  for (const t of sorted) {
    cum += Number(t.pnl ?? 0);
    if (cum > peak) peak = cum;
    const draw = peak - cum;
    if (draw > dd) dd = draw;
  }
  return dd;
}

function topMode(arr: (string | null)[]): string | null {
  const m = new Map<string, number>();
  for (const v of arr) {
    if (!v) continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of m) if (n > bestN) ((best = k), (bestN = n));
  return best;
}

function buildDiagnosis(r: Omit<TesterReport, "diagnosis" | "diagnosisStage" | "suggestions">) {
  const out: string[] = [];
  const sugg: TuneSuggestion[] = [];
  if (!r.settings) return { diagnosis: out, suggestions: sugg };
  const s = r.settings;

  if (r.longTrades >= 5 && r.shortTrades >= 5) {
    const longAvg = r.longTrades ? r.longPnl / r.longTrades : 0;
    const shortAvg = r.shortTrades ? r.shortPnl / r.shortTrades : 0;
    if (longAvg < 0 && shortAvg > 0) {
      out.push("Long trades are underperforming.");
      out.push("Short trades are currently performing better.");
      sugg.push({
        key: "reduce-long",
        label: "Temporarily reduce long auto-booking",
        rationale: "Short side is outperforming in current sample.",
        patch: { allow_short: true },
      });
    } else if (shortAvg < 0 && longAvg > 0) {
      out.push("Short trades are underperforming.");
      sugg.push({
        key: "reduce-short",
        label: "Temporarily reduce short auto-booking",
        rationale: "Long side is outperforming in current sample.",
        patch: { allow_short: false },
      });
    }
  }

  if (r.winRate < 45 && s.atr_multiplier < 2.2) {
    out.push("Stop loss may be too tight.");
    sugg.push({
      key: "atr-up",
      label: "Increase ATR multiplier",
      rationale: "Low win rate often signals premature stop-outs.",
      patch: { atr_multiplier: Math.min(2.5, Number(s.atr_multiplier) + 0.3) },
    });
  }
  if (r.winRate > 65 && r.avgPnlPct < 0.5 && s.target_multiplier < 2.5) {
    out.push("Target may be too conservative.");
    sugg.push({
      key: "tgt-up",
      label: "Increase target multiplier",
      rationale: "High win rate but small wins — let winners run.",
      patch: { target_multiplier: Math.min(2.8, Number(s.target_multiplier) + 0.3) },
    });
  }
  if (s.max_open_positions <= 2 && r.closed > 50) {
    out.push("Max open positions may be limiting opportunity capture.");
    sugg.push({
      key: "mop-up",
      label: "Increase max open positions",
      rationale: "Low concurrency caps trade frequency.",
      patch: { max_open_positions: Math.min(5, s.max_open_positions + 1) },
    });
  }
  if (s.auto_close_minutes <= 60 && r.avgPnlPct < 0.4) {
    out.push("Auto-close may be too early.");
    sugg.push({
      key: "ac-up",
      label: "Extend auto-close window",
      rationale: "Trades may need more time to mature.",
      patch: { auto_close_minutes: Math.min(360, s.auto_close_minutes + 60) },
    });
  }
  if (r.maxDrawdown > Math.abs(r.realizedPnl) * 1.5 && s.risk_per_trade_pct > 0.75) {
    out.push("Risk per trade may be too high.");
    sugg.push({
      key: "risk-dn",
      label: "Reduce risk per trade",
      rationale: "Drawdown is large relative to net PnL.",
      patch: { risk_per_trade_pct: Math.max(0.5, Number(s.risk_per_trade_pct) - 0.5) },
    });
  }
  if (r.winRate < 40 && s.min_scalp_score < 70) {
    sugg.push({
      key: "score-up",
      label: "Increase minimum confidence",
      rationale: "Filter weaker signals to lift win rate.",
      patch: { min_scalp_score: Math.min(80, s.min_scalp_score + 10) },
    });
  }
  if (r.winRate > 70 && s.atr_multiplier > 1.6) {
    sugg.push({
      key: "atr-dn",
      label: "Reduce ATR multiplier",
      rationale: "Win rate is high — tighter stops may improve R:R.",
      patch: { atr_multiplier: Math.max(1.3, Number(s.atr_multiplier) - 0.2) },
    });
  }

  return { diagnosis: out, suggestions: sugg };
}

export const getBetaReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: profiles }, { data: positions }, { data: cfgs }, { data: skips }] =
      await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("id,email,display_name,created_at"),
        supabaseAdmin
          .from("positions")
          .select(
            "user_id,symbol,side,status,pnl,pnl_pct,exit_reason,opened_at,closed_at",
          )
          .eq("mode", "paper")
          .order("opened_at", { ascending: false })
          .limit(5000),
        supabaseAdmin.from("bot_config").select("*"),
        supabaseAdmin
          .from("bot_events")
          .select("user_id,message,meta,created_at")
          .eq("level", "signal")
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);

    const allPos = (positions ?? []) as Pos[];
    const cfgMap = new Map<string, Cfg>(((cfgs ?? []) as Cfg[]).map((c) => [c.user_id, c]));
    const byUser = new Map<string, Pos[]>();
    for (const p of allPos) {
      const a = byUser.get(p.user_id) ?? [];
      a.push(p);
      byUser.set(p.user_id, a);
    }

    const sinceIso = (() => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    })();

    const testers: TesterReport[] = [];
    for (const p of profiles ?? []) {
      const trades = byUser.get(p.id) ?? [];
      if (trades.length === 0 && !cfgMap.get(p.id)?.is_running) continue;
      const closed = trades.filter((t) => t.status === "closed");
      const wins = closed.filter((t) => Number(t.pnl ?? 0) > 0).length;
      const losses = closed.filter((t) => Number(t.pnl ?? 0) < 0).length;
      const realizedPnl = closed.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
      const avgPnlPct =
        closed.length === 0
          ? 0
          : closed.reduce((s, t) => s + Number(t.pnl_pct ?? 0), 0) / closed.length;
      const longs = closed.filter((t) => t.side === "long");
      const shorts = closed.filter((t) => t.side === "short");
      const longPnl = longs.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
      const shortPnl = shorts.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
      const longWins = longs.filter((t) => Number(t.pnl ?? 0) > 0).length;
      const shortWins = shorts.filter((t) => Number(t.pnl ?? 0) > 0).length;
      const avgHoldMs =
        closed.length === 0
          ? 0
          : closed.reduce((s, t) => {
              if (!t.closed_at) return s;
              return s + (new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime());
            }, 0) / closed.length;

      const base = {
        userId: p.id,
        email: p.email ?? null,
        name: p.display_name ?? null,
        closed: closed.length,
        wins,
        losses,
        winRate: closed.length ? (wins / closed.length) * 100 : 0,
        realizedPnl,
        avgPnlPct,
        longPnl,
        shortPnl,
        longTrades: longs.length,
        shortTrades: shorts.length,
        longWinRate: longs.length ? (longWins / longs.length) * 100 : 0,
        shortWinRate: shorts.length ? (shortWins / shorts.length) * 100 : 0,
        avgHoldMinutes: Math.round(avgHoldMs / 60_000),
        maxDrawdown: maxDrawdown(closed),
        profitFactor: profitFactor(closed),
        settings: cfgMap.get(p.id) ?? null,
        today: computeDayStats(trades, sinceIso),
      };
      const stage: TesterReport["diagnosisStage"] =
        closed.length < 30 ? "none" : closed.length <= 50 ? "early" : "ready";
      const { diagnosis, suggestions } =
        stage === "ready" ? buildDiagnosis(base) : { diagnosis: [], suggestions: [] };
      testers.push({ ...base, diagnosisStage: stage, diagnosis, suggestions });
    }


    testers.sort((a, b) => b.realizedPnl - a.realizedPnl);

    // Global aggregates
    const closedAll = allPos.filter((t) => t.status === "closed");
    const totalRealized = closedAll.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
    const longsAll = closedAll.filter((t) => t.side === "long");
    const shortsAll = closedAll.filter((t) => t.side === "short");
    const longPnlAll = longsAll.reduce((s, t) => s + Number(t.pnl ?? 0), 0);
    const shortPnlAll = shortsAll.reduce((s, t) => s + Number(t.pnl ?? 0), 0);

    const bySymbol = new Map<string, number>();
    for (const t of closedAll) {
      bySymbol.set(t.symbol, (bySymbol.get(t.symbol) ?? 0) + Number(t.pnl ?? 0));
    }
    let bestPair: string | null = null,
      worstPair: string | null = null,
      bestPairPnl = -Infinity,
      worstPairPnl = Infinity;
    for (const [s, p] of bySymbol) {
      if (p > bestPairPnl) ((bestPair = s), (bestPairPnl = p));
      if (p < worstPairPnl) ((worstPair = s), (worstPairPnl = p));
    }

    const skipReasons = (skips ?? [])
      .map((e) => {
        const m = e.message ?? "";
        const idx = m.indexOf("skip");
        if (idx < 0) return null;
        return m.slice(idx, idx + 80);
      })
      .filter(Boolean) as string[];

    const todayGlobal = computeDayStats(allPos, sinceIso);
    const todayBySymbol = new Map<string, number>();
    const todayClosed = allPos.filter(
      (t) => t.status === "closed" && t.closed_at && new Date(t.closed_at).getTime() >= new Date(sinceIso).getTime(),
    );
    for (const t of todayClosed) {
      todayBySymbol.set(t.symbol, (todayBySymbol.get(t.symbol) ?? 0) + Number(t.pnl ?? 0));
    }
    let todayBestPair: string | null = null,
      todayWorstPair: string | null = null,
      tbp = -Infinity,
      twp = Infinity;
    for (const [s, p] of todayBySymbol) {
      if (p > tbp) ((todayBestPair = s), (tbp = p));
      if (p < twp) ((todayWorstPair = s), (twp = p));
    }
    const todayActiveTesters = testers.filter(
      (t) => t.today.closed > 0 || t.today.open > 0,
    ).length;

    return {
      testers,
      summary: {
        activeTesters: testers.filter((t) => t.settings?.is_running).length,
        totalTesters: testers.length,
        totalTrades: allPos.length,
        totalClosed: closedAll.length,
        totalRealized,
        avgWinRate:
          testers.length === 0
            ? 0
            : testers.reduce((s, t) => s + t.winRate, 0) / testers.length,
        avgProfitFactor:
          testers.length === 0
            ? 0
            : testers
                .map((t) => (Number.isFinite(t.profitFactor) ? t.profitFactor : 0))
                .reduce((s, n) => s + n, 0) / testers.length,
        avgMaxDrawdown:
          testers.length === 0
            ? 0
            : testers.reduce((s, t) => s + t.maxDrawdown, 0) / testers.length,
        bestTester: testers[0]
          ? { email: testers[0].email, pnl: testers[0].realizedPnl }
          : null,
        weakestTester:
          testers.length > 1
            ? {
                email: testers[testers.length - 1].email,
                pnl: testers[testers.length - 1].realizedPnl,
              }
            : null,
        bestDirection:
          longPnlAll === shortPnlAll
            ? null
            : longPnlAll > shortPnlAll
              ? "long"
              : "short",
        worstDirection:
          longPnlAll === shortPnlAll
            ? null
            : longPnlAll < shortPnlAll
              ? "long"
              : "short",
        longPnl: longPnlAll,
        shortPnl: shortPnlAll,
        bestPair,
        worstPair,
        topCloseReason: topMode(closedAll.map((t) => t.exit_reason)),
        topSkipReason: topMode(skipReasons),
        today: todayGlobal,
        todayActiveTesters,
        todayBestPair,
        todayWorstPair,
        todaySinceIso: sinceIso,
      },
    };
  });


const tunePatchSchema = z.object({
  userId: z.string().uuid(),
  patch: z
    .object({
      atr_multiplier: z.number().min(0.5).max(5).optional(),
      target_multiplier: z.number().min(0.5).max(5).optional(),
      max_open_positions: z.number().int().min(1).max(10).optional(),
      auto_close_minutes: z.number().int().min(5).max(720).optional(),
      risk_per_trade_pct: z.number().min(0.1).max(10).optional(),
      min_scalp_score: z.number().int().min(0).max(100).optional(),
      allow_short: z.boolean().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, "empty patch"),
});

export const adminApplyTune = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => tunePatchSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Only touch paper-mode config
    const { error } = await supabaseAdmin
      .from("bot_config")
      .update(data.patch)
      .eq("user_id", data.userId)
      .eq("mode", "paper");
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("bot_events").insert({
      user_id: data.userId,
      level: "info",
      message: `Admin applied tune: ${Object.keys(data.patch).join(", ")}`,
      meta: data.patch,
    });
    return { ok: true };
  });

// ---------- CSV exports (admin) ----------

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return `"${s.replace(/"/g, '""')}"`;
  }
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return (columns ?? []).join(",") + "\n";
  const cols = columns ?? Array.from(
    rows.reduce((set, r) => {
      Object.keys(r).forEach((k) => set.add(k));
      return set;
    }, new Set<string>()),
  );
  const head = cols.join(",");
  const body = rows
    .map((r) => cols.map((c) => csvCell(r[c])).join(","))
    .join("\n");
  return head + "\n" + body + "\n";
}

export const exportAllTradesCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: positions, error: e1 }, { data: profiles, error: e2 }] =
      await Promise.all([
        supabaseAdmin
          .from("positions")
          .select("*")
          .order("opened_at", { ascending: false })
          .limit(50000),
        supabaseAdmin.from("profiles").select("id,email,display_name"),
      ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const pMap = new Map<string, { email: string | null; name: string | null }>();
    for (const p of profiles ?? []) {
      pMap.set(p.id, { email: p.email ?? null, name: p.display_name ?? null });
    }

    const rows = (positions ?? []).map((t) => {
      const u = pMap.get(t.user_id);
      const opened = t.opened_at ? new Date(t.opened_at).getTime() : null;
      const closed = t.closed_at ? new Date(t.closed_at).getTime() : null;
      return {
        user_email: u?.email ?? "",
        user_name: u?.name ?? "",
        user_id: t.user_id,
        position_id: t.id,
        mode: t.mode,
        symbol: t.symbol,
        instrument: t.instrument ?? "",
        side: t.side,
        status: t.status,
        leverage: t.leverage,
        qty: t.qty,
        entry_price: t.entry_price,
        mark_price: t.mark_price ?? "",
        stop_loss: t.stop_loss ?? "",
        take_profit: t.take_profit ?? "",
        exit_price: t.exit_price ?? "",
        exit_reason: t.exit_reason ?? "",
        pnl: t.pnl ?? "",
        pnl_pct: t.pnl_pct ?? "",
        exchange_order_id: t.exchange_order_id ?? "",
        opened_at: t.opened_at,
        closed_at: t.closed_at ?? "",
        hold_minutes:
          opened && closed ? Math.round((closed - opened) / 60_000) : "",
        updated_at: t.updated_at,
      };
    });

    return { csv: toCsv(rows), count: rows.length };
  });

export const exportSignalsCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: events, error: e1 }, { data: profiles, error: e2 }] =
      await Promise.all([
        supabaseAdmin
          .from("bot_events")
          .select("*")
          .in("level", ["signal", "trade"])
          .order("created_at", { ascending: false })
          .limit(50000),
        supabaseAdmin.from("profiles").select("id,email,display_name"),
      ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const pMap = new Map<string, { email: string | null; name: string | null }>();
    for (const p of profiles ?? []) {
      pMap.set(p.id, { email: p.email ?? null, name: p.display_name ?? null });
    }

    const rows = (events ?? []).map((e) => {
      const u = pMap.get(e.user_id);
      return {
        created_at: e.created_at,
        user_email: u?.email ?? "",
        user_id: e.user_id,
        level: e.level,
        message: e.message,
        meta: e.meta ?? "",
        event_id: e.id,
      };
    });

    return { csv: toCsv(rows), count: rows.length };
  });

export const exportAlgoConfigsCsv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: cfgs, error: e1 }, { data: profiles, error: e2 }] =
      await Promise.all([
        supabaseAdmin.from("bot_config").select("*").order("updated_at", { ascending: false }),
        supabaseAdmin.from("profiles").select("id,email,display_name"),
      ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const pMap = new Map<string, { email: string | null; name: string | null }>();
    for (const p of profiles ?? []) {
      pMap.set(p.id, { email: p.email ?? null, name: p.display_name ?? null });
    }

    const rows = (cfgs ?? []).map((c) => ({
      user_email: pMap.get(c.user_id)?.email ?? "",
      user_name: pMap.get(c.user_id)?.name ?? "",
      ...c,
    }));

    return { csv: toCsv(rows), count: rows.length };
  });

export const getAlgoConfigsOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase as unknown as AnySupa, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: cfgs, error: e1 }, { data: profiles, error: e2 }, { data: tuneEvents }] =
      await Promise.all([
        supabaseAdmin.from("bot_config").select("*").order("updated_at", { ascending: false }),
        supabaseAdmin.from("profiles").select("id,email,display_name"),
        supabaseAdmin
          .from("bot_events")
          .select("user_id,message,meta,created_at")
          .ilike("message", "Admin applied tune%")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);

    const pMap = new Map<string, { email: string | null; name: string | null }>();
    for (const p of profiles ?? []) {
      pMap.set(p.id, { email: p.email ?? null, name: p.display_name ?? null });
    }

    return {
      configs: (cfgs ?? []).map((c) => ({
        user_id: c.user_id,
        user_email: pMap.get(c.user_id)?.email ?? null,
        user_name: pMap.get(c.user_id)?.name ?? null,
        mode: c.mode,
        is_running: c.is_running,
        trading_style: c.trading_style,
        atr_multiplier: Number(c.atr_multiplier),
        target_multiplier: Number(c.target_multiplier),
        min_rr: Number(c.min_rr),
        risk_per_trade_pct: Number(c.risk_per_trade_pct),
        max_open_positions: c.max_open_positions,
        max_trades_per_day: c.max_trades_per_day,
        auto_close_minutes: c.auto_close_minutes,
        min_scalp_score: c.min_scalp_score,
        allow_long: c.allow_long,
        allow_short: c.allow_short,
        leverage: c.leverage,
        cooldown_minutes: c.cooldown_minutes,
        daily_loss_cap_pct: Number(c.daily_loss_cap_pct),
        scan_interval_minutes: c.scan_interval_minutes,
        updated_at: c.updated_at,
      })),
      recentTunes: (tuneEvents ?? []).map((e) => ({
        user_email: pMap.get(e.user_id)?.email ?? null,
        user_id: e.user_id,
        message: e.message,
        meta: e.meta,
        created_at: e.created_at,
      })),
    };
  });

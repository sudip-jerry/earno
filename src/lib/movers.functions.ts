import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type Bias = "long" | "short" | "wait";
export type Action = "long" | "short" | "wait" | "avoid";
export type ConfidenceLabel = "High" | "Medium" | "Low" | "Avoid";
export type Tier = "auto" | "watch" | "weak" | "avoid";
export type ReasonLabel =
  | "Ready for auto-book"
  | "Waiting for pullback"
  | "Waiting for volume confirmation"
  | "Waiting for candle close"
  | "Overextended"
  | "Spread too wide"
  | "Choppy market"
  | "Low liquidity"
  | "Watching for setup";
export type SpreadTier = "tight" | "normal" | "wide";
export type VolumeTier = "low" | "ok" | "high";
export type TrendArrow = "up" | "down" | "flat" | "unknown";

export type CheckStatus = "pass" | "warn" | "fail";
export type Check = { label: string; status: CheckStatus };
export type ChecklistSections = {
  trend: Check[];
  entry: Check[];
  momentum: Check[];
  risk: Check[];
};

export type Mover = {
  symbol: string;
  display: string;
  price: number;
  change1m: number | null;
  change5m: number | null;
  change30mLast: number | null;
  change24h: number;
  rank24h: number;
  volume24h: number;
  // Scoring (internal — kept out of main UI)
  scalpScore: number; // 0-100
  bias: Bias;
  confidence: number; // 0-100 alias of scalpScore
  recommendation: "long" | "short" | "neutral";
  reasons: string[];
  trend30: TrendArrow | "mixed";
  // Scanner indicators (heuristic, internal)
  rsi: number | null;
  emaTrend: TrendArrow;
  vwapStatus: "above" | "below" | "unknown";
  vwapDistPct: number | null;
  spread: SpreadTier;
  volumeTier: VolumeTier;
  volumeSpike: boolean;
  eligible: boolean;
  rejectReason: string | null;
  // User-facing
  action: Action;
  confidenceLabel: ConfidenceLabel;
  shortReason: string;
  decisionSentence: string;
  checks: ChecklistSections;
  // New: tier + reason label
  tier: Tier;
  reasonLabel: ReasonLabel;
};

const PUBLIC_FUTURES_TICKER =
  "https://public.coindcx.com/market_data/v3/current_prices/futures/rt";
const CANDLES = (pair: string, interval: string, limit: number) =>
  `https://public.coindcx.com/market_data/candles?pair=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;
const PUBLIC_API_HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; EarnO/1.0; +https://earno.lovable.app)",
};

type TickerRow = {
  s?: string; pair?: string;
  c?: string | number; ls?: string | number;
  pc?: string | number; cp?: string | number;
  v?: string | number; qv?: string | number;
};

type Candle = { open: number; close: number; high: number; low: number; volume?: number };

function num(x: unknown, d = 0): number {
  const n = typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : d;
}

function prettySymbol(s: string): string {
  const m = s.match(/^B-([A-Z0-9]+)_([A-Z0-9]+)$/);
  return m ? `${m[1]}/${m[2]}` : s.replace(/^B-/, "").replace("_", "/");
}

async function fetchCandles(pair: string, interval: string, limit: number): Promise<Candle[] | null> {
  try {
    const res = await fetch(CANDLES(pair, interval, limit), {
      headers: PUBLIC_API_HEADERS,
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Candle[];
    if (!Array.isArray(json) || json.length < 1) return null;
    return json.map((k) => ({
      open: num(k.open),
      close: num(k.close),
      high: num(k.high),
      low: num(k.low),
      volume: k.volume != null ? num(k.volume) : undefined,
    }));
  } catch {
    return null;
  }
}

function pctChange(open: number, close: number): number | null {
  if (!open) return null;
  return ((close - open) / open) * 100;
}

function rsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= 14; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / 14;
  let avgL = losses / 14;
  for (let i = 15; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d >= 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * 13 + g) / 14;
    avgL = (avgL * 13 + l) / 14;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function approxVwap(c: Candle[]): number | null {
  if (!c.length) return null;
  let pv = 0;
  let v = 0;
  for (const k of c) {
    const tp = (k.high + k.low + k.close) / 3;
    const vol = k.volume ?? 1;
    pv += tp * vol;
    v += vol;
  }
  return v > 0 ? pv / v : null;
}

function classifyVolume(v: number): VolumeTier {
  if (v >= 100_000_000) return "high";
  if (v >= 5_000_000) return "ok";
  return "low";
}

function spreadFromVolume(tier: VolumeTier): SpreadTier {
  if (tier === "high") return "tight";
  if (tier === "ok") return "normal";
  return "wide";
}

type Signals = {
  c1m: number | null;
  c5m: number | null;
  c30m: Array<{ pct: number }> | null;
  c24h: number;
};

function computeRecommendation(s: Signals, market: "spot" | "futures") {
  const reasons: string[] = [];
  let score = 0;

  if (s.c1m != null) {
    if (s.c1m > 0.03) { score += 20; reasons.push(`1m burst +${s.c1m.toFixed(2)}%`); }
    else if (s.c1m < -0.03) { score -= 20; reasons.push(`1m drop ${s.c1m.toFixed(2)}%`); }
  }
  if (s.c5m != null) {
    if (s.c5m > 0.05) { score += 30; reasons.push(`5m up ${s.c5m.toFixed(2)}%`); }
    else if (s.c5m < -0.05) { score -= 30; reasons.push(`5m down ${s.c5m.toFixed(2)}%`); }
  }
  // Burst bonus: aligned 1m + 5m in same direction
  if (s.c1m != null && s.c5m != null && Math.sign(s.c1m) === Math.sign(s.c5m) && Math.abs(s.c1m) > 0.05 && Math.abs(s.c5m) > 0.1) {
    const dir = Math.sign(s.c1m);
    score += dir * 15;
    reasons.push(`${dir > 0 ? "Up" : "Down"} burst (1m+5m aligned)`);
  }

  let trend30: TrendArrow | "mixed" = "unknown";
  let last30: number | null = null;
  if (s.c30m && s.c30m.length >= 3) {
    const last3 = s.c30m.slice(-3);
    last30 = last3[last3.length - 1].pct;
    const ups = last3.filter((x) => x.pct > 0).length;
    const downs = last3.filter((x) => x.pct < 0).length;
    if (ups === 3) { trend30 = "up"; score += 25; reasons.push("30m: 3/3 green"); }
    else if (downs === 3) {
      trend30 = "down";
      const sharpLastDrop = last30 != null && last30 < -2.0;
      const reversing = (s.c1m ?? 0) > 0.05 && (s.c5m ?? 0) > 0.05;
      if (sharpLastDrop && reversing) { score += 20; reasons.push(`30m: 3 red but last ${last30.toFixed(2)}%, 1m/5m reversing — possible bounce`); }
      else { score -= 25; reasons.push("30m: 3/3 red (downtrend)"); }
    } else {
      trend30 = "mixed";
      score += (ups - downs) * 6;
      reasons.push(`30m mixed: ${ups}↑ ${downs}↓`);
    }
  }

  if (s.c24h > 5) { score += 10; reasons.push(`24h strong +${s.c24h.toFixed(1)}%`); }
  else if (s.c24h > 0) score += 5;
  else if (s.c24h < -5) { score -= 10; reasons.push(`24h weak ${s.c24h.toFixed(1)}%`); }

  let rec: "long" | "short" | "neutral";
  if (score >= 18) rec = "long";
  else if (score <= -18) rec = market === "spot" ? "neutral" : "short";
  else rec = "neutral";

  const confidence = Math.min(100, Math.round(Math.abs(score)));
  return { rec, confidence, reasons, trend30, last30 };
}

// ── User-facing derivation ─────────────────────────────────────────────────
function confidenceLabelFor(tier: Tier): ConfidenceLabel {
  if (tier === "auto") return "High";
  if (tier === "watch") return "Medium";
  if (tier === "weak") return "Low";
  return "Avoid";
}

function tierFor(confidence: number, bias: Bias, riskOk: boolean): Tier {
  if (bias === "wait" || confidence < 55) return "avoid";
  if (confidence >= 80 && riskOk) return "auto";
  if (confidence >= 65) return "watch";
  return "weak";
}

function actionForTier(tier: Tier, bias: Bias): Action {
  if (tier === "auto" && (bias === "long" || bias === "short")) return bias;
  if (tier === "avoid") return "avoid";
  return "wait";
}

type CheckInput = {
  bias: Bias;
  change1m: number | null;
  change5m: number | null;
  rsi: number | null;
  emaTrend: TrendArrow;
  vwapStatus: "above" | "below" | "unknown";
  vwapDistPct: number | null;
  spread: SpreadTier;
  volumeSpike: boolean;
  tpPct: number;
  slPct: number;
};

function buildChecks(ci: CheckInput): ChecklistSections {
  const dir = ci.bias === "long" ? 1 : ci.bias === "short" ? -1 : 0;

  const trendStatus = (val: number | null): CheckStatus => {
    if (val == null) return "warn";
    if (dir === 0) return "warn";
    if (Math.sign(val) === dir && Math.abs(val) >= 0.05) return "pass";
    if (Math.abs(val) < 0.05) return "warn";
    return "fail";
  };

  const emaStatus: CheckStatus =
    ci.emaTrend === "unknown" ? "warn"
      : dir === 0 ? "warn"
        : (ci.emaTrend === "up" && dir > 0) || (ci.emaTrend === "down" && dir < 0) ? "pass"
          : ci.emaTrend === "flat" ? "warn"
            : "fail";

  const vwapAlign: CheckStatus =
    ci.vwapStatus === "unknown" || dir === 0 ? "warn"
      : (ci.vwapStatus === "above" && dir > 0) || (ci.vwapStatus === "below" && dir < 0) ? "pass"
        : "fail";

  const trend: Check[] = [
    { label: `5m trend ${ci.bias === "short" ? "bearish" : "bullish"}`, status: trendStatus(ci.change5m) },
    { label: "EMA alignment", status: emaStatus },
    { label: `Price ${ci.vwapStatus === "unknown" ? "vs VWAP" : ci.vwapStatus + " VWAP"}`, status: vwapAlign },
  ];

  // Entry quality
  const pullback: CheckStatus =
    ci.vwapDistPct == null ? "warn"
      : Math.abs(ci.vwapDistPct) <= 0.3 ? "pass"
        : Math.abs(ci.vwapDistPct) <= 0.8 ? "warn"
          : "fail";

  const fairValue: CheckStatus =
    ci.vwapDistPct == null ? "warn"
      : Math.abs(ci.vwapDistPct) <= 1.0 ? "pass"
        : Math.abs(ci.vwapDistPct) <= 2.0 ? "warn"
          : "fail";

  const notOverextended: CheckStatus = (() => {
    if (ci.rsi == null) return "warn";
    if (ci.rsi >= 30 && ci.rsi <= 70) return "pass";
    if ((ci.rsi >= 25 && ci.rsi < 30) || (ci.rsi > 70 && ci.rsi <= 75)) return "warn";
    return "fail";
  })();

  const entry: Check[] = [
    { label: "Pullback near EMA21 / VWAP", status: pullback },
    { label: "Entry near fair value", status: fairValue },
    { label: "Not overextended", status: notOverextended },
  ];

  // Momentum
  const rsiIdeal: CheckStatus = (() => {
    if (ci.rsi == null) return "warn";
    if (dir > 0) {
      if (ci.rsi >= 45 && ci.rsi <= 65) return "pass";
      if (ci.rsi >= 35 && ci.rsi <= 75) return "warn";
      return "fail";
    }
    if (dir < 0) {
      if (ci.rsi >= 35 && ci.rsi <= 55) return "pass";
      if (ci.rsi >= 25 && ci.rsi <= 65) return "warn";
      return "fail";
    }
    return "warn";
  })();

  const candleStrength: CheckStatus = (() => {
    if (ci.change1m == null || dir === 0) return "warn";
    const aligned = Math.sign(ci.change1m) === dir;
    if (aligned && Math.abs(ci.change1m) >= 0.08) return "pass";
    if (Math.abs(ci.change1m) < 0.05) return "warn";
    return aligned ? "warn" : "fail";
  })();

  const momentum: Check[] = [
    { label: "RSI in ideal range", status: rsiIdeal },
    { label: "Volume spike present", status: ci.volumeSpike ? "pass" : "warn" },
    { label: "Candle strength valid", status: candleStrength },
  ];

  // Risk
  const spreadCheck: CheckStatus =
    ci.spread === "tight" ? "pass" : ci.spread === "normal" ? "warn" : "fail";
  const rr = ci.slPct > 0 ? ci.tpPct / ci.slPct : 0;
  const rrCheck: CheckStatus = rr >= 1.5 ? "pass" : rr >= 1 ? "warn" : "fail";

  const risk: Check[] = [
    { label: "Spread acceptable", status: spreadCheck },
    { label: "Stop loss valid", status: ci.slPct > 0 ? "pass" : "fail" },
    { label: "Target valid", status: ci.tpPct > 0 ? "pass" : "fail" },
    { label: `Risk-reward ${rr ? rr.toFixed(2) : "?"} : 1`, status: rrCheck },
  ];

  return { trend, entry, momentum, risk };
}

function decisionSentenceFor(
  action: Action,
  label: ConfidenceLabel,
  topReason: string,
): string {
  if (action === "long" || action === "short") {
    const word = action === "long" ? "Long" : "Short";
    return `${word} allowed because confidence is ${label} and required risk checks passed.`;
  }
  if (action === "avoid") {
    return `Avoid because ${topReason || "key risk checks failed"}.`;
  }
  return "Wait — no clean setup yet, keep watching.";
}

const SPOT_TICKER = "https://api.coindcx.com/exchange/ticker";
type SpotRow = { market: string; last_price: string; change_24_hour: string; volume: string };
const marketSchema = z.object({ market: z.enum(["spot", "futures"]).optional() });

async function enrichMover(
  base: { symbol: string; price: number; change24h: number; volume24h: number; rank24h: number },
  candlePair: string,
  market: "spot" | "futures",
  withCandles: boolean,
  tpPct: number,
  slPct: number,
): Promise<Mover> {
  const display = market === "spot" ? base.symbol.replace(/USDT$/, "/USDT") : prettySymbol(base.symbol);
  const volumeTier = classifyVolume(base.volume24h);
  const spread = spreadFromVolume(volumeTier);

  if (!withCandles) {
    const r = computeRecommendation({ c1m: null, c5m: null, c30m: null, c24h: base.change24h }, market);
    const bias: Bias = r.rec === "long" ? "long" : r.rec === "short" ? "short" : "wait";
    const eligible = false;
    const action = actionFor(bias, eligible);
    const confidenceLabel = confidenceLabelFor(r.confidence, eligible);
    const shortReason = r.reasons[0] ?? "Not enough data";
    const checks = buildChecks({
      bias, change1m: null, change5m: null, rsi: null,
      emaTrend: "unknown", vwapStatus: "unknown", vwapDistPct: null,
      spread, volumeSpike: false, tpPct, slPct,
    });
    return {
      ...base,
      display,
      change1m: null,
      change5m: null,
      change30mLast: r.last30,
      scalpScore: r.confidence,
      confidence: r.confidence,
      bias,
      recommendation: r.rec,
      reasons: r.reasons,
      trend30: r.trend30,
      rsi: null,
      emaTrend: "unknown",
      vwapStatus: "unknown",
      vwapDistPct: null,
      spread,
      volumeTier,
      volumeSpike: false,
      eligible,
      rejectReason: "Not enough data",
      action,
      confidenceLabel,
      shortReason,
      decisionSentence: decisionSentenceFor(action, confidenceLabel, shortReason),
      checks,
    };
  }

  const [c1Raw, c5Raw, c30Raw] = await Promise.all([
    fetchCandles(candlePair, "1m", 2),
    fetchCandles(candlePair, "5m", 20),
    fetchCandles(candlePair, "30m", 4),
  ]);

  const c1 = c1Raw && c1Raw.length ? pctChange(c1Raw[c1Raw.length - 1].open, c1Raw[c1Raw.length - 1].close) : null;
  const c5 = c5Raw && c5Raw.length ? pctChange(c5Raw[c5Raw.length - 1].open, c5Raw[c5Raw.length - 1].close) : null;
  const c30 = c30Raw ? c30Raw.map((k) => ({ pct: pctChange(k.open, k.close) ?? 0 })) : null;

  const closes5 = c5Raw?.map((k) => k.close) ?? [];
  const rsi = closes5.length >= 15 ? rsi14(closes5) : null;
  const vwap = c5Raw ? approxVwap(c5Raw) : null;
  const vwapStatus: Mover["vwapStatus"] = vwap == null ? "unknown" : base.price >= vwap ? "above" : "below";
  const vwapDistPct = vwap != null && vwap > 0 ? ((base.price - vwap) / vwap) * 100 : null;

  let emaTrend: TrendArrow = "unknown";
  if (c30 && c30.length >= 3) {
    const last3 = c30.slice(-3);
    const ups = last3.filter((x) => x.pct > 0).length;
    if (ups >= 2) emaTrend = "up";
    else if (ups <= 1) emaTrend = "down";
    else emaTrend = "flat";
  }

  let volumeSpike = false;
  if (c5Raw && c5Raw.length >= 11) {
    const last = c5Raw[c5Raw.length - 1].volume ?? 0;
    const prev = c5Raw.slice(-11, -1);
    const avg = prev.reduce((a, b) => a + (b.volume ?? 0), 0) / Math.max(prev.length, 1);
    volumeSpike = avg > 0 && last > avg * 1.8;
  }

  const r = computeRecommendation({ c1m: c1, c5m: c5, c30m: c30, c24h: base.change24h }, market);
  const bias: Bias = r.rec === "long" ? "long" : r.rec === "short" ? "short" : "wait";

  let rejectReason: string | null = null;
  const burstAligned = c1 != null && c5 != null && Math.sign(c1) === Math.sign(c5) && Math.abs(c5) > 0.1;
  if (r.confidence < 25) rejectReason = "Score too low";
  else if (volumeTier === "low" && !burstAligned) rejectReason = "Volume too thin";
  else if (rsi != null && bias === "long" && rsi > 82) rejectReason = "Overbought (RSI)";
  else if (rsi != null && bias === "short" && rsi < 18) rejectReason = "Oversold (RSI)";
  const eligible = rejectReason == null && bias !== "wait";

  const action = actionFor(bias, eligible);
  const confidenceLabel = confidenceLabelFor(r.confidence, eligible);
  const shortReason = rejectReason ?? r.reasons[0] ?? "Watching for confirmation";
  const checks = buildChecks({
    bias, change1m: c1, change5m: c5, rsi, emaTrend, vwapStatus, vwapDistPct,
    spread, volumeSpike, tpPct, slPct,
  });

  return {
    ...base,
    display,
    change1m: c1,
    change5m: c5,
    change30mLast: r.last30,
    scalpScore: r.confidence,
    confidence: r.confidence,
    bias,
    recommendation: r.rec,
    reasons: r.reasons,
    trend30: r.trend30,
    rsi,
    emaTrend,
    vwapStatus,
    vwapDistPct,
    spread,
    volumeTier,
    volumeSpike,
    eligible,
    rejectReason,
    action,
    confidenceLabel,
    shortReason,
    decisionSentence: decisionSentenceFor(action, confidenceLabel, shortReason),
    checks,
  };
}

function spotToCandlePair(market: string): string {
  const m = market.match(/^([A-Z0-9]+)USDT$/);
  return m ? `B-${m[1]}_USDT` : market;
}

export const getTopMovers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => marketSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<{ ok: true; movers: Mover[] } | { ok: false; error: string }> => {
    const market = data.market ?? "futures";
    // Pull trade params for risk-check enrichment (best-effort; fall back to sane defaults).
    let tpPct = 0.6;
    let slPct = 0.4;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: cfg } = await supabaseAdmin
        .from("bot_config")
        .select("take_profit_pct,stop_loss_pct")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (cfg) {
        tpPct = Number(cfg.take_profit_pct ?? tpPct);
        slPct = Number(cfg.stop_loss_pct ?? slPct);
      }
    } catch { /* keep defaults */ }

    try {
      if (market === "spot") {
        const res = await fetch(SPOT_TICKER, { headers: PUBLIC_API_HEADERS, signal: AbortSignal.timeout(6000) });
        if (!res.ok) return { ok: false, error: `Spot HTTP ${res.status}` };
        const raw = (await res.json()) as SpotRow[];
        const rows = raw
          .filter((r) => r.market && r.market.endsWith("USDT"))
          .map((r) => ({ symbol: r.market, price: num(r.last_price), change24h: num(r.change_24_hour), volume24h: num(r.volume) }))
          .filter((r) => r.price > 0);
        rows.sort((a, b) => b.change24h - a.change24h);
        const top = rows.slice(0, 15).map((r, i) => ({ ...r, rank24h: i + 1 }));
        const enriched = await Promise.all(top.map((r, i) => enrichMover(r, spotToCandlePair(r.symbol), "spot", i < 10, tpPct, slPct)));
        return { ok: true, movers: enriched };
      }

      const res = await fetch(PUBLIC_FUTURES_TICKER, { headers: PUBLIC_API_HEADERS, signal: AbortSignal.timeout(6000) });
      if (!res.ok) return { ok: false, error: `Ticker HTTP ${res.status}` };
      const raw = (await res.json()) as { prices: Record<string, TickerRow> } | Record<string, TickerRow> | TickerRow[];

      const rows: Array<{ symbol: string; price: number; change24h: number; volume24h: number }> = [];
      const consume = (sym: string | undefined, r: TickerRow) => {
        const symbol = sym ?? r.s ?? r.pair;
        if (!symbol || !symbol.startsWith("B-") || !symbol.endsWith("_USDT")) return;
        const price = num(r.ls ?? r.c);
        const change = num(r.cp ?? r.pc);
        const vol = num(r.qv ?? r.v);
        if (!price) return;
        rows.push({ symbol, price, change24h: change, volume24h: vol });
      };
      const dict = raw && typeof raw === "object" && !Array.isArray(raw) && "prices" in raw ? (raw as { prices: Record<string, TickerRow> }).prices : raw;
      if (Array.isArray(dict)) dict.forEach((r) => consume(undefined, r));
      else if (dict && typeof dict === "object") Object.entries(dict).forEach(([k, v]) => v && typeof v === "object" && consume(k, v as TickerRow));

      rows.sort((a, b) => b.change24h - a.change24h);
      const top = rows.slice(0, 20).map((r, i) => ({ ...r, rank24h: i + 1 }));
      const enriched = await Promise.all(top.map((r, i) => enrichMover(r, r.symbol, "futures", i < 12, tpPct, slPct)));
      return { ok: true, movers: enriched };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
    }
  });

const bookSchema = z.object({
  symbol: z.string().min(3).max(40).regex(/^[A-Z0-9_\-]+$/),
  side: z.enum(["long", "short"]),
  price: z.number().positive(),
  market: z.enum(["spot", "futures"]).optional(),
});

export const bookManualTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => bookSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: cfg, error: cfgErr } = await supabaseAdmin
      .from("bot_config")
      .select("mode,leverage,take_profit_pct,stop_loss_pct,risk_per_trade_pct,paper_equity,max_open_positions")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (cfgErr || !cfg) throw new Error(cfgErr?.message ?? "No bot config found");

    const { count } = await supabaseAdmin
      .from("positions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("status", "open");
    if ((count ?? 0) >= cfg.max_open_positions) {
      throw new Error(`Max open positions (${cfg.max_open_positions}) reached`);
    }

    const equity = Number(cfg.paper_equity ?? 0);
    const riskPct = Number(cfg.risk_per_trade_pct ?? 1);
    const lev = Number(cfg.leverage ?? 3);
    const sl = Number(cfg.stop_loss_pct ?? 2);
    const tp = Number(cfg.take_profit_pct ?? 3);

    const notional = Math.min((equity * riskPct) / sl, equity) * lev;
    const qty = notional / data.price;

    const stop_loss = data.side === "long" ? data.price * (1 - sl / 100) : data.price * (1 + sl / 100);
    const take_profit = data.side === "long" ? data.price * (1 + tp / 100) : data.price * (1 - tp / 100);

    const { error } = await supabaseAdmin.from("positions").insert({
      user_id: context.userId,
      mode: cfg.mode,
      symbol: data.symbol,
      side: data.side,
      leverage: lev,
      qty,
      entry_price: data.price,
      mark_price: data.price,
      stop_loss,
      take_profit,
      pnl: 0,
      pnl_pct: 0,
      status: "open",
      exchange_order_id: cfg.mode === "paper" ? `paper-manual-${Date.now()}` : null,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("bot_events").insert({
      user_id: context.userId,
      level: "info",
      message: `Manual ${data.side.toUpperCase()} on ${data.symbol} at ${data.price} (${cfg.mode})`,
    });

    return { ok: true };
  });

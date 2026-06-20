import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { atrPctFromCandles } from "@/lib/risk-engine";

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
  // Auto TP/SL derived from confidence (TP 3–5%, SL 20%)
  tpPct: number;
  slPct: number;
  /** ATR% (14-period over 5m candles); null when not enough data. */
  atrPct: number | null;
};

const PUBLIC_FUTURES_TICKER =
  "https://public.coindcx.com/market_data/v3/current_prices/futures/rt";
const CANDLES = (pair: string, interval: string, limit: number) =>
  `https://public.coindcx.com/market_data/candles?pair=${encodeURIComponent(pair)}&interval=${interval}&limit=${limit}`;
const PUBLIC_API_HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; Earn'O/1.0; +https://earno.lovable.app)",
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

function tierFor(confidence: number, bias: Bias, riskOk: boolean, autoConf: number): Tier {
  const watchConf = Math.max(40, autoConf - 10);
  const weakConf = Math.max(30, autoConf - 20);
  if (bias === "wait" || confidence < weakConf) return "avoid";
  if (confidence >= autoConf && riskOk) return "auto";
  if (confidence >= watchConf) return "watch";
  return "weak";
}

function actionForTier(tier: Tier, bias: Bias): Action {
  if (tier === "avoid") return "avoid";
  if (bias === "long" || bias === "short") return bias;
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
const marketSchema = z.object({
  market: z.enum(["spot", "futures"]).optional(),
  strictness: z.enum(["less", "moderate", "strict"]).optional(),
});

const STRICT_PRESETS: Record<"less" | "moderate" | "strict", StrictPreset> = {
  less:     { autoConf: 60, volRatio: 1.2, pullbackMaxPct: 0.5,  rrMin: 1.1 },
  moderate: { autoConf: 70, volRatio: 1.3, pullbackMaxPct: 0.35, rrMin: 1.2 },
  strict:   { autoConf: 80, volRatio: 1.5, pullbackMaxPct: 0.25, rrMin: 1.3 },
};

// Map context → reason label per spec.
function deriveReasonLabel(p: {
  tier: Tier;
  spreadTier: SpreadTier;
  volumeTier: VolumeTier;
  rsi: number | null;
  bias: Bias;
  volumeSpike: boolean;
  vwapDistPct: number | null;
  c1m: number | null;
  c5m: number | null;
  trend30: TrendArrow | "mixed";
}): ReasonLabel {
  if (p.tier === "auto") return "Ready for auto-book";
  // Hard blockers first
  if (p.spreadTier === "wide") return "Spread too wide";
  if (p.volumeTier === "low") return "Low liquidity";
  if (p.rsi != null) {
    if (p.bias === "long" && p.rsi > 74) return "Overextended";
    if (p.bias === "short" && p.rsi < 26) return "Overextended";
  }
  if (p.trend30 === "mixed" && (p.c5m == null || Math.abs(p.c5m) < 0.05)) return "Choppy market";
  // Watch/weak refinements
  if (!p.volumeSpike) return "Waiting for volume confirmation";
  if (p.vwapDistPct != null && Math.abs(p.vwapDistPct) > 0.25) return "Waiting for pullback";
  if (p.bias !== "wait" && p.c1m != null && Math.sign(p.c1m) !== (p.bias === "long" ? 1 : -1)) {
    return "Waiting for candle close";
  }
  return "Watching for setup";
}

type StrictPreset = { autoConf: number; volRatio: number; pullbackMaxPct: number; rrMin: number };

/**
 * Auto TP/SL derived from confidence: TP scales 3% (conf ≤ 50) → 5% (conf ≥ 100),
 * SL is a flat 20%. Users can override either at book time.
 */
export function autoTpSlForConfidence(confidence: number): { tpPct: number; slPct: number } {
  const c = Math.max(0, Math.min(100, confidence));
  const tpPct = +(3 + Math.max(0, c - 50) / 50 * 2).toFixed(2); // 3..5
  return { tpPct, slPct: 20 };
}

async function enrichMover(
  base: { symbol: string; price: number; change24h: number; volume24h: number; rank24h: number },
  candlePair: string,
  market: "spot" | "futures",
  withCandles: boolean,
  _tpPctIgnored: number,
  _slPctIgnored: number,
  preset: StrictPreset,
): Promise<Mover> {
  // Auto TP/SL is derived from confidence below; these are provisional defaults.
  let tpPct = 5;
  let slPct = 20;
  const display = market === "spot" ? base.symbol.replace(/USDT$/, "/USDT") : prettySymbol(base.symbol);
  const volumeTier = classifyVolume(base.volume24h);
  const spread = spreadFromVolume(volumeTier);

  if (!withCandles) {
    const r = computeRecommendation({ c1m: null, c5m: null, c30m: null, c24h: base.change24h }, market);
    const bias: Bias = r.rec === "long" ? "long" : r.rec === "short" ? "short" : "wait";
    ({ tpPct, slPct } = autoTpSlForConfidence(r.confidence));
    const tier: Tier = "avoid";
    const action = actionForTier(tier, bias);
    const confidenceLabel = confidenceLabelFor(tier);
    const shortReason = r.reasons[0] ?? "Not enough data";
    const checks = buildChecks({
      bias, change1m: null, change5m: null, rsi: null,
      emaTrend: "unknown", vwapStatus: "unknown", vwapDistPct: null,
      spread, volumeSpike: false, tpPct, slPct,
    });
    const reasonLabel = deriveReasonLabel({
      tier, spreadTier: spread, volumeTier, rsi: null, bias,
      volumeSpike: false, vwapDistPct: null, c1m: null, c5m: null, trend30: r.trend30,
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
      eligible: false,
      rejectReason: "Not enough data",
      action,
      confidenceLabel,
      shortReason,
      decisionSentence: decisionSentenceFor(action, confidenceLabel, shortReason),
      checks,
      tier,
      reasonLabel,
      tpPct,
      slPct,
      atrPct: null,
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
  const atrPct = c5Raw ? atrPctFromCandles(c5Raw, 14) : null;
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
  let volumeRatio = 0;
  if (c5Raw && c5Raw.length >= 11) {
    const last = c5Raw[c5Raw.length - 1].volume ?? 0;
    const prev = c5Raw.slice(-11, -1);
    const avg = prev.reduce((a, b) => a + (b.volume ?? 0), 0) / Math.max(prev.length, 1);
    volumeRatio = avg > 0 ? last / avg : 0;
    volumeSpike = volumeRatio >= 1.2; // display threshold
  }

  const r = computeRecommendation({ c1m: c1, c5m: c5, c30m: c30, c24h: base.change24h }, market);
  ({ tpPct, slPct } = autoTpSlForConfidence(r.confidence));
  const bias: Bias = r.rec === "long" ? "long" : r.rec === "short" ? "short" : "wait";

  // Watchlist allowance: 5m trend aligned with bias, 1m still forming.
  const fiveAligned = c5 != null && bias !== "wait" && Math.sign(c5) === (bias === "long" ? 1 : -1) && Math.abs(c5) >= 0.05;

  // Hard reject (Avoid tier) for fundamentally unworkable setups.
  let rejectReason: string | null = null;
  if (rsi != null && bias === "long" && rsi > 78) rejectReason = "Overbought (RSI)";
  else if (rsi != null && bias === "short" && rsi < 22) rejectReason = "Oversold (RSI)";
  // Liquidity hard floor — too thin even for watchlist
  else if (base.volume24h < 250_000) rejectReason = "Liquidity too low";

  // Strict risk-OK check for auto-book eligibility
  const rr = slPct > 0 ? tpPct / slPct : 0;
  const rsiOkForAuto =
    rsi == null
      ? true
      : bias === "long" ? rsi >= 50 && rsi <= 74
      : bias === "short" ? rsi >= 26 && rsi <= 50
      : true;
  const pullbackOkForAuto = vwapDistPct == null || Math.abs(vwapDistPct) <= preset.pullbackMaxPct;
  const riskOk =
    rejectReason == null &&
    bias !== "wait" &&
    spread !== "wide" &&
    volumeTier !== "low" &&
    rr >= preset.rrMin &&
    rsiOkForAuto &&
    pullbackOkForAuto &&
    volumeRatio >= preset.volRatio &&
    fiveAligned;

  const tier: Tier = rejectReason ? "avoid" : tierFor(r.confidence, bias, riskOk, preset.autoConf);
  const eligible = tier === "auto";
  const action = actionForTier(tier, bias);
  const confidenceLabel = confidenceLabelFor(tier);
  const reasonLabel = deriveReasonLabel({
    tier, spreadTier: spread, volumeTier, rsi, bias, volumeSpike,
    vwapDistPct, c1m: c1, c5m: c5, trend30: r.trend30,
  });
  const shortReason = rejectReason ?? reasonLabel;
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
    tier,
    reasonLabel,
    tpPct,
    slPct,
    atrPct,
  };
}

function spotToCandlePair(market: string): string {
  const m = market.match(/^([A-Z0-9]+)USDT$/);
  return m ? `B-${m[1]}_USDT` : market;
}

export const getTopMovers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => marketSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<{ ok: true; movers: Mover[]; risk: { capital: number; style: string; minSL: number; atrMult: number; maxAutoSL: number; targetMult: number; minRR: number; riskPct: number } } | { ok: false; error: string }> => {
    const market = data.market ?? "futures";
    const preset = STRICT_PRESETS[data.strictness ?? "moderate"];
    // Pull risk preset for the active user — used by the Scanner card to render
    // volatility-adjusted target / stop / position size / status.
    let stylePreset = (await import("@/lib/risk-engine")).STYLE_PRESETS.balanced;
    let capital = 1000;
    let tpPct = 0.6;
    let slPct = 0.4;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: cfg } = await supabaseAdmin
        .from("bot_config")
        .select("trading_style,min_sl_pct,atr_multiplier,max_auto_sl_pct,target_multiplier,min_rr,risk_per_trade_pct,paper_equity,take_profit_pct,stop_loss_pct")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (cfg) {
        const { presetFromConfig } = await import("@/lib/risk-engine");
        stylePreset = presetFromConfig(cfg);
        capital = Number(cfg.paper_equity ?? 1000);
        tpPct = Number(cfg.take_profit_pct ?? tpPct);
        slPct = Number(cfg.stop_loss_pct ?? slPct);
      }
    } catch { /* keep defaults */ }
    const riskSummary = {
      capital,
      style: stylePreset.key,
      minSL: stylePreset.minSL,
      atrMult: stylePreset.atrMult,
      maxAutoSL: stylePreset.maxAutoSL,
      targetMult: stylePreset.targetMult,
      minRR: stylePreset.minRR,
      riskPct: stylePreset.riskPct,
    };


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
        const enriched = await Promise.all(top.map((r, i) => enrichMover(r, spotToCandlePair(r.symbol), "spot", i < 10, tpPct, slPct, preset)));
        return { ok: true, movers: enriched, risk: riskSummary };
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

      // Hybrid universe: deepest pairs by volume PLUS biggest 24h movers
      // (abs change %) with a minimum 50M quote-volume liquidity gate so
      // small/mid-cap rockets aren't excluded by a pure volume ranking.
      const MIN_MOVER_VOLUME = 50_000_000;
      const byVolume = [...rows].sort((a, b) => b.volume24h - a.volume24h).slice(0, 30);
      const byChange = [...rows]
        .filter((r) => r.volume24h >= MIN_MOVER_VOLUME)
        .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
        .slice(0, 20);
      const seen = new Set<string>();
      const merged: typeof rows = [];
      for (const r of [...byVolume, ...byChange]) {
        if (seen.has(r.symbol)) continue;
        seen.add(r.symbol);
        merged.push(r);
      }
      const top = merged.map((r, i) => ({ ...r, rank24h: i + 1 }));
      const enriched = await Promise.all(top.map((r, i) => enrichMover(r, r.symbol, "futures", i < 30, tpPct, slPct, preset)));
      // Sort enriched output by confidence so highest setups surface first.
      enriched.sort((a, b) => b.confidence - a.confidence);
      return { ok: true, movers: enriched, risk: riskSummary };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
    }
  });

const bookSchema = z.object({
  symbol: z.string().min(3).max(40).regex(/^[A-Z0-9_\-]+$/),
  side: z.enum(["long", "short"]),
  price: z.number().positive(),
  market: z.enum(["spot", "futures"]).optional(),
  // Optional per-trade overrides. When omitted, auto values derived from confidence are used.
  confidence: z.number().min(0).max(100).optional(),
  tpPct: z.number().min(0.1).max(50).optional(),
  slPct: z.number().min(0.1).max(50).optional(),
});

export const bookManualTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => bookSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: cfg, error: cfgErr } = await supabaseAdmin
      .from("bot_config")
      .select("mode,leverage,risk_per_trade_pct,paper_equity,max_open_positions,trading_style,min_sl_pct,atr_multiplier,max_auto_sl_pct,target_multiplier,min_rr")
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
    const lev = Number(cfg.leverage ?? 3);
    const { presetFromConfig } = await import("@/lib/risk-engine");
    const style = presetFromConfig(cfg);
    // When user did not override, fall back to the preset floor (volatility-aware
    // values come from the Scanner card itself and are passed in via overrides).
    const sl = data.slPct ?? style.minSL;
    const tp = data.tpPct ?? +(sl * style.targetMult).toFixed(2);

    // Position size derived from max-loss, NOT leverage.
    const riskAmount = (equity * style.riskPct) / 100;
    const notional = sl > 0 ? riskAmount / (sl / 100) : 0;
    const qty = notional / data.price;


    const stop_loss = data.side === "long" ? data.price * (1 - sl / 100) : data.price * (1 + sl / 100);
    const take_profit = data.side === "long" ? data.price * (1 + tp / 100) : data.price * (1 - tp / 100);


    const instrument = data.market === "spot" ? "spot" : "futures";
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
      instrument,
      exchange_order_id: cfg.mode === "paper" ? `paper-manual-${Date.now()}` : null,
      source: "manual",
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("bot_events").insert({
      user_id: context.userId,
      level: "info",
      message: `Manual ${data.side.toUpperCase()} on ${data.symbol} at ${data.price} · TP ${tp}% / SL ${sl}% (${cfg.mode})`,
    });

    return { ok: true };
  });

const closeSchema = z.object({
  positionId: z.string().uuid(),
  limitPrice: z.number().positive().optional(),
});

export const closeManualTrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => closeSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: pos, error: posErr } = await supabaseAdmin
      .from("positions")
      .select("id,user_id,symbol,side,leverage,qty,entry_price,mark_price,status")
      .eq("id", data.positionId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (posErr || !pos) throw new Error(posErr?.message ?? "Position not found");
    if (pos.status !== "open") throw new Error("Position is not open");

    const exit = Number(data.limitPrice ?? pos.mark_price ?? pos.entry_price);
    const entry = Number(pos.entry_price);
    const qty = Number(pos.qty);
    const lev = Number(pos.leverage);
    const sideMul = pos.side === "long" ? 1 : -1;
    const pnl = (exit - entry) * qty * sideMul;
    const pnlPct = ((exit - entry) / entry) * 100 * sideMul * lev;

    const { error } = await supabaseAdmin
      .from("positions")
      .update({
        status: "closed",
        exit_price: exit,
        exit_reason: "manual_limit",
        pnl,
        pnl_pct: pnlPct,
        closed_at: new Date().toISOString(),
      })
      .eq("id", pos.id);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("bot_events").insert({
      user_id: context.userId,
      level: "info",
      message: `Manually closed ${pos.side.toUpperCase()} ${pos.symbol} via LIMIT at ${exit}`,
    });

    return { ok: true, pnl, pnlPct };
  });

const updateTpSlSchema = z.object({
  positionId: z.string().uuid(),
  takeProfit: z.number().positive().nullable().optional(),
  stopLoss: z.number().positive().nullable().optional(),
});

export const updatePositionTpSl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateTpSlSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pos, error: posErr } = await supabaseAdmin
      .from("positions")
      .select("id,user_id,side,entry_price,status")
      .eq("id", data.positionId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (posErr || !pos) throw new Error(posErr?.message ?? "Position not found");
    if (pos.status !== "open") throw new Error("Position is not open");

    const entry = Number(pos.entry_price);
    const tp = data.takeProfit ?? null;
    const sl = data.stopLoss ?? null;
    if (tp != null) {
      if (pos.side === "long" && tp <= entry) throw new Error("TP must be above entry for long");
      if (pos.side === "short" && tp >= entry) throw new Error("TP must be below entry for short");
    }
    if (sl != null) {
      if (pos.side === "long" && sl >= entry) throw new Error("SL must be below entry for long");
      if (pos.side === "short" && sl <= entry) throw new Error("SL must be above entry for short");
    }

    const patch: { take_profit?: number | null; stop_loss?: number | null } = {};
    if (data.takeProfit !== undefined) patch.take_profit = tp;
    if (data.stopLoss !== undefined) patch.stop_loss = sl;
    if (Object.keys(patch).length === 0) return { ok: true as const };

    const { error } = await supabaseAdmin.from("positions").update(patch).eq("id", pos.id);
    if (error) throw new Error(error.message);


    await supabaseAdmin.from("bot_events").insert({
      user_id: context.userId,
      level: "info",
      message: `Updated TP/SL on position ${pos.id}: TP=${tp ?? "—"} SL=${sl ?? "—"}`,
    });
    return { ok: true as const };
  });




const livePricesSchema = z.object({
  symbols: z.array(z.string().min(1).max(40).regex(/^[A-Z0-9_\-\/]+$/)).min(1).max(50),
});

export const getLivePrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => livePricesSchema.parse(d))
  .handler(async ({ data }) => {
    const wanted = new Set(data.symbols);
    const out: Record<string, number> = {};
    try {
      const res = await fetch(PUBLIC_FUTURES_TICKER, { headers: PUBLIC_API_HEADERS, cache: "no-store" });
      if (res.ok) {
        const rows = (await res.json()) as { prices?: Record<string, { ls?: number | string; mp?: number | string }> } | TickerRow[];
        const arr: TickerRow[] = Array.isArray(rows) ? rows : Object.entries(rows.prices ?? {}).map(([k, v]) => ({ s: k, ls: (v as { ls?: number | string }).ls, c: (v as { mp?: number | string }).mp }));
        for (const r of arr) {
          const sym = r.s ?? r.pair;
          if (!sym || !wanted.has(sym)) continue;
          const p = num(r.ls ?? r.c);
          if (p > 0) out[sym] = p;
        }
      }
    } catch {}
    try {
      const res = await fetch("https://api.coindcx.com/exchange/ticker", { headers: PUBLIC_API_HEADERS, cache: "no-store" });
      if (res.ok) {
        const rows = (await res.json()) as Array<{ market?: string; last_price?: string | number }>;
        for (const r of rows) {
          const sym = r.market;
          if (!sym) continue;
          const display = sym.endsWith("USDT") ? `${sym.replace(/USDT$/, "")}/USDT` : sym;
          if (wanted.has(sym)) {
            const p = num(r.last_price);
            if (p > 0) out[sym] = p;
          }
          if (wanted.has(display)) {
            const p = num(r.last_price);
            if (p > 0) out[display] = p;
          }
        }
      }
    } catch {}
    return { ok: true as const, prices: out };
  });

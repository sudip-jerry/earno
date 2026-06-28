/**
 * Backend Futures setup classifier.
 *
 * Pure, deterministic. Given a SignalAnalysis snapshot, scores how strongly
 * the candidate resembles a momentum continuation vs a mean-reversion /
 * pullback setup, picks a primary label, and flags overlaps that should
 * make downstream gating cautious.
 *
 * Beginner users never see "momentum" or "pullback" — this is backend-only
 * metadata used for policy gating, exit-policy tuning, and analytics.
 */

import type { SignalAnalysis } from "@/lib/signal-scoring.server";
import type { OverlapFlag, PrimarySetup, SetupClassification } from "./futures-policy-types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function abs(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.abs(n) : 0;
}

/**
 * Score 0–100 for "momentum continuation" character:
 *   - aligned EMA stack with side bias
 *   - strong impulse candle in side direction
 *   - volume spike confirming the impulse
 *   - price already pushing away from EMA21 in side direction
 */
function scoreMomentum(a: SignalAnalysis): number {
  let s = 0;
  const ema = String(a.ema_alignment ?? "").toLowerCase();
  const trend = String(a.trend_status ?? "").toLowerCase();

  if (a.side_bias === "long") {
    if (ema.includes("bull") || ema.includes("up") || ema.includes("aligned_long")) s += 25;
    if (trend.includes("up") || trend.includes("bull")) s += 15;
  } else if (a.side_bias === "short") {
    if (ema.includes("bear") || ema.includes("down") || ema.includes("aligned_short")) s += 25;
    if (trend.includes("down") || trend.includes("bear")) s += 15;
  }

  const impulse = abs(a.impulse_candle_pct);
  if (impulse >= 0.8) s += 25;
  else if (impulse >= 0.4) s += 15;
  else if (impulse >= 0.2) s += 8;

  const vol = a.volume_spike_ratio ?? 0;
  if (vol >= 2) s += 20;
  else if (vol >= 1.5) s += 12;
  else if (vol >= 1.1) s += 5;

  const distEma = abs(a.distance_from_ema21_pct);
  if (distEma >= 0.3 && distEma <= 1.5) s += 15;

  return clamp(Math.round(s), 0, 100);
}

/**
 * Score 0–100 for "pullback / mean-revert" character:
 *   - price near or returning to VWAP
 *   - RSI near mid-range (not extended)
 *   - small impulse candle (rotation, not breakout)
 *   - VWAP status indicates reclaim / hold
 */
function scorePullback(a: SignalAnalysis): number {
  let s = 0;
  const vwap = String(a.vwap_status ?? "").toLowerCase();

  const distVwap = abs(a.distance_from_vwap_pct);
  if (distVwap <= 0.25) s += 30;
  else if (distVwap <= 0.6) s += 18;
  else if (distVwap <= 1.0) s += 8;

  if (vwap.includes("reclaim") || vwap.includes("hold") || vwap.includes("at")) s += 15;

  if (a.rsi != null) {
    if (a.rsi >= 40 && a.rsi <= 60) s += 20;
    else if (a.rsi >= 35 && a.rsi <= 65) s += 10;
  }

  const impulse = abs(a.impulse_candle_pct);
  if (impulse < 0.25) s += 15;
  else if (impulse < 0.5) s += 6;

  // Mild trend agreement still helps pullbacks (buying a dip in an uptrend).
  const trend = String(a.trend_status ?? "").toLowerCase();
  if (a.side_bias === "long" && (trend.includes("up") || trend.includes("bull"))) s += 10;
  else if (a.side_bias === "short" && (trend.includes("down") || trend.includes("bear"))) s += 10;

  return clamp(Math.round(s), 0, 100);
}

function detectOverlaps(a: SignalAnalysis, momentum: number, pullback: number): OverlapFlag[] {
  const flags: OverlapFlag[] = [];
  if (momentum >= 40 && pullback >= 40) flags.push("trend_and_mean_revert");
  if (momentum < 25 && pullback < 25) flags.push("weak_signal");
  if ((a.volume_spike_ratio ?? 0) < 0.9) flags.push("low_volume");
  if (a.spread_pct != null && a.spread_pct > 0.15) flags.push("wide_spread");
  if (abs(a.distance_from_vwap_pct) > 1.5) flags.push("extended_from_vwap");
  if (abs(a.distance_from_ema21_pct) > 2.0) flags.push("extended_from_ema");
  return flags;
}

export function classifySetup(a: SignalAnalysis): SetupClassification {
  const momentumScore = scoreMomentum(a);
  const pullbackScore = scorePullback(a);
  const overlapFlags = detectOverlaps(a, momentumScore, pullbackScore);

  const diff = Math.abs(momentumScore - pullbackScore);
  const top = Math.max(momentumScore, pullbackScore);

  let primarySetup: PrimarySetup;
  if (top < 30) primarySetup = "ambiguous";
  else if (diff < 12) primarySetup = "ambiguous";
  else primarySetup = momentumScore > pullbackScore ? "momentum" : "pullback";

  // Confidence: how decisive the top score is relative to the runner-up.
  const setupConfidence = clamp(Math.round(top * 0.6 + diff * 1.5), 0, 100);

  return {
    primarySetup,
    setupConfidence,
    momentumScore,
    pullbackScore,
    overlapFlags,
  };
}

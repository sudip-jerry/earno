/**
 * Reusable SignalAnalysis fixtures for backend Futures strategy tests and
 * the manual `tsx src/lib/futures/__tests__/harness.ts` runner.
 *
 * Each fixture returns a fresh object so tests can mutate fields without
 * leaking state. The base captures a "neutral, mid-conviction long" — each
 * factory tweaks only the fields that matter for the scenario.
 */

import type { SignalAnalysis } from "@/lib/signal-scoring.server";

export type FixtureName =
  | "strongMomentumLong"
  | "strongMomentumShort"
  | "cleanPullbackLong"
  | "cleanPullbackShort"
  | "ambiguousOverlap"
  | "weakSignal"
  | "extendedFromVwap"
  | "wideSpread"
  | "neutralAvoid";

function base(): SignalAnalysis {
  return {
    symbol: "B-TEST_USDT",
    price: 100,
    action: "LONG",
    side_bias: "long",
    confidence_pct: 70,
    confidence_band: "MEDIUM",
    reason: "fixture",
    trend_status: "up",
    vwap_status: "above",
    ema_alignment: "bullish",
    rsi: 55,
    volume_spike_ratio: 1.2,
    spread_pct: 0.05,
    atr_pct: 0.6,
    distance_from_vwap_pct: 0.4,
    distance_from_ema21_pct: 0.5,
    impulse_candle_pct: 0.3,
    market_regime: "neutral",
    breakdown: {},
  };
}

export const fixtures: Record<FixtureName, () => SignalAnalysis> = {
  strongMomentumLong: () => ({
    ...base(),
    ema_alignment: "aligned_long",
    trend_status: "up",
    impulse_candle_pct: 1.1,
    volume_spike_ratio: 2.4,
    distance_from_ema21_pct: 0.8,
    distance_from_vwap_pct: 1.2,
    rsi: 68,
  }),
  strongMomentumShort: () => ({
    ...base(),
    side_bias: "short",
    action: "SHORT",
    ema_alignment: "aligned_short",
    trend_status: "down",
    impulse_candle_pct: -1.0,
    volume_spike_ratio: 2.1,
    distance_from_ema21_pct: -0.9,
    distance_from_vwap_pct: -1.3,
    rsi: 32,
  }),
  cleanPullbackLong: () => ({
    ...base(),
    ema_alignment: "neutral",
    trend_status: "up",
    vwap_status: "reclaim",
    impulse_candle_pct: 0.05,
    volume_spike_ratio: 1.0,
    distance_from_ema21_pct: 0.1,
    distance_from_vwap_pct: 0.1,
    rsi: 52,
  }),
  cleanPullbackShort: () => ({
    ...base(),
    side_bias: "short",
    action: "SHORT",
    ema_alignment: "neutral",
    trend_status: "down",
    vwap_status: "reclaim",
    impulse_candle_pct: -0.05,
    volume_spike_ratio: 1.0,
    distance_from_ema21_pct: -0.1,
    distance_from_vwap_pct: -0.1,
    rsi: 48,
  }),
  ambiguousOverlap: () => ({
    ...base(),
    ema_alignment: "aligned_long",
    trend_status: "up",
    vwap_status: "at",
    impulse_candle_pct: 0.35,
    volume_spike_ratio: 1.6,
    distance_from_ema21_pct: 0.4,
    distance_from_vwap_pct: 0.2,
    rsi: 55,
  }),
  weakSignal: () => ({
    ...base(),
    ema_alignment: "neutral",
    trend_status: "flat",
    vwap_status: "below",
    impulse_candle_pct: 0.3,
    volume_spike_ratio: 0.5,
    distance_from_ema21_pct: 2.5,
    distance_from_vwap_pct: 2.0,
    rsi: 72,
  }),
  extendedFromVwap: () => ({
    ...base(),
    impulse_candle_pct: 0.9,
    volume_spike_ratio: 2.0,
    distance_from_vwap_pct: 2.6,
    distance_from_ema21_pct: 1.8,
    ema_alignment: "aligned_long",
    trend_status: "up",
  }),
  wideSpread: () => ({ ...base(), spread_pct: 0.35 }),
  neutralAvoid: () => ({
    ...base(),
    action: "AVOID",
    side_bias: "neutral",
    confidence_pct: 30,
    confidence_band: "AVOID",
  }),
};

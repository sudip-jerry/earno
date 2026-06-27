/**
 * Centralized Futures exit policy.
 *
 * Pure, deterministic. Given the open trade state and config, returns the
 * first matching ExitDecision or null. Auto-book mark-pass calls this
 * BEFORE the hard stop-loss check so failing trades exit on policy and
 * hard SL stays an emergency fallback.
 *
 * Profile selection prefers the explicit (primarySetup, riskProfile) the
 * backend detected at booking time. When those aren't provided (e.g. legacy
 * callers, replays without setup metadata), it falls back to deriving the
 * profile from raw strategy/style strings.
 */

import type { PrimarySetup, RiskProfile } from "./futures-policy-types";

export type StrategyKind = "momentum" | "pullback";
export type StyleKind = "aggressive" | "moderate";

export type FuturesExitTradeState = {
  tp1Hit: boolean;
  heldMinutes: number;
  peakRoePct: number;
  currentRoePct: number;
};

export type FuturesExitConfig = {
  strategyType: string | null | undefined;
  tradingStyle: string | null | undefined;
  /** Backend-detected primary setup at booking time. Overrides strategyType. */
  primarySetup?: PrimarySetup | null;
  /** Backend-resolved risk profile. Overrides tradingStyle. */
  riskProfile?: RiskProfile | null;
};

export type ExitDecision = {
  rule: string;
  exitReason: string;
  protectionReason?: string;
};

type Profile = {
  minHoldMinutes: number;
  progressRoe: number;
  failRoe: number;
  minGivebackRoe: number;
};

const PROFILES: Record<StyleKind, Record<StrategyKind, Profile>> = {
  aggressive: {
    momentum: { minHoldMinutes: 8,  progressRoe: 0.6, failRoe: -1.1, minGivebackRoe: 1.7 },
    pullback: { minHoldMinutes: 10, progressRoe: 0.7, failRoe: -1.3, minGivebackRoe: 2.0 },
  },
  moderate: {
    momentum: { minHoldMinutes: 12, progressRoe: 0.8, failRoe: -1.4, minGivebackRoe: 2.1 },
    pullback: { minHoldMinutes: 15, progressRoe: 0.9, failRoe: -1.6, minGivebackRoe: 2.4 },
  },
};

export function normaliseStrategy(raw: string | null | undefined): StrategyKind {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("pullback") || s.includes("vwap") || s.includes("mean")) return "pullback";
  return "momentum";
}

export function normaliseStyle(raw: string | null | undefined): StyleKind {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("aggress")) return "aggressive";
  // conservative + moderate share the moderate (looser) profile.
  return "moderate";
}

function styleFromRiskProfile(p: RiskProfile): StyleKind {
  return p === "aggressive" ? "aggressive" : "moderate";
}

function strategyFromSetup(s: PrimarySetup): StrategyKind {
  // Ambiguous setups exit on the safer "pullback" profile (looser holds,
  // higher giveback before cutting) to avoid over-cutting indecisive trades.
  if (s === "pullback" || s === "ambiguous") return "pullback";
  return "momentum";
}

export function resolveProfile(cfg: FuturesExitConfig): Profile {
  const style: StyleKind = cfg.riskProfile
    ? styleFromRiskProfile(cfg.riskProfile)
    : normaliseStyle(cfg.tradingStyle);
  const strat: StrategyKind = cfg.primarySetup
    ? strategyFromSetup(cfg.primarySetup)
    : normaliseStrategy(cfg.strategyType);
  return PROFILES[style][strat];
}

function evaluatePreTp1FailedMomentum(
  state: FuturesExitTradeState,
  profile: Profile,
): ExitDecision | null {
  if (state.tp1Hit) return null;
  if (state.heldMinutes < profile.minHoldMinutes) return null;
  if (state.peakRoePct < profile.progressRoe) return null;
  if (state.currentRoePct > profile.failRoe) return null;
  const giveback = state.peakRoePct - state.currentRoePct;
  if (giveback < profile.minGivebackRoe) return null;
  return {
    rule: "pre_tp1_failed_momentum",
    exitReason: "Pre-TP1 Failed Momentum Exit",
    protectionReason: "pre_tp1_failed_momentum",
  };
}

export function evaluateFuturesExit(
  state: FuturesExitTradeState,
  cfg: FuturesExitConfig,
): ExitDecision | null {
  const profile = resolveProfile(cfg);
  return evaluatePreTp1FailedMomentum(state, profile);
}

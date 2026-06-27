/**
 * Futures exit policy (paper + future-live).
 *
 * Pure, deterministic, side-effect-free. Given the open trade state, current
 * market state, and config, returns the first matching ExitDecision or null.
 *
 * Designed to be called by the auto-book mark pass BEFORE the hard stop-loss
 * check so failing trades exit on the policy rather than waiting for hard SL.
 * Hard SL remains as an emergency fallback.
 *
 * Reusable by both momentum and pullback strategies — thresholds are chosen
 * from (strategy_type, trading_style) without per-call duplication.
 */

export type StrategyKind = "momentum" | "pullback";
export type StyleKind = "aggressive" | "moderate";

export type FuturesExitTradeState = {
  tp1Hit: boolean;
  heldMinutes: number;
  /** Highest ROE % seen since open (leverage-adjusted). */
  peakRoePct: number;
  /** Current ROE % (leverage-adjusted). */
  currentRoePct: number;
};

export type FuturesExitConfig = {
  strategyType: string | null | undefined;
  tradingStyle: string | null | undefined;
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

/** Map raw config values to the canonical kinds used by the profile table. */
export function normaliseStrategy(raw: string | null | undefined): StrategyKind {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("pullback") || s.includes("vwap") || s.includes("mean")) return "pullback";
  return "momentum";
}

export function normaliseStyle(raw: string | null | undefined): StyleKind {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("aggress")) return "aggressive";
  // balanced / moderate / conservative all map to the "moderate" profile —
  // aggressive is the only style with tighter pre-TP1 thresholds.
  return "moderate";
}

export function resolveProfile(cfg: FuturesExitConfig): Profile {
  const style = normaliseStyle(cfg.tradingStyle);
  const strat = normaliseStrategy(cfg.strategyType);
  return PROFILES[style][strat];
}

/**
 * Pre-TP1 failed-momentum rule.
 *
 * Only fires before TP1. Trade must have aged past minHoldMinutes, must have
 * shown real progress (peak ROE >= progressRoe), must have rolled over to a
 * fail level (current ROE <= failRoe), and the giveback from peak to current
 * must be at least minGivebackRoe ROE points.
 */
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

/**
 * Evaluate all Futures exit rules in priority order. The first match wins.
 *
 * IMPORTANT: This must be called BEFORE the hard stop-loss check so that
 * weak trades exit early and hard SL stays an emergency-only fallback.
 */
export function evaluateFuturesExit(
  state: FuturesExitTradeState,
  cfg: FuturesExitConfig,
): ExitDecision | null {
  const profile = resolveProfile(cfg);
  return evaluatePreTp1FailedMomentum(state, profile);
}

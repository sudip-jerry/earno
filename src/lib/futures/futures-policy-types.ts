/**
 * Shared TypeScript types for the Futures backend strategy/policy/eligibility
 * pipeline. Types only — no runtime code, no thresholds, no logic.
 */

export type PrimarySetup = "momentum" | "pullback" | "ambiguous";

export type RiskProfile = "conservative" | "moderate" | "aggressive";

export type OverlapFlag =
  | "trend_and_mean_revert"
  | "weak_signal"
  | "low_volume"
  | "wide_spread"
  | "extended_from_vwap"
  | "extended_from_ema";

export type SetupClassification = {
  primarySetup: PrimarySetup;
  /** 0–100 confidence the classifier has in the primary label. */
  setupConfidence: number;
  /** 0–100 raw scores per setup type. */
  momentumScore: number;
  pullbackScore: number;
  overlapFlags: OverlapFlag[];
};

export type BackendStrategyPolicy = {
  riskProfile: RiskProfile;
  /** Subset of {"momentum","pullback"} the user's backend strategy permits. */
  allowedSetups: Array<Exclude<PrimarySetup, "ambiguous">>;
  /** Minimum classifier confidence required to book. */
  minSetupConfidence: number;
  /** Whether "ambiguous" classifications may still be booked. */
  allowAmbiguous: boolean;
};

export type TradeEligibility = {
  allowed: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
};

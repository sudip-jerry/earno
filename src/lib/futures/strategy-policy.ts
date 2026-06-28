/**
 * Backend strategy policy resolver.
 *
 * Maps the user's bot_config (strategy + trading_style) to a structured
 * policy describing which setup types may be booked and at what minimum
 * confidence. Beginner-facing UI exposes only "Auto mode" + "Risk level"
 * — the momentum/pullback split lives entirely behind this resolver.
 */

import type { BackendStrategyPolicy, RiskProfile } from "./futures-policy-types";

type PolicyConfigInput = {
  strategy: string | null | undefined;
  trading_style: string | null | undefined;
};

function resolveRiskProfile(raw: string | null | undefined): RiskProfile {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("aggress")) return "aggressive";
  if (s.includes("conserv")) return "conservative";
  return "moderate";
}

function resolveAllowedSetups(
  raw: string | null | undefined,
): BackendStrategyPolicy["allowedSetups"] {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("pullback") || s.includes("vwap") || s.includes("mean")) {
    return ["pullback"];
  }
  if (s.includes("momentum") || s.includes("trend") || s.includes("breakout")) {
    return ["momentum"];
  }
  // Default / "auto" / unspecified strategies accept either side.
  return ["momentum", "pullback"];
}

/**
 * Minimum classifier confidence required before a candidate can be booked.
 * Tighter for aggressive risk so the system isn't fed marginal setups at
 * higher position-sizing.
 */
function resolveMinSetupConfidence(profile: RiskProfile): number {
  switch (profile) {
    case "aggressive":
      return 55;
    case "moderate":
      return 45;
    case "conservative":
      return 40;
  }
}

/**
 * Whether "ambiguous" classifications may still be booked. Conservative and
 * single-setup strategies refuse ambiguous; broad/moderate strategies allow
 * them at a higher confidence bar (enforced via minSetupConfidence).
 */
function resolveAllowAmbiguous(
  profile: RiskProfile,
  allowed: BackendStrategyPolicy["allowedSetups"],
): boolean {
  if (profile === "conservative") return false;
  if (allowed.length === 1) return false;
  return true;
}

export function getBackendStrategyPolicy(cfg: PolicyConfigInput): BackendStrategyPolicy {
  const riskProfile = resolveRiskProfile(cfg.trading_style);
  const allowedSetups = resolveAllowedSetups(cfg.strategy);
  const minSetupConfidence = resolveMinSetupConfidence(riskProfile);
  const allowAmbiguous = resolveAllowAmbiguous(riskProfile, allowedSetups);
  return { riskProfile, allowedSetups, minSetupConfidence, allowAmbiguous };
}

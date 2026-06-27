/**
 * Trade eligibility gate.
 *
 * Combines the classifier output with the resolved backend strategy policy
 * to decide whether the candidate is allowed to be booked. Pure function,
 * no side effects, no DB access. Auto-book treats a `false` result as a
 * rejection reason and continues to the next candidate.
 */

import type { SignalAnalysis } from "@/lib/signal-scoring.server";
import type {
  BackendStrategyPolicy,
  SetupClassification,
  TradeEligibility,
} from "./futures-policy-types";

export function evaluateTradeEligibility(
  analysis: SignalAnalysis,
  setup: SetupClassification,
  policy: BackendStrategyPolicy,
): TradeEligibility {
  const meta: Record<string, unknown> = {
    primary_setup: setup.primarySetup,
    setup_confidence: setup.setupConfidence,
    momentum_score: setup.momentumScore,
    pullback_score: setup.pullbackScore,
    overlap_flags: setup.overlapFlags,
    backend_risk_profile: policy.riskProfile,
    allowed_setups: policy.allowedSetups,
  };

  if (setup.primarySetup === "ambiguous" && !policy.allowAmbiguous) {
    return {
      allowed: false,
      reason: "Ambiguous setup not allowed by backend policy",
      metadata: meta,
    };
  }

  if (
    setup.primarySetup !== "ambiguous" &&
    !policy.allowedSetups.includes(setup.primarySetup)
  ) {
    return {
      allowed: false,
      reason: `Backend strategy does not allow ${setup.primarySetup} setups`,
      metadata: meta,
    };
  }

  if (setup.overlapFlags.includes("weak_signal")) {
    return {
      allowed: false,
      reason: "Weak signal (both setup scores low)",
      metadata: meta,
    };
  }

  if (setup.setupConfidence < policy.minSetupConfidence) {
    return {
      allowed: false,
      reason: `Setup confidence ${setup.setupConfidence} < min ${policy.minSetupConfidence} for ${policy.riskProfile}`,
      metadata: meta,
    };
  }

  void analysis;
  return { allowed: true, metadata: meta };
}

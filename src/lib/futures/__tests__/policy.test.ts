import { describe, it, expect } from "vitest";
import { classifySetup } from "@/lib/futures/setup-classifier";
import { getBackendStrategyPolicy } from "@/lib/futures/strategy-policy";
import { evaluateTradeEligibility } from "@/lib/futures/trade-eligibility";
import { fixtures } from "./fixtures";

describe("classifySetup", () => {
  it("labels strong momentum (long) as momentum with high confidence", () => {
    const r = classifySetup(fixtures.strongMomentumLong());
    expect(r.primarySetup).toBe("momentum");
    expect(r.momentumScore).toBeGreaterThan(r.pullbackScore);
    expect(r.setupConfidence).toBeGreaterThanOrEqual(50);
  });

  it("labels strong momentum (short) as momentum", () => {
    const r = classifySetup(fixtures.strongMomentumShort());
    expect(r.primarySetup).toBe("momentum");
    expect(r.momentumScore).toBeGreaterThan(r.pullbackScore);
  });

  it("labels a clean VWAP reclaim long as pullback", () => {
    const r = classifySetup(fixtures.cleanPullbackLong());
    expect(r.primarySetup).toBe("pullback");
    expect(r.pullbackScore).toBeGreaterThan(r.momentumScore);
  });

  it("labels a clean pullback short as pullback", () => {
    const r = classifySetup(fixtures.cleanPullbackShort());
    expect(r.primarySetup).toBe("pullback");
  });

  it("labels overlap setups as ambiguous and flags trend_and_mean_revert", () => {
    const r = classifySetup(fixtures.ambiguousOverlap());
    expect(r.primarySetup).toBe("ambiguous");
    expect(r.overlapFlags).toContain("trend_and_mean_revert");
  });

  it("flags weak_signal when both scores are low", () => {
    const r = classifySetup(fixtures.weakSignal());
    expect(r.primarySetup).toBe("ambiguous");
    expect(r.overlapFlags).toContain("weak_signal");
  });

  it("flags extended_from_vwap on overextended candidates", () => {
    const r = classifySetup(fixtures.extendedFromVwap());
    expect(r.overlapFlags).toContain("extended_from_vwap");
  });
});

describe("getBackendStrategyPolicy", () => {
  it("defaults to moderate+both setups when strategy/style are unset", () => {
    const p = getBackendStrategyPolicy({ strategy: null, trading_style: null });
    expect(p.riskProfile).toBe("moderate");
    expect(p.allowedSetups.sort()).toEqual(["momentum", "pullback"]);
    expect(p.allowAmbiguous).toBe(true);
  });

  it("restricts allowedSetups when strategy names momentum", () => {
    const p = getBackendStrategyPolicy({ strategy: "momentum", trading_style: "balanced" });
    expect(p.allowedSetups).toEqual(["momentum"]);
    expect(p.allowAmbiguous).toBe(false);
  });

  it("restricts to pullback for vwap/mean strategies", () => {
    const p = getBackendStrategyPolicy({ strategy: "vwap_pullback", trading_style: "balanced" });
    expect(p.allowedSetups).toEqual(["pullback"]);
    expect(p.allowAmbiguous).toBe(false);
  });

  it("conservative profile forbids ambiguous and has the lowest min confidence", () => {
    const p = getBackendStrategyPolicy({ strategy: null, trading_style: "conservative" });
    expect(p.riskProfile).toBe("conservative");
    expect(p.allowAmbiguous).toBe(false);
    expect(p.minSetupConfidence).toBeLessThanOrEqual(45);
  });

  it("aggressive profile demands the highest min confidence", () => {
    const p = getBackendStrategyPolicy({ strategy: null, trading_style: "aggressive" });
    expect(p.riskProfile).toBe("aggressive");
    expect(p.minSetupConfidence).toBeGreaterThanOrEqual(55);
  });
});

describe("evaluateTradeEligibility", () => {
  const moderatePolicy = getBackendStrategyPolicy({ strategy: null, trading_style: "balanced" });
  const momentumPolicy = getBackendStrategyPolicy({
    strategy: "momentum",
    trading_style: "balanced",
  });
  const pullbackPolicy = getBackendStrategyPolicy({
    strategy: "vwap_pullback",
    trading_style: "balanced",
  });
  const conservativePolicy = getBackendStrategyPolicy({
    strategy: null,
    trading_style: "conservative",
  });

  it("allows a strong momentum candidate under a momentum strategy", () => {
    const a = fixtures.strongMomentumLong();
    const setup = classifySetup(a);
    const r = evaluateTradeEligibility(a, setup, momentumPolicy);
    expect(r.allowed).toBe(true);
    expect(r.metadata?.primary_setup).toBe("momentum");
  });

  it("rejects a pullback candidate when the strategy demands momentum", () => {
    const a = fixtures.cleanPullbackLong();
    const setup = classifySetup(a);
    const r = evaluateTradeEligibility(a, setup, momentumPolicy);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/does not allow pullback/);
  });

  it("rejects a momentum candidate when the strategy demands pullback", () => {
    const a = fixtures.strongMomentumLong();
    const setup = classifySetup(a);
    const r = evaluateTradeEligibility(a, setup, pullbackPolicy);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/does not allow momentum/);
  });

  it("rejects ambiguous setups under a conservative policy", () => {
    const a = fixtures.ambiguousOverlap();
    const setup = classifySetup(a);
    const r = evaluateTradeEligibility(a, setup, conservativePolicy);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Ambiguous/);
  });

  it("rejects weak_signal candidates even under a permissive policy", () => {
    const a = fixtures.weakSignal();
    const setup = classifySetup(a);
    const r = evaluateTradeEligibility(a, setup, moderatePolicy);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Weak signal/);
  });

  it("rejects when setupConfidence is below the policy threshold", () => {
    const a = fixtures.cleanPullbackLong();
    const setup = classifySetup(a);
    // Force the threshold one point above the fixture's actual confidence so
    // the test stays stable as scoring is tuned.
    const tightPolicy = { ...moderatePolicy, minSetupConfidence: setup.setupConfidence + 1 };
    const r = evaluateTradeEligibility(a, setup, tightPolicy);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Setup confidence/);
  });

  it("always includes setup + policy metadata for logging", () => {
    const a = fixtures.strongMomentumLong();
    const setup = classifySetup(a);
    const r = evaluateTradeEligibility(a, setup, momentumPolicy);
    expect(r.metadata).toMatchObject({
      primary_setup: "momentum",
      backend_risk_profile: "moderate",
      allowed_setups: ["momentum"],
    });
    expect(typeof r.metadata?.momentum_score).toBe("number");
    expect(typeof r.metadata?.setup_confidence).toBe("number");
  });
});

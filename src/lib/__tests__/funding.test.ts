import { describe, it, expect } from "vitest";
import { premiumPct } from "@/lib/funding";

describe("premiumPct", () => {
  it("is positive when the perp trades above spot (longs pay)", () => {
    expect(premiumPct(101, 100)).toBeCloseTo(1, 9);
  });

  it("is negative when the perp trades below spot (shorts pay)", () => {
    expect(premiumPct(99, 100)).toBeCloseTo(-1, 9);
  });

  it("is zero at parity", () => {
    expect(premiumPct(100, 100)).toBe(0);
  });

  it("returns null on non-positive prices", () => {
    expect(premiumPct(0, 100)).toBeNull();
    expect(premiumPct(100, 0)).toBeNull();
    expect(premiumPct(-1, 100)).toBeNull();
    expect(premiumPct(100, Number.NaN)).toBeNull();
  });
});

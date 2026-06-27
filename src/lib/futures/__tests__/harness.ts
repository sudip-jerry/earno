/**
 * Manual fixture harness for the Futures backend strategy pipeline.
 *
 * Usage:
 *   bunx vite-node src/lib/futures/__tests__/harness.ts
 *   bunx vite-node src/lib/futures/__tests__/harness.ts --strategy=momentum --style=aggressive
 *
 * Runs every fixture in fixtures.ts through classifySetup +
 * getBackendStrategyPolicy + evaluateTradeEligibility and prints a table.
 * Use this when tweaking thresholds to see at a glance which fixtures flip
 * between allowed / rejected without writing new assertions.
 */

import { classifySetup } from "@/lib/futures/setup-classifier";
import { getBackendStrategyPolicy } from "@/lib/futures/strategy-policy";
import { evaluateTradeEligibility } from "@/lib/futures/trade-eligibility";
import { fixtures, type FixtureName } from "./fixtures";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const strategy = arg("strategy", "auto");
const tradingStyle = arg("style", "balanced");
const policy = getBackendStrategyPolicy({ strategy, trading_style: tradingStyle });

console.log(`policy: strategy=${strategy} style=${tradingStyle} →`, policy);

const rows = (Object.keys(fixtures) as FixtureName[]).map((name) => {
  const a = fixtures[name]();
  const setup = classifySetup(a);
  const elig = evaluateTradeEligibility(a, setup, policy);
  return {
    fixture: name,
    side: a.side_bias,
    primary: setup.primarySetup,
    mom: setup.momentumScore,
    pb: setup.pullbackScore,
    conf: setup.setupConfidence,
    flags: setup.overlapFlags.join(",") || "-",
    allowed: elig.allowed ? "yes" : "no",
    reason: elig.reason ?? "",
  };
});

console.table(rows);

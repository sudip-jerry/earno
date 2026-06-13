/**
 * Risk engine.
 *
 * Pure decision functions. Given the user's risk config and recent trading
 * activity, decides whether a new trade may be opened. No side effects.
 *
 * Rules enforced:
 *   1. Max daily loss cap (% of equity)
 *   2. Max trades per day
 *   3. Max open positions
 *   4. Max consecutive losses
 *   5. Cooldown after a losing trade
 *   6. Minimum scalp score
 */

export type RiskConfig = {
  equityUsdt: number;
  dailyLossCapPct: number;       // e.g. 3 → stop at -3% of equity for the day
  maxTradesPerDay: number;
  maxOpenPositions: number;
  maxConsecutiveLosses: number;
  cooldownMinutesAfterLoss: number;
  minScalpScore: number;         // 0..100
};

export type TradeRecord = {
  id: string;
  status: "open" | "closed";
  pnl_usdt: number | null;
  opened_at: string;       // ISO
  closed_at: string | null;
};

export type RiskInput = {
  config: RiskConfig;
  now?: Date;
  openPositions: TradeRecord[];
  /** All trades (open + closed) for the current trading day (00:00 local). */
  todaysTrades: TradeRecord[];
  /** Last N closed trades, most-recent first. */
  recentClosed: TradeRecord[];
  candidate: { symbol: string; scalpScore: number };
};

export type RiskDecision = {
  allowed: boolean;
  reasons: string[];           // every rule outcome (passed or failed)
  blockedBy: string[];         // subset of reasons that blocked the trade
  metrics: {
    dailyPnlUsdt: number;
    dailyLossCapUsdt: number;
    tradesToday: number;
    openPositions: number;
    consecutiveLosses: number;
    minutesSinceLastLoss: number | null;
  };
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function evaluateTrade(input: RiskInput): RiskDecision {
  const now = input.now ?? new Date();
  const { config, openPositions, todaysTrades, recentClosed, candidate } = input;

  const dailyPnlUsdt = todaysTrades
    .filter((t) => t.status === "closed")
    .reduce((sum, t) => sum + (t.pnl_usdt ?? 0), 0);
  const dailyLossCapUsdt = -(config.equityUsdt * config.dailyLossCapPct) / 100;

  // consecutive losses: walk recent closed trades from most-recent
  let consecutiveLosses = 0;
  for (const t of recentClosed) {
    if (t.status !== "closed") continue;
    if ((t.pnl_usdt ?? 0) < 0) consecutiveLosses++;
    else break;
  }

  // minutes since last loss
  let minutesSinceLastLoss: number | null = null;
  const lastLoss = recentClosed.find((t) => (t.pnl_usdt ?? 0) < 0 && t.closed_at);
  if (lastLoss?.closed_at) {
    minutesSinceLastLoss = Math.floor(
      (now.getTime() - new Date(lastLoss.closed_at).getTime()) / 60_000,
    );
  }

  const reasons: string[] = [];
  const blockedBy: string[] = [];
  const fail = (msg: string) => {
    reasons.push(`✗ ${msg}`);
    blockedBy.push(msg);
  };
  const pass = (msg: string) => reasons.push(`✓ ${msg}`);

  // 1. daily loss cap
  if (dailyPnlUsdt <= dailyLossCapUsdt) {
    fail(
      `Daily loss cap hit (${dailyPnlUsdt.toFixed(2)} ≤ ${dailyLossCapUsdt.toFixed(2)} USDT)`,
    );
  } else {
    pass(
      `Within daily loss cap (${dailyPnlUsdt.toFixed(2)} / ${dailyLossCapUsdt.toFixed(2)} USDT)`,
    );
  }

  // 2. max trades per day
  if (todaysTrades.length >= config.maxTradesPerDay) {
    fail(`Max trades/day reached (${todaysTrades.length}/${config.maxTradesPerDay})`);
  } else {
    pass(`Trades today ${todaysTrades.length}/${config.maxTradesPerDay}`);
  }

  // 3. max open positions
  if (openPositions.length >= config.maxOpenPositions) {
    fail(
      `Max open positions reached (${openPositions.length}/${config.maxOpenPositions})`,
    );
  } else {
    pass(`Open positions ${openPositions.length}/${config.maxOpenPositions}`);
  }

  // 4. max consecutive losses
  if (consecutiveLosses >= config.maxConsecutiveLosses) {
    fail(
      `Consecutive losses ${consecutiveLosses}/${config.maxConsecutiveLosses}`,
    );
  } else {
    pass(`Consecutive losses ${consecutiveLosses}/${config.maxConsecutiveLosses}`);
  }

  // 5. cooldown after loss
  if (
    minutesSinceLastLoss != null &&
    minutesSinceLastLoss < config.cooldownMinutesAfterLoss
  ) {
    fail(
      `Cooldown active: ${minutesSinceLastLoss}m of ${config.cooldownMinutesAfterLoss}m since last loss`,
    );
  } else {
    pass(
      minutesSinceLastLoss == null
        ? "No recent loss"
        : `Cooldown elapsed (${minutesSinceLastLoss}m ≥ ${config.cooldownMinutesAfterLoss}m)`,
    );
  }

  // 6. min scalp score
  if (candidate.scalpScore < config.minScalpScore) {
    fail(
      `${candidate.symbol} score ${candidate.scalpScore} < min ${config.minScalpScore}`,
    );
  } else {
    pass(`${candidate.symbol} score ${candidate.scalpScore} ≥ min ${config.minScalpScore}`);
  }

  // mark day boundary so callers can show "since 00:00"
  void startOfDay(now);

  return {
    allowed: blockedBy.length === 0,
    reasons,
    blockedBy,
    metrics: {
      dailyPnlUsdt,
      dailyLossCapUsdt,
      tradesToday: todaysTrades.length,
      openPositions: openPositions.length,
      consecutiveLosses,
      minutesSinceLastLoss,
    },
  };
}

export const RiskEngine = { evaluateTrade };

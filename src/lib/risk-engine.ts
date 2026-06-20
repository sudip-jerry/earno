/**
 * Volatility-adjusted risk model.
 * Pure functions — safe to import from server, client, and shared modules.
 *
 * Stop loss is derived from recent market volatility (ATR%) rather than a
 * single fixed percentage. Position size is then derived from the user's
 * Risk-per-Trade so the maximum loss stays bounded regardless of stop width.
 */

export type TradingStyle = "conservative" | "balanced" | "aggressive";

export type StylePreset = {
  key: TradingStyle;
  label: string;
  description: string;
  /** Risk-per-trade as % of capital (max money at risk per trade). */
  riskPct: number;
  /** Floor for stop-loss %, regardless of ATR. */
  minSL: number;
  /** ATR multiplier — wider for volatile coins. */
  atrMult: number;
  /** Hard cap; anything above this is sent to Manual Review. */
  maxAutoSL: number;
  /** Target = SL × targetMult. */
  targetMult: number;
  /** Reject auto-book when realized R:R is below this. */
  minRR: number;
  /** Partial-profit (TP1) % from entry — closes 50% and moves SL to breakeven. */
  tp1Pct: number;
  /** Trailing-stop % applied to the runner half after TP1. */
  trailPct: number;
  /** Peak unrealized profit (%) required before profit-fade exit can trigger. */
  profitFadeMinPct: number;
  /** Fraction of peak profit given back to trigger profit-fade exit (0..1). */
  profitFadeGivebackPct: number;
  /** If trade does not reach this unrealized % within the window, flag weak progress. */
  weakProgressMinPct: number;
  /** Window in minutes used to evaluate weak progress (45–60). */
  weakProgressWindowMin: number;
  /** Style-aware execution caps. */
  maxTradesPerDay: number;
  maxSameDirPerDay: number;
  maxTradesPerSymbolPerDay: number;
  /** Symbol cooldown after this many losses in 24h. */
  lossesBeforeSymbolCooldown: number;
  /** Cooldown duration (hours) once `lossesBeforeSymbolCooldown` triggers. */
  symbolCooldownHours: number;
};

export const STYLE_PRESETS: Record<TradingStyle, StylePreset> = {
  conservative: {
    key: "conservative",
    label: "Conservative",
    description: "Smaller risk, tighter caps. Filters out volatile coins.",
    riskPct: 0.5,
    minSL: 1.5,
    atrMult: 2.0,
    maxAutoSL: 2.5,
    targetMult: 1.5,
    minRR: 1.5,
    tp1Pct: 0.55,
    trailPct: 0.30,
    profitFadeMinPct: 0.6,
    profitFadeGivebackPct: 0.4,
    weakProgressMinPct: 0.3,
    weakProgressWindowMin: 60,
    maxTradesPerDay: 9,
    maxSameDirPerDay: 5,
    maxTradesPerSymbolPerDay: 2,
    lossesBeforeSymbolCooldown: 2,
    symbolCooldownHours: 6,
  },
  balanced: {
    key: "balanced",
    label: "Balanced",
    description: "Default mode. Volatility-adjusted with moderate caps.",
    riskPct: 1,
    minSL: 1.5,
    atrMult: 2.2,
    maxAutoSL: 4,
    targetMult: 1.7,
    minRR: 1.5,
    tp1Pct: 0.70,
    trailPct: 0.42,
    profitFadeMinPct: 0.6,
    profitFadeGivebackPct: 0.4,
    weakProgressMinPct: 0.3,
    weakProgressWindowMin: 55,
    maxTradesPerDay: 15,
    maxSameDirPerDay: 8,
    maxTradesPerSymbolPerDay: 3,
    lossesBeforeSymbolCooldown: 2,
    symbolCooldownHours: 5,
  },
  aggressive: {
    key: "aggressive",
    label: "Aggressive",
    description: "Allows wider stops and larger risk on volatile setups.",
    riskPct: 1.5,
    minSL: 1.8,
    atrMult: 2.4,
    maxAutoSL: 5,
    targetMult: 2,
    minRR: 1.5,
    tp1Pct: 0.90,
    trailPct: 0.62,
    profitFadeMinPct: 0.6,
    profitFadeGivebackPct: 0.4,
    weakProgressMinPct: 0.3,
    weakProgressWindowMin: 50,
    maxTradesPerDay: 25,
    maxSameDirPerDay: 12,
    maxTradesPerSymbolPerDay: 4,
    lossesBeforeSymbolCooldown: 3,
    symbolCooldownHours: 3,
  },
};

/** Best-effort coercion from the persisted bot_config row to a preset. */
export function presetFromConfig(cfg: {
  trading_style?: string | null;
  min_sl_pct?: number | null;
  atr_multiplier?: number | null;
  max_auto_sl_pct?: number | null;
  target_multiplier?: number | null;
  min_rr?: number | null;
  risk_per_trade_pct?: number | null;
} | null | undefined): StylePreset {
  const styleKey = (cfg?.trading_style as TradingStyle) ?? "balanced";
  const base = STYLE_PRESETS[styleKey] ?? STYLE_PRESETS.balanced;
  return {
    ...base,
    riskPct: numOr(cfg?.risk_per_trade_pct, base.riskPct),
    minSL: numOr(cfg?.min_sl_pct, base.minSL),
    atrMult: numOr(cfg?.atr_multiplier, base.atrMult),
    maxAutoSL: numOr(cfg?.max_auto_sl_pct, base.maxAutoSL),
    targetMult: numOr(cfg?.target_multiplier, base.targetMult),
    minRR: numOr(cfg?.min_rr, base.minRR),
  };
}

function numOr(v: number | null | undefined, fallback: number): number {
  const n = typeof v === "number" ? v : v != null ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type RiskStatus = "auto_eligible" | "manual_review" | "avoid";

export type RiskPlan = {
  /** Effective stop loss % (post-floor, pre-cap clamp for display). */
  slPct: number;
  /** Stop loss % the engine actually needs based on ATR + floor. */
  requiredSL: number;
  /** Maximum stop loss % allowed for auto-book under the active preset. */
  maxAllowedSL: number;
  /** Target % = slPct × targetMult. */
  tpPct: number;
  /** Realized risk-reward ratio (tpPct / slPct). */
  rr: number;
  /** ATR% used (null when not available). */
  atrPct: number | null;
  /** Money at risk if SL hits, in capital currency units. */
  riskAmount: number;
  /** Notional position size (unleveraged). */
  positionSize: number;
  /** Final status badge. */
  status: RiskStatus;
  /** Short human reason; populated for manual_review / avoid. */
  reason: string | null;
};

export type ComputeRiskInput = {
  atrPct: number | null;
  preset: StylePreset;
  /** Capital used for position sizing (paper_equity or wallet balance). */
  capital: number;
  /** True when the setup has no tradable bias (bias === "wait" / avoid). */
  unsupported?: boolean;
};

export function computeRiskPlan({ atrPct, preset, capital, unsupported }: ComputeRiskInput): RiskPlan {
  const atrComponent = atrPct != null && atrPct > 0 ? atrPct * preset.atrMult : 0;
  const requiredSL = Math.max(preset.minSL, atrComponent);
  // Cap stop-loss for display purposes, but flag the breach via status.
  const slPct = Number(requiredSL.toFixed(2));
  const tpPct = Number((slPct * preset.targetMult).toFixed(2));
  const rr = slPct > 0 ? Number((tpPct / slPct).toFixed(2)) : 0;
  const riskAmount = capital > 0 ? Number(((capital * preset.riskPct) / 100).toFixed(2)) : 0;
  const positionSize = slPct > 0 ? Number((riskAmount / (slPct / 100)).toFixed(2)) : 0;

  let status: RiskStatus = "auto_eligible";
  let reason: string | null = null;

  if (unsupported) {
    status = "avoid";
    reason = "No tradable setup";
  } else if (requiredSL > preset.maxAutoSL) {
    status = "manual_review";
    reason = "Volatility too high for auto-book";
  } else if (rr < preset.minRR) {
    status = "manual_review";
    reason = "Risk-reward weak";
  } else if (capital <= 0) {
    status = "manual_review";
    reason = "No capital available";
  }

  return {
    slPct,
    requiredSL: Number(requiredSL.toFixed(2)),
    maxAllowedSL: preset.maxAutoSL,
    tpPct,
    rr,
    atrPct: atrPct != null ? Number(atrPct.toFixed(2)) : null,
    riskAmount,
    positionSize,
    status,
    reason,
  };
}

/** ATR% from candles (true range avg / lastClose × 100). */
export function atrPctFromCandles(
  candles: Array<{ open: number; high: number; low: number; close: number }>,
  period = 14,
): number | null {
  if (!candles || candles.length < period + 1) return null;
  const slice = candles.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    const cur = slice[i];
    const prev = slice[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    sum += tr;
  }
  const atr = sum / period;
  const last = slice[slice.length - 1].close;
  if (!last) return null;
  return (atr / last) * 100;
}

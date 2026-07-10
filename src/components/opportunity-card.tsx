import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import type { Mover, Action, ConfidenceLabel } from "@/lib/movers.functions";
import { RecommendationModal } from "@/components/recommendation-modal";
import { useCurrency } from "@/hooks/use-currency";
import { computeRiskPlan, STYLE_PRESETS, type RiskPlan, type StylePreset } from "@/lib/risk-engine";

export type RiskMeta = {
  capital: number;
  style: string;
  minSL: number;
  atrMult: number;
  maxAutoSL: number;
  targetMult: number;
  minRR: number;
  riskPct: number;
};

type Props = {
  mover: Mover;
  /** Volatility preset + capital — supplied by getTopMovers' `risk` field. */
  riskMeta: RiskMeta;
  dailyRiskAvailable?: boolean;
  booking?: boolean;
  onBook: (side: "long" | "short", overrides: { tpPct: number; slPct: number }) => void;
  /** Compact layout for tables/scanner. */
  compact?: boolean;
  /** When this scan was produced (ms epoch or ISO) — shown as a relative age. */
  asOf?: number | string | null;
};

function timeAgo(v: number | string | null | undefined): string {
  if (v == null) return "";
  const t = typeof v === "number" ? v : new Date(v).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function actionMeta(a: Action) {
  if (a === "long")
    return {
      label: "LONG",
      btn: "Book Paper Trade",
      cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
      btnCls: "bg-emerald-600 hover:bg-emerald-700",
    };
  if (a === "short")
    return {
      label: "SHORT",
      btn: "Book Paper Trade",
      cls: "bg-destructive/10 text-destructive border-destructive/30",
      btnCls: "bg-destructive hover:bg-destructive/90",
    };
  if (a === "avoid")
    return {
      label: "AVOID",
      btn: "Avoid",
      cls: "bg-destructive/10 text-destructive border-destructive/30",
      btnCls: "bg-muted text-muted-foreground",
    };
  return {
    label: "WAIT",
    btn: "Wait",
    cls: "bg-muted text-muted-foreground border-border",
    btnCls: "bg-muted text-muted-foreground",
  };
}

function labelCls(l: ConfidenceLabel): string {
  if (l === "High") return "text-emerald-500";
  if (l === "Medium") return "text-amber-500";
  if (l === "Low") return "text-muted-foreground";
  return "text-destructive";
}

function statusBadge(p: RiskPlan) {
  if (p.status === "auto_eligible")
    return {
      label: "Auto-book Eligible",
      cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
    };
  if (p.status === "manual_review")
    return { label: "Manual Review", cls: "bg-amber-500/10 text-amber-500 border-amber-500/30" };
  return { label: "Avoid", cls: "bg-destructive/10 text-destructive border-destructive/30" };
}

function formatPrice(p: number): string {
  return p.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function presetFromMeta(meta: RiskMeta): StylePreset {
  const base = STYLE_PRESETS[meta.style as keyof typeof STYLE_PRESETS] ?? STYLE_PRESETS.balanced;
  return {
    ...base,
    riskPct: meta.riskPct,
    minSL: meta.minSL,
    atrMult: meta.atrMult,
    maxAutoSL: meta.maxAutoSL,
    targetMult: meta.targetMult,
    minRR: meta.minRR,
  };
}

export function OpportunityCard({
  mover,
  riskMeta,
  dailyRiskAvailable = true,
  booking = false,
  onBook,
  compact = false,
  asOf,
}: Props) {
  const [whyOpen, setWhyOpen] = useState(false);
  const { fmt } = useCurrency();
  const meta = actionMeta(mover.action);
  const tradable = mover.action === "long" || mover.action === "short";
  const lowZone = formatPrice(mover.price * 0.999);
  const highZone = formatPrice(mover.price * 1.001);

  const plan = useMemo(() => {
    return computeRiskPlan({
      atrPct: mover.atrPct,
      preset: presetFromMeta(riskMeta),
      capital: riskMeta.capital,
      unsupported: mover.bias === "wait",
    });
  }, [mover.atrPct, mover.bias, riskMeta]);

  const badge = statusBadge(plan);
  const canBook = tradable && plan.status === "auto_eligible";
  const reviewOnly = tradable && plan.status === "manual_review";

  return (
    <div className={`rounded-2xl border bg-card ${compact ? "p-3" : "p-4"}`}>
      {/* Header: pair, action, confidence */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">{mover.display}</p>
            <span
              className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-semibold border ${meta.cls}`}
            >
              {meta.label}
            </span>
            <span
              className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-semibold border ${badge.cls}`}
            >
              {badge.label}
            </span>
            {asOf ? (
              <span className="text-[10px] text-muted-foreground">· {timeAgo(asOf)}</span>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {plan.reason ?? mover.shortReason}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-semibold tabular-nums leading-none">{mover.confidence}%</p>
          <p
            className={`text-[10px] font-medium uppercase tracking-wider ${labelCls(mover.confidenceLabel)}`}
          >
            {mover.confidenceLabel}
          </p>
        </div>
      </div>

      {/* Why earnO selected this */}
      {mover.reasons && mover.reasons.length > 0 && (
        <div className="mt-3 rounded-xl bg-muted/40 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Why earnO selected this
          </p>
          <ul className="mt-1 space-y-0.5">
            {mover.reasons.slice(0, 5).map((r, i) => (
              <li key={i} className="text-[11px] text-foreground leading-snug flex gap-1.5">
                <span className="text-primary mt-0.5">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Trade plan */}
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <div>
          <p className="uppercase tracking-wider text-muted-foreground">Entry zone</p>
          <p className="tabular-nums font-medium text-foreground mt-0.5">
            {lowZone}–{highZone}
          </p>
        </div>
        <div>
          <p className="uppercase tracking-wider text-muted-foreground">Target</p>
          <p className="tabular-nums font-medium text-emerald-500 mt-0.5">
            +{plan.tpPct.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="uppercase tracking-wider text-muted-foreground">Stop</p>
          <p className="tabular-nums font-medium text-destructive mt-0.5">
            −{plan.slPct.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="uppercase tracking-wider text-muted-foreground">Stop type</p>
          <p className="font-medium text-foreground mt-0.5">Volatility-based</p>
        </div>
        <div>
          <p className="uppercase tracking-wider text-muted-foreground">Risk</p>
          <p className="tabular-nums font-medium text-foreground mt-0.5">{fmt(plan.riskAmount)}</p>
        </div>
        <div>
          <p className="uppercase tracking-wider text-muted-foreground">Risk-reward</p>
          <p
            className={`tabular-nums font-medium mt-0.5 ${plan.rr < riskMeta.minRR ? "text-amber-500" : "text-foreground"}`}
          >
            {plan.rr > 0 ? `${plan.rr.toFixed(1)} : 1` : "—"}
          </p>
        </div>
        <div className="col-span-2">
          <p className="uppercase tracking-wider text-muted-foreground">Position size</p>
          <p className="tabular-nums font-medium text-foreground mt-0.5">
            {fmt(plan.positionSize)}
          </p>
        </div>
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground leading-snug">
        Stop is based on recent market volatility, not a fixed percentage.
      </p>

      {reviewOnly ? (
        <p className="mt-2 text-[11px] text-amber-500">
          Manual review required — {plan.reason?.toLowerCase() ?? "risk rejected"}.
        </p>
      ) : null}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          className={`flex-1 h-9 rounded-lg text-white ${meta.btnCls} disabled:opacity-60`}
          disabled={!canBook || booking}
          onClick={() =>
            canBook &&
            onBook(mover.action === "short" ? "short" : "long", {
              tpPct: plan.tpPct,
              slPct: plan.slPct,
            })
          }
        >
          {booking ? "Booking…" : reviewOnly ? "Manual review" : meta.btn}
        </Button>
        <button
          type="button"
          onClick={() => setWhyOpen(true)}
          className="h-9 px-3 inline-flex items-center gap-1 rounded-lg border text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label="Why this recommendation"
        >
          <Info className="size-3.5" />
          Why?
        </button>
      </div>

      <RecommendationModal
        open={whyOpen}
        onOpenChange={setWhyOpen}
        mover={mover}
        plan={plan}
        riskMeta={riskMeta}
        dailyRiskAvailable={dailyRiskAvailable}
      />
    </div>
  );
}

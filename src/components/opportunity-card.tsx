import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import type { Mover, Action, ConfidenceLabel } from "@/lib/movers.functions";
import { RecommendationModal } from "@/components/recommendation-modal";
import { useCurrency } from "@/hooks/use-currency";

type Props = {
  mover: Mover;
  /** Auto-derived defaults; user can override via inline inputs. */
  tpPct: number;
  slPct: number;
  riskAmountUsd: number;
  dailyRiskAvailable?: boolean;
  booking?: boolean;
  onBook: (side: "long" | "short", overrides: { tpPct: number; slPct: number }) => void;
  /** Compact layout for tables/scanner. */
  compact?: boolean;
};

function actionMeta(a: Action) {
  if (a === "long")
    return { label: "LONG", btn: "Book Paper Trade",
      cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
      btnCls: "bg-emerald-600 hover:bg-emerald-700" };
  if (a === "short")
    return { label: "SHORT", btn: "Book Paper Trade",
      cls: "bg-destructive/10 text-destructive border-destructive/30",
      btnCls: "bg-destructive hover:bg-destructive/90" };
  if (a === "avoid")
    return { label: "AVOID", btn: "Avoid",
      cls: "bg-destructive/10 text-destructive border-destructive/30",
      btnCls: "bg-muted text-muted-foreground" };
  return { label: "WAIT", btn: "Wait",
    cls: "bg-muted text-muted-foreground border-border",
    btnCls: "bg-muted text-muted-foreground" };
}

function labelCls(l: ConfidenceLabel): string {
  if (l === "High") return "text-emerald-500";
  if (l === "Medium") return "text-amber-500";
  if (l === "Low") return "text-muted-foreground";
  return "text-destructive";
}

function formatPrice(p: number): string {
  return p.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function OpportunityCard({
  mover,
  tpPct,
  slPct,
  riskAmountUsd,
  dailyRiskAvailable = true,
  booking = false,
  onBook,
  compact = false,
}: Props) {
  const [whyOpen, setWhyOpen] = useState(false);
  const { fmt } = useCurrency();
  const meta = actionMeta(mover.action);
  const tradable = mover.action === "long" || mover.action === "short";
  const isAutoEligible = mover.tier === "auto";
  const lowZone = formatPrice(mover.price * 0.999);
  const highZone = formatPrice(mover.price * 1.001);

  return (
    <div className={`rounded-2xl border bg-card ${compact ? "p-3" : "p-4"}`}>
      {/* Header: pair, action, confidence */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm truncate">{mover.display}</p>
            <span className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-semibold border ${meta.cls}`}>
              {meta.label}
            </span>
            <span className="inline-flex items-center px-2 h-5 rounded text-[10px] font-medium border bg-muted/60 text-muted-foreground border-border">
              {mover.reasonLabel}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{mover.shortReason}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-semibold tabular-nums leading-none">
            {mover.confidence}%
          </p>
          <p className={`text-[10px] font-medium uppercase tracking-wider ${labelCls(mover.confidenceLabel)}`}>
            {mover.confidenceLabel}
          </p>
        </div>
      </div>

      {/* Trade plan */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <p className="uppercase tracking-wider text-muted-foreground">Entry zone</p>
          <p className="tabular-nums font-medium text-foreground mt-0.5">
            {lowZone}–{highZone}
          </p>
        </div>
        <div>
          <p className="uppercase tracking-wider text-muted-foreground">Target</p>
          <p className="tabular-nums font-medium text-emerald-500 mt-0.5">+{tpPct.toFixed(2)}%</p>
        </div>
        <div>
          <p className="uppercase tracking-wider text-muted-foreground">Stop</p>
          <p className="tabular-nums font-medium text-destructive mt-0.5">−{slPct.toFixed(2)}%</p>
        </div>
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground flex items-center justify-between">
        <span>Risk amount</span>
        <span className="tabular-nums font-medium text-foreground">
          {fmt(riskAmountUsd)}
        </span>
      </div>

      {tradable && !isAutoEligible ? (
        <p className="mt-2 text-[10px] text-amber-500">Manual book — not auto-eligible</p>
      ) : null}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          className={`flex-1 h-9 rounded-lg text-white ${meta.btnCls} disabled:opacity-60`}
          disabled={!tradable || booking}
          onClick={() => tradable && onBook(mover.action === "short" ? "short" : "long")}
        >
          {booking ? "Booking…" : meta.btn}
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
        dailyRiskAvailable={dailyRiskAvailable}
      />
    </div>
  );
}

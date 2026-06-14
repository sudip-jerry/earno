import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Check, CheckStatus, Mover } from "@/lib/movers.functions";
import type { RiskPlan } from "@/lib/risk-engine";
import type { RiskMeta } from "@/components/opportunity-card";
import { useCurrency } from "@/hooks/use-currency";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mover: Mover | null;
  plan?: RiskPlan;
  riskMeta?: RiskMeta;
  dailyRiskAvailable?: boolean;
};

function statusBadge(s: CheckStatus) {
  if (s === "pass") return { label: "Pass", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" };
  if (s === "warn") return { label: "Warn", cls: "bg-amber-500/10 text-amber-500 border-amber-500/30" };
  return { label: "Fail", cls: "bg-destructive/10 text-destructive border-destructive/30" };
}

function Section({ title, items }: { title: string; items: Check[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</h3>
      <ul className="space-y-1.5">
        {items.map((c, i) => {
          const b = statusBadge(c.status);
          return (
            <li key={i} className="flex items-center justify-between gap-2 text-sm">
              <span>{c.label}</span>
              <span className={`text-[10px] font-semibold uppercase px-1.5 h-5 inline-flex items-center rounded border ${b.cls}`}>
                {b.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function KV({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "fail" }) {
  const cls = tone === "ok" ? "text-emerald-500" : tone === "warn" ? "text-amber-500" : tone === "fail" ? "text-destructive" : "text-foreground";
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-medium ${cls}`}>{value}</span>
    </div>
  );
}

export function RecommendationModal({ open, onOpenChange, mover, plan, riskMeta, dailyRiskAvailable = true }: Props) {
  const { fmt } = useCurrency();
  if (!mover) return null;
  const risk: Check[] = [
    ...mover.checks.risk,
    { label: "Daily risk limit available", status: dailyRiskAvailable ? "pass" : "fail" },
  ];

  const accepted = plan?.status === "auto_eligible";
  const finalSentence = plan
    ? accepted
      ? "Risk accepted because stop loss is within allowed range and position size keeps maximum loss within limit."
      : plan.reason === "Volatility too high for auto-book"
        ? "Risk rejected because required stop loss exceeds the allowed limit."
        : plan.reason === "Risk-reward weak"
          ? "Risk rejected because risk-reward is below the minimum required."
          : `Risk rejected — ${plan.reason ?? "preset criteria not met"}.`
    : mover.decisionSentence;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Recommendation Logic</DialogTitle>
          <DialogDescription>
            {mover.display} · Confidence {mover.confidence}% ({mover.confidenceLabel})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          <Section title="1. Trend" items={mover.checks.trend} />
          <Section title="2. Entry Quality" items={mover.checks.entry} />
          <Section title="3. Momentum" items={mover.checks.momentum} />
          <Section title="4. Risk" items={risk} />

          {plan && riskMeta ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                5. Risk Check
              </h3>
              <div className="rounded-lg border bg-muted/30 px-3 py-2 space-y-1.5">
                <KV label="Stop Type" value="Volatility-based" />
                <KV label="ATR" value={plan.atrPct != null ? `${plan.atrPct.toFixed(2)}%` : "—"} />
                <KV
                  label="Stop"
                  value={`${plan.slPct.toFixed(2)}%`}
                  tone={plan.requiredSL > plan.maxAllowedSL ? "fail" : "ok"}
                />
                <KV label="Max Allowed" value={`${plan.maxAllowedSL.toFixed(2)}%`} />
                <KV label="Risk per Trade" value={fmt(plan.riskAmount)} />
                <KV label="Position Size" value={fmt(plan.positionSize)} />
                <KV
                  label="Risk-Reward"
                  value={plan.rr > 0 ? `${plan.rr.toFixed(2)} : 1` : "—"}
                  tone={plan.rr < riskMeta.minRR ? "warn" : "ok"}
                />
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Final Result
            </h3>
            <p className={`text-sm leading-relaxed rounded-lg border px-3 py-2 ${accepted ? "bg-emerald-500/5 border-emerald-500/30" : plan ? "bg-amber-500/5 border-amber-500/30" : "bg-muted/30"}`}>
              {finalSentence}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

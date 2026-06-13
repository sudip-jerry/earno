import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Check, CheckStatus, Mover } from "@/lib/movers.functions";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mover: Mover | null;
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

export function RecommendationModal({ open, onOpenChange, mover, dailyRiskAvailable = true }: Props) {
  if (!mover) return null;
  const risk: Check[] = [
    ...mover.checks.risk,
    { label: "Daily risk limit available", status: dailyRiskAvailable ? "pass" : "fail" },
  ];

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

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              5. Final Decision
            </h3>
            <p className="text-sm leading-relaxed rounded-lg border bg-muted/30 px-3 py-2">
              {mover.decisionSentence}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

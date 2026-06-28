import type { DashboardStats } from "@/lib/stats.functions";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Activity,
  Radar,
  Target,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  Briefcase,
  Clock,
  HelpCircle,
  ChevronRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function WealthEngineStatus({ stats }: { stats?: DashboardStats }) {
  const [riskOpen, setRiskOpen] = useState(false);
  const rawStatus = stats?.engineStatus ?? "paused";
  // Derive "Risk Locked" when running but daily loss limit reached.
  const isRiskLocked =
    rawStatus === "active" && stats?.riskHealthy === false && (stats?.dailyLossUsedPct ?? 0) >= 80;
  const status: "active" | "paused" | "cooldown" | "risk_locked" = isRiskLocked
    ? "risk_locked"
    : rawStatus;

  const badge =
    status === "active"
      ? { label: "Running", cls: "bg-emerald-500 text-white" }
      : status === "cooldown"
        ? { label: "Cooldown", cls: "bg-amber-500 text-white" }
        : status === "risk_locked"
          ? { label: "Risk Locked", cls: "bg-destructive text-white" }
          : { label: "Paused", cls: "bg-muted text-muted-foreground" };

  const reason =
    status === "risk_locked"
      ? "Risk lock active because the daily loss limit was reached. The bot will resume tomorrow or after you adjust risk settings."
      : status === "cooldown"
        ? (stats?.riskReason ?? "Bot is cooling down after recent trades.")
        : status === "paused"
          ? "Bot is paused. Tap Start Bot to resume scanning."
          : (stats?.noTradeReason ?? "Bot is running and scanning markets for setups.");

  const riskLabel =
    status === "risk_locked"
      ? "Locked"
      : stats?.riskHealthy
        ? "Active"
        : status === "cooldown"
          ? "Engaged"
          : "Limit reached";

  return (
    <section className="px-5 mt-5">
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          <p className="text-xs font-semibold uppercase tracking-wider">Wealth Engine</p>
          <span
            className={`ml-auto inline-flex items-center text-[10px] px-2 h-5 rounded-full font-bold tracking-wider ${badge.cls}`}
          >
            {status === "active" && (
              <span className="size-1.5 rounded-full bg-white mr-1.5 animate-pulse" />
            )}
            {badge.label.toUpperCase()}
          </span>
        </div>

        {/* Always-on reason block */}
        <div className="mt-3 rounded-xl bg-muted/40 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Reason
          </p>
          <p className="mt-0.5 text-xs text-foreground leading-relaxed">{reason}</p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Cell
            to="/scanner"
            icon={<Radar className="size-3.5 text-primary" />}
            label="Markets scanned"
            value={
              status === "paused"
                ? "Paused"
                : status === "cooldown" && (stats?.marketsScannedToday ?? 0) === 0
                  ? "Paused"
                  : (stats?.marketsScannedToday ?? 0).toLocaleString()
            }
            hint={
              status === "paused"
                ? "Bot is stopped"
                : status === "cooldown" && (stats?.marketsScannedToday ?? 0) === 0
                  ? "Scanning paused during cooldown"
                  : "View scanner"
            }
          />
          <Cell
            to="/scanner"
            icon={<Target className="size-3.5 text-primary" />}
            label="Opportunities found"
            value={
              status === "paused"
                ? "—"
                : status === "cooldown" && (stats?.opportunitiesFoundToday ?? 0) === 0
                  ? "Paused"
                  : (stats?.opportunitiesFoundToday ?? 0).toLocaleString()
            }
            hint={
              status === "cooldown" && (stats?.opportunitiesFoundToday ?? 0) === 0
                ? "Waiting for next scan cycle"
                : "Open scanner"
            }
          />
          <Cell
            to="/positions"
            icon={<CheckCircle2 className="size-3.5 text-primary" />}
            label="Trades executed"
            value={(stats?.tradesExecutedToday ?? 0).toLocaleString()}
            hint="View positions"
          />
          <Cell
            to="/positions"
            icon={<Briefcase className="size-3.5 text-primary" />}
            label="Open positions"
            value={(stats?.openCount ?? 0).toLocaleString()}
            hint="View positions"
          />
          <Cell
            icon={<Clock className="size-3.5 text-primary" />}
            label="Last analysis"
            value={timeAgo(stats?.lastAnalysisAt ?? null)}
          />
          <Cell
            onClick={() => setRiskOpen(true)}
            icon={
              stats?.riskHealthy ? (
                <ShieldCheck className="size-3.5 text-emerald-500" />
              ) : (
                <ShieldAlert className="size-3.5 text-amber-500" />
              )
            }
            label="Risk protection"
            value={riskLabel}
            tone={stats?.riskHealthy ? "positive" : "warn"}
            trailingIcon={<HelpCircle className="size-3 text-muted-foreground" />}
            hint="What is this?"
          />
        </div>
      </div>

      <Dialog open={riskOpen} onOpenChange={setRiskOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {stats?.riskHealthy ? (
                <ShieldCheck className="size-4 text-emerald-500" />
              ) : (
                <ShieldAlert className="size-4 text-amber-500" />
              )}
              Risk Protection — {riskLabel}
            </DialogTitle>
            <DialogDescription className="text-left">
              {status === "risk_locked"
                ? "Daily loss cap reached. Auto-booking is paused to protect capital."
                : status === "cooldown"
                  ? (stats?.riskReason ?? "Cooling down after recent trades.")
                  : stats?.riskHealthy
                    ? "All guardrails healthy. Bot is trading within safe limits."
                    : (stats?.riskReason ?? "A guardrail is currently engaged.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 text-sm">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Current guardrails
            </p>
            <RiskRow
              label="Daily loss used"
              value={`${(stats?.dailyLossUsedPct ?? 0).toFixed(0)}% of cap`}
              sub={`Cap: -${stats?.dailyLossCapPct ?? 0}% of equity`}
              warn={(stats?.dailyLossUsedPct ?? 0) >= 80}
            />
            <RiskRow
              label="Trades today"
              value={`${stats?.tradesExecutedToday ?? 0} / ${stats?.maxTradesPerDay ?? 0}`}
              warn={(stats?.tradesExecutedToday ?? 0) >= (stats?.maxTradesPerDay ?? 999)}
            />
            <RiskRow
              label="Open positions"
              value={`${stats?.openCount ?? 0} / ${stats?.maxOpenPositions ?? 0}`}
              warn={(stats?.openCount ?? 0) >= (stats?.maxOpenPositions ?? 999)}
            />
            <RiskRow
              label="Consecutive losses"
              value={`${stats?.consecutiveLosses ?? 0}`}
              warn={(stats?.consecutiveLosses ?? 0) >= 3}
            />
            <RiskRow
              label="Min confidence"
              value={`${stats?.minConfidenceRequired ?? 0}`}
              sub={`Top today: ${stats?.topConfidenceToday ?? 0}`}
            />
            <RiskRow label="Cooldown after loss" value={`${stats?.cooldownMinutes ?? 0} min`} />
          </div>

          <Link
            to="/settings"
            onClick={() => setRiskOpen(false)}
            className="flex items-center justify-between rounded-xl border bg-card p-3 hover:bg-muted/40"
          >
            <span className="text-sm font-medium">Change risk settings</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function RiskRow({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-background/40 px-3 py-2">
      <div>
        <p className="text-xs font-medium">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <span
        className={`text-sm font-semibold tabular-nums ${
          warn ? "text-amber-600 dark:text-amber-400" : "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Cell({
  icon,
  label,
  value,
  tone,
  hint,
  to,
  onClick,
  trailingIcon,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "positive" | "warn";
  hint?: string;
  to?: "/scanner" | "/positions" | "/settings";
  onClick?: () => void;
  trailingIcon?: React.ReactNode;
}) {
  const valueCls =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";

  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
        {(to || onClick) && (
          <span className="ml-auto">
            {trailingIcon ?? <ChevronRight className="size-3 text-muted-foreground/70" />}
          </span>
        )}
      </div>
      <p className={`mt-1 text-sm font-semibold tabular-nums ${valueCls}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground leading-tight">{hint}</p>}
    </>
  );

  const cls =
    "rounded-xl border bg-background/40 p-2.5 text-left transition hover:bg-muted/40 hover:border-primary/30";

  if (to) {
    return (
      <Link to={to} className={cls}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {body}
      </button>
    );
  }
  return <div className="rounded-xl border bg-background/40 p-2.5">{body}</div>;
}

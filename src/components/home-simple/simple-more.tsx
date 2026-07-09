import { Link } from "@tanstack/react-router";
import {
  Zap,
  HelpCircle,
  CreditCard,
  Eye,
  EyeOff,
  Settings as Cog,
  Shield,
  Info,
  ChevronRight,
  FlaskConical,
  BadgeCheck,
} from "lucide-react";

export type SimpleMoreProps = {
  onSwitchToPro: () => void;
  hideBalance: boolean;
  onToggleHideBalance: () => void;
  currentMode: "paper" | "live";
  onManageMode: () => void;
};

function LinkRow({
  to,
  icon,
  label,
  hint,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/40 transition">
      <span className="size-8 grid place-items-center rounded-lg bg-muted text-foreground/80 shrink-0">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </div>
      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
    </Link>
  );
}

export function SimpleMore({
  onSwitchToPro,
  hideBalance,
  onToggleHideBalance,
  currentMode,
  onManageMode,
}: SimpleMoreProps) {
  const isLive = currentMode === "live";
  return (
    <div className="min-h-svh bg-background pb-28">
      <div className="mx-auto max-w-md">
        <header className="px-5 pt-5">
          <h1 className="text-[19px] font-semibold">More</h1>
          <p className="mt-1 text-[12.5px] text-muted-foreground">Help, your plan, and settings.</p>
        </header>

        {/* Switch to Pro — the deliberate mode switch */}
        <div className="px-5 mt-4">
          <button
            type="button"
            onClick={onSwitchToPro}
            className="w-full text-left rounded-2xl bg-primary text-primary-foreground px-5 py-4 shadow-sm"
          >
            <div className="flex items-center gap-2">
              <Zap className="size-4" />
              <span className="text-[14px] font-semibold">Switch to Pro mode</span>
            </div>
            <p className="mt-1 text-[12px] opacity-90">
              Scanner, full positions table and bot controls. You can switch back any time.
            </p>
          </button>
        </div>

        <div className="px-5 mt-4">
          <section className="rounded-2xl border bg-card shadow-sm divide-y overflow-hidden">
            <button
              type="button"
              onClick={onManageMode}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40 transition"
            >
              <span
                className={`size-8 grid place-items-center rounded-lg shrink-0 ${isLive ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"}`}
              >
                {isLive ? <BadgeCheck className="size-4" /> : <FlaskConical className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">Trading mode</div>
                <div className="text-[11px] text-muted-foreground">
                  {isLive
                    ? "Live — trading with real money. Tap to manage."
                    : "Practice — simulated money. Tap to go live."}
                </div>
              </div>
              <span
                className={`text-[10px] font-semibold tracking-wider px-2 h-5 inline-flex items-center rounded-full shrink-0 ${isLive ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"}`}
              >
                {isLive ? "LIVE" : "PAPER"}
              </span>
            </button>
            <LinkRow
              to="/help"
              icon={<HelpCircle className="size-4" />}
              label="Help & how it works"
              hint="Plain-English answers"
            />
            <LinkRow
              to="/upgrade"
              icon={<CreditCard className="size-4" />}
              label="Plan & upgrade"
              hint="See your plan and options"
            />
            <button
              type="button"
              onClick={onToggleHideBalance}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40 transition"
            >
              <span className="size-8 grid place-items-center rounded-lg bg-muted text-foreground/80 shrink-0">
                {hideBalance ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">Hide balances</div>
                <div className="text-[11px] text-muted-foreground">
                  {hideBalance ? "On — amounts are hidden" : "Off — amounts are shown"}
                </div>
              </div>
            </button>
            <LinkRow
              to="/settings"
              icon={<Cog className="size-4" />}
              label="Settings"
              hint="Currency, appearance, exchange keys"
            />
            <LinkRow
              to="/privacy"
              icon={<Shield className="size-4" />}
              label="Safety & privacy"
              hint="How your money stays yours"
            />
            <LinkRow
              to="/about"
              icon={<Info className="size-4" />}
              label="About earn'O"
              hint="What this app is"
            />
          </section>
        </div>
      </div>
    </div>
  );
}

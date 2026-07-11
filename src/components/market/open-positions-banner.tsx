import { Link } from "@tanstack/react-router";
import { Briefcase, ChevronRight } from "lucide-react";

/**
 * Shared "you have N open positions/holdings · unrealized PnL" banner, used
 * identically on the All, Futures and Coins home screens. Renders nothing when
 * there is nothing open.
 */
export function OpenPositionsBanner({
  count,
  pnl,
  pnlPct,
  noun = "position",
  fmt,
}: {
  count: number;
  pnl: number;
  pnlPct?: number | null;
  noun?: string;
  fmt: (n: number | null | undefined, opts?: { signed?: boolean }) => string;
}) {
  if (count <= 0) return null;
  const pos = pnl >= 0;
  return (
    <div className="px-5 mt-3">
      <Link
        to="/positions"
        className="w-full flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 hover:bg-muted/40 transition"
      >
        <span
          className={`inline-flex items-center justify-center size-8 rounded-full shrink-0 ${
            pos
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
          }`}
        >
          <Briefcase className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted-foreground leading-tight">
            {count} open {noun}
            {count === 1 ? "" : "s"} · unrealized
          </p>
          <p
            className={`text-[14px] font-semibold leading-tight tabular-nums mt-0.5 ${
              pos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
            }`}
          >
            {fmt(pnl, { signed: true })}
            {pnlPct != null && (
              <span className="ml-1.5 text-[11px] font-medium opacity-80">
                ({pnlPct >= 0 ? "+" : ""}
                {pnlPct.toFixed(2)}%)
              </span>
            )}
          </p>
        </div>
        <ChevronRight className="size-4 text-muted-foreground shrink-0" />
      </Link>
    </div>
  );
}

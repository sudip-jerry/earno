import { FlaskConical, BadgeCheck } from "lucide-react";

/**
 * Shared Paper/Live banner used identically on the All, Futures and Coins
 * home screens. `isLive` drives the styling/copy; `onToggle` fires when tapped
 * (each screen wires it to its own market's go-live flow).
 */
export function ModeBanner({ isLive, onToggle }: { isLive: boolean; onToggle: () => void }) {
  return (
    <div className="px-5 mt-4">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full text-left flex items-center gap-3 rounded-2xl border px-4 py-3 transition ${
          isLive
            ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
            : "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15"
        }`}
        aria-label="Toggle paper or live trading"
      >
        <span
          className={`inline-flex items-center justify-center size-9 rounded-full shrink-0 ${
            isLive
              ? "bg-destructive/15 text-destructive"
              : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
          }`}
        >
          {isLive ? <BadgeCheck className="size-4" /> : <FlaskConical className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`text-[13px] font-semibold leading-tight ${
              isLive ? "text-destructive" : "text-amber-700 dark:text-amber-300"
            }`}
          >
            {isLive ? "LIVE trading active" : "PAPER — practice mode"}
          </p>
          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
            {isLive
              ? "Real funds are at risk. Tap to switch back to Paper."
              : "All numbers reflect simulated trading. Tap to go Live."}
          </p>
        </div>
        <span
          className={`text-[10px] font-semibold tracking-wider px-2 h-6 inline-flex items-center rounded-full ${
            isLive ? "bg-destructive text-destructive-foreground" : "bg-amber-500 text-white"
          }`}
        >
          {isLive ? "LIVE" : "PAPER"}
        </span>
      </button>
    </div>
  );
}

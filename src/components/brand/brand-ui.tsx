import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import earneyWave from "@/assets/earney-wave.png.asset.json";
import earneyHappy from "@/assets/earney-happy.png.asset.json";
import earneyThinking from "@/assets/earney-thinking.png.asset.json";
import earneyAnalyzing from "@/assets/earney-analyzing.png.asset.json";
import earneyConfident from "@/assets/earney-confident.png.asset.json";
import earneyFriendly from "@/assets/earney-friendly.png.asset.json";

/**
 * Shared earn'O brand primitives so every screen stays visually consistent
 * from one place instead of hand-rolling its own header / section / empty state.
 */

export type EarneyMood = "wave" | "happy" | "thinking" | "analyzing" | "confident" | "friendly";

const MOOD_SRC: Record<EarneyMood, string> = {
  wave: earneyWave.url,
  happy: earneyHappy.url,
  thinking: earneyThinking.url,
  analyzing: earneyAnalyzing.url,
  confident: earneyConfident.url,
  friendly: earneyFriendly.url,
};

export function Earney({
  mood = "happy",
  className = "h-16 w-16",
}: {
  mood?: EarneyMood;
  className?: string;
}) {
  return (
    <img
      src={MOOD_SRC[mood]}
      alt=""
      aria-hidden="true"
      className={`${className} shrink-0 select-none drop-shadow-sm`}
      draggable={false}
    />
  );
}

/**
 * Unified page header. Two shapes, matching what the screens already use:
 *  - list  (default): accent icon + title + subtitle, actions on the right
 *  - back  (onBack set): back chevron + title, optional actions on the right
 */
export function PageHeader({
  icon,
  title,
  subtitle,
  actions,
  onBack,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
}) {
  if (onBack) {
    return (
      <header className="px-5 pt-6 pb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="size-9 -ml-2 grid place-items-center rounded-full hover:bg-muted text-foreground shrink-0"
          >
            <ChevronLeft className="size-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold truncate">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
      </header>
    );
  }
  return (
    <header className="px-5 pt-6 pb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </header>
  );
}

/** Consistent section label (matches the settings-screen convention). */
export function SectionLabel({
  children,
  icon,
  action,
  className = "",
}: {
  children: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-2 flex items-center gap-1 px-1 ${className}`}>
      <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        {icon}
        {children}
      </h2>
      {action && <span className="ml-auto text-[11px] font-medium text-primary">{action}</span>}
    </div>
  );
}

/** Consistent card surface. */
export function BrandCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`rounded-2xl border bg-card shadow-sm ${className}`}>{children}</div>;
}

/**
 * Friendly, on-brand empty state — the app's dashed-card pattern, now with
 * Earney and plain-language copy. `mood={null}` renders without the mascot.
 */
export function BrandEmptyState({
  mood = "thinking",
  title,
  message,
  action,
}: {
  mood?: EarneyMood | null;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center flex flex-col items-center">
      {mood && <Earney mood={mood} className="h-16 w-16 mb-2" />}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {message && (
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-[40ch]">{message}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

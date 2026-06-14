import type { ActivityItem } from "@/lib/stats.functions";
import { History } from "lucide-react";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function classify(msg: string): { tag: string; tone: "positive" | "negative" | "warn" | "neutral" } {
  if (/^Auto-booked/i.test(msg)) return { tag: "Opened", tone: "positive" };
  if (/^Auto-closed/i.test(msg)) return { tag: "Closed", tone: "neutral" };
  if (/paused|cap hit|limit/i.test(msg)) return { tag: "Paused", tone: "warn" };
  if (/Scan complete/i.test(msg)) return { tag: "Scan", tone: "neutral" };
  if (/failed|error/i.test(msg)) return { tag: "Error", tone: "negative" };
  if (/skipped|cooldown/i.test(msg)) return { tag: "Skipped", tone: "warn" };
  return { tag: "Info", tone: "neutral" };
}

const toneCls = {
  positive: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  negative: "bg-destructive/10 text-destructive",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  neutral: "bg-muted text-muted-foreground",
};

export function RecentActivity({ items }: { items: ActivityItem[] }) {
  return (
    <section className="px-5 mt-5">
      <div className="rounded-2xl border bg-card">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <History className="size-4 text-primary" />
          <p className="text-xs font-semibold uppercase tracking-wider">Recent Activity</p>
        </div>
        <div className="divide-y">
          {items.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              No activity yet. Start the bot to see live actions here.
            </p>
          )}
          {items.map((it) => {
            const c = classify(it.message);
            return (
              <div key={it.id} className="px-4 py-2.5 flex items-start gap-3">
                <span className="text-[10px] tabular-nums text-muted-foreground w-10 shrink-0 mt-0.5">
                  {fmtTime(it.at)}
                </span>
                <span
                  className={`text-[10px] px-1.5 h-4 inline-flex items-center rounded font-semibold tracking-wider uppercase shrink-0 mt-0.5 ${toneCls[c.tone]}`}
                >
                  {c.tag}
                </span>
                <p className="text-xs text-foreground/90 leading-relaxed flex-1 min-w-0">
                  {it.message}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

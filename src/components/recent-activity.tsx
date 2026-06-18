import type { ActivityItem, ActivityMeta } from "@/lib/stats.functions";
import { History } from "lucide-react";
import { useCurrency } from "@/hooks/use-currency";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

const REASON_LABEL: Record<string, string> = {
  take_profit: "Take Profit",
  stop_loss: "Stop Loss",
  trend_invalidated: "Trend Invalidated",
  recovery_exit: "Recovery Exit",
  time_exit: "Time Exit",
  manual_limit: "Manual Close",
  manual_close: "Manual Close",
  kill_switch: "Risk Protection",
  risk_lock: "Risk Protection",
};

function prettyReason(code?: string | null): string | null {
  if (!code) return null;
  const key = code.toLowerCase();
  if (REASON_LABEL[key]) return REASON_LABEL[key];
  return code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function sanitize(msg: string): { text: string; reason: string | null } {
  // Strip raw "position_<uuid>" tokens
  let text = msg.replace(/\bposition[_-][0-9a-f-]{6,}\b/gi, "").replace(/\s{2,}/g, " ").trim();
  // Extract "(reason_code)" suffix and convert to pretty label
  let reason: string | null = null;
  const m = text.match(/\(([a-z_]+)\)\s*$/i);
  if (m) {
    reason = prettyReason(m[1]);
    text = text.slice(0, m.index).trim();
  }
  return { text, reason };
}

function classify(msg: string, meta?: ActivityMeta | null): { tag: string; tone: "positive" | "negative" | "warn" | "neutral" } {
  const kind = meta?.kind;
  if (kind === "auto_tune" || /^Auto-tuned/i.test(msg)) return { tag: "Auto-tuned", tone: "warn" };
  if (kind === "auto_book" || /^Auto-booked/i.test(msg)) return { tag: "Opened", tone: "positive" };
  if (kind === "skip" || /^Skipped/i.test(msg)) return { tag: "Skipped", tone: "warn" };
  if (/^Auto-closed|^Closed/i.test(msg)) return { tag: "Closed", tone: "neutral" };
  if (/paused|cap hit|limit|risk lock/i.test(msg)) return { tag: "Paused", tone: "warn" };
  if (/Scan complete/i.test(msg)) return { tag: "Scan", tone: "neutral" };
  if (/failed|error/i.test(msg)) return { tag: "Error", tone: "negative" };
  if (/cooldown/i.test(msg)) return { tag: "Skipped", tone: "warn" };
  return { tag: "Info", tone: "neutral" };
}

const toneCls = {
  positive: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  negative: "bg-destructive/10 text-destructive",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  neutral: "bg-muted text-muted-foreground",
};

function KV({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  const cls = tone === "ok" ? "text-emerald-500" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-medium ${cls}`}>{value}</span>
    </div>
  );
}

function StructuredEntry({ it }: { it: ActivityItem }) {
  const { fmt } = useCurrency();
  const m = it.meta!;
  if (m.kind === "auto_book") {
    const sideLabel = (m.side ?? "").toUpperCase();
    return (
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground">
          Auto-booked {sideLabel} {m.symbol}
        </p>
        <div className="mt-1.5 space-y-1 rounded-lg bg-muted/40 px-2.5 py-1.5">
          {m.confidence != null && <KV label="Confidence" value={`${m.confidence}%`} />}
          {m.tpPct != null && <KV label="Target" value={`+${m.tpPct.toFixed(2)}%`} tone="ok" />}
          {m.slPct != null && <KV label="Stop" value={`−${m.slPct.toFixed(2)}%`} tone="bad" />}
          <KV label="Stop Type" value={m.stopType ?? "Volatility-based"} />
          {m.riskAmount != null && <KV label="Risk" value={fmt(m.riskAmount)} />}
          {m.rr != null && <KV label="Risk-Reward" value={`${m.rr.toFixed(2)} : 1`} />}
        </div>
      </div>
    );
  }
  if (m.kind === "skip") {
    return (
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground">Skipped {m.symbol}</p>
        <div className="mt-1.5 space-y-1 rounded-lg bg-amber-500/5 border border-amber-500/20 px-2.5 py-1.5">
          {m.reason && <KV label="Reason" value={m.reason} tone="bad" />}
          {m.requiredSL != null && <KV label="Required Stop" value={`${m.requiredSL.toFixed(2)}%`} />}
          {m.allowedSL != null && <KV label="Allowed Stop" value={`${m.allowedSL.toFixed(2)}%`} />}
          {m.rr != null && m.reason === "Risk-reward weak" && (
            <KV label="R:R" value={`${m.rr.toFixed(2)} : 1`} />
          )}
        </div>
      </div>
    );
  }
  if (m.kind === "auto_tune") {
    const kinds = m.rec_kinds ?? [];
    const fields = m.fields ?? [];
    return (
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground">
          Auto-tuned after critical alert
        </p>
        <div className="mt-1.5 space-y-1 rounded-lg bg-amber-500/5 border border-amber-500/20 px-2.5 py-1.5">
          {kinds.length > 0 && (
            <KV label="Trigger" value={kinds.join(", ")} tone="bad" />
          )}
          {fields.length > 0 && (
            <KV label="Changed" value={fields.join(", ")} />
          )}
          <KV label="Effective" value="Next scan cycle" />
        </div>
      </div>
    );
  }
  return (
    <p className="text-xs text-foreground/90 leading-relaxed flex-1 min-w-0">{it.message}</p>
  );
}

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
            const c = classify(it.message, it.meta);
            const structured =
              it.meta?.kind === "auto_book" ||
              it.meta?.kind === "skip" ||
              it.meta?.kind === "auto_tune";
            const clean = structured ? null : sanitize(it.message);
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
                {structured ? (
                  <StructuredEntry it={it} />
                ) : (
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground/90 leading-relaxed">{clean!.text}</p>
                    {clean!.reason && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Reason: <span className="text-foreground font-medium">{clean!.reason}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

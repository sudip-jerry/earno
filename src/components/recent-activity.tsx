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
  let text = msg
    .replace(/\bposition[_-][0-9a-f-]{6,}\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  let reason: string | null = null;
  const m = text.match(/\(([a-z_]+)\)\s*$/i);
  if (m) {
    reason = prettyReason(m[1]);
    text = text.slice(0, m.index).trim();
  }
  return { text, reason };
}

function classify(
  msg: string,
  meta?: ActivityMeta | null,
): { tag: string; tone: "positive" | "negative" | "warn" | "neutral" } {
  const kind = meta?.kind;
  if (kind === "auto_tune" || /^Auto-tuned/i.test(msg)) return { tag: "Auto-tuned", tone: "warn" };
  if (kind === "auto_book" || /^Auto-booked/i.test(msg)) return { tag: "Opened", tone: "positive" };
  if (kind === "session_hour_skip" || /session hour/i.test(msg))
    return { tag: "Session block", tone: "warn" };
  if (kind === "sl_width_skip" || /exceeds max_sl_atr/i.test(msg))
    return { tag: "SL too wide", tone: "warn" };
  if (kind === "ev_ratio_skip" || /EV ratio/i.test(msg)) return { tag: "Low EV", tone: "warn" };
  if (kind === "pre_entry_net_profit_skip" || /net profit at TP below/i.test(msg))
    return { tag: "Fee gate", tone: "warn" };
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

const TRIGGER_LABEL: Record<string, string> = {
  "loss-streak": "Several losing trades in a row today",
  "daily-bleed": "Today's losses were growing fast",
  "sl-dominated": "Most trades were hitting their stop-loss",
  "shorts-bleeding": "Short (sell) trades were losing money",
  "longs-bleeding": "Long (buy) trades were losing money",
  "low-pf": "Losses have been outweighing wins this week",
  overtrading: "Too many trades opened today",
  "wide-net": "Bot was accepting weak signals",
  "auto-blacklist-loose": "Bad coins weren't being skipped quickly enough",
};

function friendlyTrigger(kind: string): string {
  return TRIGGER_LABEL[kind] ?? kind.replace(/-/g, " ");
}

function friendlyChanges(
  patch: NonNullable<ActivityMeta["patch"]> | undefined,
  fields: string[] | undefined,
): string[] {
  const out: string[] = [];
  const p = patch ?? {};
  const has = (k: string) => k in p || (fields ?? []).includes(k);
  if (has("auto_book_confidence_threshold")) {
    const v = p.auto_book_confidence_threshold;
    out.push(
      v != null
        ? `Only take stronger setups now — confidence raised to ${v}`
        : "Only take stronger setups now (confidence raised)",
    );
  }
  if (has("risk_per_trade_pct")) {
    const v = p.risk_per_trade_pct;
    out.push(
      v != null
        ? `Risking less per trade — now ${Number(v).toFixed(2)}% of balance`
        : "Risking less per trade",
    );
  }
  if (has("cooldown_minutes")) {
    const v = p.cooldown_minutes;
    out.push(
      v != null ? `Waiting ${v} min between trades to cool off` : "Waiting longer between trades",
    );
  }
  if (has("max_trades_per_day")) {
    const v = p.max_trades_per_day;
    out.push(v != null ? `Capping today's trades at ${v}` : "Capping today's trade count");
  }
  if (has("allow_short") && p.allow_short === false)
    out.push("Paused new short (sell) trades until the trend recovers");
  if (has("allow_long") && p.allow_long === false)
    out.push("Paused new long (buy) trades until the trend recovers");
  if (has("symbol_blacklist_threshold")) {
    const v = p.symbol_blacklist_threshold;
    out.push(
      v != null
        ? `A coin is auto-skipped after just ${v} losses in a day`
        : "Auto-skip bad coins sooner",
    );
  }
  if (has("symbol_sl_cooldown_minutes")) {
    const v = p.symbol_sl_cooldown_minutes;
    if (v != null) {
      const hrs = v >= 60 ? `${Math.round(v / 60)} h` : `${v} min`;
      out.push(`After a stop-loss, that coin rests for ${hrs}`);
    } else {
      out.push("Longer rest for coins after a stop-loss");
    }
  }
  return out;
}

function KV({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  const cls =
    tone === "ok" ? "text-emerald-500" : tone === "bad" ? "text-destructive" : "text-foreground";
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-medium ${cls}`}>{value}</span>
    </div>
  );
}

function GateEntry({ kind, msg }: { kind: string; msg: string }) {
  const gateInfo: Record<string, { title: string; why: string }> = {
    session_hour_skip: {
      title: "Blocked — noisy session window",
      why: "This signal arrived during a high-noise market transition hour (e.g. US open or pre-US). Historical data shows these windows produce more false breakouts, so the bot waits for calmer conditions.",
    },
    sl_width_skip: {
      title: "Blocked — stop loss too wide",
      why: "The ATR-based stop distance for this setup exceeded the style cap. A wider stop means a much larger loss if wrong, destroying the risk-reward ratio even if the signal was otherwise valid.",
    },
    ev_ratio_skip: {
      title: "Blocked — expected value too low",
      why: "At the current confidence level, the projected win doesn't cover the projected loss. The bot only enters when the math favours a positive edge.",
    },
    pre_entry_net_profit_skip: {
      title: "Blocked — fees would erase profit",
      why: "The projected gross profit at the take-profit level is too small to clear entry + exit fees and GST. Taking this trade would likely result in a net loss even if the target is hit.",
    },
  };
  const info = gateInfo[kind] ?? { title: "Entry blocked by quality gate", why: msg };
  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-medium text-foreground">{info.title}</p>
      <div className="mt-1.5 rounded-lg bg-amber-500/5 border border-amber-500/20 px-2.5 py-1.5">
        <p className="text-[11px] text-foreground/80 leading-snug">{info.why}</p>
      </div>
    </div>
  );
}

function StructuredEntry({ it }: { it: ActivityItem }) {
  const { fmt } = useCurrency();
  const m = it.meta!;

  const gateKinds = [
    "session_hour_skip",
    "sl_width_skip",
    "ev_ratio_skip",
    "pre_entry_net_profit_skip",
  ];
  if (gateKinds.includes(m.kind ?? "")) {
    return <GateEntry kind={m.kind!} msg={it.message} />;
  }

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
          {m.requiredSL != null && (
            <KV label="Required Stop" value={`${m.requiredSL.toFixed(2)}%`} />
          )}
          {m.allowedSL != null && <KV label="Allowed Stop" value={`${m.allowedSL.toFixed(2)}%`} />}
          {m.rr != null && m.reason === "Risk-reward weak" && (
            <KV label="R:R" value={`${m.rr.toFixed(2)} : 1`} />
          )}
        </div>
      </div>
    );
  }
  if (m.kind === "auto_tune") {
    const triggers = (m.rec_kinds ?? []).map(friendlyTrigger);
    const changes = friendlyChanges(m.patch, m.fields);
    return (
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground">
          Earno tightened your settings to protect today's capital
        </p>
        <div className="mt-1.5 space-y-1.5 rounded-lg bg-amber-500/5 border border-amber-500/20 px-2.5 py-2">
          {triggers.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">
                Why
              </p>
              <ul className="space-y-0.5">
                {triggers.map((t, i) => (
                  <li key={i} className="text-[11px] text-foreground/90 leading-snug">
                    • {t}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {changes.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">
                What changed
              </p>
              <ul className="space-y-0.5">
                {changes.map((c, i) => (
                  <li key={i} className="text-[11px] text-foreground/90 leading-snug">
                    • {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground pt-0.5">
            Takes effect from the next trade scan. You can review or undo in Settings.
          </p>
        </div>
      </div>
    );
  }
  return <p className="text-xs text-foreground/90 leading-relaxed flex-1 min-w-0">{it.message}</p>;
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
            const gateKinds = [
              "session_hour_skip",
              "sl_width_skip",
              "ev_ratio_skip",
              "pre_entry_net_profit_skip",
            ];
            const structured =
              it.meta?.kind === "auto_book" ||
              it.meta?.kind === "skip" ||
              it.meta?.kind === "auto_tune" ||
              gateKinds.includes(it.meta?.kind ?? "");
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

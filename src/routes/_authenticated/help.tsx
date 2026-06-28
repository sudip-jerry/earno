import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ArrowRight,
  Sparkles,
  Radar,
  Brain,
  MessageSquareText,
  Play,
  ShieldCheck,
  TrendingUp,
  CheckCircle2,
} from "lucide-react";
import journeyAsset from "@/assets/earno-journey.png.asset.json";
import mascotHappy from "@/assets/earney-happy.png.asset.json";
import mascotAnalyzing from "@/assets/earney-analyzing.png.asset.json";
import mascotThinking from "@/assets/earney-thinking.png.asset.json";
import mascotConfident from "@/assets/earney-confident.png.asset.json";
import { useCurrency } from "@/hooks/use-currency";

const PRIMARY = "#082567";

export const Route = createFileRoute("/_authenticated/help")({
  head: () => ({
    meta: [
      { title: "Get Started — Earn'O" },
      { name: "description", content: "Welcome to Earn'O — Wealth, Engineered." },
    ],
  }),
  component: HelpPage,
});

const STEPS = [
  { key: "welcome", label: "Welcome" },
  { key: "flow", label: "How it works" },
  { key: "paper", label: "Paper trading" },
  { key: "automate", label: "Automate" },
] as const;

function HelpPage() {
  return (
    <div className="min-h-svh bg-background pb-28">
      <HelpFlow
        headerLeft={
          <Link to="/" className="size-9 grid place-items-center rounded-full hover:bg-muted -ml-2">
            <ChevronLeft className="size-5" />
          </Link>
        }
      />
    </div>
  );
}

export function HelpFlow({
  onClose,
  headerLeft,
}: {
  onClose?: () => void;
  headerLeft?: React.ReactNode;
}) {
  const [step, setStep] = useState(0);
  const total = STEPS.length;

  return (
    <div className="flex flex-col h-full">
      <header className="px-5 pt-6 pb-4 flex items-center gap-2 shrink-0">
        {headerLeft ??
          (onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="size-9 grid place-items-center rounded-full hover:bg-muted -ml-2"
            >
              <ChevronLeft className="size-5" />
            </button>
          ) : null)}
        <h1 className="text-base font-semibold">Get started</h1>
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {step + 1} / {total}
        </span>
      </header>

      {/* Progress */}
      <div className="px-5 shrink-0">
        <div className="flex gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`h-1 flex-1 rounded-full transition-all ${i <= step ? "" : "bg-muted"}`}
              style={i <= step ? { backgroundColor: PRIMARY } : undefined}
            />
          ))}
        </div>
      </div>

      <div className="px-5 pt-6 pb-32 overflow-y-auto animate-fade-in flex-1" key={step}>
        {step === 0 && <StepWelcome />}
        {step === 1 && <StepFlow />}
        {step === 2 && <StepPaper />}
        {step === 3 && <StepAutomate />}
      </div>

      {/* Footer CTAs */}
      <div className="sticky bottom-0 left-0 right-0 px-5 pb-5 pt-3 bg-gradient-to-t from-background via-background to-transparent">
        <div className="mx-auto max-w-md flex items-center gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="h-12 px-4 rounded-full border border-border bg-background text-sm font-medium hover:bg-muted"
            >
              Back
            </button>
          )}
          {step < total - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
              className="flex-1 h-12 rounded-full text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm hover:opacity-95"
              style={{ backgroundColor: PRIMARY }}
            >
              Continue <ArrowRight className="size-4" />
            </button>
          ) : (
            <>
              <Link
                to="/"
                onClick={onClose}
                className="flex-1 h-12 rounded-full text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm hover:opacity-95"
                style={{ backgroundColor: PRIMARY }}
              >
                Explore Demo <ArrowRight className="size-4" />
              </Link>
              <Link
                to="/settings"
                onClick={onClose}
                className="h-12 px-4 rounded-full border border-border bg-background text-sm font-medium hover:bg-muted inline-flex items-center"
              >
                Connect Exchange
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Steps ---------------- */

function StepWelcome() {
  const { fmt: fmtCur } = useCurrency();

  return (
    <section>
      <div className="flex items-end gap-3">
        <img
          src={mascotHappy.url}
          alt="Earney mascot"
          className="size-24 -mb-1 shrink-0 drop-shadow"
        />
        <div className="pb-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Hi, I'm Earn'O
          </p>
          <h2 className="mt-1 text-[28px] leading-[1.05] font-semibold tracking-tight">
            Welcome to <span className="text-primary">Earn'O</span>
          </h2>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
        Your AI market companion. Spot opportunities, understand the why, and grow your portfolio —
        with paper trading, manual control, or full automation.
      </p>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <Pillar icon={<Brain className="size-4" />} label="AI insight" />
        <Pillar icon={<ShieldCheck className="size-4" />} label="Risk first" />
        <Pillar icon={<TrendingUp className="size-4" />} label="Growth" />
      </div>

      <div className="mt-5 rounded-2xl border bg-card p-2 overflow-hidden">
        <img
          src={journeyAsset.url}
          alt="The Earn'O journey: scan markets, find opportunities, analyze, decide, execute, monitor and track performance."
          className="w-full h-auto rounded-xl"
        />
      </div>

      <Link
        to="/"
        className="mt-5 block rounded-2xl p-4 bg-gradient-to-br from-primary to-[#3B82F6] text-primary-foreground"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs opacity-80">Live demo</p>
            <p className="font-semibold mt-0.5">See your virtual portfolio</p>
            <p className="text-xs opacity-80 mt-0.5">
              No setup. Start with {fmtCur(1190)} paper capital.
            </p>
          </div>
          <ArrowRight className="size-5 shrink-0" />
        </div>
      </Link>
    </section>
  );
}

function StepFlow() {
  return (
    <section>
      <div className="flex items-end gap-3">
        <img
          src={mascotAnalyzing.url}
          alt="Earney analyzing"
          className="size-24 -mb-1 shrink-0 drop-shadow"
        />
        <div className="pb-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            How it works
          </p>
          <h2 className="mt-1 text-[22px] leading-tight font-semibold tracking-tight">
            Scan → Analyze → Explain → Trade
          </h2>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
        Hundreds of markets scanned live, ranked by confidence, every signal explained in plain
        English.
      </p>

      <DemoLoop />

      <div className="mt-5 grid grid-cols-2 gap-2">
        <MiniStep
          icon={<Radar className="size-4" />}
          title="Scan"
          body="Hundreds of pairs, live."
        />
        <MiniStep
          icon={<Brain className="size-4" />}
          title="Analyze"
          body="Confidence + risk scoring."
        />
        <MiniStep
          icon={<MessageSquareText className="size-4" />}
          title="Explain"
          body="Plain‑English rationale."
        />
        <MiniStep icon={<Play className="size-4" />} title="Trade" body="Paper, manual or auto." />
      </div>
    </section>
  );
}

function StepPaper() {
  const { fmt: fmtCur } = useCurrency();

  return (
    <section>
      <div className="flex items-end gap-3">
        <img
          src={mascotThinking.url}
          alt="Earney thinking"
          className="size-24 -mb-1 shrink-0 drop-shadow"
        />
        <div className="pb-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Risk free
          </p>
          <h2 className="mt-1 text-[24px] leading-tight font-semibold tracking-tight">
            Paper Trading First
          </h2>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
        Start with virtual capital. No exchange, no API keys, no real money at risk. Same signals,
        same scores — zero downside.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <StatCard label="Starting capital" value={fmtCur(1190)} />
        <StatCard label="Risk to wallet" value={fmtCur(0)} tone="positive" />
        <StatCard label="Signal quality" value="Same as live" />
        <StatCard label="Setup time" value="None" />
      </div>

      <ul className="mt-5 rounded-2xl border bg-card p-4 space-y-3">
        <Bullet>Virtual {fmtCur(1190)} portfolio to start.</Bullet>
        <Bullet>Same live signals, same confidence scores.</Bullet>
        <Bullet>Full P&amp;L tracking — today and all-time.</Bullet>
      </ul>

      <div className="mt-3 rounded-2xl p-4 bg-primary/5 border border-primary/20">
        <p className="text-xs font-semibold text-primary">Why it matters</p>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          Conviction beats luck. Paper trade until you trust the signals — then scale up on your own
          terms.
        </p>
      </div>
    </section>
  );
}

function StepAutomate() {
  return (
    <section>
      <div className="flex items-end gap-3">
        <img
          src={mascotConfident.url}
          alt="Earney confident"
          className="size-24 -mb-1 shrink-0 drop-shadow"
        />
        <div className="pb-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            When you're ready
          </p>
          <h2 className="mt-1 text-[24px] leading-tight font-semibold tracking-tight">
            Automate When Ready
          </h2>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
        Connect your exchange when you're confident. Earn'O executes with your risk rules, your
        limits, your control.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <StatCard label="You set" value="Risk caps" />
        <StatCard label="You set" value="Position size" />
        <StatCard label="You set" value="Daily loss cap" />
        <StatCard label="Anytime" value="Pause / resume" />
      </div>

      <ul className="mt-5 rounded-2xl border bg-card p-4 space-y-3">
        <Bullet>Connect CoinDCX securely, only when you choose.</Bullet>
        <Bullet>Pause, resume or override any time.</Bullet>
        <Bullet>Every trade still explained, every step.</Bullet>
      </ul>

      <Link
        to="/settings"
        className="mt-3 block rounded-2xl p-4 bg-gradient-to-br from-primary to-[#3B82F6] text-primary-foreground"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs opacity-80">When ready</p>
            <p className="font-semibold mt-0.5">Connect your exchange</p>
            <p className="text-xs opacity-80 mt-0.5">
              Optional. Many traders stay in paper forever — that's fine.
            </p>
          </div>
          <ArrowRight className="size-5 shrink-0" />
        </div>
      </Link>
    </section>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "positive" }) {
  return (
    <div className="rounded-2xl border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-base font-semibold tracking-tight tabular-nums ${tone === "positive" ? "text-emerald-500" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

/* ---------------- Pieces ---------------- */

function Pillar({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="rounded-xl border bg-card p-3 flex flex-col items-center gap-1.5">
      <span style={{ color: PRIMARY }}>{icon}</span>
      <span className="text-[11px] font-medium">{label}</span>
    </div>
  );
}

function MiniStep({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2">
        <span style={{ color: PRIMARY }}>{icon}</span>
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{body}</p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3 items-start">
      <CheckCircle2 className="size-5 shrink-0 mt-0.5" style={{ color: PRIMARY }} />
      <span className="text-sm text-foreground leading-relaxed">{children}</span>
    </li>
  );
}

/* ---------------- Looping demo animation (~14s) ---------------- */

const PHASES = [
  { key: "scan", label: "Scanning markets…", icon: Radar },
  { key: "find", label: "Finding opportunities", icon: Sparkles },
  { key: "confidence", label: "Calculating confidence", icon: Brain },
  { key: "explain", label: "Explaining rationale", icon: MessageSquareText },
  { key: "trade", label: "Opening paper trade", icon: Play },
  { key: "track", label: "Tracking P&L", icon: TrendingUp },
] as const;

const PHASE_MS = 2200;

function DemoLoop() {
  const { fmt: fmtCur } = useCurrency();
  const [phase, setPhase] = useState(0);
  const [pnl, setPnl] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), PHASE_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (phase < 4) {
      setPnl(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      const t = (Date.now() - start) / 1500;
      setPnl(Math.min(1, t) * (phase === 5 ? 427 : 180));
    }, 60);
    return () => clearInterval(id);
  }, [phase]);

  const Icon = PHASES[phase].icon;

  return (
    <div
      className="mt-5 rounded-2xl border overflow-hidden relative"
      style={{
        background: "linear-gradient(160deg, rgba(8,37,103,0.06), rgba(8,37,103,0) 60%)",
      }}
    >
      {/* Status bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-card/60 backdrop-blur">
        <span
          className="size-7 rounded-lg grid place-items-center"
          style={{ backgroundColor: "rgba(8,37,103,0.1)", color: PRIMARY }}
        >
          <Icon className="size-4" />
        </span>
        <p className="text-xs font-semibold">{PHASES[phase].label}</p>
        <span className="ml-auto flex gap-1">
          {PHASES.map((_, i) => (
            <span
              key={i}
              className="size-1.5 rounded-full transition-all"
              style={{
                backgroundColor: i === phase ? PRIMARY : "rgba(0,0,0,0.12)",
              }}
            />
          ))}
        </span>
      </div>

      <div className="p-4 space-y-2 min-h-[260px]">
        {/* Scan rows */}
        <DemoRow pair="BTCUSDT" side="Long" conf={84} active={phase >= 0} highlight={phase === 0} />
        <DemoRow
          pair="ETHUSDT"
          side="Short"
          conf={81}
          active={phase >= 1}
          highlight={phase === 1}
        />
        <DemoRow pair="SOLUSDT" side="Long" conf={74} active={phase >= 1} muted />

        {/* Confidence */}
        {phase >= 2 && (
          <div className="mt-3 rounded-xl border bg-card p-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                BTCUSDT · Confidence
              </p>
              <p className="text-sm font-semibold tabular-nums" style={{ color: PRIMARY }}>
                84%
              </p>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: phase >= 2 ? "84%" : "0%", backgroundColor: PRIMARY }}
              />
            </div>
          </div>
        )}

        {/* Rationale */}
        {phase >= 3 && (
          <div className="mt-2 rounded-xl border bg-card p-3 animate-fade-in">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <MessageSquareText className="size-3.5" /> Rationale
            </div>
            <p className="mt-1.5 text-xs leading-relaxed">
              Trend aligned across timeframes, momentum confirmed, entry near structure with capped
              downside.
            </p>
          </div>
        )}

        {/* Paper trade booked */}
        {phase >= 4 && (
          <div
            className="mt-2 rounded-xl border p-3 animate-fade-in flex items-center gap-3"
            style={{ borderColor: "rgba(8,37,103,0.25)", backgroundColor: "rgba(8,37,103,0.04)" }}
          >
            <CheckCircle2 className="size-5" style={{ color: PRIMARY }} />
            <div className="min-w-0">
              <p className="text-xs font-semibold">Paper trade opened</p>
              <p className="text-[11px] text-muted-foreground">BTCUSDT · Long · 84%</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">P&L</p>
              <p className="text-sm font-semibold tabular-nums text-emerald-600">
                {fmtCur(pnl / 84, { signed: true })}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DemoRow({
  pair,
  side,
  conf,
  active,
  highlight,
  muted,
}: {
  pair: string;
  side: "Long" | "Short";
  conf: number;
  active: boolean;
  highlight?: boolean;
  muted?: boolean;
}) {
  const isLong = side === "Long";
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2 transition-all ${
        active ? "opacity-100" : "opacity-30"
      } ${muted ? "opacity-60" : ""}`}
      style={
        highlight ? { borderColor: PRIMARY, boxShadow: "0 0 0 3px rgba(8,37,103,0.08)" } : undefined
      }
    >
      <p className="text-xs font-semibold w-20">{pair}</p>
      <span
        className={`text-[10px] font-semibold px-1.5 h-5 inline-flex items-center rounded border ${
          isLong
            ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
            : "bg-rose-500/10 text-rose-600 border-rose-500/20"
        }`}
      >
        {side.toUpperCase()}
      </span>
      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: active ? `${conf}%` : "0%", backgroundColor: PRIMARY }}
        />
      </div>
      <p className="text-xs font-semibold tabular-nums w-9 text-right">{conf}%</p>
    </div>
  );
}

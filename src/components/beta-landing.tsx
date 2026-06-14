import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Brain,
  FlaskConical,
  Bot,
  Radar,
  Eye,
  Play,
  ShieldCheck,
  LineChart,
  Layers,
  Activity,
  Gauge,
  BookOpen,
  Info,
  Sparkles,
} from "lucide-react";

const PRIMARY = "#082567";

export function BetaLanding() {
  return (
    <div className="bg-white text-neutral-900 -mx-5 px-0">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, rgba(8,37,103,0.06) 0%, rgba(255,255,255,0) 70%)",
          }}
        />
        <div className="mx-auto max-w-6xl px-5 pt-10 pb-10 md:pt-20 md:pb-16">
          <div className="grid md:grid-cols-2 gap-10 md:gap-14 items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-700">
                <Sparkles className="size-3.5" style={{ color: PRIMARY }} />
                Wealth, Engineered.
              </span>
              <h1 className="mt-5 text-3xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05] text-neutral-900">
                Trade Smarter.
                <br />
                <span style={{ color: PRIMARY }}>Grow Better.</span>
              </h1>
              <p className="mt-5 text-sm sm:text-lg text-neutral-600 max-w-xl leading-relaxed">
                earnO helps traders discover opportunities, understand market
                conditions, test strategies, and automate execution with
                confidence.
              </p>
              <div className="mt-7 flex flex-col sm:flex-row gap-3">
                <Link
                  to="/"
                  className="inline-flex items-center justify-center gap-2 rounded-full h-12 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-95"
                  style={{ backgroundColor: PRIMARY }}
                >
                  Start Paper Trading <ArrowRight className="size-4" />
                </Link>
                <Link
                  to="/movers"
                  className="inline-flex items-center justify-center gap-2 rounded-full h-12 px-6 text-sm font-medium text-neutral-900 border border-neutral-300 hover:bg-neutral-50"
                >
                  Explore Opportunities
                </Link>
              </div>
            </div>

            {/* Hero visual */}
            <div className="relative">
              <div
                aria-hidden
                className="absolute -inset-6 -z-10 rounded-3xl"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(8,37,103,0.08), rgba(8,37,103,0.0))",
                }}
              />
              <div className="space-y-3">
                <OppCard pair="BTC/USDT" side="Long" confidence={84} expReturn={0.6} risk={0.3} />
                <OppCard pair="ETH/USDT" side="Short" confidence={81} expReturn={0.5} risk={0.25} />
                <OppCard pair="SOL/USDT" side="Long" confidence={76} expReturn={0.8} risk={0.4} muted />
              </div>
            </div>
          </div>
        </div>
      </section>

      <Section eyebrow="Why earnO" title="Built for serious traders, made simple.">
        <div className="grid md:grid-cols-3 gap-4">
          <Feature icon={<Brain className="size-5" />} title="AI Market Intelligence" body="Analyze markets continuously and surface the most relevant opportunities." />
          <Feature icon={<FlaskConical className="size-5" />} title="Paper Trading First" body="Validate ideas and strategies before risking real capital." />
          <Feature icon={<Bot className="size-5" />} title="Automation With Control" body="Automate execution while staying in control of risk and decision-making." />
        </div>
      </Section>

      <Section eyebrow="How it works" title="From signal to execution in three steps.">
        <div className="grid md:grid-cols-3 gap-4">
          <Step n={1} icon={<Radar className="size-5" />} title="Scan" body="Monitor hundreds of market conditions in real time." />
          <Step n={2} icon={<Eye className="size-5" />} title="Understand" body="See confidence, risk and rationale behind every opportunity." />
          <Step n={3} icon={<Play className="size-5" />} title="Execute" body="Paper trade, automate, or execute manually." />
        </div>
      </Section>

      <Section eyebrow="Opportunity Engine" title="Every signal comes with a reason.">
        <div className="grid md:grid-cols-2 gap-4">
          <OppCard pair="BTC/USDT" side="Long" confidence={84} expReturn={0.6} risk={0.3} expanded />
          <OppCard pair="ETH/USDT" side="Short" confidence={81} expReturn={0.5} risk={0.25} expanded />
        </div>
        <p className="mt-6 text-sm text-neutral-600 max-w-2xl">
          Each opportunity tells you why it was identified — the trend, entry
          quality, momentum and risk signals — so you can act with conviction
          instead of guessing.
        </p>
      </Section>

      <Section eyebrow="Risk First" title="Risk management is built into every decision.">
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { icon: <ShieldCheck className="size-4" />, t: "Daily loss limits" },
            { icon: <Gauge className="size-4" />, t: "Position limits" },
            { icon: <Activity className="size-4" />, t: "Confidence thresholds" },
            { icon: <LineChart className="size-4" />, t: "Cooldowns" },
            { icon: <Layers className="size-4" />, t: "Automated safeguards" },
            { icon: <ShieldCheck className="size-4" />, t: "Capital preservation" },
          ].map((x) => (
            <div key={x.t} className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm">
              <span className="inline-flex items-center justify-center size-7 rounded-md" style={{ backgroundColor: "rgba(8,37,103,0.08)", color: PRIMARY }}>
                {x.icon}
              </span>
              <span className="font-medium text-neutral-900">{x.t}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section eyebrow="Platform" title="Everything you need to trade with intent.">
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
          <FeatureLite icon={<Radar className="size-4" />} t="Opportunity Scanner" />
          <FeatureLite icon={<Layers className="size-4" />} t="Strategy Builder" />
          <FeatureLite icon={<FlaskConical className="size-4" />} t="Paper Trading" />
          <FeatureLite icon={<LineChart className="size-4" />} t="Performance Analytics" />
          <FeatureLite icon={<Bot className="size-4" />} t="Automation Controls" />
          <FeatureLite icon={<BookOpen className="size-4" />} t="Trade Journal" />
        </div>
      </Section>

      <section className="px-5 pb-16 pt-4">
        <div
          className="mx-auto max-w-6xl rounded-3xl px-6 py-12 md:py-20 text-center text-white relative overflow-hidden"
          style={{ backgroundColor: PRIMARY }}
        >
          <div
            aria-hidden
            className="absolute inset-0 opacity-20"
            style={{
              background:
                "radial-gradient(60% 60% at 50% 0%, rgba(255,255,255,0.4), rgba(255,255,255,0) 70%)",
            }}
          />
          <h2 className="relative text-2xl md:text-5xl font-semibold tracking-tight">Wealth, Engineered.</h2>
          <p className="relative mt-4 text-white/80 max-w-xl mx-auto text-sm md:text-base">
            Discover opportunities, test ideas, and automate with confidence.
          </p>
          <div className="relative mt-7 flex justify-center">
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-full bg-white text-neutral-900 h-12 px-7 text-sm font-medium hover:bg-neutral-100"
            >
              Get Started <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-5 py-12 md:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: PRIMARY }}>
            {eyebrow}
          </p>
          <h2 className="mt-2 text-xl md:text-4xl font-semibold tracking-tight text-neutral-900">
            {title}
          </h2>
        </div>
        {children}
      </div>
    </section>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 hover:shadow-sm transition">
      <span className="inline-flex items-center justify-center size-10 rounded-xl" style={{ backgroundColor: "rgba(8,37,103,0.08)", color: PRIMARY }}>
        {icon}
      </span>
      <h3 className="mt-4 text-base font-semibold text-neutral-900">{title}</h3>
      <p className="mt-2 text-sm text-neutral-600 leading-relaxed">{body}</p>
    </div>
  );
}

function Step({ n, icon, title, body }: { n: number; icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold rounded-full px-2 py-0.5" style={{ color: PRIMARY, backgroundColor: "rgba(8,37,103,0.08)" }}>
          Step {n}
        </span>
        <span className="text-neutral-400">{icon}</span>
      </div>
      <h3 className="mt-4 text-base font-semibold text-neutral-900">{title}</h3>
      <p className="mt-2 text-sm text-neutral-600 leading-relaxed">{body}</p>
    </div>
  );
}

function FeatureLite({ icon, t }: { icon: React.ReactNode; t: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3.5">
      <span className="inline-flex items-center justify-center size-8 rounded-md" style={{ backgroundColor: "rgba(8,37,103,0.08)", color: PRIMARY }}>
        {icon}
      </span>
      <span className="text-sm font-medium text-neutral-900">{t}</span>
    </div>
  );
}

function OppCard({
  pair,
  side,
  confidence,
  expReturn,
  risk,
  muted = false,
  expanded = false,
}: {
  pair: string;
  side: "Long" | "Short";
  confidence: number;
  expReturn: number;
  risk: number;
  muted?: boolean;
  expanded?: boolean;
}) {
  const isLong = side === "Long";
  return (
    <div
      className={`rounded-2xl border bg-white p-4 sm:p-5 ${
        muted
          ? "border-neutral-200 opacity-80"
          : "border-neutral-200 shadow-[0_1px_0_rgba(8,37,103,0.04),0_8px_24px_-12px_rgba(8,37,103,0.18)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm text-neutral-900">{pair}</p>
            <span
              className={`inline-flex items-center px-2 h-5 rounded text-[10px] font-semibold border ${
                isLong
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-rose-50 text-rose-700 border-rose-200"
              }`}
            >
              {side.toUpperCase()}
            </span>
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5">Identified by AI</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-semibold tabular-nums leading-none text-neutral-900">{confidence}%</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">Confidence</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
        <Metric label="Expected" value={`+${expReturn.toFixed(2)}%`} positive />
        <Metric label="Risk" value={`−${risk.toFixed(2)}%`} negative />
        <Metric label="R:R" value={`${(expReturn / risk).toFixed(1)}x`} />
      </div>

      {expanded ? (
        <p className="mt-4 text-xs text-neutral-600 leading-relaxed border-t border-neutral-100 pt-3">
          Trend aligned across timeframes, momentum confirmed, entry near
          structure with capped downside.
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <button type="button" className="flex-1 h-9 rounded-lg text-white text-xs font-medium" style={{ backgroundColor: PRIMARY }}>
          Paper trade
        </button>
        <button type="button" className="h-9 px-3 inline-flex items-center gap-1 rounded-lg border border-neutral-300 text-xs text-neutral-700 hover:bg-neutral-50">
          <Info className="size-3.5" />
          Why?
        </button>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div>
      <p className="uppercase tracking-wider text-neutral-500">{label}</p>
      <p
        className={`tabular-nums font-semibold mt-0.5 ${
          positive ? "text-emerald-600" : negative ? "text-rose-600" : "text-neutral-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

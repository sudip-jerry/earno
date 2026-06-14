import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Linkedin, Shield, Scale, Megaphone } from "lucide-react";

export const Route = createFileRoute("/_authenticated/about")({
  head: () => ({
    meta: [
      { title: "About — Earn'O" },
      { name: "description", content: "About Earn'O — automated quantitative trading, built by traders for traders." },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="min-h-svh bg-background pb-24">
      <header className="px-5 pt-6 pb-4 flex items-center gap-2">
        <Link to="/settings" className="size-9 grid place-items-center rounded-full hover:bg-muted -ml-2">
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-xl font-semibold">About Earn'O</h1>
      </header>

      <section className="px-5 space-y-5">
        <div className="rounded-2xl border bg-card p-5 space-y-3">
          <p className="text-sm font-medium tracking-widest uppercase text-primary">Wealth, Engineered.</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Earn'O is an automated, quantitative trading assistant for CoinDCX Futures. It scans the
            market, scores opportunities, and executes a disciplined strategy on your behalf — so
            decisions are driven by data and rules, not emotion.
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Founder</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Earn'O is built by <span className="font-medium text-foreground">Sudip Gupta</span>, a
            technology and product leader with over a decade of experience across fintech, data,
            and AI-driven platforms. Sudip founded Earn'O to bring institutional-grade automation
            and risk discipline to retail crypto traders in a transparent, user-controlled way.
          </p>
          <a
            href="https://www.linkedin.com/in/sudipgupta87"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <Linkedin className="size-4" /> LinkedIn profile
          </a>
        </div>

        <div className="rounded-2xl border bg-card p-5 space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Shield className="size-4 text-primary" /> Security</h2>
          <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
            <li>Encrypted API key storage — keys are encrypted at rest and never exposed to the browser.</li>
            <li>Audit logs of every automated action and user-initiated change.</li>
            <li>Explicit user consent is required before any automation is enabled.</li>
            <li>You remain in full control of your CoinDCX account at all times.</li>
          </ul>
        </div>

        <div className="rounded-2xl border bg-card p-5 space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Scale className="size-4 text-primary" /> Legal</h2>
          <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
            <li>You control your account, your API keys, and your funds at all times.</li>
            <li>You assume all trading risk. Crypto derivatives can result in total loss of capital.</li>
            <li>No returns are guaranteed. Past performance does not indicate future results.</li>
            <li>Earn'O is a software tool — not investment advice, not a broker, not a fund.</li>
          </ul>
        </div>

        <div className="rounded-2xl border bg-card p-5 space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Megaphone className="size-4 text-primary" /> What Earn'O is — and isn't</h2>
          <div className="grid grid-cols-1 gap-3 text-sm">
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3">
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-500 mb-1">Earn'O is</p>
              <ul className="text-muted-foreground space-y-1 list-disc pl-5">
                <li>Automated strategy execution</li>
                <li>Quantitative market analysis</li>
                <li>User-controlled automation with configurable risk caps</li>
              </ul>
            </div>
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3">
              <p className="text-xs font-semibold text-destructive mb-1">Earn'O is not</p>
              <ul className="text-muted-foreground space-y-1 list-disc pl-5">
                <li>A guarantee of profits</li>
                <li>A way to "beat the market"</li>
                <li>Passive or risk-free income</li>
              </ul>
            </div>
          </div>
        </div>

        <Link
          to="/terms"
          className="block rounded-2xl border bg-card p-4 text-sm text-center hover:bg-muted"
        >
          Read full Terms & Disclaimer →
        </Link>
      </section>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

export const TERMS_VERSION = "2026-06-13";

export const Route = createFileRoute("/_authenticated/terms")({
  head: () => ({
    meta: [
      { title: "Terms & Disclaimer — EarnO" },
      { name: "description", content: "EarnO terms of use and risk disclaimer." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-svh bg-background pb-24">
      <header className="px-5 pt-6 pb-4 flex items-center gap-2">
        <Link to="/settings" className="size-9 grid place-items-center rounded-full hover:bg-muted -ml-2">
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-xl font-semibold">Terms & Disclaimer</h1>
      </header>
      <section className="px-5">
        <article className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground space-y-4 leading-relaxed">
          <p className="text-xs uppercase tracking-wider text-foreground/70">Version {TERMS_VERSION}</p>

          <div>
            <h2 className="text-sm font-semibold text-foreground mb-1">1. Your account, your control</h2>
            <p>You retain full ownership and control of your CoinDCX account, API keys, and funds. EarnO never custodies your assets and never has withdrawal permissions on your exchange account.</p>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-foreground mb-1">2. You assume all trading risk</h2>
            <p>Cryptocurrency derivatives and leveraged futures trading carry substantial risk and can result in the total loss of your capital. You are solely responsible for any orders placed by EarnO under your configuration.</p>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-foreground mb-1">3. No guaranteed returns</h2>
            <p>EarnO makes no representation, warranty, or guarantee of profit. Past performance, backtests, and paper-trading results do not indicate future results. Strategy outcomes depend on market conditions outside our control.</p>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-foreground mb-1">4. Software tool, not investment advice</h2>
            <p>EarnO is a software automation tool. Nothing in the app constitutes investment, financial, tax, or legal advice. You should consult a qualified professional before making financial decisions.</p>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-foreground mb-1">5. Automation consent</h2>
            <p>Automated order placement is opt-in. You must explicitly enable auto-booking and can pause it at any time from the Dashboard. All automated actions are logged and viewable in your account.</p>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-foreground mb-1">6. Security</h2>
            <p>API keys are stored encrypted at rest, never exposed to the browser, and used only to place orders on your behalf via CoinDCX. We recommend you enable Futures-only permissions and disable withdrawals on your API key.</p>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-foreground mb-1">7. Marketing &amp; claims</h2>
            <p>EarnO provides automated strategy execution, quantitative market analysis, and user-controlled automation. EarnO does not promise guaranteed profits, "beating the market", passive income, or risk-free trading.</p>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-foreground mb-1">8. Limitation of liability</h2>
            <p>To the maximum extent permitted by law, EarnO and its founders are not liable for any direct, indirect, incidental, or consequential losses arising from use of the service.</p>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-foreground mb-1">9. Changes</h2>
            <p>These terms may be updated. When the terms version changes, you'll be asked to re-confirm before continuing to use automated features.</p>
          </div>
        </article>
      </section>
    </div>
  );
}

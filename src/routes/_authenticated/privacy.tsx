import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ShieldCheck,
  Lock,
  Database,
  Cookie,
  UserCheck,
  Mail,
  Server,
  AlertTriangle,
} from "lucide-react";

export const PRIVACY_VERSION = "2026-06-17";
const COMPANY = "Earno Automations";
const CONTACT = "admin@rootsandroutes.com";

export const Route = createFileRoute("/_authenticated/privacy")({
  head: () => ({
    meta: [
      { title: "Trust & Privacy — Earn'O" },
      {
        name: "description",
        content: "How Earn'O protects your data, secures your API keys, and handles your privacy.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-svh bg-background pb-24">
      <header className="px-5 pt-6 pb-4 flex items-center gap-2">
        <Link
          to="/settings"
          className="size-9 grid place-items-center rounded-full hover:bg-muted -ml-2"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="text-xl font-semibold">Trust & Privacy</h1>
      </header>

      <section className="px-5 space-y-4">
        <div className="rounded-2xl border bg-card p-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Maintained by {COMPANY} · Version {PRIVACY_VERSION}
          </p>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            This page is maintained by {COMPANY} to answer common security and privacy questions
            about Earn'O. It describes the controls currently enabled in the product and how we
            handle your data. It is not an independent certification.
          </p>
        </div>

        <Pillars />

        <Article icon={<Lock className="size-4" />} title="1. Your API keys">
          <p>
            Your CoinDCX API keys are encrypted at rest in our database and are never exposed to the
            browser. They are used only to place orders on your behalf via the CoinDCX API.
          </p>
          <p>
            We strongly recommend you create a{" "}
            <strong className="text-foreground">Futures-only</strong> API key with{" "}
            <strong className="text-foreground">withdrawals disabled</strong>. Earn'O never
            custodies funds and cannot move assets off your exchange account.
          </p>
        </Article>

        <Article icon={<Database className="size-4" />} title="2. What data we collect">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong className="text-foreground">Account:</strong> email, authentication
              identifiers, and acceptance of terms.
            </li>
            <li>
              <strong className="text-foreground">Trading configuration:</strong> your strategy
              preferences, risk limits, and automation toggles.
            </li>
            <li>
              <strong className="text-foreground">Trading activity:</strong> orders we place on your
              behalf, paper-trade results, positions, and PnL — used to show your dashboard and
              improve the engine.
            </li>
            <li>
              <strong className="text-foreground">Operational logs:</strong> error reports and audit
              logs of config changes for safety and debugging.
            </li>
          </ul>
          <p>
            We do not collect government IDs, bank details, or KYC documents — those stay with
            CoinDCX.
          </p>
        </Article>

        <Article icon={<Server className="size-4" />} title="3. Where it runs">
          <p>
            Earn'O runs on managed cloud infrastructure with encryption in transit (HTTPS/TLS) and
            at rest. Database access is gated by row-level security so users can only read and write
            their own records.
          </p>
          <p>
            Application servers run in a sandboxed serverless runtime; we do not maintain shell
            access to user data in production for routine operations.
          </p>
        </Article>

        <Article icon={<UserCheck className="size-4" />} title="4. How we use your data">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              To operate the service — place the trades and show the analytics you've configured.
            </li>
            <li>To enforce risk limits and automation safeguards.</li>
            <li>To improve the strategy engine using aggregated, de-identified trade outcomes.</li>
            <li>To contact you about service status, security, or material product changes.</li>
          </ul>
          <p>We do not sell your personal data and we do not share it with advertisers.</p>
        </Article>

        <Article icon={<Cookie className="size-4" />} title="5. Cookies & analytics">
          <p>
            We use essential cookies and local storage to keep you signed in and remember
            preferences such as theme and currency. We do not use third-party advertising trackers.
          </p>
        </Article>

        <Article icon={<ShieldCheck className="size-4" />} title="6. Subprocessors">
          <p>We rely on a small number of subprocessors to run Earn'O:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong className="text-foreground">CoinDCX</strong> — to execute trades you
              configure.
            </li>
            <li>
              <strong className="text-foreground">Managed database & auth provider</strong> — to
              store your account and trading data with row-level security.
            </li>
            <li>
              <strong className="text-foreground">Hosting provider</strong> — to serve the
              application.
            </li>
            <li>
              <strong className="text-foreground">Payments provider</strong> — only if you upgrade
              to a paid plan.
            </li>
          </ul>
        </Article>

        <Article icon={<UserCheck className="size-4" />} title="7. Your rights">
          <p>You can:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Export or request a copy of the data tied to your account.</li>
            <li>Delete your stored API credentials at any time from Settings.</li>
            <li>Request deletion of your account and associated data by emailing us.</li>
            <li>Pause or disable automation at any time.</li>
          </ul>
        </Article>

        <Article
          icon={<AlertTriangle className="size-4" />}
          title="8. Incident & vulnerability reporting"
        >
          <p>
            If you believe you've found a security issue or a privacy concern, please email{" "}
            <a href={`mailto:${CONTACT}`} className="text-primary underline">
              {CONTACT}
            </a>
            . We aim to acknowledge reports within two business days.
          </p>
          <p>
            In the event of a security incident affecting your account data, we will notify affected
            users by email with what happened and what action, if any, you should take.
          </p>
        </Article>

        <Article icon={<Mail className="size-4" />} title="9. Contact">
          <p>
            {COMPANY}
            <br />
            Privacy & security:{" "}
            <a href={`mailto:${CONTACT}`} className="text-primary underline">
              {CONTACT}
            </a>
          </p>
          <p className="text-xs">
            See also our{" "}
            <Link to="/terms" className="text-primary underline">
              Terms & Risk Disclaimer
            </Link>
            .
          </p>
        </Article>
      </section>
    </div>
  );
}

function Pillars() {
  const items = [
    {
      icon: <Lock className="size-4" />,
      t: "Encrypted API keys",
      d: "Stored encrypted, never exposed to your browser.",
    },
    {
      icon: <ShieldCheck className="size-4" />,
      t: "Row-level security",
      d: "You can only read and write your own data.",
    },
    {
      icon: <Database className="size-4" />,
      t: "No custody",
      d: "We never hold your funds. Withdrawals stay disabled.",
    },
    {
      icon: <UserCheck className="size-4" />,
      t: "Opt-in automation",
      d: "Auto-book is off by default and pausable anytime.",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((x) => (
        <div key={x.t} className="rounded-xl border bg-card p-3">
          <span className="inline-flex items-center justify-center size-8 rounded-md bg-primary/10 text-primary">
            {x.icon}
          </span>
          <p className="mt-2 text-sm font-semibold text-foreground">{x.t}</p>
          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{x.d}</p>
        </div>
      ))}
    </div>
  );
}

function Article({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground space-y-2.5 leading-relaxed">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="inline-flex items-center justify-center size-6 rounded-md bg-primary/10 text-primary">
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </article>
  );
}

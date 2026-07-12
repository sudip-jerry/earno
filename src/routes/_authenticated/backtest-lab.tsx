import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ScatterChart,
  Scatter,
  ZAxis,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, Loader2, Play, TrendingUp, TrendingDown, Target, Percent } from "lucide-react";
import { getMyEntitlements } from "@/lib/plans.functions";
import {
  runFilterBacktest,
  runGenerateBacktest,
  runMoversBacktest,
} from "@/lib/backtest-lab.functions";

export const Route = createFileRoute("/_authenticated/backtest-lab")({
  head: () => ({
    meta: [
      { title: "Backtest Lab — Earn'O" },
      { name: "description", content: "Run and visualize Earn'O backtesting strategies." },
    ],
  }),
  component: BacktestLabPage,
});

type Mode = "filter" | "generate" | "movers";

type Summary = {
  n: number;
  winRate: number;
  profitFactor: number | null;
  expectancy: number;
  net: number;
};

type FilterResult = {
  ok: true;
  scope: { sinceHours: number; limit: number; side: string; trades: number; evaluated: number; noData: number };
  rulePass: Summary;
  ruleFail: Summary;
  baseline: Summary;
  elapsedMs: number;
};

type GenerateResult = {
  ok: true;
  mode: "generate";
  scope: { sinceHours: number; symbols: number; symbolsWithData: number; tpPct: number; slPct: number; maxHoldBars: number };
  result: Summary;
  perSymbol: Record<string, { entries: number; wins: number; net: number }>;
  elapsedMs: number;
};

type MoversResult = {
  ok: true;
  mode: "movers";
  scope: Record<string, unknown> & { universe: number; symbolsWithData: number };
  universe: string[];
  long: Summary;
  short: Summary;
  combined: Summary;
  perSymbol: Record<string, { long: number; short: number; net: number }>;
  elapsedMs: number;
};

type AnyResult = FilterResult | GenerateResult | MoversResult | { ok: false; error: string };

function BacktestLabPage() {
  const entFn = useServerFn(getMyEntitlements);
  const ent = useQuery({ queryKey: ["entitlements"], queryFn: () => entFn() });

  const [mode, setMode] = useState<Mode>("filter");

  // Filter params
  const [fSinceHours, setFSinceHours] = useState(240);
  const [fLimit, setFLimit] = useState(600);
  const [fSide, setFSide] = useState<"long" | "short">("long");

  // Generate params
  const [gSinceHours, setGSinceHours] = useState(72);
  const [gMaxSymbols, setGMaxSymbols] = useState(10);
  const [gTp, setGTp] = useState(1.5);
  const [gSl, setGSl] = useState(1.0);

  // Movers params
  const [mSinceHours, setMSinceHours] = useState(72);
  const [mMaxSymbols, setMMaxSymbols] = useState(15);
  const [mMoverGate, setMMoverGate] = useState(4);
  const [mTp, setMTp] = useState(1.5);
  const [mSl, setMSl] = useState(1.0);
  const [mSide, setMSide] = useState<"long" | "short" | "both">("both");
  const [mShortRule, setMShortRule] = useState<"continuation" | "exhaustion" | "meanrev">("continuation");

  const filterFn = useServerFn(runFilterBacktest);
  const genFn = useServerFn(runGenerateBacktest);
  const moversFn = useServerFn(runMoversBacktest);

  const run = useMutation({
    mutationFn: async (): Promise<AnyResult> => {
      if (mode === "filter") {
        return (await filterFn({ data: { sinceHours: fSinceHours, limit: fLimit, side: fSide } })) as AnyResult;
      }
      if (mode === "generate") {
        return (await genFn({
          data: { sinceHours: gSinceHours, maxSymbols: gMaxSymbols, tpPct: gTp, slPct: gSl },
        })) as AnyResult;
      }
      return (await moversFn({
        data: {
          sinceHours: mSinceHours,
          maxSymbols: mMaxSymbols,
          moverGatePct: mMoverGate,
          tpPct: mTp,
          slPct: mSl,
          side: mSide,
          shortRule: mShortRule,
        },
      })) as AnyResult;
    },
  });

  const result = run.data;

  if (ent.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!ent.data?.isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <p className="text-sm text-muted-foreground">Backtest Lab is admin-only.</p>
        <Link to="/" className="text-xs underline text-primary">
          Back home
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur-xl bg-background/70 border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            to="/more"
            className="w-8 h-8 rounded-full bg-muted flex items-center justify-center hover:bg-muted/70"
          >
            <ChevronLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-base font-semibold tracking-tight">Backtest Lab</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Simulate · Compare · Visualize
            </p>
          </div>
          {run.isPending && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-5">
        {/* Mode picker */}
        <section>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { k: "filter", label: "Filter", desc: "Rule-pass vs fail on real trades" },
                { k: "generate", label: "Generate", desc: "Fire entries from history" },
                { k: "movers", label: "Movers", desc: "Top-mover momentum universe" },
              ] as const
            ).map((m) => (
              <button
                key={m.k}
                onClick={() => setMode(m.k)}
                className={`text-left rounded-2xl border p-3 transition ${
                  mode === m.k
                    ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/20"
                    : "bg-card hover:border-primary/40"
                }`}
              >
                <div className="text-sm font-semibold">{m.label}</div>
                <div className={`text-[10px] mt-0.5 ${mode === m.k ? "opacity-80" : "text-muted-foreground"}`}>
                  {m.desc}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Params */}
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Parameters</h2>
          {mode === "filter" && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Since (hours)" value={fSinceHours} onChange={setFSinceHours} />
              <Field label="Trade limit" value={fLimit} onChange={setFLimit} />
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Side</Label>
                <Select value={fSide} onValueChange={(v) => setFSide(v as "long" | "short")}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="long">Long</SelectItem>
                    <SelectItem value="short">Short</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {mode === "generate" && (
            <div className="grid grid-cols-4 gap-3">
              <Field label="Since (hours)" value={gSinceHours} onChange={setGSinceHours} />
              <Field label="Max symbols" value={gMaxSymbols} onChange={setGMaxSymbols} />
              <Field label="TP %" value={gTp} onChange={setGTp} step={0.1} />
              <Field label="SL %" value={gSl} onChange={setGSl} step={0.1} />
            </div>
          )}
          {mode === "movers" && (
            <div className="grid grid-cols-4 gap-3">
              <Field label="Since (hours)" value={mSinceHours} onChange={setMSinceHours} />
              <Field label="Max symbols" value={mMaxSymbols} onChange={setMMaxSymbols} />
              <Field label="Mover gate %" value={mMoverGate} onChange={setMMoverGate} step={0.5} />
              <Field label="TP %" value={mTp} onChange={setMTp} step={0.1} />
              <Field label="SL %" value={mSl} onChange={setMSl} step={0.1} />
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Side</Label>
                <Select value={mSide} onValueChange={(v) => setMSide(v as typeof mSide)}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Both</SelectItem>
                    <SelectItem value="long">Long</SelectItem>
                    <SelectItem value="short">Short</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Short rule</Label>
                <Select value={mShortRule} onValueChange={(v) => setMShortRule(v as typeof mShortRule)}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="continuation">Continuation</SelectItem>
                    <SelectItem value="exhaustion">Exhaustion (fade gainer)</SelectItem>
                    <SelectItem value="meanrev">Mean-reversion</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <Button
              onClick={() => run.mutate()}
              disabled={run.isPending}
              className="gap-2"
            >
              {run.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Run backtest
            </Button>
            {result && "elapsedMs" in result && (
              <span className="text-[10px] text-muted-foreground">
                Completed in {(result.elapsedMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </section>

        {run.error && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-3 text-xs text-rose-500">
            {(run.error as Error).message}
          </div>
        )}

        {result && "ok" in result && !result.ok && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-3 text-xs text-rose-500">
            {result.error}
          </div>
        )}

        {result && "ok" in result && result.ok && mode === "filter" && (
          <FilterViz r={result as FilterResult} />
        )}
        {result && "ok" in result && result.ok && mode === "generate" && (
          <GenerateViz r={result as GenerateResult} />
        )}
        {result && "ok" in result && result.ok && mode === "movers" && (
          <MoversViz r={result as MoversResult} />
        )}

        {result && "ok" in result && result.ok && (
          <details className="rounded-2xl border bg-card">
            <summary className="cursor-pointer px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">
              Raw JSON
            </summary>
            <pre className="px-4 pb-4 text-[10px] overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        )}
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        className="h-9 mt-1 tabular-nums"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/* ------------------------- Visualizations ------------------------- */

const POS = "hsl(var(--primary))";
const NEG = "hsl(0 84% 60%)";
const NEUT = "hsl(var(--muted-foreground))";
const GOLD = "hsl(45 93% 55%)";

function StatCard({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg" | "gold";
  icon?: React.ReactNode;
}) {
  const color =
    tone === "pos"
      ? "text-emerald-500"
      : tone === "neg"
        ? "text-rose-500"
        : tone === "gold"
          ? "text-amber-500"
          : "text-foreground";
  return (
    <div className="rounded-2xl border bg-card p-3 relative overflow-hidden">
      {icon && <div className="absolute top-2 right-2 opacity-20">{icon}</div>}
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function summaryRow(s: Summary, label: string, color: string) {
  return { name: label, n: s.n, winRate: s.winRate, pf: s.profitFactor ?? 0, exp: s.expectancy, net: s.net, fill: color };
}

function FilterViz({ r }: { r: FilterResult }) {
  const bars = [
    summaryRow(r.rulePass, "Rule PASS", POS),
    summaryRow(r.ruleFail, "Rule FAIL", NEG),
    summaryRow(r.baseline, "Baseline", NEUT),
  ];

  return (
    <div className="space-y-4">
      {/* Hero KPIs */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard
          label="Rule net PnL"
          value={r.rulePass.net > 0 ? `+${r.rulePass.net}` : `${r.rulePass.net}`}
          tone={r.rulePass.net >= 0 ? "pos" : "neg"}
          icon={<TrendingUp className="w-6 h-6" />}
        />
        <StatCard
          label="Win rate"
          value={`${r.rulePass.winRate}%`}
          sub={`vs ${r.baseline.winRate}% baseline`}
          tone={r.rulePass.winRate > r.baseline.winRate ? "pos" : "neg"}
          icon={<Percent className="w-6 h-6" />}
        />
        <StatCard
          label="Profit factor"
          value={r.rulePass.profitFactor?.toFixed(2) ?? "—"}
          sub={r.rulePass.profitFactor && r.rulePass.profitFactor > 1 ? "positive edge" : "no edge"}
          tone={r.rulePass.profitFactor && r.rulePass.profitFactor > 1 ? "gold" : "neg"}
          icon={<Target className="w-6 h-6" />}
        />
        <StatCard
          label="Sample"
          value={`${r.rulePass.n}`}
          sub={`of ${r.scope.evaluated} eval'd (${r.scope.side})`}
          icon={<TrendingDown className="w-6 h-6" />}
        />
      </div>

      {/* Comparison bars */}
      <div className="grid grid-cols-2 gap-3">
        <ChartCard title="Net PnL comparison">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bars}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="name" fontSize={10} />
              <YAxis fontSize={10} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Bar dataKey="net" radius={[8, 8, 0, 0]}>
                {bars.map((b, i) => (
                  <Cell key={i} fill={b.net >= 0 ? POS : NEG} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Win rate">
          <ResponsiveContainer width="100%" height={220}>
            <RadialBarChart
              innerRadius="35%"
              outerRadius="100%"
              data={bars.map((b) => ({ ...b, winRate: b.winRate }))}
              startAngle={90}
              endAngle={-270}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar dataKey="winRate" cornerRadius={10} background />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
            </RadialBarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Detailed table */}
      <div className="rounded-2xl border bg-card overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">Group</th>
              <th className="px-3 py-2 text-right">N</th>
              <th className="px-3 py-2 text-right">Win %</th>
              <th className="px-3 py-2 text-right">PF</th>
              <th className="px-3 py-2 text-right">Expectancy</th>
              <th className="px-3 py-2 text-right">Net</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {bars.map((b) => (
              <tr key={b.name} className="border-t">
                <td className="px-3 py-2 font-medium">{b.name}</td>
                <td className="px-3 py-2 text-right">{b.n}</td>
                <td className="px-3 py-2 text-right">{b.winRate}%</td>
                <td className="px-3 py-2 text-right">{b.pf.toFixed(2)}</td>
                <td className={`px-3 py-2 text-right ${b.exp >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                  {b.exp >= 0 ? "+" : ""}{b.exp.toFixed(3)}
                </td>
                <td className={`px-3 py-2 text-right font-semibold ${b.net >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                  {b.net >= 0 ? "+" : ""}{b.net.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GenerateViz({ r }: { r: GenerateResult }) {
  const perSymbol = useMemo(
    () =>
      Object.entries(r.perSymbol)
        .map(([sym, s]) => ({
          sym: sym.replace(/^B-/, "").replace(/_USDT$/, ""),
          entries: s.entries,
          wins: s.wins,
          losses: s.entries - s.wins,
          net: Number(s.net.toFixed(2)),
          winRate: s.entries ? Math.round((100 * s.wins) / s.entries) : 0,
        }))
        .sort((a, b) => b.net - a.net),
    [r],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        <StatCard label="Entries" value={`${r.result.n}`} sub={`${r.scope.symbolsWithData} symbols`} />
        <StatCard
          label="Win rate"
          value={`${r.result.winRate}%`}
          tone={r.result.winRate >= 50 ? "pos" : "neg"}
          icon={<Percent className="w-6 h-6" />}
        />
        <StatCard
          label="PF"
          value={r.result.profitFactor?.toFixed(2) ?? "—"}
          tone={r.result.profitFactor && r.result.profitFactor > 1 ? "gold" : "neg"}
          icon={<Target className="w-6 h-6" />}
        />
        <StatCard
          label="Net %"
          value={r.result.net >= 0 ? `+${r.result.net.toFixed(1)}` : `${r.result.net.toFixed(1)}`}
          tone={r.result.net >= 0 ? "pos" : "neg"}
        />
      </div>

      <ChartCard title={`Per-symbol net % (TP ${r.scope.tpPct} / SL ${r.scope.slPct})`}>
        <ResponsiveContainer width="100%" height={Math.max(240, perSymbol.length * 22)}>
          <BarChart data={perSymbol} layout="vertical" margin={{ left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis type="number" fontSize={10} />
            <YAxis dataKey="sym" type="category" width={70} fontSize={10} />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Bar dataKey="net" radius={[0, 8, 8, 0]}>
              {perSymbol.map((s, i) => (
                <Cell key={i} fill={s.net >= 0 ? POS : NEG} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Win-rate vs entry count (bubble = |net|)">
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis type="number" dataKey="entries" name="entries" fontSize={10} />
            <YAxis type="number" dataKey="winRate" name="win %" unit="%" fontSize={10} domain={[0, 100]} />
            <ZAxis type="number" dataKey="net" range={[50, 400]} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ fontSize: 11 }} />
            <Scatter data={perSymbol}>
              {perSymbol.map((s, i) => (
                <Cell key={i} fill={s.net >= 0 ? POS : NEG} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function MoversViz({ r }: { r: MoversResult }) {
  const bars = [
    { name: "Long", n: r.long.n, winRate: r.long.winRate, pf: r.long.profitFactor ?? 0, net: r.long.net, fill: POS },
    { name: "Short", n: r.short.n, winRate: r.short.winRate, pf: r.short.profitFactor ?? 0, net: r.short.net, fill: NEG },
    { name: "Combined", n: r.combined.n, winRate: r.combined.winRate, pf: r.combined.profitFactor ?? 0, net: r.combined.net, fill: GOLD },
  ];

  const perSymbol = useMemo(
    () =>
      Object.entries(r.perSymbol)
        .map(([sym, s]) => ({
          sym: sym.replace(/^B-/, "").replace(/_USDT$/, ""),
          long: s.long,
          short: s.short,
          net: Number(s.net.toFixed(2)),
        }))
        .sort((a, b) => b.net - a.net),
    [r],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        <StatCard label="Universe" value={`${r.scope.universe}`} sub={`${r.scope.symbolsWithData} with data`} />
        <StatCard
          label="Combined WR"
          value={`${r.combined.winRate}%`}
          tone={r.combined.winRate >= 50 ? "pos" : "neg"}
          icon={<Percent className="w-6 h-6" />}
        />
        <StatCard
          label="Combined PF"
          value={r.combined.profitFactor?.toFixed(2) ?? "—"}
          tone={r.combined.profitFactor && r.combined.profitFactor > 1 ? "gold" : "neg"}
          icon={<Target className="w-6 h-6" />}
        />
        <StatCard
          label="Net %"
          value={r.combined.net >= 0 ? `+${r.combined.net.toFixed(1)}` : `${r.combined.net.toFixed(1)}`}
          tone={r.combined.net >= 0 ? "pos" : "neg"}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ChartCard title="Direction breakdown — Net %">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bars}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="name" fontSize={10} />
              <YAxis fontSize={10} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Bar dataKey="net" radius={[8, 8, 0, 0]}>
                {bars.map((b, i) => (
                  <Cell key={i} fill={b.net >= 0 ? b.fill : NEG} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Trade counts">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bars}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="name" fontSize={10} />
              <YAxis fontSize={10} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Bar dataKey="n" radius={[8, 8, 0, 0]}>
                {bars.map((b, i) => (
                  <Cell key={i} fill={b.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {perSymbol.length > 0 && (
        <ChartCard title="Per-symbol long vs short entries">
          <ResponsiveContainer width="100%" height={Math.max(240, perSymbol.length * 24)}>
            <BarChart data={perSymbol} layout="vertical" margin={{ left: 40 }} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis type="number" fontSize={10} />
              <YAxis dataKey="sym" type="category" width={70} fontSize={10} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="long" stackId="a" fill={POS} radius={[0, 0, 0, 0]} />
              <Bar dataKey="short" stackId="a" fill={NEG} radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <div className="rounded-2xl border bg-card p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Universe ({r.universe.length})
        </div>
        <div className="flex flex-wrap gap-1.5">
          {r.universe.map((s) => (
            <span
              key={s}
              className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground tabular-nums"
            >
              {s.replace(/^B-/, "").replace(/_USDT$/, "")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      {children}
    </div>
  );
}

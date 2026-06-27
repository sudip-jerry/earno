import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  replayFuturesExitPolicy,
  type ReplaySummary,
  type ReplayBucket,
} from "@/lib/futures-exit-replay.functions";

export const Route = createFileRoute("/_authenticated/exit-replay")({
  component: ExitReplayPage,
  head: () => ({ meta: [{ title: "Exit Policy Replay" }] }),
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 text-sm">
        <p className="text-destructive">{error.message}</p>
        <button
          className="mt-3 rounded border px-3 py-1.5"
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          Retry
        </button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

const BUCKETS: ReplayBucket[] = [
  "pre_tp1_policy_exit",
  "hard_sl",
  "breakeven_exit",
  "take_profit",
  "other",
];

const LABELS: Record<ReplayBucket, string> = {
  pre_tp1_policy_exit: "Pre-TP1 policy exits",
  hard_sl: "Hard SL",
  breakeven_exit: "Breakeven exits",
  take_profit: "Take profit",
  other: "Other",
};

function ExitReplayPage() {
  const replay = useServerFn(replayFuturesExitPolicy);
  const [hours, setHours] = useState(72);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<ReplaySummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await replay({ data: { sinceHours: hours, limit: 200 } });
      setData(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-6 space-y-5 max-w-3xl mx-auto">
      <header>
        <h1 className="text-xl font-semibold">Exit Policy Replay</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Replays the pre-TP1 protective exit policy against your closed paper trades.
          Read-only — no positions are modified.
        </p>
      </header>

      <div className="flex items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground mb-1">Window (hours)</span>
          <input
            type="number"
            min={1}
            max={720}
            value={hours}
            onChange={(e) => setHours(Math.max(1, Math.min(720, Number(e.target.value) || 1)))}
            className="w-24 rounded border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={run}
          disabled={busy}
          className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? "Running…" : "Run replay"}
        </button>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      {data && (
        <>
          <div className="rounded-2xl border p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
              {data.total} closed trades · {new Date(data.windowStart).toLocaleString()} →{" "}
              {new Date(data.windowEnd).toLocaleString()}
            </p>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-medium py-1">Bucket</th>
                  <th className="text-right font-medium py-1">Actual</th>
                  <th className="text-right font-medium py-1">Replay</th>
                  <th className="text-right font-medium py-1">Δ</th>
                </tr>
              </thead>
              <tbody>
                {BUCKETS.map((b) => (
                  <tr key={b} className="border-t">
                    <td className="py-1.5">{LABELS[b]}</td>
                    <td className="py-1.5 text-right tabular-nums">{data.actual[b]}</td>
                    <td className="py-1.5 text-right tabular-nums">{data.replay[b]}</td>
                    <td
                      className={`py-1.5 text-right tabular-nums ${
                        data.delta[b] > 0
                          ? "text-emerald-500"
                          : data.delta[b] < 0
                            ? "text-destructive"
                            : ""
                      }`}
                    >
                      {data.delta[b] > 0 ? "+" : ""}
                      {data.delta[b]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border">
            <div className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground border-b">
              Per-trade detail
            </div>
            <div className="max-h-[60svh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground sticky top-0 bg-background">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Symbol</th>
                    <th className="text-left font-medium px-3 py-2">Side</th>
                    <th className="text-left font-medium px-3 py-2">Actual</th>
                    <th className="text-left font-medium px-3 py-2">Replay</th>
                    <th className="text-right font-medium px-3 py-2">Held (m)</th>
                    <th className="text-right font-medium px-3 py-2">Peak ROE</th>
                    <th className="text-right font-medium px-3 py-2">Cur ROE</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.positionId} className="border-t">
                      <td className="px-3 py-1.5">{r.symbol}</td>
                      <td className="px-3 py-1.5 uppercase">{r.side}</td>
                      <td className="px-3 py-1.5">{LABELS[r.actualBucket]}</td>
                      <td
                        className={`px-3 py-1.5 ${
                          r.replayBucket === "pre_tp1_policy_exit" ? "text-amber-500" : ""
                        }`}
                      >
                        {LABELS[r.replayBucket]}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.policyTriggerMinutes ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.policyPeakRoePct != null ? `${r.policyPeakRoePct}%` : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.policyCurrentRoePct != null ? `${r.policyCurrentRoePct}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

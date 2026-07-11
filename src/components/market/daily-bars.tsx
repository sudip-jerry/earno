/**
 * Daily PnL bar chart for the brand-hero surface (white text / translucent
 * bars). Shared so the Coins hero shows the same chart the Futures hero does.
 * Pass a chronological { date: "YYYY-MM-DD", pnl } series; the last 14 render.
 */
export function DailyBars({ series }: { series: { date: string; pnl: number }[] }) {
  const s = series.slice(-14);
  const maxAbs = s.reduce((a, d) => Math.max(a, Math.abs(d.pnl)), 0);

  if (s.length < 3) {
    return (
      <div className="mt-4 h-[64px] grid place-items-center text-[12px] text-white/60">
        Chart builds as trades close
      </div>
    );
  }

  return (
    <div className="mt-4 flex items-end gap-1.5 h-[64px]">
      {s.map((d) => {
        const ratio = maxAbs > 0 ? Math.abs(d.pnl) / maxAbs : 0;
        const h = Math.max(3, Math.round(ratio * 48));
        const pos = d.pnl >= 0;
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
            <div
              className={`w-full rounded-sm ${pos ? "bg-emerald-400" : "bg-rose-400"}`}
              style={{ height: `${h}px` }}
            />
            <div className="text-[9px] text-white/50 tabular-nums leading-none">
              {d.date.slice(-2)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
